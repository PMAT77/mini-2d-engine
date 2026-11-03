import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review/day-clock';
mkdirSync(output, { recursive: true });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
try {
  for (const dpr of [1, 1.25, 2, 3]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5182/');
    await page.keyboard.down('n'); await page.waitForSelector('[data-campaign-hud]'); await page.keyboard.up('n');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.g = (await import(entry.src)).game;
      window.requestAnimationFrame = () => 0; await new Promise(resolve => setTimeout(resolve, 70));
      window.scene = () => g.sceneManager.getCurrentScene();
      window.tick = (delta = 0) => { scene().update(delta, g.input); scene().draw(g.renderer.ctx); };
      window.dispatchEvent(new Event('focus')); tick();
    });
    const hud = page.locator('[data-day-clock-hud]');
    await hud.waitFor({ state: 'visible' });
    assert.match(await hud.getAttribute('aria-label'), /第 01 天 白昼.*白天整备时间/);
    assert.equal(await hud.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    const initial = await page.evaluate(() => ({ time: g.campaign.session.getClockReading().worldMinute,
      canvas: document.querySelector('[data-day-clock-hud]').toDataURL() }));
    await page.evaluate(() => { scene().setExplicitPaused(true); tick(20); });
    assert.equal(await page.evaluate(() => g.campaign.session.getClockReading().worldMinute), initial.time);
    assert.equal(await hud.evaluate(el => el.toDataURL()), initial.canvas, 'pause does not advance or animate HUD pixels');
    assert.ok(await hud.evaluate(el => Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector('.pause-overlay')).zIndex)));
    if (dpr === 1) await page.screenshot({ path: `${output}/paused.png` });
    await page.evaluate(() => { scene().setExplicitPaused(false); scene().backpackPanel.setOpen(true); tick(2); });
    await page.waitForTimeout(350);
    assert.ok(await hud.isVisible());
    assert.ok(await page.evaluate(() => !scene().isWorldPaused() && g.campaign.session.getClockReading().worldMinute > 1));
    assert.ok(await hud.evaluate(el => Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector('[data-backpack]')).zIndex)));
    const packClock = await hud.boundingBox(), packTabs = await page.locator('.backpack-tabs').boundingBox();
    assert.equal(overlaps(packClock, packTabs), false);
    if (dpr === 1) await page.screenshot({ path: `${output}/backpack.png` });
    await page.evaluate(() => scene().backpackPanel.setOpen(false));
    // 外出时依然接在同一会话上；背包不暂停权威世界时间。
    assert.equal(await page.evaluate(() => g.campaign.travel()), true);
    await page.evaluate(() => { scene().backpackPanel.setOpen(true); tick(1); });
    assert.match(await hud.getAttribute('aria-label'), /距返程截止/);
    await page.evaluate(() => scene().backpackPanel.setOpen(false));
    assert.equal(await page.locator('[data-day-clock-hud]').count(), 1, 'travel replaces the owning canvas');
    assert.equal(await page.evaluate(() => g.campaign.travel()), true);
    for (const [width, height] of [[1440, 900], [1100, 800], [800, 600], [640, 360], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(w => Math.abs(g.renderer.width / devicePixelRatio - w) < 1, width);
      await page.evaluate(() => tick());
      const box = await hud.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 12 && box.x + box.width <= width + .1 && box.y + box.height <= height);
      assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < .1, `${width}x${height}@${dpr}: ${JSON.stringify(box)}`);
      const occupied = await page.evaluate(async () => {
        const m = scene().minimap.getLayout();
        const { getWeaponListLayout } = await import('/src/ui/WeaponListHud.ts');
        const debug = document.querySelector('.debug-toggle').getBoundingClientRect();
        return [{ x: m.left, y: m.top, width: m.diameter, height: m.diameter },
          { x: debug.x, y: debug.y, width: debug.width, height: debug.height }, getWeaponListLayout(innerWidth, innerHeight).area];
      });
      for (const rect of occupied) assert.equal(overlaps(box, rect), false, `${width}x${height}@${dpr}`);
      assert.equal(overlaps(await page.locator('[data-campaign-hud]').boundingBox(), occupied[2]), false, 'campaign actions also stay clear of weapons');
      const backing = await hud.evaluate(el => ({ width: el.width, height: el.height }));
      assert.ok(Math.abs(backing.width - box.width * dpr) <= 1);
      assert.ok(Math.abs(backing.height - box.height * dpr) <= 1);
      if (dpr === 1 && width === 390) await page.screenshot({ path: `${output}/compact.png` });
    }
    if (dpr === 1) {
      // 同一游戏场景、同一世界画布，仅注入只读 HUD 状态来验收被原型跳过的夜间。
      await page.setViewportSize({ width: 1672, height: 941 });
      await page.evaluate(async () => {
        const { GameScene } = await import('/src/scenes/GameScene.ts');
        const s = new GameScene({ seed: 817 }); await s.load();
        g.sceneManager.changeScene(s, 0); await new Promise(resolve => setTimeout(resolve, 0));
        window.dispatchEvent(new Event('focus')); tick();
      });
      const renderedDigits = await page.evaluate(() => {
        const ctx = document.querySelector('[data-day-clock-hud]').getContext('2d'), original = ctx.fillText, frames = [];
        try {
          for (const worldMinute of [311, 1079]) {
            const calls = []; ctx.fillText = function(text, x, y, ...rest) { if (y === 49) calls.push({ text, x }); return original.call(this, text, x, y, ...rest); };
            scene().setDayClockPreview({ worldMinute, location: 'camp' }); scene().draw(g.renderer.ctx); frames.push(calls);
          }
        } finally { ctx.fillText = original; }
        return frames;
      });
      assert.deepEqual(renderedDigits.map(frame => frame.map(call => call.text).join('')), ['11:11', '23:59']);
      assert.deepEqual(renderedDigits[0].map(call => call.x), renderedDigits[1].map(call => call.x));
      let worldPixels;
      for (const [name, state] of [
        ['day', { worldMinute: 2880 + 515, location: 'field' }],
        ['urgent', { worldMinute: 2880 + 711, location: 'field' }],
        ['dusk', { worldMinute: 2880 + 762, location: 'camp' }],
        ['night', { worldMinute: 2880 + 900, location: 'camp', raid: { wave: 1, totalWaves: 2 } }],
        ['missed', { worldMinute: 2880 + 720, location: 'field' }],
        ['day-100', { worldMinute: 99 * 1440 + 305, location: 'camp' }],
      ]) {
        await page.evaluate(state => { scene().setDayClockPreview(state); scene().deltaSinceLastFrame = 0; scene().draw(g.renderer.ctx); }, state);
        const pixels = await page.evaluate(() => g.renderer.ctx.canvas.toDataURL());
        if (worldPixels) assert.ok(pixels === worldPixels, 'new clock never alters any existing game/HUD canvas pixels');
        worldPixels = pixels;
        await page.screenshot({ path: `${output}/${name}.png` });
      }
      await page.evaluate(() => { scene().setDayClockPreview(null); scene().draw(g.renderer.ctx); });
      assert.equal(await hud.isVisible(), false, 'sandbox without a campaign does not fabricate time');
    }
    const retained = await page.evaluate(() => {
      const s = scene(); s.onSuspend(); s.onResume();
      return document.querySelectorAll('[data-day-clock-hud]').length;
    });
    assert.equal(retained, 1);
    if (dpr !== 1) {
      await page.evaluate(() => { scene().player.takeDamage(999); tick(); });
      assert.equal(await hud.isVisible(), false, 'death hides the clock');
    }
    await page.evaluate(async () => {
      const { MenuScene } = await import('/src/scenes/MenuScene.ts'); g.sceneManager.changeScene(new MenuScene(), 0);
    });
    assert.equal(await page.locator('[data-day-clock-hud]').count(), 0);
    assert.equal(await page.locator('[data-day-clock-layer]').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Day clock browser checks passed: live campaign/backpack, pause, travel/cleanup, 6 sizes × DPR 1/1.25/2/3, unchanged world/HUD pixels, phase screenshots.');
} finally { await browser.close(); }
