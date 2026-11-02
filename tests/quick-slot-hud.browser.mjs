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
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const { game } = await import('/src/main.ts');
      window.requestAnimationFrame = () => 0;
      await new Promise(resolve => setTimeout(resolve, 50));
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      window.hudGame = game;
      window.hudScene = await createFixedScene(game, 60, 40, 600, 600);
      window.hudModules = {
        slots: await import('/src/ui/QuickSlotHud.ts'),
        weapons: await import('/src/ui/WeaponListHud.ts'),
        status: await import('/src/ui/PlayerStatusHud.ts'),
        backpack: await import('/src/ui/BackpackHud.ts'),
        vitals: await import('/src/ui/PlayerVitalsHud.ts'),
      };
      await window.hudScene.backpackHud.icon?.decode();
    });

    for (const [key, selected] of [['Digit4', 3], ['Digit1', 0], ['Digit3', 2], ['Numpad2', 1]]) {
      const before = await page.evaluate(() => hudScene.getPlayer().getWeaponLoadoutView().activeSlot);
      await page.keyboard.down(key);
      const actual = await page.evaluate(() => {
        hudScene.update(0, hudGame.input);
        return hudScene.quickSlotHud.getSelectedSlot();
      });
      await page.keyboard.up(key);
      assert.equal(actual, selected, `${key} selects its item slot`);
      assert.equal(await page.evaluate(() => hudScene.getPlayer().getWeaponLoadoutView().activeSlot), before,
        'item selection does not switch firearms');
    }
    await page.evaluate(() => hudScene.setWorldPaused(true));
    await page.keyboard.down('Digit4');
    assert.equal(await page.evaluate(() => {
      hudScene.update(0, hudGame.input);
      return hudScene.quickSlotHud.getSelectedSlot();
    }), 1, 'paused game ignores slot selection');
    await page.keyboard.up('Digit4');
    await page.evaluate(() => { hudScene.setWorldPaused(false); hudGame.input.setBlocked(true); });
    await page.keyboard.down('Digit3');
    assert.equal(await page.evaluate(() => {
      hudScene.update(0, hudGame.input);
      return hudScene.quickSlotHud.getSelectedSlot();
    }), 1, 'blocked input ignores slot selection');
    await page.keyboard.up('Digit3');
    await page.evaluate(() => hudGame.input.setBlocked(false));

    for (const [width, height] of [[1920, 1080], [1672, 941], [1100, 800], [800, 600], [640, 360], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(([w, h]) => hudGame.renderer.width === w * devicePixelRatio
        && hudGame.renderer.height === h * devicePixelRatio, [width, height], { polling: 50, timeout: 5000 });
      const result = await page.evaluate(({ width, height, dpr }) => {
        const { slots, weapons, status, backpack, vitals } = hudModules;
        const weaponArea = weapons.getWeaponListLayout(width, height).area;
        const reserved = [status.getPlayerStatusHudRect(width, height, weaponArea),
          backpack.getBackpackHudRect(width, height, weaponArea), weaponArea];
        reserved.push(vitals.getPlayerVitalsHudRect(width, height, reserved));
        const layout = slots.getQuickSlotHudLayout(width, height, reserved);
        const canvas = document.createElement('canvas');
        canvas.width = width * dpr; canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        hudScene.quickSlotHud.draw(ctx, width, height, reserved);
        const pixel = (x, y) => [...ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data];
        const idleSlot = pixel(layout.x + layout.size + layout.gap + layout.size / 2, layout.y + layout.size / 2);
        const emptySlot = pixel(layout.x + layout.size / 2, layout.y + layout.size / 2);
        const transform = ctx.getTransform();
        ctx.clearRect(0, 0, width, height);
        hudScene.quickSlotHud.draw(ctx, width, height, reserved, [], { slot: 1, progress: .5 });
        const filled = pixel(layout.x + layout.size + layout.gap + layout.size * .25, layout.y + layout.size / 2);
        const unfilled = pixel(layout.x + layout.size + layout.gap + layout.size * .75, layout.y + layout.size / 2);

        hudScene.handleResize();
        const map = hudScene.minimap.getLayout();
        const labelPixels = () => {
          const data = [];
          for (const y of [map.top - 12, map.top + map.diameter - 15]) {
            const pixels = ctx.getImageData(Math.round((map.centerX - 15) * dpr), Math.round(y * dpr), 30 * dpr, 30 * dpr).data;
            data.push([...pixels]);
          }
          return data;
        };
        ctx.clearRect(0, 0, width, height);
        hudScene.minimap.draw(ctx);
        const labels = labelPixels();
        hudScene.player.currentRotation += Math.PI / 2;
        hudScene.updateMinimap(0);
        ctx.clearRect(0, 0, width, height);
        hudScene.minimap.draw(ctx);
        const rotatedLabels = labelPixels();
        hudScene.draw(hudGame.renderer.ctx);
        return { layout, reserved, weaponArea, idleSlot, emptySlot, filled, unfilled,
          transform: [transform.a, transform.d, transform.e, transform.f],
          labelsBright: labels.map(data => data.filter((v, i) => i % 4 === 0
            && v > 190 && data[i + 1] > 190 && data[i + 2] > 190).length),
          compassFixed: JSON.stringify(labels) === JSON.stringify(rotatedLabels) };
      }, { width, height, dpr });
      const { layout } = result;
      assert.ok(Math.abs(layout.x + layout.width / 2 - width / 2) < 0.01, 'slots remain horizontally centered');
      assert.ok(layout.x >= 0 && layout.y >= 0 && layout.x + layout.width <= width
        && layout.y + layout.height <= height, 'all slots and key labels stay inside the viewport');
      for (const area of [...result.reserved, result.weaponArea]) {
        assert.ok(layout.x + layout.width <= area.x || layout.x >= area.x + area.width
          || layout.y + layout.height <= area.y || layout.y >= area.y + area.height,
        `${width}x${height}: slots clear existing HUD`);
      }
      assert.deepEqual(result.idleSlot, result.emptySlot, 'idle slots have no selection highlight');
      assert.ok(result.filled[1] > result.unfilled[1] + 80, 'consumable progress fills only the completed background portion');
      assert.deepEqual(result.transform, [dpr, dpr, 0, 0], 'HUD preserves canvas transforms');
      assert.ok(result.labelsBright.every(count => count > 8), 'both N and S are visible');
      assert.ok(result.compassFixed, 'N/S remain fixed when the player turns');
      if (width === 1920 || width === 640) await page.screenshot({ path: `.review/quick-slots-${width}x${height}-dpr${dpr}.png` });
    }
    assert.deepEqual(errors, [], 'no browser runtime errors');
    await context.close();
  }
  console.log('Quick slots and compass: keyboard selection, pause, HUD spacing, fixed N/S and DPR 1/1.25/2 passed.');
} finally {
  await browser.close();
}
