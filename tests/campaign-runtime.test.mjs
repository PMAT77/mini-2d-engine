import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { CampaignSession } = load('campaign/CampaignSession');
const { Scene, SceneManager } = load('core/Scene');
const { createLocationMap, initializeLocation, LOCATION_DEFINITIONS, CAMPAIGN_DEFINITION_VERSION } = load('campaign/LocationDefinitions');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1, location: { search: '' },
  addEventListener() {}, removeEventListener() {} };
function empty(locationId) {
  return { locationId, definitionVersion: CAMPAIGN_DEFINITION_VERSION, seed: (42 ^ (locationId === 'outpost' ? 0x6f757470 : 0x72657369)) >>> 0,
    initialized: false, lastVisitedDay: null, spawns: {}, containers: {}, groundItems: [], terrainChanges: [], exploration: null };
}
async function runtime(locationId, saved = initializeLocation(empty(locationId), 1), player, resume) {
  const pose = LOCATION_DEFINITIONS[locationId].entrance;
  const scene = new GameScene({ map: createLocationMap(locationId, saved.seed), seed: saved.seed, playerSpawn: pose.position,
    campaignData: { location: saved, player, pose, nextInstanceSequence: 0, runtime: resume } });
  scene.configLoader = { async load() {}, getConfig() { return {}; } };
  await scene.load();
  return scene;
}

test('runtime restores exact player resources after config and rejects invalid restore before mutation', async () => {
  const source = await runtime('outpost'), state = source.captureCampaignPlayer();
  assert.deepEqual(source.captureCampaignPose(), LOCATION_DEFINITIONS.outpost.entrance);
  state.hp = 37; state.stamina = 17.5; state.exhausted = true; state.staminaRegenDelaySeconds = .45;
  state.weapons.primary.magazineAmmo = 11; state.weapons.primary.reserveAmmo = 0;
  state.weapons.secondary.magazineAmmo = 2; state.weapons.secondary.reserveAmmo = null;
  state.infection = { infected: true, remainderSeconds: .7 };
  state.effects = [{ id: 'buff-01', stat: 'damage', value: .3, isMultiplier: true, remainingSeconds: 4.2 }];
  state.quickSlots = ['primary', 'secondary', 'vaccine', null]; state.preferences.flashlightOn = false;
  const target = await runtime('residential', undefined, state);
  assert.deepEqual(target.captureCampaignPlayer(), state);
  const before = target.captureCampaignPlayer(), pose = target.captureCampaignPose();
  for (const change of [p => p.hp = Infinity, p => p.weapons.primary.reserveAmmo = -1,
    p => p.weapons.primary.definitionId = 'missing-definition', p => p.weapons.secondary.instanceId = p.weapons.primary.instanceId]) {
    const bad = structuredClone(state); change(bad);
    assert.throws(() => target.getPlayer().restorePersistentState(bad, pose));
    assert.deepEqual(target.captureCampaignPlayer(), before);
  }
  assert.throws(() => target.getPlayer().restorePersistentState(state, { position: { x: NaN, y: 1 }, facing: 0 }));
  assert.deepEqual(target.captureCampaignPose(), pose);
});

test('terrain restore is silent and atomic, preserves depleted spawn IDs, and validates location geometry', async () => {
  const source = await runtime('residential');
  source.map.damageTile(14, 12, 31);
  source.enemies.dispose(); source.vaccinePickups = [];
  const saved = source.captureCampaignCheckpoint(1).location;
  assert.equal(saved.terrainChanges[0].goldAlreadyIssued, 2);
  const target = await runtime('residential', saved, source.captureCampaignPlayer());
  assert.equal(target.goldPickups.length, 2); assert.equal(target.enemies.zombies.length, 0);
  assert.equal(target.vaccinePickups.length, 0);
  let payouts = 0; target.map.onTileDestroyed = target.map.onTileDamaged = () => payouts++;
  target.map.restoreTerrain(saved.terrainChanges); assert.equal(payouts, 0);
  let chips = 0;
  const context = new Proxy({ fillRect() { chips++; } }, { get: (target, key) => target[key] ?? (() => {}) });
  target.map.drawTerrainDetails(context, 0, 0, 14, 14, 12, 12, 0);
  assert.equal(chips, 8, 'restored 69 HP mineral visibly retains its damage stage without a new hit');
  const before = target.map.tiles.map(row => row.slice()), hp = target.map.tileHp.map(row => row.slice());
  assert.throws(() => target.map.restoreTerrain([...saved.terrainChanges, { col: -1, row: 0, tileTypeId: 'default', hp: 0, goldAlreadyIssued: 0 }]));
  assert.deepEqual(target.map.tiles, before); assert.deepEqual(target.map.tileHp, hp);
  const impossible = structuredClone(saved);
  impossible.terrainChanges.push({ col: 3, row: 10, tileTypeId: 'wall', hp: 0, goldAlreadyIssued: 0 });
  await assert.rejects(runtime('residential', impossible, source.captureCampaignPlayer()), /玩家位置不可通行/);
});

