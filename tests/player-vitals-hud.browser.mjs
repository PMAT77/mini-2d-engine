import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.vitalsGame = (await import(entry.src)).game;
      window.requestAnimationFrame = () => 0;
      await new Promise(resolve => setTimeout(resolve, 50));
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      window.vitalsScene = await createFixedScene(vitalsGame, 60, 40, 600, 600);
      window.vitalsModules = {
        vitals: await import('/src/ui/PlayerVitalsHud.ts'),
        weapons: await import('/src/ui/WeaponListHud.ts'),
        status: await import('/src/ui/PlayerStatusHud.ts'),
        backpack: await import('/src/ui/BackpackHud.ts'),
        slots: await import('/src/ui/QuickSlotHud.ts'),
      };
      await vitalsScene.backpackHud.icon?.decode();
      await vitalsScene.statusHud.ready;
    });

    const states = await page.evaluate(() => {
      const { vitals } = vitalsModules, player = vitalsScene.getPlayer();
      const canvas = document.createElement('canvas');
      canvas.width = 400 * devicePixelRatio; canvas.height = 100 * devicePixelRatio;
      const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
      const rect = { x: 20, y: 20, width: 340, height: 72 };
      const pixel = (x, y) => [...ctx.getImageData(Math.floor((rect.x + x) * devicePixelRatio),
        Math.floor((rect.y + y) * devicePixelRatio), 1, 1).data];
      const results = {};
      for (const [name, health, stamina, maxHealth, maxStamina] of [
        ['full', 100, 100, 100, 100], ['half', 50, 50, 100, 100],
        ['low', 25, 25, 100, 100], ['empty', 0, 0, 100, 100],
        ['scaled', 100, 100, 200, 200], ['exhausted', 100, 0, 100, 100],
        ['recovering', 100, 0, 100, 100],
      ]) {
        player.resetLifeState();
        player.applyConfig({ base: { maxHealth }, sprint: { maxStamina } });
        player.setDebugState({ health, stamina });
        if (name === 'recovering') player.update(.3, { isKeyDown: () => false }, vitalsScene.map);
        ctx.clearRect(0, 0, 400, 100);
        vitals.drawPlayerVitalsHud(ctx, player, rect, devicePixelRatio);
        results[name] = { health: [pixel(90, 25), pixel(250, 25)],
          stamina: [pixel(90, 50), pixel(180, 50), pixel(290, 50)],
          dividers: [112.5, 165.5, 218.5, 271.5].map(x => pixel(x, 50)),
          cross: pixel(25, 25), bolt: pixel(40, 49), border: pixel(100, 44),
          earlyStamina: pixel(75, 50), exhausted: player.getIsExhausted(),
          transform: [ctx.getTransform().a, ctx.getTransform().d, ctx.getTransform().e, ctx.getTransform().f] };
      }
      player.resetLifeState();
      player.setDebugState({ health: 100, stamina: 100 });
      ctx.clearRect(0, 0, 400, 100);
      player.drawUI(ctx);
      results.worldOverlayEmpty = !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(value => value);
      return results;
    });
    for (const name of ['full', 'half', 'scaled']) {
      assert.deepEqual(states[name].health[0], [121, 226, 160, 255], `${name}: health uses the project mint green`);
      assert.deepEqual(states[name].stamina[0], [123, 171, 183, 255], `${name}: stamina uses the project muted blue`);
    }
    assert.deepEqual(states.half.health, states.scaled.health, 'health uses its configured maximum');
    assert.deepEqual(states.half.stamina, states.scaled.stamina, 'stamina uses its configured maximum');
    assert.deepEqual(states.full.health[1], states.full.health[0], 'full health reaches the end');
    assert.deepEqual(states.half.health[1], [29, 44, 53, 255], 'missing health uses the backpack empty-slot color');
    assert.deepEqual(states.empty.health[0], states.half.health[1], 'empty health keeps the slot visible');
    assert.ok(states.half.stamina[1][1] > 100 && states.half.stamina[2][1] < 50, 'partial third segment follows half stamina');
    assert.ok(states.empty.stamina.every(pixel => pixel[1] < 50), 'empty stamina shows no blue fill');
    assert.deepEqual(states.low.health[0], [207, 116, 106, 255], '25% health uses the status icon coral red');
    assert.ok(states.exhausted.border[0] > 180 && states.exhausted.border[0] > states.exhausted.border[1], 'exhaustion has an orange border');
    assert.equal(states.recovering.exhausted, true, 'early recovery keeps the actual exhaustion lock');
    assert.deepEqual(states.recovering.earlyStamina, [80, 97, 107, 255], 'exhausted recovery fill is muted gray');
    // Segment gaps are sampled at their centers at each DPR.
    assert.ok(states.full.dividers.every(pixel => pixel[1] < 100), 'five stamina segments have four dark dividers');
    for (const name of ['full', 'empty']) {
      assert.deepEqual(states[name].cross, [216, 222, 219, 255], 'health icon uses the status icon off-white');
      assert.deepEqual(states[name].bolt, [216, 222, 219, 255], 'stamina icon uses the same off-white');
      assert.deepEqual(states[name].transform, [dpr, dpr, 0, 0], 'drawing preserves the canvas transform');
    }
    assert.equal(states.worldOverlayEmpty, true, 'idle player no longer draws bars in world space');

    for (const [width, height] of [[1920, 1080], [1100, 800], [800, 600], [650, 360], [640, 360], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(([w, h]) => vitalsGame.renderer.ctx.canvas.width === Math.floor(w * devicePixelRatio)
        && vitalsGame.renderer.ctx.canvas.height === Math.floor(h * devicePixelRatio), [width, height], { polling: 50, timeout: 5000 });
      const layout = await page.evaluate(({ width, height }) => {
        const { vitals, weapons, status, backpack, slots } = vitalsModules;
        const weaponArea = weapons.getWeaponListLayout(width, height).area;
        const reserved = [status.getPlayerStatusHudRect(width, height, weaponArea),
          backpack.getBackpackHudRect(width, height, weaponArea), weaponArea];
        const rect = vitals.getPlayerVitalsHudRect(width, height, reserved);
        const quick = slots.getQuickSlotHudLayout(width, height, [...reserved, rect]);
        vitalsScene.getPlayer().setDebugState({ health: 100, stamina: 50 });
        vitalsScene.draw(vitalsGame.renderer.ctx);
        return { rect, reserved, quick };
      }, { width, height });
      const { rect } = layout;
      assert.equal(rect.x, width < 650 ? 12 : 24, 'anchored to left edge');
      assert.ok(rect.width > 0 && rect.height > 0 && rect.y >= 0 && rect.x + rect.width <= width
        && rect.y + rect.height <= height, 'vitals stay inside the viewport');
      for (const area of layout.reserved) assert.equal(overlaps(rect, area), false, `${width}x${height}: vitals clear existing HUD`);
      for (const area of [...layout.reserved, rect]) assert.equal(overlaps(layout.quick, area), false, `${width}x${height}: quick slots clear all HUD`);
      if (width < 650 || height <= 600) assert.ok(layout.reserved[0].y + layout.reserved[0].height <= rect.y - 7.9,
        'compact status icons stay above the final vitals position, including backpack avoidance');
      if (width >= 800) assert.equal(rect.y + rect.height, height - 24, 'desktop stays 24px above bottom');
      if (width >= 1100) assert.deepEqual([rect.width, rect.height], [340, 72], 'desktop uses the larger design size');
      await page.screenshot({ path: `${output}/vitals-${width}x${height}-dpr${dpr}.png` });
      if (width === 1100 && dpr === 2) {
        await page.evaluate(() => {
          const canvas = document.createElement('canvas'); canvas.id = 'vitals-preview';
          canvas.width = 364 * devicePixelRatio; canvas.height = 96 * devicePixelRatio;
          canvas.style.cssText = 'position:fixed;left:0;top:0;width:364px;height:96px;background:#090b0d;z-index:9999;border:0';
          const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
          vitalsModules.vitals.drawPlayerVitalsHud(ctx, vitalsScene.getPlayer(),
            { x: 12, y: 12, width: 340, height: 72 }, devicePixelRatio);
          document.body.append(canvas);
        });
        await page.locator('#vitals-preview').screenshot({ path: `${output}/vitals-detail.png` });
        await page.locator('#vitals-preview').evaluate(element => element.remove());
      }
    }
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForFunction(() => vitalsGame.renderer.width === 1100 * devicePixelRatio, null, { polling: 50, timeout: 5000 });
    const integration = await page.evaluate(() => {
      const ctx = vitalsGame.renderer.ctx, player = vitalsScene.getPlayer();
      const rect = vitalsModules.vitals.getPlayerVitalsHudRect(1100, 800);
      const pixel = () => [...ctx.getImageData(Math.floor((rect.x + 70) * devicePixelRatio),
        Math.floor((rect.y + 25) * devicePixelRatio), 1, 1).data];
      vitalsScene.draw(ctx); const before = pixel();
      vitalsScene.camera.x += 80; vitalsScene.camera.y += 40;
      vitalsScene.draw(ctx); const moved = pixel();
      const original = vitalsScene.backpackPanel.isOpen;
      vitalsScene.backpackPanel.isOpen = () => true;
      vitalsScene.draw(ctx); const hidden = pixel();
      vitalsScene.backpackPanel.isOpen = original;
      return { before, moved, hidden, stamina: player.getStamina() };
    });
    assert.deepEqual(integration.before, integration.moved, 'camera movement does not move or darken the HUD');
    assert.notDeepEqual(integration.before, integration.hidden, 'vitals hide alongside other HUD when backpack opens');
    assert.equal(integration.stamina, 50, 'drawing never changes stamina');
    assert.deepEqual(errors, [], 'no browser runtime errors');
    await context.close();
  }
  console.log('Player vitals HUD: real values, five segments, warnings, responsive placement, camera, backpack and DPR 1/1.25/2 passed.');
} finally {
  await browser.close();
}
