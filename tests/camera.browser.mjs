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
        // The weapon list HUD is a screen-space overlay pinned to the right edge, so the compared
        // columns stop left of it instead of assuming every pixel below the minimap is world.
        const hudBottom = 280 * devicePixelRatio;
        const rows = scene.weaponListHud.getLastStatus()?.rows ?? [];
        const weaponHudLeft = rows.length
          ? Math.min(...rows.map(row => row.brushRect.x)) - 8
          : expected.width;
        const compareWidth = Math.max(1, Math.min(expected.width, Math.floor(weaponHudLeft)));
        const actualPixels = screen.getImageData(0, hudBottom,
          compareWidth, expected.height - hudBottom).data;
        const expectedPixels = expectedContext.getImageData(0, hudBottom,
          compareWidth, expected.height - hudBottom).data;
        const samePixels = actualPixels.every((value, i) => value === expectedPixels[i]);
        // The gold counter sits under the circular minimap, whose size follows the viewport, so
        // look the marker colour up in the HUD corner instead of sampling one fixed pixel.
        const hudRegion = screen.getImageData(0, 0, Math.min(screen.canvas.width, 200 * devicePixelRatio),
          Math.min(screen.canvas.height, 340 * devicePixelRatio)).data;
        let hudMarkers = 0;
        for (let i = 0; i < hudRegion.length; i += 4) {
          if (hudRegion[i] === 255 && hudRegion[i + 1] === 215 && hudRegion[i + 2] === 0) hudMarkers++;
        }
        const hud = [hudMarkers];
        const x = camera.x, y = camera.y;
        camera.follow(x + camera.width / 2 + 201, y + camera.height / 2 + 126, 1 / 60);
        const follows = camera.x > x && camera.y > y;
        const transform = screen.getTransform();
        return { centered, samePixels, hud, follows, colliderSize, zoom: scene.graphics.camera.zoom,
          viewport: [camera.width, camera.height], world: [worldCanvas.width, worldCanvas.height],
          lighting: [lightingSystem.shadowCanvas.width, lightingSystem.shadowCanvas.height],
          deadZone: [camera.deadZoneWidth, camera.deadZoneHeight],
          transform: [transform.a, transform.d, transform.e, transform.f] };
      });
      const worldSize = [Math.ceil(Math.floor(viewport.width * dpr) / result.zoom), Math.ceil(Math.floor(viewport.height * dpr) / result.zoom)];
      assert.deepEqual(result.viewport, worldSize);
      assert.deepEqual(result.world, worldSize);
      assert.deepEqual(result.lighting, worldSize);
      assert.deepEqual(result.deadZone, [400, 250]);
      assert.deepEqual(result.transform, [1, 1, 0, 0]);
      assert.ok(result.hud[0] > 40, `gold counter markers: ${result.hud[0]}`);
      assert.equal(result.colliderSize, 49);
      assert.ok(result.centered && result.samePixels && result.follows, JSON.stringify(result));
    }
    await page.screenshot({ path: `.review/camera-zoom-${dpr}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Camera zoom: DPR 1 / 1.25 / 2, resize, composition, HUD and follow passed.');
} finally { await browser.close(); }
