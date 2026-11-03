import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review/structures', { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, hasTouch: true }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const bind = () => page.evaluate(() => {
    window.g = window.__miniGame; window.m = g.campaign; window.s = () => g.sceneManager.getCurrentScene();
    window.tick = (dt = 0) => { s().update(dt, g.input); s().draw(g.renderer.ctx); };
    window.records = () => {
      const id = JSON.parse(localStorage.getItem('mini-2d-engine:campaign:active')).campaignId;
      return [0, 1].map(slot => ({ key: 'mini-2d-engine:campaign:' + encodeURIComponent(id) + ':' + slot,
        raw: localStorage.getItem('mini-2d-engine:campaign:' + encodeURIComponent(id) + ':' + slot) })).filter(r => r.raw)
        .map(r => ({ ...r, value: JSON.parse(r.raw) })).sort((a, b) => b.value.saveSequence - a.value.saveSequence);
    };
    window.dispatchEvent(new Event('focus')); tick();
  });
  const resume = async () => { await page.locator('[data-continue-campaign]').click(); await page.waitForSelector('[data-campaign-hud]'); await bind(); };
  const open = async () => { await page.locator('[data-campaign-construction]').click(); await page.evaluate(() => tick()); };
  const close = async () => { await page.keyboard.press('Escape'); await page.evaluate(() => tick()); };
  const cellPoint = (col, row, offset = .5) => page.evaluate(([col, row, offset]) => {
      const v = s().displayedView, rect = g.renderer.ctx.canvas.getBoundingClientRect();
      return { x: rect.left + ((col + offset) * 50 - v.x) * rect.width / v.width, y: rect.top + ((row + offset) * 50 - v.y) * rect.height / v.height };
    }, [col, row, offset]);
  const selectCell = async (col, row) => {
    const point = await cellPoint(col, row);
    await page.mouse.click(point.x, point.y); await page.evaluate(() => tick());
    assert.deepEqual(await page.evaluate(() => [s().structurePanel.col, s().structurePanel.row]), [col, row]);
  };
  const dragCard = async () => {
    const box = await page.locator('[data-structure-drag]').boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    assert.equal(await page.evaluate(() => !!s().constructionDrag), true);
    return point;
  };
  const dragTo = async (col, row, offset = .5) => {
    const point = await cellPoint(col, row, offset);
    await page.mouse.move(point.x, point.y, { steps: 5 }); await page.evaluate(() => tick());
    assert.deepEqual(await page.evaluate(() => [s().structurePanel.col, s().structurePanel.row]), [col, row]);
  };
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5187');
  await page.locator('[data-new-campaign]').click(); await page.waitForSelector('[data-campaign-hud]'); await bind();
  const before = await page.evaluate(() => ({ player: s().captureCampaignPlayer(), clock: m.session.getClockReading().worldMinute }));
  await open();
  assert.equal(await page.locator('[data-structure-panel] input').count(), 0, 'construction never requires numeric coordinates');
  assert.equal(await page.evaluate(() => m.session.getClockReading().pauseReasons.includes('construction')), true);
  await page.keyboard.press('F2'); await page.keyboard.press('Tab');
  assert.deepEqual(await page.evaluate(() => [s().debugPanel.isOpen(), s().backpackPanel.isOpen()]), [false, false]);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); tick(); });
  assert.equal(await page.locator('[data-structure-build]').isEnabled(), true, await page.evaluate(() => JSON.stringify({ reasons: m.session.getClockReading().pauseReasons, status: s().getStructurePanelView() })));
  await page.evaluate(() => tick(3));
  assert.equal(await page.evaluate(() => m.session.getClockReading().worldMinute), before.clock);
  await dragCard(); await dragTo(7, 10);
  assert.equal(await page.locator('[data-structure-build]').isDisabled(), true);
  assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 0);
  await dragTo(9, 10, .88);
  assert.equal(await page.locator('[data-structure-build]').isEnabled(), true);
  assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 0, 'preview does not place before release');
  await page.screenshot({ path: `.review/structures/drag${dpr === 1 ? '' : '-dpr-' + dpr}.png` });
  await page.mouse.up(); await page.evaluate(() => tick());
  const built = await page.evaluate(() => ({ state: s().getStructures().snapshot()[0], saved: records()[0].value.payload.locations.outpost.structures,
    sequence: m.session.getSnapshot().nextInstanceSequence, player: s().captureCampaignPlayer() }));
  assert.equal(built.state.hp, 120); assert.deepEqual([built.state.col, built.state.row], [9, 10]);
  assert.deepEqual(built.saved, [built.state]); assert.equal(built.sequence, 1); assert.deepEqual(built.player, before.player);
  assert.equal(await page.locator('[data-structure-build]').isDisabled(), true);
  await page.screenshot({ path: `.review/structures/planning${dpr === 1 ? '' : '-dpr-' + dpr}.png` });
  // Selection stays on the clicked wall while moving to its management panel.
  const empty = await cellPoint(8, 9); await page.mouse.move(empty.x, empty.y);
  assert.deepEqual(await page.evaluate(() => [s().structurePanel.col, s().structurePanel.row]), [9, 10]);
  // Invalid drops, UI drops and ownership loss never allocate another ID or place a wall.
  await dragCard(); await dragTo(7, 10); await page.mouse.up();
  await dragCard(); await dragTo(9, 10); await page.mouse.up();
  const card = await dragCard(); await dragTo(8, 9); await page.mouse.move(card.x, card.y); await page.mouse.up();
  await dragCard(); await dragTo(8, 9); await page.mouse.move(-10, -10); await page.mouse.up();
  await dragCard(); await dragTo(8, 9);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  assert.equal(await page.evaluate(() => !!s().constructionDrag), false);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); tick(); });
  await dragCard(); await dragTo(8, 9); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.evaluate(() => s().isConstructionPlanning()), false);
  assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 1);
  assert.equal(await page.evaluate(() => m.session.getSnapshot().nextInstanceSequence), built.sequence);
  assert.deepEqual(await page.evaluate(() => s().captureCampaignPlayer()), before.player);
  await open();
  // The preview/drop conversion follows the displayed camera at a different zoom too.
  await page.evaluate(() => { s().applyGraphics({ ...s().graphics, camera: { zoom: .7 } }); tick(); });
  await dragCard(); await dragTo(8, 9, .82);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 1);
  await page.evaluate(() => { s().applyGraphics({ ...s().graphics, camera: { zoom: 1 } }); tick(); });
  await open();
  await close();
  assert.equal(await page.evaluate(() => m.session.getClockReading().paused), false);
  const damaged = await page.evaluate(async () => {
    const { Bullet } = await import('/src/objects/Bullet.ts'), { Vector2 } = await import('/src/math/Vector2.ts');
    const b = new Bullet(new Vector2(420, 525), new Vector2(1000, 0), 37); b.update(.2, s().map); b.update(.2, s().map); tick();
    return { hp: s().getStructures().snapshot()[0].hp, saved: records()[0].value.payload.locations.outpost.structures[0].hp };
  });
  assert.deepEqual(damaged, { hp: 83, saved: 83 });
  await page.reload(); await resume();
  assert.equal(await page.evaluate(() => s().getStructures().snapshot()[0].hp), 83);
  assert.equal(await page.evaluate(() => s().map.blocksLightAt(475, 525)), true);
  await open();
  const revision = await page.evaluate(() => s().map.getNavigationRevision());
  await page.locator('[data-structure-repair]').click();
  assert.equal(await page.evaluate(() => s().getStructures().snapshot()[0].hp), 120);
  assert.equal(await page.evaluate(() => s().map.getNavigationRevision()), revision, 'repair does not change topology');
  await close();
  assert.equal(await page.evaluate(() => m.travel()), true); assert.equal(await page.evaluate(() => m.travel()), true);
  assert.equal(await page.evaluate(() => s().getStructures().snapshot()[0].hp), 120);
  await page.evaluate(() => {
    const hp = s().player.getHealth(); s().explodeThrowable(510, 525); tick();
    if (s().player.getHealth() !== hp) throw new Error('blast tunneled through a wall destroyed by the same blast');
  });
  assert.equal(await page.evaluate(() => s().getStructures().snapshot()[0].status), 'destroyed');
  assert.equal(await page.evaluate(() => s().map.blocksLightAt(475, 525)), false);
  await page.reload(); await resume();
  assert.equal(await page.evaluate(() => s().getStructures().snapshot()[0].hp), 0);
  await open(); assert.equal(await page.locator('[data-structure-repair]').isDisabled(), true);
  await page.locator('[data-structure-remove]').click(); assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 1);
  await page.locator('[data-structure-remove]').click(); assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 0);
  const start = await cellPoint(8, 9); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await dragTo(9, 10, .15); await page.keyboard.press('r'); await page.mouse.up(); await page.evaluate(() => tick());
  assert.equal(await page.evaluate(() => s().getStructures().snapshot()[0].rotation), 1);
  assert.notEqual(await page.evaluate(() => s().getStructures().snapshot()[0].instanceId), built.state.instanceId);
  // Clicking an invalid cell cannot place a wall; clicking an existing one selects it.
  await selectCell(7, 10);
  assert.equal(await page.locator('[data-structure-build]').isDisabled(), true);
  await selectCell(9, 10);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => g.renderer.width === 390 * devicePixelRatio, undefined, { polling: 25 }); await page.evaluate(() => tick());
  await selectCell(7, 10); assert.equal(await page.locator('[data-structure-build]').isDisabled(), true);
  await selectCell(9, 10);
  const bounds = await page.locator('[data-structure-panel]').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
  await page.screenshot({ path: `.review/structures/mobile${dpr === 1 ? '' : '-dpr-' + dpr}.png` });
  await page.locator('[data-structure-remove]').click(); await page.locator('[data-structure-remove]').click();
  // Native touch drag uses the same snapping/drop path, including pointercancel.
  const cdp = await page.context().newCDPSession(page);
  const touchDrag = async cancel => {
    const box = await page.locator('[data-structure-drag]').boundingBox(), target = await cellPoint(9, 10, .8);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x, y: target.y, id: 1 }] });
    await page.evaluate(() => tick());
    assert.equal(await page.evaluate(() => !!s().constructionDrag), true);
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await page.evaluate(() => tick()); assert.equal(await page.evaluate(() => !!s().constructionDrag), false);
  };
  await touchDrag(true); assert.equal(await page.evaluate(() => s().getStructures().snapshot().length), 0);
  await touchDrag(false); assert.deepEqual(await page.evaluate(() => s().getStructures().snapshot().map(w => [w.col, w.row])), [[9, 10]]);
  await cdp.detach();
  await page.locator('[data-structure-remove]').click(); await page.locator('[data-structure-remove]').click(); await close();
  // Synthetic P1 archive: migration is pure and the first new save preserves the original slot as backup.
  const legacy = await page.evaluate(() => {
    const record = records()[0]; record.value.payload.schemaVersion = 1;
    for (const location of Object.values(record.value.payload.locations)) delete location.structures;
    const raw = JSON.stringify(record.value); localStorage.setItem(record.key, raw); return { key: record.key, raw };
  });
  await page.reload(); await resume();
  assert.equal(await page.evaluate(() => m.session.getSnapshot().schemaVersion), 2);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), legacy.key), legacy.raw);
  await open();
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await page.evaluate(() => [s().structurePanel.col, s().structurePanel.row]), [9, 11]);
  await page.keyboard.press('ArrowUp');
  await page.locator('[data-structure-build]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => records()[0].value.payload.schemaVersion), 2);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), legacy.key), legacy.raw);
  await close(); await page.evaluate(() => m.endDay());
  assert.equal(await page.locator('[data-campaign-construction]').isDisabled(), true, 'dusk does not allow construction pause');
  assert.deepEqual(errors, []);
  await page.close();
  }
  console.log('Structures browser: mouse/card/canvas and native touch drag, grid snapping, release-only placement, invalid/UI/outside drops, blur/Esc/touch cancellation, locked selection, paused free build, persistence/reload/travel, damage/repair/rubble, rotation, mobile, DPR 1/1.25/2 and schema-1 migration passed.');
} finally { await browser.close(); }
