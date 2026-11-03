import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener, entries = [];
    EventTarget.prototype.addEventListener = function(type, fn, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      if ((this === window || this === document) && !entries.some(e => e.target === this && e.type === type && e.fn === fn && e.capture === capture))
        entries.push({ target: this, type, fn, capture });
      return add.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function(type, fn, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      const index = entries.findIndex(e => e.target === this && e.type === type && e.fn === fn && e.capture === capture);
      if (index >= 0) entries.splice(index, 1);
      return remove.call(this, type, fn, options);
    };
    window.listenerCount = () => entries.length;
  });
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5182/');
  await page.keyboard.down('n'); await page.waitForSelector('[data-campaign-hud]'); await page.keyboard.up('n');
  await page.evaluate(async () => {
    const { game } = await import('/src/main.ts'); window.g = game; window.m = game.campaign;
    window.requestAnimationFrame = () => 0; await new Promise(resolve => setTimeout(resolve, 70));
    window.scene = () => g.sceneManager.getCurrentScene();
    window.tick = (dt = 0) => { scene().update(dt, g.input); scene().draw(g.renderer.ctx); };
    window.dispatchEvent(new Event('focus')); tick();
    window.uiCounts = () => ['[data-campaign-hud]', '[data-day-clock-hud]', '[data-player-debug]', '[data-backpack]', '.pause-overlay', '[data-crosshair="root"]']
      .map(selector => document.querySelectorAll(selector).length).concat(listenerCount());
    window.baselineUI = uiCounts();
  });
  assert.equal(await page.evaluate(() => scene().getCampaignLocationId()), 'outpost');
  assert.match(await page.locator('[data-campaign-clock]').textContent(), /营地.*第 1 天/);
  await page.screenshot({ path: '.review/campaign-outpost.png' });

  const expected = await page.evaluate(() => {
    const s = scene(), p = s.captureCampaignPlayer();
    p.hp = 73; p.stamina = 23.5; p.exhausted = true; p.staminaRegenDelaySeconds = .3;
    p.infection = { infected: true, remainderSeconds: .7 };
    p.weapons.primary.magazineAmmo = 11; p.weapons.primary.reserveAmmo = 0;
    p.weapons.secondary.magazineAmmo = 2; p.weapons.secondary.reserveAmmo = null;
    p.weapons.activeSlot = 'melee'; p.weapons.lastFirearmSlot = 'secondary';
    p.quickSlots = ['primary', 'secondary', 'vaccine', 'grenade'];
    p.effects = [{ id: 'persist-effect', stat: 'damage', value: .25, isMultiplier: true, remainingSeconds: 4.25 }];
    p.preferences.flashlightOn = false; p.preferences.defaultReloadMode = 'load';
    s.player.restorePersistentState(p, s.captureCampaignPose()); s.survival.restore(p);
    s.modifierManager.restorePersistentState(p.effects); s.quickSlotBindings.splice(0, 4, ...p.quickSlots); s.flashlightOn = false;
    s.backpackPanel.setOpen(true); s.dropBackpackItem('secondary'); s.backpackPanel.setOpen(false);
    s.map.damageTile(16, 10, 31);
    s.perception.getExplorationGrid('player').markCell(25, 20);
    s.perception.getTerrainMemory('player').capture(16, 10);
    return { player: s.captureCampaignPlayer(), location: s.captureCampaignCheckpoint(1).location,
      time: m.session.getClockReading().worldMinute };
  });
  assert.equal(expected.player.weapons.secondary, null);
  assert.equal(await page.evaluate(() => m.travel()), true);
  assert.deepEqual(await page.evaluate(() => scene().captureCampaignPlayer()), expected.player);
  assert.equal(await page.evaluate(() => scene().getCampaignLocationId()), 'residential');
  assert.equal(await page.evaluate(() => scene().getEnemySystem().zombies.length), 3);
  assert.equal(await page.evaluate(() => m.session.getClockReading().worldMinute), expected.time);
  assert.equal(await page.evaluate(() => m.travel()), true);
  assert.deepEqual(await page.evaluate(() => scene().captureCampaignCheckpoint(1).location), expected.location);
  assert.deepEqual(await page.evaluate(() => scene().captureCampaignPlayer()), expected.player);
  const mining = await page.evaluate(() => {
    const s = scene(), before = s.goldPickups.length;
    const weapon = s.weaponPickups[0]; s.player.collectWeapon(weapon.weapon); weapon.markCollected(); s.weaponPickups = [];
    s.map.damageTile(16, 10, 100);
    return { before, after: s.goldPickups.length, tile: s.map.tiles[10][16], weapon: s.captureCampaignPlayer().weapons.secondary };
  });
  assert.equal(mining.before, 2); assert.equal(mining.after, 10); assert.equal(mining.tile, 'default');
  assert.equal(mining.weapon.magazineAmmo, 2); assert.equal(mining.weapon.reserveAmmo, null);

  assert.equal(await page.evaluate(() => m.travel()), true);
  const changed = await page.evaluate(() => {
    const s = scene(), [dead, hurt] = s.enemies.zombies;
    const impact = damage => ({ source: 'script', damage, point: dead.getCenter(), direction: { x: 1, y: 0 },
      impulse: 0, impactSpeed: 0, initialSpeed: 0, traveledDistance: 0 });
    s.enemies.receiveHit(dead, impact(999)); s.enemies.receiveHit(hurt, impact(7));
    hurt.x += 12; hurt.currentRotation = 1;
    const vaccine = s.vaccinePickups[0]; s.survival.collectVaccine(vaccine); s.vaccinePickups = [];
    return s.captureCampaignCheckpoint(1).location;
  });
  assert.equal(await page.evaluate(() => m.travel()), true);
  for (let round = 0; round < 20; round++) {
    assert.equal(await page.evaluate(() => m.travel()), true, 'outbound ' + round);
    assert.equal(await page.locator('[data-structure-panel]').count(), 0, 'residential has no stale construction panel');
    assert.deepEqual(await page.evaluate(() => scene().captureCampaignCheckpoint(1).location), changed);
    assert.equal(await page.evaluate(() => m.travel()), true, 'inbound ' + round);
    assert.equal(await page.locator('[data-structure-panel]').count(), 1, 'outpost owns exactly one construction panel');
    assert.equal(await page.evaluate(() => scene().goldPickups.length), 10, 'no duplicate mineral rewards');
    assert.deepEqual(await page.evaluate(() => uiCounts()), await page.evaluate(() => baselineUI), 'listeners and overlays remain bounded');
    assert.equal(await page.evaluate(() => typeof g.input.onPointerMove), 'function');
  }
  assert.equal(await page.evaluate(() => m.session.getClockReading().worldMinute), expected.time);

  const failedLoad = await page.evaluate(async () => {
    const GameScene = scene().constructor, original = GameScene.prototype.load;
    const source = scene(), before = m.session.getSnapshot(), player = source.captureCampaignPlayer();
    GameScene.prototype.load = async () => { throw new Error('injected load failure'); };
    let success;
    try { success = await m.travel(); } finally { GameScene.prototype.load = original; }
    return { success, same: scene() === source, unchanged: JSON.stringify(before) === JSON.stringify(m.session.getSnapshot()),
      playerSame: JSON.stringify(player) === JSON.stringify(source.captureCampaignPlayer()), paused: source.isWorldPaused(), ui: uiCounts() };
  });
  assert.deepEqual({ ...failedLoad, ui: undefined }, { success: false, same: true, unchanged: true, playerSame: true, paused: false, ui: undefined });
  assert.deepEqual(failedLoad.ui, await page.evaluate(() => baselineUI));

  const failedActivation = await page.evaluate(async () => {
    const GameScene = scene().constructor, original = GameScene.prototype.onEnterPrepared;
    const source = scene(), before = m.session.getSnapshot();
    GameScene.prototype.onEnterPrepared = function() { original.call(this); if (this !== source) throw new Error('injected activation failure'); };
    let success;
    try { success = await m.travel(); } finally { GameScene.prototype.onEnterPrepared = original; }
    return { success, same: scene() === source, unchanged: JSON.stringify(before) === JSON.stringify(m.session.getSnapshot()),
      paused: source.isWorldPaused(), ui: uiCounts(), input: typeof g.input.onPointerMove };
  });
  assert.deepEqual({ ...failedActivation, ui: undefined }, { success: false, same: true, unchanged: true, paused: false, ui: undefined, input: 'function' });
  assert.deepEqual(failedActivation.ui, await page.evaluate(() => baselineUI));

  const late = await page.evaluate(async () => {
    const GameScene = scene().constructor, original = GameScene.prototype.load;
    let finish, delay = true;
    GameScene.prototype.load = function(...args) {
      const loaded = original.apply(this, args);
      if (!delay) return loaded;
      delay = false; return loaded.then(() => new Promise(resolve => { finish = resolve; }));
    };
    try {
      const pending = m.travel(), duplicate = await m.travel();
      while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
      m.cancelTransition();
      const next = await m.travel(), current = scene();
      finish(); const obsolete = await pending;
      return { duplicate, next, obsolete, same: scene() === current, input: typeof g.input.onPointerMove, ui: uiCounts() };
    } finally { GameScene.prototype.load = original; }
  });
  assert.deepEqual({ ...late, ui: undefined }, { duplicate: false, next: true, obsolete: false, same: true, input: 'function', ui: undefined });
  assert.deepEqual(late.ui, await page.evaluate(() => baselineUI));
  assert.equal(await page.evaluate(() => m.travel()), true);

  const hazard = await page.evaluate(async () => {
    const s = scene(); s.survival.inventory.add('grenade');
    s.throwable.equip('grenade', s.player.getActiveWeaponSlot()); s.survival.inventory.reserve('grenade'); s.throwable.prepared = true;
    const before = s.survival.inventory.snapshot(), fuse = s.throwable.fuse;
    const allowed = await m.travel();
    const preserved = s.throwable.locked && s.throwable.fuse === fuse && JSON.stringify(before) === JSON.stringify(s.survival.inventory.snapshot());
    s.throwable.dispose();
    s.throwableBodies.push({ dead: false });
    const flightAllowed = await m.travel(), retained = s.throwableBodies.length === 1;
    s.throwableBodies = [];
    return { allowed, preserved, flightAllowed, retained };
  });
  assert.deepEqual(hazard, { allowed: false, preserved: true, flightAllowed: false, retained: true });

  const pause = await page.evaluate(() => {
    const s = scene(), initial = m.session.getClockReading().worldMinute, hp = s.player.getHealth();
    s.setExplicitPaused(true); window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    s.setExplicitPaused(false); window.dispatchEvent(new Event('focus')); tick(2);
    const stopped = m.session.getClockReading().worldMinute === initial && s.player.getHealth() === hp;
    delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));
    s.backpackPanel.setOpen(true); tick(.2);
    const liveBackpack = !s.isWorldPaused() && m.session.getClockReading().worldMinute > initial && s.survival.infection.getRemainder() > .7;
    s.backpackPanel.setOpen(false);
    return { stopped, liveBackpack, pauses: m.session.getClockReading().pauseReasons };
  });
  assert.deepEqual(pause, { stopped: true, liveBackpack: true, pauses: [] });

  await page.locator('[data-campaign-end-day]').click(); await page.evaluate(() => tick());
  await page.getByRole('button', { name: '确认推进至 18:00' }).click();
  assert.equal(await page.evaluate(() => m.session.getClockReading().worldMinute), 720);
  await page.evaluate(() => { m.advance(scene(), 120); tick(); });
  assert.equal(await page.evaluate(() => m.session.getClockReading().phase), 'night');
  await page.evaluate(() => { m.advance(scene(), 300); tick(); });
  assert.equal(await page.evaluate(() => m.session.getClockReading().day), 2);
  assert.equal(await page.evaluate(() => m.travel()), true);
  assert.equal(await page.evaluate(() => scene().enemies.zombies.length), 2, 'later days do not refresh active content in P1');
  assert.equal(await page.evaluate(() => scene().vaccinePickups.length), 0);
  await page.evaluate(() => { tick(); });
  await page.screenshot({ path: '.review/campaign-residential.png' });
  assert.equal(await page.evaluate(() => m.travel()), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => g.renderer.width === 390, undefined, { polling: 25 });
  await page.evaluate(() => tick());
  await page.screenshot({ path: '.review/campaign-mobile.png' });
  const bounds = await page.locator('[data-campaign-hud]').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height < 180);

  const death = await page.evaluate(async () => {
    const s = scene(); s.player.takeDamage(999); tick();
    g.input.isKeyDown = () => true; tick();
    return { lifecycle: m.session.getSnapshot().lifecycle.kind, hp: m.session.getSnapshot().player.hp,
      travel: await m.travel(), retained: scene() === s };
  });
  assert.deepEqual(death, { lifecycle: 'recovering', hp: 0, travel: false, retained: true });
  assert.deepEqual(errors, []);
  console.log('Campaign browser checks passed: state round trips, 20 return trips, failures/cancellation, hazards, clock/pause, death, UI bounds.');
} finally { await browser.close(); }
