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
            scene.player.update(delta, { isKeyDown: k => keys.includes(k) }, scene.map); left -= delta;
          }
          this.render(); return this.stats();
        },
        stats() {
          const p = scene.player;
          return { x: p.x, y: p.y, speed: p.getVelocity().length(), stamina: p.getStamina(), sprinting: p.getIsSprinting(), heat: p.getHeatPercentage(), overheated: p.getIsOverheated() };
        },
        pixel(x, y) { return [...game.renderer.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]; },
        ring(angle) {
          const p = scene.player;
          const { heatX, heatY } = p.getOverlayLayout(scene.camera.x, scene.camera.y);
          return this.pixel(heatX + 11 * Math.cos(angle), heatY + 11 * Math.sin(angle));
        },
      };
      t.reset();
    });

    await page.keyboard.down('d');
    const walk = await page.evaluate(() => movementTest.tick(0.1));
    assert.ok(Math.abs(walk.speed - 400) < 0.001);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('w');
    const sprint = await page.evaluate(() => movementTest.tick(0.1));
    assert.equal(sprint.sprinting, true); assert.ok(sprint.speed > 400 && sprint.speed < 640);
    assert.ok(sprint.stamina < 100);
    const fullSprint = await page.evaluate(() => movementTest.tick(0.06));
    assert.ok(Math.abs(fullSprint.speed - 640) < 0.001, 'Shift smoothly reaches full sprint speed after 160ms');
    await page.keyboard.down('ShiftRight'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('d');
    assert.equal((await page.evaluate(() => movementTest.tick(0.1))).sprinting, true);
    await page.keyboard.up('w'); await page.keyboard.up('ShiftRight');
    const coasting = await page.evaluate(() => movementTest.tick(1 / 60));
    assert.ok(coasting.speed > 250 && coasting.speed <= 400, 'release preserves a perceptible braking tail');
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
    assert.ok(Math.abs(braking.earlySpeed - 337.5) < 0.001, 'first 50ms preserves momentum rather than braking immediately');
    assert.ok(braking.travel > 38 && braking.travel < 42, `actual braking distance: ${braking.travel}`);
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
      const heat = await page.evaluate(([ox, oy]) => {
        const t = movementTest; t.reset(); t.advance(1.4, ['ArrowUp']);
        t.scene.camera.x = ox; t.scene.camera.y = oy; t.render();
        const p = t.scene.player;
        return { stats: t.stats(), right: t.ring(0), bottom: t.ring(Math.PI / 2),
          stamina: t.pixel(p.x - ox + 20, p.getOverlayLayout(ox, oy).healthY + 12) };
      }, [ox, oy]);
      assert.ok(heat.stats.heat > 0.25 && heat.stats.heat < 0.5);
      assert.ok(Math.max(...heat.right.slice(0, 3)) > 140, 'clockwise heat arc covers the right quarter');
      assert.ok(Math.max(...heat.bottom.slice(0, 3)) < 110, 'heat arc has not reached the bottom');
      assert.deepEqual(heat.stamina, [117, 223, 233, 255], 'stamina stays bright after lighting');
      cases++;
    }
    if (dpr === 1) await page.screenshot({ path: join(output, 'movement-heat.png'), clip: { x: 100, y: 150, width: 340, height: 260 } });
    const overheat = await page.evaluate(() => {
      const t = movementTest; t.reset();
      for (let i = 0; i < 300 && !t.scene.player.getIsOverheated(); i++) t.advance(1 / 60, ['ArrowUp']);
      t.render(); return { stats: t.stats(), right: t.ring(0) };
    });
    assert.equal(overheat.stats.overheated, true); assert.ok(overheat.right[0] > 220 && overheat.right[1] < 150);
    const cooled = await page.evaluate(() => {
      const t = movementTest; t.advance(0.5);
      return { filled: t.ring(Math.PI / 4), empty: t.ring(3 * Math.PI / 4) };
    });
    assert.ok(cooled.filled[0] > 220); assert.ok(Math.max(...cooled.empty.slice(0, 3)) < 110, 'cooldown arc shrinks clockwise from the top');
    if (dpr === 1) await page.screenshot({ path: join(output, 'movement-overheat.png'), clip: { x: 100, y: 150, width: 340, height: 260 } });
    assert.equal(await page.evaluate(() => { movementTest.advance(1); return movementTest.scene.player.cooldownBarAlpha; }), 0);
    const exhausted = await page.evaluate(() => {
      const t = movementTest; t.reset(); t.advance(4, ['d', 'Shift']);
      t.scene.player.x = 200; t.scene.player.y = 250; t.render();
      const stats = t.stats(), p = t.scene.player;
      return { stats, border: t.pixel(p.x + 20, p.getOverlayLayout().healthY + 9) };
    });
    assert.equal(exhausted.stats.stamina, 0); assert.equal(exhausted.stats.sprinting, false);
    assert.ok(exhausted.border[0] > 100, 'exhausted stamina retains a visible warning border');
    if (dpr === 1) await page.screenshot({ path: join(output, 'movement-exhausted.png'), clip: { x: 100, y: 150, width: 340, height: 260 } });
    assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  }
  console.log(`Browser movement regression: ${cases} DPR/camera cases, real Shift input, heat/cooldown arcs, fade-out and exhaustion passed.`);
} finally { await browser.close(); }
