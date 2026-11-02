import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5182/');
    await page.evaluate(async () => {
      const { game } = await import('/src/main.ts'); window.requestAnimationFrame = () => 0;
      await new Promise(r => setTimeout(r, 60));
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      window.g = game; window.s = await createFixedScene(game, 50, 40, 900, 800);
      window.tick = (dt = 0) => { s.update(dt, g.input); s.draw(g.renderer.ctx); };
      window.advance = seconds => { for (let i = 0; i < Math.round(seconds * 120); i++) s.update(1 / 120, g.input); s.draw(g.renderer.ctx); };
      s.survival.inventory.add('grenade', 2); s.survival.inventory.addVaccines(2); s.survival.infection.infect();
      s.player.shootAt({ x: 1500, y: 800 }, 10, s.map); s.player.requestReload();
      window.dispatchEvent(new Event('focus')); tick();
    });
    const tap = async key => { await page.keyboard.down(key); await page.evaluate(() => tick()); await page.keyboard.up(key); await page.evaluate(() => tick()); };
    await page.keyboard.down('KeyW'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => s.backpackPanel.isOpen() && g.input.isBlocked() && !s.isWorldPaused()), true);
    const motion = await page.evaluate(() => {
      const root = document.querySelector('[data-backpack]'), animation = root.getAnimations()[0];
      animation.pause(); animation.currentTime = 90;
      const opacity = Number(getComputedStyle(root).opacity); animation.play(); return opacity;
    });
    assert.ok(motion > 0 && motion < 1, 'the opening transition has a real intermediate state');
    const before = await page.evaluate(() => ({ x: s.player.x, y: s.player.y, hp: s.player.getHealth(), bullets: s.player.getBullets().map(b => [b.x, b.y]) }));
    await page.evaluate(() => advance(2));
    assert.deepEqual(await page.evaluate(() => [s.player.x, s.player.y]), [before.x, before.y]);
    assert.ok(await page.evaluate(hp => s.player.getHealth() < hp && !s.player.getWeaponView().isReloading, before.hp));
    assert.notDeepEqual(await page.evaluate(() => s.player.getBullets().map(b => [b.x, b.y])), before.bullets);
    await page.keyboard.up('KeyW');
    await page.locator('[data-category="consumables"]').click();
    await page.locator('[data-item-id="vaccine"]').click({ button: 'right' }); await page.locator('[data-bind-slot="0"]').click();
    await page.locator('[data-category="throwables"]').click();
    await page.locator('[data-item-id="grenade"]').click({ button: 'right' }); await page.locator('[data-bind-slot="1"]').click();
    await page.evaluate(() => tick());
    await page.mouse.move(1100, 280); await page.mouse.down({ button: 'right' });
    assert.equal(await page.evaluate(() => s.backpackPanel.isOpen()), false);
    const bullets = await page.evaluate(() => s.player.getBullets().length);
    await page.mouse.down(); await page.evaluate(() => tick()); assert.equal(await page.evaluate(() => s.player.getBullets().length), bullets);
    await page.mouse.up(); await page.mouse.up({ button: 'right' });
    await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => !s.backpackPanel.isOpen() && s.isWorldPaused() && s.sfx.isPaused()), true);
    const paused = await page.evaluate(() => s.survival.snapshot()); await page.evaluate(() => advance(2));
    assert.deepEqual(await page.evaluate(() => s.survival.snapshot()), paused);
    await page.locator('.pause-panel button').click(); assert.equal(await page.evaluate(() => s.isWorldPaused()), false);
    const slots = await page.evaluate(() => { tick(); const l = s.quickSlotHud.layout; return Array.from({ length: 4 }, (_, i) => ({ x: l.x + i * (l.size + l.gap) + l.size / 2, y: l.y + l.size / 2 })); });
    const dragSlot = async (from, target) => { await page.mouse.move(slots[from].x, slots[from].y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 6 }); await page.evaluate(() => tick()); await page.mouse.up(); await page.evaluate(() => tick()); };
    await page.mouse.move(slots[0].x, slots[0].y); await page.evaluate(() => tick());
    assert.equal(await page.evaluate(() => document.body.classList.contains('hud-pointer')), true);
    await dragSlot(0, slots[1]); assert.deepEqual(await page.evaluate(() => s.quickSlotBindings), ['grenade', 'vaccine', null, null]);
    await dragSlot(1, slots[3]); assert.deepEqual(await page.evaluate(() => s.quickSlotBindings), ['grenade', null, null, 'vaccine']);
    await page.evaluate(() => { s.survival.inventory.consume('grenade'); s.survival.inventory.consume('grenade'); tick(); });
    assert.equal(await page.evaluate(() => s.quickSlotBindings[0]), 'grenade');
    await page.screenshot({ path: `.review/improvements-hotbar-dpr${dpr}.png` });
    await page.evaluate(() => { s.survival.inventory.add('grenade'); tick(); }); await tap('Digit1');
    assert.equal(await page.evaluate(() => s.throwable.held), 'grenade');
    await page.keyboard.press('Tab'); await dragSlot(3, slots[2]);
    assert.equal(await page.evaluate(() => s.backpackPanel.isOpen()), false); assert.equal(await page.evaluate(() => s.quickSlotBindings[2]), 'vaccine');
    const count = await page.evaluate(() => s.survival.inventory.getVaccines());
    await page.mouse.click(slots[2].x, slots[2].y, { button: 'right' });
    assert.equal(await page.evaluate(() => s.quickSlotBindings[2]), null); assert.equal(await page.evaluate(() => s.survival.inventory.getVaccines()), count);
    await dragSlot(0, { x: 800, y: 300 }); assert.equal(await page.evaluate(() => s.quickSlotBindings[0]), null);
    await page.evaluate(() => { s.quickSlotBindings[0] = 'grenade'; tick(); });
    await page.mouse.move(slots[0].x, slots[0].y); await page.mouse.down(); await page.mouse.move(800, 300); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await page.evaluate(() => s.quickSlotBindings[0]), 'grenade'); await page.keyboard.press('Escape');
    const map = await page.evaluate(() => s.minimap.getLayout()), weapon = await page.evaluate(() => s.player.getActiveWeaponSlot());
    await page.mouse.move(map.centerX, map.centerY); await page.mouse.wheel(0, -100); await page.waitForTimeout(30); await page.evaluate(() => tick());
    assert.equal(await page.evaluate(() => s.minimap.getLayout().worldRadius), 450); assert.equal(await page.evaluate(() => s.player.getActiveWeaponSlot()), weapon);
    for (let i = 0; i < 7; i++) await page.mouse.wheel(0, -100);
    await page.waitForTimeout(30); assert.equal(await page.evaluate(() => s.minimap.getLayout().worldRadius), 300); assert.equal(await page.evaluate(() => s.player.getActiveWeaponSlot()), weapon);
    await page.mouse.move(1100, 250); await page.mouse.wheel(0, 100); await page.waitForTimeout(30); await page.evaluate(() => tick());
    assert.notEqual(await page.evaluate(() => s.player.getActiveWeaponSlot()), weapon);
    await page.evaluate(async () => {
      const { TradingStation } = await import('/src/objects/TradingStation.ts'); const p = s.player.getVisionState();
      s.tradingStations = [new TradingStation('test', p.x + 70, p.y)]; s.map.setStaticObstacles(s.tradingStations.map(s => s.getCollider())); tick();
      await new Promise(r => setTimeout(r, 120)); tick();
    });
    await tap('KeyT'); assert.equal(await page.evaluate(() => s.getTradingStationState().lastInteracted), 'test');
    await page.screenshot({ path: `.review/improvements-terminal-dpr${dpr}.png` });
    for (const [width, height] of [[640, 360], [390, 844]]) {
      await page.setViewportSize({ width, height }); await page.keyboard.press('Tab'); await page.waitForTimeout(200); await page.evaluate(() => tick());
      const b = await page.locator('.backpack-panel').boundingBox(); assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height);
      const covered = await page.evaluate(() => {
        const l = s.quickSlotHud.layout, x = l.x + l.size / 2, y = l.y + l.size / 2;
        return document.elementFromPoint(x, y)?.closest('.backpack-panel') ? { x, y } : null;
      });
      if (covered) { await page.mouse.click(covered.x, covered.y); assert.equal(await page.evaluate(() => s.backpackPanel.isOpen()), true, 'the backpack owns clicks over underlying hotbar slots'); }
      const mini = await page.evaluate(() => s.minimap.getLayout());
      await page.mouse.move(mini.centerX, mini.centerY); await page.mouse.wheel(0, 100); await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => s.minimap.getLayout().worldRadius), mini.worldRadius, 'scrolling a panel covering the minimap cannot zoom the map');
      await page.screenshot({ path: `.review/improvements-backpack-${width}-dpr${dpr}.png` }); await page.keyboard.press('Tab');
    }
    await page.evaluate(() => { for (let i = 0; i < 6; i++) { s.backpackPanel.setOpen(true); s.backpackPanel.setOpen(false); } });
    await page.waitForTimeout(150); assert.equal(await page.locator('[data-backpack]').isVisible(), false, 'interrupted transitions never reopen a closed panel');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('[data-backpack]').getAnimations().length), 0);
    await page.keyboard.press('Tab'); assert.equal(await page.locator('[data-backpack]').isVisible(), false, 'reduced motion closes immediately');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { s.survival.inventory.add('grenade'); s.activateInventoryItem('grenade', 'gameplay'); const p = s.player.getVisionState(); s.throwable.input({ aimedLeftPressed: true }, p); });
    await page.keyboard.press('Tab'); await page.evaluate(() => advance(4.1));
    assert.equal(await page.evaluate(() => s.player.isAlive()), false); assert.equal(await page.evaluate(() => s.backpackPanel.isOpen()), false);
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => s.backpackPanel.isOpen()), false);
    await page.evaluate(() => s.onExit()); assert.equal(await page.locator('[data-backpack],.pause-overlay').count(), 0);
    assert.equal(await page.evaluate(() => g.input.isBlocked()), false); assert.deepEqual(errors, []); await context.close();
  }
  console.log('Backpack/live world, pause, hotbar, minimap and terminal: desktop/mobile, DPR 1/1.25/2 passed.');
} finally { await browser.close(); }
