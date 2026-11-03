import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187/';
mkdirSync('.review', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Explicit frames make reload comparisons exact, including infection remainders and buff durations.
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const bind = () => page.evaluate(() => {
    window.g = window.__miniGame; window.m = g.campaign;
    window.s = () => g.sceneManager.getCurrentScene();
    window.grantGold = count => { for (let i = 0; i < count; i++) s().player.collectGold(); };
    window.tick = (dt = 0) => { s().update(dt, g.input); s().draw(g.renderer.ctx); };
    window.disk = () => {
      const id = JSON.parse(localStorage.getItem('mini-2d-engine:campaign:active')).campaignId;
      return [0, 1].map(slot => ({ key: 'mini-2d-engine:campaign:' + encodeURIComponent(id) + ':' + slot,
        raw: localStorage.getItem('mini-2d-engine:campaign:' + encodeURIComponent(id) + ':' + slot) }))
        .filter(x => x.raw).map(x => ({ ...x, value: JSON.parse(x.raw) })).sort((a, b) => b.value.saveSequence - a.value.saveSequence);
    };
    window.dispatchEvent(new Event('focus'));
  });
  const resume = async () => {
    await page.locator('[data-continue-campaign]').click(); await page.waitForSelector('[data-campaign-hud]'); await bind();
  };
  await page.goto(base);
  assert.equal(await page.locator('[data-continue-campaign]').isDisabled(), true);
  await page.locator('[data-new-campaign]').click(); await page.waitForSelector('[data-campaign-hud]'); await bind();
  assert.equal(await page.evaluate(() => disk()[0].value.payload.campaignId), await page.evaluate(() => m.session.getSnapshot().campaignId));
  assert.equal(await page.evaluate(() => m.travel()), true);
  assert.equal(await page.evaluate(() => disk()[0].value.payload.presence.locationId), 'residential', 'travel saves immediately');

  const saved = await page.evaluate(() => {
    const scene = s(), p = scene.captureCampaignPlayer();
    p.hp = 47; p.stamina = 18.5; p.exhausted = true; p.staminaRegenDelaySeconds = .35; p.gold = 9;
    p.infection = { infected: true, remainderSeconds: .72 };
    p.weapons.primary.magazineAmmo = 11; p.weapons.primary.reserveAmmo = 0;
    p.weapons.secondary.magazineAmmo = 2; p.weapons.secondary.reserveAmmo = null;
    p.effects = [{ id: 'saved-buff', stat: 'damage', value: .25, isMultiplier: true, remainingSeconds: 4.25 }];
    p.preferences.flashlightOn = false; p.quickSlots = ['primary', 'secondary', 'vaccine', 'grenade'];
    scene.player.restorePersistentState(p, { position: { x: 425.5, y: 575.5 }, facing: 1.25 });
    scene.survival.restore(p); scene.modifierManager.restorePersistentState(p.effects);
    scene.quickSlotBindings.splice(0, 4, ...p.quickSlots); scene.flashlightOn = false;
    scene.backpackPanel.setOpen(true); scene.dropBackpackItem('secondary'); scene.backpackPanel.setOpen(false);
    scene.map.damageTile(14, 12, 31);
    const enemy = scene.enemies.zombies[0];
    scene.enemies.receiveHit(enemy, { source: 'script', damage: 999, point: enemy.getCenter(), direction: { x: 1, y: 0 },
      impulse: 0, impactSpeed: 0, initialSpeed: 0, traveledDistance: 0 });
    const vaccine = scene.vaccinePickups[0]; scene.survival.collectVaccine(vaccine); scene.vaccinePickups = [];
    scene.updatePerception(0); scene.perception.getExplorationGrid('player').markCell(25, 20);
    m.advance(scene, 30);
    return disk()[0].value.payload;
  });
  assert.equal(saved.player.hp, 47); assert.equal(saved.player.weapons.secondary, null);
  assert.equal(saved.locations.residential.groundItems.length, 3);
  assert.equal(saved.worldMinute, 24);
  const sequence = await page.evaluate(() => { const before = disk()[0].value.saveSequence; m.requestSave(); m.requestSave(); return [before, disk()[0].value.saveSequence]; });
  assert.equal(sequence[0], sequence[1], 'unchanged same-frame requests are coalesced');
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => m.session.getSnapshot()), saved, 'continue restores exact persisted time and state');
  assert.deepEqual(await page.evaluate(() => s().captureCampaignPlayer()), saved.player);
  assert.deepEqual(await page.evaluate(() => s().captureCampaignPose()), { position: saved.presence.position, facing: saved.presence.facing });
  assert.deepEqual(await page.evaluate(() => s().captureCampaignCheckpoint(1).location), saved.locations.residential);
  assert.equal(await page.evaluate(() => m.session.getClockReading().paused), false);

  const quota = await page.evaluate(() => {
    const before = disk().map(x => x.raw), original = Storage.prototype.setItem;
    window.restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('mini-2d-engine:campaign:')) throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); };
    grantGold(3); const result = m.requestSave();
    return { result, unchanged: JSON.stringify(before) === JSON.stringify(disk().map(x => x.raw)), gold: s().player.getGold() };
  });
  assert.deepEqual(quota, { result: false, unchanged: true, gold: 12 });
  assert.equal(await page.locator('[data-campaign-retry-save]').isVisible(), true);
  assert.match(await page.locator('[data-campaign-save-status]').textContent(), /自动保存失败/);
  await page.evaluate(() => restoreStorage()); await page.locator('[data-campaign-retry-save]').click();
  assert.equal(await page.evaluate(() => disk()[0].value.payload.player.gold), 12);
  assert.equal(await page.locator('[data-campaign-retry-save]').isHidden(), true);

  const held = await page.evaluate(() => {
    const scene = s(); scene.survival.inventory.add('grenade', 2); scene.throwable.equip('grenade', 'primary');
    scene.survival.inventory.reserve('grenade'); scene.throwable.prepared = true;
    scene.throwable.fuse = 2.375; scene.throwable.target = { x: 1000, y: 600 }; scene.throwableRemainder = .003;
    grantGold(2); if (!m.requestSave()) throw new Error('armed save failed');
    return disk()[0].value.runtime;
  });
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => s().captureCampaignRuntime()), held);
  assert.deepEqual(await page.evaluate(() => [s().throwable.locked, s().survival.inventory.getCount('grenade'), s().survival.inventory.getAvailable('grenade')]), [true, 2, 1]);
  assert.equal(await page.evaluate(() => m.travel()), false, 'restored armed grenade still prevents travel');
  const flying = await page.evaluate(() => {
    const scene = s(); scene.releaseThrowable();
    scene.survival.inventory.add('smokeGrenade'); scene.throwable.equip('smokeGrenade', 'primary');
    scene.throwable.input({ aimFirePressed: true }, { x: 900, y: 650 }); scene.releaseThrowable();
    scene.updateThrowables(.15, false); if (!m.requestSave()) throw new Error('flight save failed');
    return disk()[0].value.runtime;
  });
  assert.equal(flying.bodies.length, 2); assert.ok(flying.bodies.every(body => body.z > 0));
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => s().captureCampaignRuntime()), flying);
  assert.deepEqual(await page.evaluate(() => [s().survival.inventory.getCount('grenade'), s().survival.inventory.getCount('smokeGrenade')]), [1, 0]);
  const smoking = await page.evaluate(() => {
    s().updateThrowables(.9, false); if (!m.requestSave()) throw new Error('smoke save failed');
    const body = s().throwableBodies.find(body => body.kind === 'smokeGrenade');
    return { runtime: disk()[0].value.runtime, opacity: s().smoke.density(body.x, body.y) };
  });
  assert.ok(smoking.runtime.bodies.find(body => body.kind === 'smokeGrenade').smokeAge >= 0);
  assert.ok(smoking.opacity > 0);
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => s().captureCampaignRuntime()), smoking.runtime);
  assert.equal(await page.evaluate(() => { const body = s().throwableBodies.find(body => body.kind === 'smokeGrenade'); return s().smoke.density(body.x, body.y); }), smoking.opacity);
  const explosions = await page.evaluate(() => {
    const scene = s(), original = scene.explodeThrowable.bind(scene); let count = 0;
    scene.explodeThrowable = (...args) => { count++; original(...args); };
    scene.updateThrowables(3, false); m.requestSave();
    return { count, remaining: scene.throwableBodies.filter(body => body.kind === 'grenade').length,
      grenades: scene.survival.inventory.getCount('grenade'), runtime: disk()[0].value.runtime };
  });
  assert.equal(explosions.count, 1); assert.equal(explosions.remaining, 0); assert.equal(explosions.grenades, 1);
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => s().captureCampaignRuntime()), explosions.runtime);
  assert.equal(await page.evaluate(() => { let count = 0; s().explodeThrowable = () => count++; s().updateThrowables(.02, false); return count; }), 0, 'resolved explosion is not replayed');
  await page.evaluate(() => { s().updateThrowables(14, false); m.requestSave(); });

  // pagehide supplements periodic checkpoints; no wall-clock elapsed time is applied on continue.
  const closed = await page.evaluate(() => { grantGold(1); window.dispatchEvent(new PageTransitionEvent('pagehide')); return disk()[0].value.payload; });
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => m.session.getSnapshot()), closed);

  const backup = await page.evaluate(() => {
    const records = disk(); localStorage.setItem(records[0].key, '{broken'); return records[1].value.payload;
  });
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => m.session.getSnapshot()), backup);
  assert.match(await page.locator('[data-campaign-save-status]').textContent(), /上一份有效/);
  await page.evaluate(() => { grantGold(1); m.requestSave(); });
  const geometryBackup = await page.evaluate(() => {
    const records = disk(), invalid = records[0].value; invalid.payload.presence.position = { x: 0, y: 0 };
    localStorage.setItem(records[0].key, JSON.stringify(invalid)); return records[1].value.payload;
  });
  await page.reload(); await resume();
  assert.deepEqual(await page.evaluate(() => m.session.getSnapshot()), geometryBackup, 'invalid runtime geometry falls back without random teleportation');
  await page.evaluate(() => { grantGold(1); m.requestSave(); });

  await page.evaluate(async () => {
    const player = s().player; player.x = 125.5; player.y = 475.5;
    if (!await m.travel()) throw new Error('return failed');
    m.endDay(); m.advance(s(), 120);
    if (m.session.getClockReading().phase !== 'night') throw new Error('night was skipped');
    m.advance(s(), 300);
  });
  assert.equal(await page.evaluate(() => disk()[0].value.payload.worldMinute), 1440);
  await page.reload(); await resume();
  assert.equal(await page.evaluate(() => m.session.getClockReading().day), 2);
  await page.evaluate(() => { tick(); });
  await page.screenshot({ path: '.review/campaign-continued.png' });
  await page.evaluate(() => {
    const scene = s(); scene.throwable.equip('grenade', 'primary'); scene.survival.inventory.reserve('grenade');
    scene.throwable.prepared = true; scene.throwable.fuse = 1.1;
    scene.player.takeDamage(999); m.advance(scene, 0);
  });
  assert.equal(await page.evaluate(() => disk()[0].value.payload.lifecycle.kind), 'recovering');
  await page.reload(); await resume();
  assert.equal(await page.evaluate(() => s().player.getHealth()), 0);
  assert.equal(await page.evaluate(() => m.isEnded()), true);
  assert.equal(await page.evaluate(() => s().survival.inventory.getCount('grenade')), 0);
  assert.equal(await page.evaluate(() => s().throwableBodies[0].fuse), 1.1, 'death drops the armed grenade and persists its fuse once');
  assert.equal(await page.evaluate(() => m.travel()), false);

  const future = await page.evaluate(() => {
    const record = disk()[0]; record.value.payload.schemaVersion = 99;
    const raw = JSON.stringify(record.value); localStorage.setItem(record.key, raw); return { key: record.key, raw };
  });
  await page.reload();
  assert.equal(await page.locator('[data-continue-campaign]').isDisabled(), true);
  assert.match(await page.locator('[data-campaign-menu]').textContent(), /更高版本/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), future.key), future.raw);
  const activeBefore = await page.evaluate(() => localStorage.getItem('mini-2d-engine:campaign:active'));
  await page.locator('[data-new-campaign]').click();
  assert.match(await page.locator('[data-new-campaign]').textContent(), /确认开始/);
  assert.equal(await page.evaluate(() => localStorage.getItem('mini-2d-engine:campaign:active')), activeBefore);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem; window.restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key === 'mini-2d-engine:campaign:active') throw new Error('write failure'); return original.call(this, key, value); };
  });
  await page.locator('[data-new-campaign]').click();
  await page.waitForFunction(() => document.querySelector('[data-campaign-menu]')?.textContent.includes('自动保存失败'), undefined, { polling: 25 });
  assert.equal(await page.evaluate(() => localStorage.getItem('mini-2d-engine:campaign:active')), activeBefore);
  assert.equal(await page.locator('[data-campaign-hud]').count(), 0);
  await page.evaluate(() => restoreStorage());
  await page.evaluate(() => { const game = window.__miniGame; game.sceneManager.draw(game.renderer.ctx); });
  await page.screenshot({ path: '.review/campaign-save-error.png' });
  await page.locator('[data-new-campaign]').click(); await page.locator('[data-new-campaign]').click();
  await page.waitForSelector('[data-campaign-hud]'); await bind();
  assert.notEqual(await page.evaluate(() => localStorage.getItem('mini-2d-engine:campaign:active')), activeBefore);
  assert.equal(await page.evaluate(() => s().player.getHealth()), 100);
  assert.deepEqual(errors, []);
  console.log('Campaign saves browser: exact reload, both maps, periodic/phase/death/pagehide, quota retry, armed/flying grenade and smoke recovery, corrupt/invalid backup, future version and replacement rollback passed.');
} finally { await browser.close(); }