test('location transition commits both maps once, rejects altered cargo and regressing instance sequences', async () => {
  const source = await runtime('outpost');
  const session = CampaignSession.create({ campaignId: 'runtime-test', worldSeed: 42,
    definitionVersion: CAMPAIGN_DEFINITION_VERSION, player: source.captureCampaignPlayer(), outpostSpawn: source.captureCampaignPose() });
  const initial = source.captureCampaignCheckpoint(1);
  session.commitCurrentLocation(0, initial);
  source.map.damageTile(16, 10, 11);
  const checkpoint = source.captureCampaignCheckpoint(1);
  const target = await runtime('residential', initializeLocation(session.getSnapshot().locations.residential, 1), checkpoint.player);
  const next = target.captureCampaignCheckpoint(1); next.nextInstanceSequence = checkpoint.nextInstanceSequence;
  const before = session.getSnapshot();
  const bad = structuredClone(next); bad.player.hp--;
  assert.throws(() => session.commitLocationTransition(1, checkpoint, bad), /随身资源/);
  assert.deepEqual(session.getSnapshot(), before);
  session.commitLocationTransition(1, checkpoint, next);
  const committed = session.getSnapshot();
  assert.equal(committed.presence.locationId, 'residential'); assert.equal(committed.revision, 2);
  assert.equal(committed.locations.outpost.terrainChanges[0].goldAlreadyIssued, 1);
  assert.equal(committed.nextInstanceSequence, 1); assert.equal(committed.statistics.expeditions, 1);
  assert.throws(() => session.commitLocationTransition(1, checkpoint, next), /过期/);
  next.nextInstanceSequence = 0;
  assert.throws(() => session.commitCurrentLocation(2, next), /序号/);
  assert.deepEqual(session.getSnapshot(), committed);
  session.setTimePaused('menu', true);
  assert.throws(() => session.setTimePaused('storage', true), /营地白天/);
});

test('prepared activation rolls back before commit and disposes source only after success', () => {
  class Prepared extends Scene {
    calls = []; update() {} draw() {}
    onSuspend() { this.calls.push('suspend'); }
    onResume() { this.calls.push('resume'); }
    onEnterPrepared() { this.calls.push('activate'); }
    onExit() { this.calls.push('exit'); }
  }
  const manager = new SceneManager({}), source = new Prepared(), candidate = new Prepared();
  manager.changeScene(source, 0);
  assert.throws(() => manager.changePreparedScene(candidate, () => { throw new Error('invalid checkpoint'); }), /invalid checkpoint/);
  assert.equal(manager.getCurrentScene(), source);
  assert.deepEqual(source.calls, ['suspend', 'resume']); assert.deepEqual(candidate.calls, ['activate', 'exit']);
  const target = new Prepared();
  manager.changePreparedScene(target, () => assert.equal(source.calls.includes('exit'), false));
  assert.equal(manager.getCurrentScene(), target);
  assert.deepEqual(source.calls, ['suspend', 'resume', 'suspend', 'exit']);
  const cleanupFailure = new Prepared(), final = new Prepared();
  manager.changePreparedScene(cleanupFailure, () => {});
  cleanupFailure.onExit = () => { throw new Error('cleanup failure'); };
  const originalError = console.error, errors = [];
  console.error = (...args) => errors.push(args);
  try { manager.changePreparedScene(final, () => {}); }
  finally { console.error = originalError; }
  assert.equal(errors.length, 1);
  assert.equal(manager.getCurrentScene(), final, 'cleanup failure cannot roll back a committed destination');
});


test('same-map resume restores one grenade reservation, fuse, physics remainder and safe enemy attack recovery', async () => {
  const source = await runtime('residential');
  source.survival.inventory.add('grenade', 2); source.throwable.equip('grenade', 'primary');
  source.throwable.input({ aimFirePressed: true }, { x: 500, y: 500 }); source.throwable.advance(1.25);
  source.throwableRemainder = .003;
  const saved = source.captureCampaignRuntime(), checkpoint = source.captureCampaignCheckpoint(1);
  const restored = await runtime('residential', checkpoint.location, checkpoint.player, saved);
  assert.deepEqual(restored.captureCampaignRuntime(), saved);
  assert.equal(restored.survival.inventory.getAvailable('grenade'), 1);
  restored.throwable.restoreHeldGrenade(saved.heldGrenade);
  assert.equal(restored.survival.inventory.getAvailable('grenade'), 1, 'reservation restored once even on retry');
  assert.equal(restored.throwable.commit().fuse, 2.75);
  assert.equal(restored.survival.inventory.getCount('grenade'), 1); assert.equal(restored.throwable.commit(), null);
  for (const zombie of restored.enemies.zombies) {
    assert.equal(zombie.attack.canStart(0), false);
    assert.equal(zombie.attack.advance(zombie.config.recovery), null, 'old windup cannot emit another hit');
    assert.equal(zombie.attack.canStart(zombie.config.recovery), true);
  }
});
