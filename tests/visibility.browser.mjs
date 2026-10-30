import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173', output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    // 默认视野已切到 three-layer；这条用例只覆盖 legacy 圆形迷雾，必须显式指定。
    await page.goto(`${base}/?vision=legacy`);
    await page.evaluate(async () => { window.visionGame = (await import('/src/main.ts')).game; });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]'); await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

    const scene = await page.evaluate(async () => {
      const { TileMap } = await import('/src/map/TileMap.ts');
      const { GoldPickup } = await import('/src/objects/GoldPickup.ts');
      const game = window.visionGame, scene = game.sceneManager.getCurrentScene();
      scene.map = new TileMap(40, 30, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tileHp.forEach(row => row.fill(0));
      scene.torches.forEach(t => scene.lightingSystem.removeLightSource(t.light)); scene.torches = [];
      scene.pickupItems = []; scene.particleSystem.clear();
      const s = scene.map.tileSize, px = 20.5 * s, py = 15.5 * s;
      scene.player.x = px - 24.5; scene.player.y = py - 24.5;
      scene.player.currentRotation = Math.PI / 2; // 视野朝上
      scene.playerLight.getPosition().set(px, py);
      scene.flashlight.getPosition().set(px, py);
      scene.flashlight.setDirection(-Math.PI / 2);
      scene.camera.x = px - scene.camera.width / 2; scene.camera.y = py - scene.camera.height / 2;
      // 迷雾内 150px、迷雾外 520px 各放一个金块。
      scene.goldPickups = [new GoldPickup(px, py - 150, px, py - 150), new GoldPickup(px, py - 520, px, py - 520)];
      scene.goldPickups.forEach(g => g.update(1));
      window.visionTest = {
        scene, px, py,
        draw(flashlight = true) { scene.flashlight.setActive(flashlight); scene.draw(game.renderer.ctx); },
        pixel(x, y, canvas = scene.worldContext) {
          const v = scene.displayedView;
          return [...canvas.getImageData(Math.round(x - v.x), Math.round(y - v.y), 1, 1).data];
        },
      };
      window.visionTest.draw(true);
      return {
        vision: scene.player.getVisionState(),
        inside: window.visionTest.pixel(px + 4, py - 146),
        outside: window.visionTest.pixel(px + 4, py - 516),
        groundOutside: window.visionTest.pixel(px + 520, py),
        sizes: { world: [scene.worldCanvas.width, scene.worldCanvas.height],
          mask: [scene.visibilitySystem.getCanvas().width, scene.visibilitySystem.getCanvas().height] },
      };
    });
    assert.equal(scene.vision.range, 400, 'fog/vision radius is fixed');
    assert.equal('angle' in scene.vision, false, 'vision no longer exposes a focus-dependent angle');
    assert.ok(scene.inside[0] > 40, 'a unit inside the fog is visible');
    assert.equal(scene.outside[3], 0, 'a unit outside the fog is not drawn');
    assert.ok(scene.groundOutside[3] === 255 && scene.groundOutside[0] > 0, 'terrain behind the fog stays visible');
    assert.deepEqual(scene.sizes.mask, scene.sizes.world, 'fog mask uses the world canvas size');

    const cone = await page.evaluate(() => {
      const t = window.visionTest;
      t.draw(true); const on = t.pixel(t.px, t.py - 120); const behind = t.pixel(t.px, t.py + 120);
      t.draw(false); const off = t.pixel(t.px, t.py - 120); const behindOff = t.pixel(t.px, t.py + 120);
      return { on, behind, off, behindOff };
    });
    assert.ok(cone.on[0] > cone.off[0] + 6, 'the flashlight brightens only its facing cone');
    assert.ok(Math.abs(cone.behind[0] - cone.behindOff[0]) <= 2, 'nothing behind the character is lit by the cone');

    const toggle = await page.evaluate(() => {
      const game = window.visionGame, scene = game.sceneManager.getCurrentScene();
      const tick = () => scene.update(0, game.input);
      const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: 'g', code: 'KeyG' }));
      key('keydown'); tick(); const off = scene.flashlight.isLightActive();
      tick(); const held = scene.flashlight.isLightActive();
      key('keyup'); tick(); key('keydown'); tick(); const on = scene.flashlight.isLightActive();
      key('keyup'); tick();
      return { off, held, on };
    });
    assert.deepEqual(toggle, { off: false, held: false, on: true }, 'G toggles the flashlight on key-down edges');

    const alignment = await page.evaluate(() => {
      const t = window.visionTest, scene = t.scene, game = window.visionGame;
      scene.player.currentRotation = 0; scene.update(0, game.input);
      const v = scene.player.getVisionState();
      const followsBody = Math.abs(scene.flashlight.getDirection() - v.direction) < 1e-9;
      scene.camera.shake(5, 1, .5, 20, 'linear'); scene.camera.follow(t.px, t.py, .01);
      t.draw(true);
      const view = scene.displayedView, mask = scene.visibilitySystem.getCanvas().getContext('2d');
      const alpha = (x, y) => mask.getImageData(Math.round(x - view.x), Math.round(y - view.y), 1, 1).data[3];
      return { followsBody, center: alpha(t.px, t.py), edge: alpha(t.px + 380, t.py), far: alpha(t.px + 460, t.py) };
    });
    assert.ok(alignment.followsBody, 'flashlight direction follows the actual body rotation');
    assert.equal(alignment.center, 255);
    assert.ok(alignment.edge > 8 && alignment.edge < 240, `fog edge feathers: ${alignment.edge}`);
    assert.equal(alignment.far, 0);
    await page.screenshot({ path: `${output}/fog-flashlight-dpr${dpr}.png` });

    await page.setViewportSize({ width: 1000, height: 720 });
    const resized = await page.evaluate(() => {
      const scene = window.visionTest.scene; scene.handleResize(); scene.draw(window.visionGame.renderer.ctx);
      return { world: [scene.worldCanvas.width, scene.worldCanvas.height],
        mask: [scene.visibilitySystem.getCanvas().width, scene.visibilitySystem.getCanvas().height] };
    });
    assert.deepEqual(resized.mask, resized.world);
    assert.deepEqual(errors, []);
    results.push({ dpr, scene, cone, toggle, alignment, resized });
    console.log(`DPR ${dpr}: fog hides units only, flashlight cone and G toggle passed.`);
    await context.close();
  }
  writeFileSync(`${output}/fog-pixels.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('Fog and flashlight passed: unit-only fog, terrain stays visible, 120° cone follows body, G toggles.');
} finally { await browser.close(); }
