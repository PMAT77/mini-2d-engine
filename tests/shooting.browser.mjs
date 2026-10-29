import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const measurements = [];
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const angleNear = (a, b) => near(Math.atan2(Math.sin(a - b), Math.cos(a - b)), 0);
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.shootingGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => shootingGame.sceneManager.getCurrentScene()?.loaded);
    await page.keyboard.up('Enter');
    await page.evaluate(() => {
      const scene = shootingGame.sceneManager.getCurrentScene();
      scene.map = new scene.map.constructor(30, 24, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.pickupItems = []; scene.goldPickups = [];
      scene.player.x = scene.player.y = 400; scene.camera.reset(); scene.particleSystem.clear();
    });
    // Also exercise the running game loop, rather than only inspecting manually stepped state.
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('w');
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const scene = shootingGame.sceneManager.getCurrentScene(), draw = scene.draw;
      window.liveAimFrames = [];
      window.liveAimBody = scene.player.getBodyRotation();
      scene.draw = function (ctx) {
        const aim = this.player.getAimState();
        if (aim.visible && Math.abs(aim.targetAngle - Math.PI / 4) < 1e-8) {
          liveAimFrames.push({ angle: aim.angle, body: this.player.getBodyRotation(), time: performance.now() });
        }
        return draw.call(this, ctx);
      };
      window.restoreAimDraw = () => { scene.draw = draw; };
    });
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(175);
    const { frames: liveFrames, body: liveBody } = await page.evaluate(() => {
      restoreAimDraw(); return { frames: liveAimFrames, body: liveAimBody };
    });
    assert.ok(liveFrames.some(frame => frame.angle > 0 && frame.angle < Math.PI / 4 - 1e-8),
      `running game must draw an intermediate angle after a long hold, DPR ${dpr}: ${JSON.stringify(liveFrames)}`);
    angleNear(liveFrames.at(-1).angle, Math.PI / 4);
    for (let i = 0; i < liveFrames.length; i++) {
      angleNear(liveFrames[i].body, liveBody);
      if (i > 0) assert.ok(liveFrames[i].angle >= liveFrames[i - 1].angle - 1e-8);
    }
    angleNear(liveBody, 0);
    await page.keyboard.up('w'); await page.keyboard.down('a');
    await page.waitForTimeout(300);
    const moving = await page.evaluate(() => {
      const p = shootingGame.sceneManager.getCurrentScene().player;
      return { ...p.getAimState(), body: p.getBodyRotation(), velocity: p.getVelocity() };
    });
    angleNear(moving.angle, Math.PI / 4); angleNear(moving.body, -Math.PI / 2);
    assert.ok(moving.velocity.x < 0);
    await page.keyboard.up('a'); await page.waitForTimeout(250);
    const stopped = await page.evaluate(() => {
      const p = shootingGame.sceneManager.getCurrentScene().player;
      return { ...p.getAimState(), body: p.getBodyRotation(), speed: p.getVelocity().length() };
    });
    angleNear(stopped.angle, Math.PI / 4); angleNear(stopped.body, moving.body); near(stopped.speed, 0);
    await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(30);
    await page.evaluate(() => {
      const game = shootingGame, scene = game.sceneManager.getCurrentScene();
      scene.update = () => {};
      scene.map = new scene.map.constructor(30, 24, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tileHighlight.forEach(row => row.fill(0));
      scene.pickupItems = []; scene.goldPickups = []; scene.particleSystem.clear();
      scene.camera.x = scene.camera.y = 0;
      const p = new scene.player.constructor(400, 400, scene.player.sprite, scene.particleSystem);
      p.applyConfig(scene.configLoader.getConfig('playerConfig'));
      scene.player = p;
      let last = performance.now() / 1000;
      const shots = [];
      p.setOnShootCallback(direction => {
        const b = p.getBullets().at(-1), pos = b.getPosition();
        shots.push({ angle: Math.atan2(direction.y, direction.x), pointer: p.getAimState().angle,
          body: p.getBodyRotation(), x: pos.x + b.getSize() / 2, y: pos.y + b.getSize() / 2 });
      });
      game.input.consumeAimChanges();
      window.shootingTest = {
        game, scene, p, shots,
        render() {
          const Vector2 = p.getVelocity().constructor;
          scene.playerLight.setPosition(new Vector2(p.x + p.getSize() / 2, p.y + p.getSize() / 2));
          scene.draw(game.renderer.ctx);
        },
        stats() { return { ...p.getAimState(), body: p.getBodyRotation(), elapsed: p.aimTime - p.aimStarted,
          shots: shots.slice(), layout: p.getOverlayLayout(), size: p.getSize() }; },
        tick() { const now = performance.now() / 1000; p.update(now - last, game.input, scene.map); last = now; this.render(); return this.stats(); },
        pointerPixels() {
          const aim = p.getAimState(), offset = scene.camera.getOffset();
          const scaleX = game.renderer.width / scene.camera.width, scaleY = game.renderer.height / scene.camera.height;
          const data = game.renderer.ctx.getImageData(Math.round((aim.x - offset.x) * scaleX) - 3,
            Math.round((aim.y - offset.y) * scaleY) - 3, 7, 7).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 1] > 225 && data[i + 2] > 240) count++;
          return count;
        },
      };
      shootingTest.render();
    });

    await page.keyboard.down('ArrowRight');
    const first = await page.evaluate(() => shootingTest.tick());
    near(first.angle, 0); assert.equal(first.visible, true);
    // Normal play: hold one direction, then add a neighboring direction without releasing it.
    await page.waitForTimeout(350);
    await page.keyboard.down('ArrowDown');
    const turning = await page.evaluate(() => shootingTest.tick());
    assert.ok(turning.angle > 0 && turning.angle < Math.PI / 4, `first rendered update starts sliding: ${JSON.stringify(turning)}`);
    angleNear(turning.angle, Math.PI / 4 * turning.elapsed / 0.15);
    angleNear(turning.body, first.body);
    assert.ok(turning.shots.at(-1).angle > 0 && turning.shots.at(-1).angle < Math.PI / 4);
    await page.waitForTimeout(155);
    const settled = await page.evaluate(() => shootingTest.tick()); angleNear(settled.angle, Math.PI / 4);

    // Two adjacent key changes between updates must remain a sweep, even though the final target is 90 degrees away.
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowLeft');
    const sameFrame = await page.evaluate(() => shootingTest.tick());
    angleNear(sameFrame.targetAngle, 3 * Math.PI / 4);
    assert.ok(sameFrame.angle > settled.angle && sameFrame.angle < sameFrame.targetAngle);
    await page.waitForTimeout(155); await page.evaluate(() => shootingTest.tick());
    await page.keyboard.up('ArrowDown');
    await page.keyboard.down('ArrowUp');
    await page.evaluate(() => shootingTest.tick());
    await page.waitForTimeout(155); await page.evaluate(() => shootingTest.tick());
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => shootingTest.tick());
    await page.waitForTimeout(155); const wrapped = await page.evaluate(() => shootingTest.tick());
    angleNear(wrapped.angle, -Math.PI / 4);

    // Opposite vertical keys temporarily cancel to right, then resume at down-right.
    await page.keyboard.down('ArrowDown');
    await page.evaluate(() => shootingTest.tick());
    await page.keyboard.up('ArrowUp');
    const adjacent = await page.evaluate(() => shootingTest.tick());
    angleNear(adjacent.targetAngle, Math.PI / 4);
    await page.keyboard.down('ArrowLeft');
    await page.evaluate(() => shootingTest.tick());
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowLeft');
    await page.evaluate(() => shootingTest.tick());
    await page.keyboard.down('ArrowUp');
    const cancelled = await page.evaluate(() => shootingTest.tick()); assert.equal(cancelled.visible, false);
    await page.keyboard.up('ArrowDown');
    const resumed = await page.evaluate(() => shootingTest.tick()); angleNear(resumed.angle, -Math.PI / 2);

    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    const jumped = await page.evaluate(() => shootingTest.tick()); angleNear(jumped.angle, Math.PI);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowUp');
    await page.evaluate(() => shootingTest.tick());

    for (const [ox, oy] of [[0, 0], [37.25, 19.75]]) {
      const visual = await page.evaluate(([ox, oy]) => {
        const t = shootingTest;
        t.scene.camera.x = ox; t.scene.camera.y = oy;
        t.scene.camera.shake(2, 1, -Math.PI / 6);
        t.scene.camera.shakeTime = 0.025;
        t.render();
        return { state: t.stats(), cyan: t.pointerPixels(), offset: t.scene.camera.getOffset() };
      }, [ox, oy]);
      assert.ok(visual.cyan > 3, `pointer remains visible after lighting at DPR ${dpr}, offset ${ox},${oy}`);
      const { radius, layout, size } = visual.state, center = 400 + size / 2;
      assert.ok(layout.healthY - 1 - center - radius - 7.2 >= 6);
      assert.ok(Math.hypot(layout.heatX - center, layout.heatY - center) - 12.5 - radius - 7.2 >= 6);
      measurements.push({ dpr, ox, oy, firstFrameProgress: turning.angle, sampledEventAgeMs: turning.elapsed * 1000,
        liveFrameAngles: liveFrames.map(frame => frame.angle), moving, stopped, cyanPixels: visual.cyan });
    }
    // World coordinates are backing pixels in this renderer; Playwright clips use CSS pixels.
    await page.screenshot({ path: join(output, `shooting-dpr${dpr}.png`), clip: { x: 310 / dpr, y: 290 / dpr, width: 240 / dpr, height: 250 / dpr } });
    await page.keyboard.up('ArrowUp');
    const hidden = await page.evaluate(() => { shootingTest.tick(); return { visible: shootingTest.p.getAimState().visible, cyan: shootingTest.pointerPixels() }; });
    assert.equal(hidden.visible, false); assert.equal(hidden.cyan, 0);
    const shots = await page.evaluate(() => shootingTest.shots);
    for (const shot of shots) {
      angleNear(shot.angle, shot.pointer); angleNear(shot.body, first.body);
      near(shot.x, 424.5); near(shot.y, 424.5);
    }
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); shootingTest.tick(); });
    const frameRateCases = await page.evaluate(() => {
      const { scene, game } = shootingTest, Player = scene.player.constructor, sprite = scene.player.sprite;
      const near = (a, b) => { if (Math.abs(a - b) > 1e-6) throw new Error(`${a} != ${b}`); };
      const angleNear = (a, b) => near(Math.atan2(Math.sin(a - b), Math.cos(a - b)), 0);
      scene.camera.reset();
      return [30, 60, 144].map(fps => {
        const p = new Player(400, 400, sprite, scene.particleSystem);
        p.applyConfig(scene.configLoader.getConfig('playerConfig')); scene.player = p;
        near(p.getFireRate(), 0.2);
        let now = 0, previous = 0, sector = 0, x = 1, y = 0;
        let changes = [{ time: 0, x, y }];
        const shots = [], frames = [];
        const movement = ['w', 's', 'a', 'd'];
        const input = {
          isKeyDown: key => key === movement[Math.min(3, Math.floor(now / 0.5))] ||
            ({ ArrowRight: x > 0, ArrowLeft: x < 0, ArrowDown: y > 0, ArrowUp: y < 0 })[key] || false,
          consumeAimChanges() { const result = { changes, now, reset: false }; changes = []; return result; },
        };
        p.setOnShootCallback(direction => {
          const aim = p.getAimState(), bullet = p.getBullets().at(-1), pos = bullet.getPosition();
          angleNear(Math.atan2(direction.y, direction.x), aim.angle);
          angleNear(Math.atan2(bullet.velocity.y, bullet.velocity.x), aim.angle);
          near(pos.x + bullet.getSize() / 2, p.x + p.getSize() / 2);
          near(pos.y + bullet.getSize() / 2, p.y + p.getSize() / 2);
          shots.push({ time: now, angle: aim.angle });
        });
        p.update(0, input, scene.map);
        for (let i = 1; i <= fps * 2; i++) {
          now = i / fps;
          while ((sector + 1) * 0.18 <= now + 1e-9) {
            sector++;
            x = Math.round(Math.cos(sector * Math.PI / 4)); y = Math.round(Math.sin(sector * Math.PI / 4));
            changes.push({ time: sector * 0.18, x, y });
          }
          const oldBullets = p.getBullets().map(bullet => ({ bullet, position: bullet.getPosition(), velocity: bullet.velocity.clone() }));
          const delta = now - previous; p.update(delta, input, scene.map); previous = now;
          for (const { bullet, position, velocity } of oldBullets) if (!bullet.getIsDestroyed()) {
            const after = bullet.getPosition();
            near(after.x - position.x, velocity.x * delta); near(after.y - position.y, velocity.y * delta);
          }
          const aim = p.getAimState(), size = p.getSize(), segmentTime = now % 0.5;
          near(aim.x - p.x - size / 2, Math.cos(aim.angle) * aim.radius);
          near(aim.y - p.y - size / 2, Math.sin(aim.angle) * aim.radius);
          if (segmentTime > 0.4) {
            const expected = [0, Math.PI, -Math.PI / 2, Math.PI / 2][Math.min(3, Math.floor(now / 0.5))];
            angleNear(p.getBodyRotation(), expected);
          }
          scene.playerLight.setPosition(new (p.getVelocity().constructor)(p.x + size / 2, p.y + size / 2));
          scene.draw(game.renderer.ctx);
          if (i % Math.max(1, Math.round(fps / 10)) === 0) frames.push({ time: now, body: p.getBodyRotation(), pointer: aim.angle });
        }
        return { fps, fireRate: p.getFireRate(), shots, frames };
      });
    });
    for (const result of frameRateCases) {
      assert.ok(result.shots.some(shot => Math.abs(Math.sin(shot.angle * 4)) > 0.05),
        `default-rate actual bullet must have a non-eight-way angle, DPR ${dpr}, FPS ${result.fps}`);
      assert.ok(result.shots.length <= 11, 'sweeping cannot add transition bullets');
      for (let i = 1; i < result.shots.length; i++) assert.ok(result.shots[i].time - result.shots[i - 1].time >= 0.2 - 1e-8);
    }
    measurements.push({ dpr, frameRateCases });
    await page.screenshot({ path: join(output, `shooting-separation-dpr${dpr}.png`),
      clip: { x: 290 / dpr, y: 280 / dpr, width: 300 / dpr, height: 300 / dpr } });
    assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  }
  writeFileSync(join(output, 'shooting-results.json'), JSON.stringify(measurements, null, 2));
  console.log('Browser shooting regression: real-key live frames, independent movement/body/aim, default-rate intermediate bullet trajectories at 30/60/144 FPS, and DPR/camera/shake overlays passed.');
} finally { await browser.close(); }
