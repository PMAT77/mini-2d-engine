import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });

try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://localhost:5173/');
    await page.evaluate(async () => {
      const { game } = await import('/src/main.ts');
      window.requestAnimationFrame = () => 0;
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      window.backpackGame = game;
      window.backpackScene = await createFixedScene(game, 60, 40, 600, 600);
      await window.backpackScene.backpackHud.icon.decode();
      window.backpackModules = {
        backpack: await import('/src/ui/BackpackHud.ts'),
        weapons: await import('/src/ui/WeaponListHud.ts'),
        status: await import('/src/ui/PlayerStatusHud.ts'),
      };
    });

    for (const [width, height] of [[1672, 941], [1100, 800], [800, 600], [640, 360], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(([w, h]) => {
        const canvas = window.backpackGame.renderer.ctx.canvas;
        return Math.abs(canvas.width / devicePixelRatio - w) < 1 && Math.abs(canvas.height / devicePixelRatio - h) < 1;
      }, [width, height], { polling: 50, timeout: 5000 });
      const result = await page.evaluate(({ width, height, dpr }) => {
        const { backpack, weapons, status } = window.backpackModules;
        const weaponArea = weapons.getWeaponListLayout(width, height).area;
        const rect = backpack.getBackpackHudRect(width, height, weaponArea);
        const statusRect = status.getPlayerStatusHudRect(width, height, weaponArea);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        const hud = window.backpackScene.backpackHud;
        const pixel = (x, y) => [...ctx.getImageData(Math.floor((rect.x + x * rect.width / 400) * dpr), Math.floor((rect.y + y * rect.height / 132) * dpr), 1, 1).data];
        const render = load => {
          ctx.fillStyle = '#04070b'; ctx.fillRect(0, 0, width, height);
          hud.draw(ctx, width, height, weaponArea, dpr, load);
        };
        render({ weightKg: 12.6, capacityKg: 30 });
        const filled = pixel(164, 100), empty = pixel(164, 30), icon = pixel(75, 38);
        render({ weightKg: 0, capacityKg: 30 }); const zero = pixel(164, 100);
        render({ weightKg: 60, capacityKg: 30 }); const full = pixel(164, 30);
        render({ weightKg: NaN, capacityKg: 0 }); const invalid = pixel(164, 100);
        const transform = ctx.getTransform();
        window.backpackScene.draw(window.backpackGame.renderer.ctx);
        return { rect, statusRect, weaponArea, filled, empty, icon, zero, full, invalid, transform: [transform.a, transform.d, transform.e, transform.f] };
      }, { width, height, dpr });
      const { rect, statusRect, weaponArea } = result;
      assert.ok(rect.width > 1 && rect.height > 1, `${width}x${height}: backpack visible`);
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height, 'inside viewport');
      assert.ok(Math.abs(rect.x + rect.width - (width - 22)) < 0.01, 'anchored to right edge');
      assert.ok(Math.abs(rect.y + rect.height - (height - 18)) < 0.01, 'anchored to bottom edge independently of survival status');
      assert.ok(rect.y >= weaponArea.y + weaponArea.height, 'below weapons');
      assert.ok(rect.x >= statusRect.x + statusRect.width || rect.x + rect.width <= statusRect.x
        || rect.y >= statusRect.y + statusRect.height || rect.y + rect.height <= statusRect.y, 'clear of survival status');
      assert.ok(result.filled[1] > 180 && result.filled[2] > 120, 'load fills upward in mint green');
      assert.ok(result.empty[1] < 100 && result.zero[1] < 100 && result.invalid[1] < 100, 'empty capacity remains dark');
      assert.ok(result.full[1] > 180, 'over-capacity load clamps to full');
      assert.ok(result.icon[0] > 160 && result.icon[1] > 160, 'supplied backpack image is drawn');
      assert.deepEqual(result.transform, [dpr, dpr, 0, 0], 'does not leak Canvas transforms');
      if (width === 1672 || width === 640) await page.screenshot({ path: `${output}/backpack-${width}x${height}-dpr${dpr}.png` });
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => window.backpackGame.sceneManager.getCurrentScene() === window.backpackScene), true, 'Tab opens backpack within the current game scene');
    assert.deepEqual(errors, [], 'no browser runtime errors');
    await context.close();
  }
  console.log('Backpack HUD: supplied icon, load fill, responsive placement and DPR 1/1.25/2 passed.');
} finally {
  await browser.close();
}
