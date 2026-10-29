import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
let cases = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      // Vite can timestamp the entry URL after edits; use that exact module, not a second game instance.
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.movementTestGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => {
      const scene = window.movementTestGame.sceneManager.getCurrentScene();
      return scene?.constructor.name === 'GameScene' && scene.loaded;
    });
    await page.keyboard.up('Enter');
    // Exercise the real game and rendering order, with a fixed map and a manually stepped clock.
    await page.evaluate(() => {
      const game = window.movementTestGame;
      const scene = game.sceneManager.getCurrentScene(), sprite = scene.player.sprite;
      const Player = scene.player.constructor, Vector2 = scene.player.getVelocity().constructor;
      scene.update = () => {};
      scene.map = new scene.map.constructor(100, 100, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tileHighlight.forEach(row => row.fill(0));
      scene.pickupItems = [];
      scene.camera.x = scene.camera.y = 0;
      const t = window.movementTest = {
        game, scene,
        reset() {
          scene.player = new Player(200, 250, sprite, scene.particleSystem);
          scene.player.applyConfig(scene.configLoader.getConfig('playerConfig'));
          scene.particleSystem.clear(); scene.camera.x = scene.camera.y = 0;
          this.render();
        },
        render() {
          const p = scene.player;
          scene.playerLight.setPosition(new Vector2(p.x + p.getSize() / 2, p.y + p.getSize() / 2));
          scene.draw(game.renderer.ctx);
        },
        tick(delta, input = game.input) { scene.player.update(delta, input, scene.map); this.render(); return this.stats(); },
        advance(seconds, keys = []) {
          for (let left = seconds; left > 1e-9;) {
            const delta = Math.min(left, 1 / 60);
            scene.player.update(delta, { isKeyDown: k => keys.includes(k) }, scene.map,
              keys.includes('MouseLeft') ? { target: { x: scene.player.x + 24.5, y: scene.player.y - 975.5 }, fire: true, face: false } : undefined); left -= delta;
          }
          this.render(); return this.stats();
        },
        stats() {
          const p = scene.player;
          return { x: p.x, y: p.y, speed: p.getVelocity().length(), stamina: p.getStamina(), sprinting: p.getIsSprinting(),
            ammo: p.getMagazineAmmo(), reloading: p.getIsReloading(), reloadProgress: p.getReloadProgress() };
        },
        pixel(x, y) { return [...game.renderer.ctx.getImageData(Math.floor((x + .5) * game.renderer.width / scene.worldCanvas.width), Math.floor((y + .5) * game.renderer.height / scene.worldCanvas.height), 1, 1).data]; },
        ring(angle) {
          const p = scene.player;
          const { reloadX, reloadY } = p.getOverlayLayout(scene.camera.x, scene.camera.y);
          // A thin circle is filtered by the existing 0.85 world zoom; sample its local footprint.
          const samples = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => this.pixel(reloadX + 11 * Math.cos(angle) + dx, reloadY + 11 * Math.sin(angle) + dy)));
          return samples.sort((a, b) => Math.max(...b.slice(0, 3)) - Math.max(...a.slice(0, 3)))[0];
        },
      };
      t.reset();
    });

    await page.keyboard.down('d');
    const startup = await page.evaluate(() => [movementTest.tick(0.000001).speed,
      movementTest.tick(0.019999).speed, movementTest.tick(0.02).speed]);
    assert.ok(startup[0] < 0.001, 'startup begins at rest without an immediate speed jump');
    assert.ok(Math.abs(startup[1] - 31.25) < 0.001);
    assert.ok(Math.abs(startup[2] - 100) < 0.001);
    const walk = await page.evaluate(() => movementTest.tick(0.04));
    assert.ok(Math.abs(walk.speed - 200) < 0.001);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('w');
    const sprint = await page.evaluate(() => movementTest.tick(0.1));
    assert.equal(sprint.sprinting, true); assert.ok(sprint.speed > 200 && sprint.speed < 320);
    assert.ok(sprint.stamina < 100);
    const fullSprint = await page.evaluate(() => movementTest.tick(0.06));
    assert.ok(Math.abs(fullSprint.speed - 320) < 0.001, 'Shift smoothly reaches full sprint speed after 160ms');
    await page.keyboard.down('ShiftRight'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('d');
    assert.equal((await page.evaluate(() => movementTest.tick(0.1))).sprinting, true);
    await page.keyboard.up('w'); await page.keyboard.up('ShiftRight');
    const coasting = await page.evaluate(() => movementTest.tick(1 / 60));
    assert.ok(coasting.speed > 125 && coasting.speed <= 200, 'release preserves a perceptible braking tail');
    assert.equal(coasting.sprinting, false);
    const stopped = await page.evaluate(() => movementTest.advance(0.25));
    assert.equal(stopped.speed, 0); assert.equal(stopped.stamina, coasting.stamina);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('w');
    assert.equal(await page.evaluate(() => { window.dispatchEvent(new Event('blur')); return movementTest.tick(1 / 60).speed; }), 0);
    await page.keyboard.up('w'); await page.keyboard.up('ShiftLeft');

    const braking = await page.evaluate(() => {
      const t = movementTest; t.reset(); t.advance(0.3, ['d']);
      const x = t.scene.player.x;
      const early = t.advance(0.05);
      const end = t.advance(0.15);
      return { duration: t.scene.player.movement.stopDuration, earlySpeed: early.speed, travel: end.x - x, endSpeed: end.speed };
    });
    assert.equal(braking.duration, 0.2, 'the actual loaded game configuration uses the new braking duration');
    assert.ok(Math.abs(braking.earlySpeed - 168.75) < 0.001, 'first 50ms preserves momentum rather than braking immediately');
    assert.ok(braking.travel > 19 && braking.travel < 21, `actual braking distance: ${braking.travel}`);
    assert.equal(braking.endSpeed, 0);
    console.log(`DPR ${dpr}: loaded stop duration ${braking.duration}s, braking distance ${braking.travel.toFixed(2)}px.`);

    const taps = await page.evaluate(() => [0.02, 0.04, 0.08].map(duration => {
      const t = movementTest; t.reset(); const x = t.scene.player.x;
      t.advance(duration, ['d']);
      const end = t.advance(duration);
      return { duration, distance: end.x - x, speed: end.speed };
    }));
    assert.ok(taps[0].distance > 0 && taps[0].distance < 12, `20ms tap: ${JSON.stringify(taps[0])}`);
    assert.ok(taps[1].distance > taps[0].distance && taps[1].distance < 25);
    assert.ok(taps[2].distance > taps[1].distance);
    assert.ok(taps.every(tap => tap.speed === 0), 'each tap stops within its own press-duration budget');
    console.log(`DPR ${dpr} taps: ${taps.map(tap => `${tap.duration * 1000}ms=${tap.distance.toFixed(2)}px`).join(', ')}.`);

    for (const [ox, oy] of [[0, 0], [37.25, 19.75]]) {
      const ring = await page.evaluate(([ox, oy]) => {
        const t = movementTest; t.reset();
        const p = t.scene.player;
        p.setDebugState({ magazineAmmo: 3 });
        p.requestReload();
        t.tick(0.28); // 1.4s 换弹的 20%：进度弧只走过右上方向
        t.scene.camera.x = ox; t.scene.camera.y = oy; t.render();
        return { stats: t.stats(), bright: t.ring(-Math.PI / 4), dark: t.ring(Math.PI / 2),
          stamina: t.pixel(p.x - ox + 20, p.getOverlayLayout(ox, oy).healthY + 12) };
      }, [ox, oy]);
      assert.equal(ring.stats.reloading, true, 'the ring only appears while reloading');
      assert.ok(ring.stats.reloadProgress > 0.15 && ring.stats.reloadProgress < 0.25, `reload progress: ${ring.stats.reloadProgress}`);
      assert.ok(Math.max(...ring.bright.slice(0, 3)) > 140, 'the reload arc fills clockwise from the top');
      assert.ok(Math.max(...ring.dark.slice(0, 3)) < 110, 'the reload arc has not reached the bottom');
      assert.deepEqual(ring.stamina, [117, 223, 233, 255], 'stamina stays bright after lighting');
      cases++;
    }
    if (dpr === 1) await page.screenshot({ path: join(output, 'movement-reload.png'), clip: { x: 100, y: 150, width: 340, height: 260 } });
    const refilled = await page.evaluate(() => {
      const t = movementTest; t.advance(1.2);
      const p = t.scene.player;
      return { stats: t.stats(), arc: t.ring(Math.PI / 4), ammo: p.getMagazineAmmo(), chambered: p.getChambered() };
    });
    assert.equal(refilled.stats.reloading, false);
    assert.equal(refilled.ammo, 6); assert.equal(refilled.chambered, true);
    assert.equal(refilled.stats.reloadProgress, 0);
    assert.ok(Math.max(...refilled.arc.slice(0, 3)) < 110, 'the finished reload leaves no amber arc');
    assert.equal(await page.evaluate(() => { movementTest.advance(1); return movementTest.scene.player.reloadBarAlpha; }), 0);
    const exhausted = await page.evaluate(() => {
      const t = movementTest; t.reset(); t.advance(4, ['d', 'Shift']);
      t.scene.player.x = 200; t.scene.player.y = 250; t.render();
      const stats = t.stats(), p = t.scene.player;
      return { stats, border: [-1, 0, 1].map(dy => t.pixel(p.x + 20, p.getOverlayLayout().healthY + 9 + dy)) };
    });
    assert.equal(exhausted.stats.stamina, 0); assert.equal(exhausted.stats.sprinting, false);
    assert.ok(exhausted.border.some(([r, g, b]) => r > 100 && r > g && g > b), 'exhausted stamina retains a visible orange warning border after zoom filtering');
    if (dpr === 1) await page.screenshot({ path: join(output, 'movement-exhausted.png'), clip: { x: 100, y: 150, width: 340, height: 260 } });
    assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  }
  console.log(`Browser movement regression: ${cases} DPR/camera cases, real Shift input, reload arcs, fade-out and exhaustion passed.`);
} finally { await browser.close(); }
