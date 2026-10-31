import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.cameraGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    // Let the one outstanding animation frame finish before controlled rendering.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    for (const viewport of [{ width: 1280, height: 720 }, { width: 900, height: 600 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => cameraGame.renderer.width === width * devicePixelRatio
        && cameraGame.renderer.height === height * devicePixelRatio, viewport);
      const result = await page.evaluate(() => {
        const scene = cameraGame.sceneManager.getCurrentScene(), screen = cameraGame.renderer.ctx;
        scene.handleResize();
        const { camera, player, worldCanvas, lightingSystem } = scene;
        const centered = Math.abs(player.x + player.getSize() / 2 - camera.x - camera.width / 2) < 1e-8
          && Math.abs(player.y + player.getSize() / 2 - camera.y - camera.height / 2) < 1e-8;
        const colliderSize = player.getCollider().pose.size;
        scene.draw(screen);
        // Independent composition catches stretched or displaced lighting, clipped edges,
        // and accidental transforms leaking from world rendering into the screen HUD.
        const expected = document.createElement('canvas');
        expected.width = screen.canvas.width; expected.height = screen.canvas.height;
        const expectedContext = expected.getContext('2d');
        expectedContext.drawImage(worldCanvas, 0, 0, expected.width, expected.height);
        // Below the minimap HUD (circle + gold counter) the screen must be the world composite.
        const hudBottom = 240 * devicePixelRatio;
        const actualPixels = screen.getImageData(0, hudBottom,
          expected.width, expected.height - hudBottom).data;
        const expectedPixels = expectedContext.getImageData(0, hudBottom,
          expected.width, expected.height - hudBottom).data;
        const samePixels = actualPixels.every((value, i) => value === expectedPixels[i]);
        // The gold counter now sits just below the circular minimap.
        const hud = [...screen.getImageData(28 * devicePixelRatio, 200 * devicePixelRatio, 1, 1).data];
        const x = camera.x, y = camera.y;
        camera.follow(x + camera.width / 2 + 201, y + camera.height / 2 + 126, 1 / 60);
        const follows = camera.x > x && camera.y > y;
        const transform = screen.getTransform();
        return { centered, samePixels, hud, follows, colliderSize,
          viewport: [camera.width, camera.height], world: [worldCanvas.width, worldCanvas.height],
          lighting: [lightingSystem.shadowCanvas.width, lightingSystem.shadowCanvas.height],
          deadZone: [camera.deadZoneWidth, camera.deadZoneHeight],
          transform: [transform.a, transform.d, transform.e, transform.f] };
      });
      const worldSize = [Math.ceil(Math.floor(viewport.width * dpr) / 0.85), Math.ceil(Math.floor(viewport.height * dpr) / 0.85)];
      assert.deepEqual(result.viewport, worldSize);
      assert.deepEqual(result.world, worldSize);
      assert.deepEqual(result.lighting, worldSize);
      assert.deepEqual(result.deadZone, [400, 250]);
      assert.deepEqual(result.transform, [1, 1, 0, 0]);
      assert.deepEqual(result.hud, [255, 215, 0, 255]);
      assert.equal(result.colliderSize, 49);
      assert.ok(result.centered && result.samePixels && result.follows, JSON.stringify(result));
    }
    await page.screenshot({ path: `.review/camera-zoom-${dpr}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Camera zoom: DPR 1 / 1.25 / 2, resize, composition, HUD and follow passed.');
} finally { await browser.close(); }
