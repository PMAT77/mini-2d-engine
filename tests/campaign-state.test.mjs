import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { CampaignSession } = load('campaign/CampaignSession');
const { parseCampaignState } = load('campaign/CampaignState');
const copy = value => structuredClone(value);

function firearm(instanceId, magazineCapacity, magazineAmmo, reserveAmmo) {
  return { instanceId, definitionId: 'prototype-gun', attributes: {
    damage: 10, fireIntervalSeconds: .2, bulletSpeed: 2600, knockbackImpulse: 280,
    magazineCapacity, reloadSeconds: 1.4,
  }, magazineAmmo, chambered: true, reserveAmmo };
}
function input() {
  return {
    campaignId: 'campaign-fixed', worldSeed: 42, definitionVersion: 'prototype-v1',
    outpostSpawn: { position: { x: 100, y: 200 }, facing: -.75 },
    player: {
      hp: 73, baseMaxHp: 100, infection: { infected: true, remainderSeconds: .7 },
      stamina: 42.5, baseMaxStamina: 100, exhausted: false, staminaRegenDelaySeconds: .3,
      weapons: { primary: firearm('gun-primary', 30, 17, 0), secondary: firearm('gun-secondary', 6, 2, null),
        activeSlot: 'primary', lastFirearmSlot: 'secondary' },
      consumables: { vaccine: 2, grenade: 1, smokeGrenade: 0 },
      quickSlots: ['primary', 'vaccine', 'smokeGrenade', null],
      gold: 5,
      effects: [{ id: 'effect-damage', stat: 'damage', value: .25, isMultiplier: true, remainingSeconds: 4.25 }],
      recovery: { rollCooldownSeconds: .4, fireCooldownSeconds: .05, meleeGraceSeconds: .1 },
      preferences: { autoReload: false, defaultReloadMode: 'load', flashlightOn: false },
    },
  };
}
function checkpoint(session) {
  const state = session.getSnapshot(), id = state.presence.locationId;
  return { locationId: id, player: state.player,
    pose: { position: state.presence.position, facing: state.presence.facing },
    location: state.locations[id], reason: { kind: 'checkpoint' } };
}
function populate(location) {
  location.initialized = true;
  location.lastVisitedDay = 1;
  location.spawns['outpost/enemy-01'] = {
    spawnId: 'outpost/enemy-01', generation: 0, lastRefreshDay: 1,
    occupant: { kind: 'enemy', value: { instanceId: 'enemy-01', kind: 'runner', hp: 23,
      pose: { position: { x: 500, y: 400 }, facing: 1 } } },
  };
  location.spawns['outpost/loot-01'] = {
    spawnId: 'outpost/loot-01', generation: 0, lastRefreshDay: null,
    occupant: { kind: 'loot', value: { instanceId: 'loot-01', position: { x: 300, y: 400 },
      item: { kind: 'consumable', itemId: 'vaccine', quantity: 1 } } },
  };
  location.containers['outpost/crate-01'] = { containerId: 'outpost/crate-01', opened: false,
    generation: 0, lastRefreshDay: null, contents: [{ kind: 'gold', quantity: 4 }] };
  location.terrainChanges = [{ col: 3, row: 4, tileTypeId: 'mineral', hp: 63, goldAlreadyIssued: 2 }];
  location.exploration = { cellSize: 25, cols: 4, rows: 4, exploredCellIndices: [0, 4],
    observedTiles: [{ col: 0, row: 0, tileTypeId: 'mineral', damageStage: 1 }] };
}

test('campaign creates a deterministic initial checkpoint without loading browser or gameplay modules', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const a = CampaignSession.create(input()), b = CampaignSession.create(input());
  const state = a.getSnapshot();
  assert.deepEqual(state, b.getSnapshot());
  assert.equal(state.campaignId, 'campaign-fixed');
  assert.equal(state.worldSeed, 42);
  assert.equal(state.worldMinute, 0);
  assert.equal(state.revision, 0);
  assert.equal(state.presence.locationId, 'outpost');
  assert.deepEqual(state.player, input().player);
  assert.notEqual(state.locations.outpost.seed, state.locations.residential.seed);
  assert.deepEqual(Object.values(state.locations).map(l => l.initialized), [false, false]);
  assert.deepEqual(state.resolvedRaidIds, []);
  assert.deepEqual(state.statistics, { kills: 0, expeditions: 0 });
  assert.ok(!Object.keys(require.cache).some(path => /[/\\](objects|scenes|map|survival)[/\\]/.test(path)),
    'pure state uses type-only imports, including the tile identifiers');
});

test('campaign generates an identity and seed once when omitted, including seed zero as an explicit input', () => {
  const options = input(); delete options.campaignId; delete options.worldSeed;
  const first = CampaignSession.create(options), second = CampaignSession.create(options);
  const a = first.getSnapshot(), b = second.getSnapshot();
  assert.match(a.campaignId, /^[0-9a-f-]+$/i);
  assert.notEqual(a.campaignId, b.campaignId);
  assert.ok(Number.isSafeInteger(a.worldSeed) && a.worldSeed >= 0 && a.worldSeed <= 0xffffffff);
  assert.deepEqual(first.getSnapshot(), a, 'reading never regenerates identity or seeds');
  assert.equal(CampaignSession.create({ ...input(), worldSeed: 0 }).getSnapshot().worldSeed, 0);
});

test('creation input and nested snapshots cannot mutate the session or another campaign', () => {
  const options = input(), session = CampaignSession.create(options), other = CampaignSession.create(options);
  const expected = session.getSnapshot();
  options.player.weapons.primary.magazineAmmo = 0;
  options.player.effects[0].remainingSeconds = 999;
  options.player.infection.remainderSeconds = 0;
  options.player.quickSlots.fill(null);
  options.outpostSpawn.position.x = 999;
  const snapshot = session.getSnapshot();
  snapshot.player.weapons.primary.attributes.damage = 999;
  snapshot.player.consumables.vaccine = 999;
  snapshot.player.effects.splice(0);
  snapshot.presence.position.y = 999;
  populate(snapshot.locations.outpost);
  snapshot.resolvedRaidIds.push('fake-raid');
  assert.deepEqual(session.getSnapshot(), expected);
  assert.deepEqual(other.getSnapshot(), expected);
});

test('a complete location checkpoint captures health, infection, ammo, gold payouts and exploration together', () => {
  const session = CampaignSession.create(input()), next = checkpoint(session);
  populate(next.location);
  next.player.hp = 61;
  next.player.infection.remainderSeconds = .875;
  next.player.stamina = 13.25;
  next.player.weapons.primary.magazineAmmo = 16;
  next.pose.position.x = 150;
  session.commitCurrentLocation(0, next);
  const saved = session.getSnapshot();
  assert.equal(saved.revision, 1);
  assert.equal(saved.worldMinute, 0);
  assert.deepEqual(saved.player, next.player);
  assert.deepEqual(saved.locations.outpost, next.location);
  assert.deepEqual(saved.presence, { locationId: 'outpost', ...next.pose });
  assert.equal(saved.locations.residential.initialized, false);
  next.location.exploration.exploredCellIndices.push(3);
  next.location.containers['outpost/crate-01'].contents[0].quantity = 200;
  next.location.spawns['outpost/enemy-01'].occupant.value.hp = 1;
  next.player.weapons.primary.attributes.damage = 999;
  assert.deepEqual(session.getSnapshot(), saved, 'committed payloads are detached from caller-owned objects');
});

test('weapon slots and null/zero reserves survive pure-data round trips without normalization', () => {
  const session = CampaignSession.create(input());
  const snapshot = session.getSnapshot();
  const restored = parseCampaignState(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored, snapshot);
  assert.equal(restored.player.weapons.primary.magazineAmmo, 17);
  assert.equal(restored.player.weapons.primary.reserveAmmo, 0);
  assert.equal(restored.player.weapons.secondary.magazineAmmo, 2);
  assert.equal(restored.player.weapons.secondary.reserveAmmo, null);
  assert.equal(restored.player.infection.remainderSeconds, .7);
  restored.player.infection.remainderSeconds = .1;
  assert.equal(snapshot.player.infection.remainderSeconds, .7);
});

test('dropping and recovering a firearm transfers one instance without recreating an empty slot', () => {
  const session = CampaignSession.create(input()), next = checkpoint(session);
  populate(next.location);
  const weapon = next.player.weapons.primary;
  next.player.weapons.primary = null;
  next.player.weapons.activeSlot = 'melee';
  next.player.weapons.lastFirearmSlot = 'primary';
  next.location.groundItems.push({ instanceId: 'drop-01', position: { x: 130, y: 200 }, item: { kind: 'firearm', weapon } });
  session.commitCurrentLocation(0, next);
  const dropped = parseCampaignState(JSON.parse(JSON.stringify(session.getSnapshot())));
  assert.equal(dropped.player.weapons.primary, null);
  assert.equal(dropped.player.weapons.lastFirearmSlot, 'primary', 'historical last slot may be empty');
  const pickup = checkpoint(session);
  pickup.player.weapons.primary = pickup.location.groundItems.pop().item.weapon;
  pickup.player.weapons.activeSlot = 'primary';
  session.commitCurrentLocation(1, pickup);
  assert.deepEqual(session.getSnapshot().player.weapons.primary, weapon);
  assert.deepEqual(session.getSnapshot().locations.outpost.groundItems, []);
});

test('duplicate weapon ownership anywhere in the campaign is rejected', () => {
  const original = CampaignSession.create(input()).getSnapshot();
  for (const target of ['ground', 'container', 'spawn', 'other-location']) {
    const state = copy(original), loc = state.locations[target === 'other-location' ? 'residential' : 'outpost'];
    loc.initialized = true;
    const gun = { kind: 'firearm', weapon: copy(state.player.weapons.primary) };
    const dropped = { instanceId: 'drop-01', position: { x: 100, y: 100 }, item: gun };
    if (target === 'container') loc.containers.crate = {
      containerId: 'crate', opened: true, generation: 0, lastRefreshDay: null, contents: [gun],
    };
    else if (target === 'spawn') loc.spawns.loot = {
      spawnId: 'loot', generation: 0, lastRefreshDay: null, occupant: { kind: 'loot', value: dropped },
    };
    else loc.groundItems.push(dropped);
    assert.throws(() => parseCampaignState(state), /实例被多个所有者持有/, target);
  }
});

test('failed checkpoints leave every resource and revision unchanged, then allow a corrected transaction', () => {
  const session = CampaignSession.create(input()), expected = session.getSnapshot(), next = checkpoint(session);
  populate(next.location);
  next.player.hp = 20;
  next.player.consumables.vaccine = 0;
  next.location.groundItems.push({ instanceId: 'drop-01', position: { x: 100, y: 200 },
    item: { kind: 'firearm', weapon: copy(next.player.weapons.secondary) } });
  assert.throws(() => session.commitCurrentLocation(0, next), /实例被多个所有者持有/);
  assert.deepEqual(session.getSnapshot(), expected);
  next.player.weapons.secondary = null;
  session.commitCurrentLocation(0, next);
  assert.equal(session.getSnapshot().revision, 1);
  assert.equal(session.getSnapshot().player.hp, 20);
});

test('stale or malformed revision cannot overwrite a newer checkpoint', () => {
  const session = CampaignSession.create(input()), old = checkpoint(session);
  const next = checkpoint(session); next.player.hp = 60;
  session.commitCurrentLocation(0, next);
  const expected = session.getSnapshot();
  for (const revision of [0, -1, NaN, Infinity, 1.5, '1']) {
    assert.throws(() => session.commitCurrentLocation(revision, old), /版本|过期/);
    assert.deepEqual(session.getSnapshot(), expected);
  }
});

test('ordinary checkpoints cannot mutate campaign identity, time, another location or lifecycle', () => {
  const session = CampaignSession.create(input()), expected = session.getSnapshot();
  for (const field of ['campaignId', 'worldSeed', 'worldMinute', 'revision', 'lifecycle', 'locations', 'resolvedRaidIds']) {
    const next = checkpoint(session); next[field] = field === 'worldMinute' ? 1440 : {};
    assert.throws(() => session.commitCurrentLocation(0, next), /未知字段/, field);
    assert.deepEqual(session.getSnapshot(), expected);
  }
  const other = checkpoint(session); other.locationId = 'residential'; other.location = expected.locations.residential;
  assert.throws(() => session.commitCurrentLocation(0, other), /不能切换地点/);
  const teleport = checkpoint(session); teleport.pose.locationId = 'residential';
  assert.throws(() => session.commitCurrentLocation(0, teleport), /未知字段/);
  for (const change of [c => c.location.seed++, c => c.location.definitionVersion = 'different-v2']) {
    const next = checkpoint(session); change(next);
    assert.throws(() => session.commitCurrentLocation(0, next), /种子或定义版本/);
  }
  assert.deepEqual(session.getSnapshot(), expected);
});

test('death requires a deliberate observation and pending recovery cannot be cleared by a normal update', () => {
  const session = CampaignSession.create(input()), next = checkpoint(session);
  next.player.hp = 0;
  assert.throws(() => session.commitCurrentLocation(0, next), /生命周期/);
  assert.equal(session.getSnapshot().revision, 0);
  next.reason = { kind: 'player-death', resolutionId: 'death-01' };
  session.commitCurrentLocation(0, next);
  const dead = session.getSnapshot();
  assert.equal(dead.player.hp, 0);
  assert.deepEqual(dead.lifecycle, { kind: 'recovering', resolutionId: 'death-01',
    deathLocationId: 'outpost', deathWorldMinute: 0, raidId: null });
  const revival = checkpoint(session); revival.player.hp = 100;
  assert.throws(() => session.commitCurrentLocation(1, revival), /不能通过普通检查点恢复/);
  assert.throws(() => session.commitCurrentLocation(1, next), /不能通过普通检查点恢复/);
  assert.deepEqual(session.getSnapshot(), dead);
});

test('alive players cannot submit a death event and event identifiers are validated atomically', () => {
  const session = CampaignSession.create(input()), expected = session.getSnapshot();
  const next = checkpoint(session); next.reason = { kind: 'player-death', resolutionId: 'death-01' };
  assert.throws(() => session.commitCurrentLocation(0, next), /生命周期/);
  next.player.hp = 0;
  for (const resolutionId of ['', null, 'contains space']) {
    next.reason.resolutionId = resolutionId;
    assert.throws(() => session.commitCurrentLocation(0, next), /标识符/);
    assert.deepEqual(session.getSnapshot(), expected);
  }
});

test('dead spawns and collected loot remain tombstones; plain checkpoints cannot restock or reset the map', () => {
  const session = CampaignSession.create(input()), first = checkpoint(session);
  populate(first.location); session.commitCurrentLocation(0, first);
  const cleared = checkpoint(session);
  cleared.location.spawns['outpost/enemy-01'].occupant.value = null;
  cleared.location.spawns['outpost/loot-01'].occupant.value = null;
  cleared.player.consumables.vaccine++;
  cleared.location.containers['outpost/crate-01'].opened = true;
  cleared.location.containers['outpost/crate-01'].contents = [];
  session.commitCurrentLocation(1, cleared);
  const expected = session.getSnapshot();
  const changes = [
    c => c.location.spawns['outpost/enemy-01'].occupant.value = copy(first.location.spawns['outpost/enemy-01'].occupant.value),
    c => c.location.spawns['outpost/loot-01'].occupant.value = copy(first.location.spawns['outpost/loot-01'].occupant.value),
    c => c.location.spawns['outpost/enemy-01'].generation++,
    c => c.location.spawns['outpost/loot-01'].lastRefreshDay = 1,
    c => delete c.location.spawns['outpost/enemy-01'],
    c => c.location.containers['outpost/crate-01'].opened = false,
    c => c.location.containers['outpost/crate-01'].generation++,
    c => c.location.lastVisitedDay = null,
    c => c.location = checkpoint(CampaignSession.create(input())).location,
  ];
  for (const change of changes) {
    const next = checkpoint(session); change(next);
    assert.throws(() => session.commitCurrentLocation(2, next));
    assert.deepEqual(session.getSnapshot(), expected);
  }
});

test('invalid numeric resources, ammo, infection, IDs and quick slots reject the whole checkpoint', () => {
  const session = CampaignSession.create(input()), expected = session.getSnapshot();
  const mutations = [
    c => c.player.hp = NaN, c => c.player.hp = -1, c => c.player.hp = 101,
    c => c.player.baseMaxHp = 0, c => c.player.stamina = Infinity, c => c.player.stamina = 101,
    c => c.player.consumables.grenade = -1, c => c.player.consumables.vaccine = 1.5,
    c => c.player.gold = Number.MAX_SAFE_INTEGER + 1,
    c => c.player.weapons.primary.magazineAmmo = 31,
    c => c.player.weapons.primary.reserveAmmo = -1,
    c => c.player.weapons.primary.reserveAmmo = undefined,
    c => c.player.weapons.primary.chambered = 1,
    c => c.player.weapons.primary.attributes.fireIntervalSeconds = 0,
    c => c.player.weapons.primary.instanceId = '',
    c => c.player.weapons.primary = null,
    c => c.player.quickSlots = ['vaccine', 'vaccine', null, null],
    c => c.player.quickSlots = [null, null, null],
    c => c.player.quickSlots[0] = 'unknown-item',
    c => c.player.quickSlots = new Array(4),
    c => c.player.infection.remainderSeconds = 1,
    c => c.player.infection.infected = false,
    c => delete c.player.infection,
    c => c.player.effects[0].value = -1,
    c => c.player.effects[0].remainingSeconds = 0,
    c => c.player.effects.push({ ...c.player.effects[0], id: 'different-id' }),
    c => c.pose.position.x = Infinity,
    c => c.location.locationId = 'residential',
    c => c.location.lastVisitedDay = 2,
    c => c.location.spawns = [],
    c => c.player.preferences.autoReload = 'false',
    c => c.reason = { kind: 'skip-night' },
  ];
  for (const mutate of mutations) {
    const next = checkpoint(session); mutate(next);
    assert.throws(() => session.commitCurrentLocation(0, next));
    assert.deepEqual(session.getSnapshot(), expected);
  }
});

test('map validation rejects unknown terrain, duplicate IDs/cells, future dates and invalid initialization', () => {
  const base = CampaignSession.create(input()).getSnapshot(); populate(base.locations.outpost);
  const mutations = [
    s => s.locations.outpost.terrainChanges[0].tileTypeId = 'unknown',
    s => s.locations.outpost.terrainChanges[0].goldAlreadyIssued = -1,
    s => s.locations.outpost.terrainChanges.push(copy(s.locations.outpost.terrainChanges[0])),
    s => s.locations.outpost.exploration.exploredCellIndices.push(16),
    s => s.locations.outpost.exploration.exploredCellIndices.push(0),
    s => s.locations.outpost.exploration.observedTiles[0].damageStage = 4,
    s => s.locations.outpost.exploration.cols = Number.MAX_SAFE_INTEGER,
    s => s.locations.outpost.spawns['outpost/enemy-01'].occupant.value.hp = 0,
    s => s.locations.outpost.spawns['outpost/enemy-01'].occupant.value.instanceId = 'gun-primary',
    s => s.locations.outpost.spawns['outpost/enemy-01'].spawnId = 'wrong-key',
    s => s.locations.outpost.containers['outpost/crate-01'].containerId = 'wrong-key',
    s => s.locations.outpost.containers['outpost/crate-01'].contents[0].quantity = 0,
    s => s.locations.outpost.spawns['outpost/enemy-01'].lastRefreshDay = 2,
    s => s.locations.outpost.initialized = false,
    s => s.locations.outpost.spawns = JSON.parse('{"__proto__":{}}'),
  ];
  for (const mutate of mutations) {
    const state = copy(base); mutate(state);
    assert.throws(() => parseCampaignState(state));
  }
});

test('state validation rejects incompatible formats and inconsistent death/failure records without repairing input', () => {
  const base = CampaignSession.create(input()).getSnapshot();
  const mutations = [
    s => s.schemaVersion = 3, s => s.worldMinute = -1, s => s.worldMinute = Infinity,
    s => s.revision = Number.MAX_SAFE_INTEGER + 1,
    s => s.resolvedRaidIds = ['raid-01', 'raid-01'],
    s => s.statistics.kills = -.5,
    s => s.lifecycle = { kind: 'recovering', resolutionId: 'death-01', deathLocationId: 'outpost', deathWorldMinute: 0, raidId: null },
    s => s.lifecycle = { kind: 'failed', reason: 'core-destroyed', worldMinute: 1 },
    s => s.lifecycle = { kind: 'failed', reason: 'player-death', worldMinute: 0 },
    s => s.player.hp = 0,
    s => s.scene = {},
  ];
  for (const mutate of mutations) {
    const state = copy(base); mutate(state); const before = copy(state);
    assert.throws(() => parseCampaignState(state));
    assert.deepEqual(state, before, 'validation must not silently repair or normalize invalid data');
  }
  const failed = copy(base); failed.lifecycle = { kind: 'failed', reason: 'core-destroyed', worldMinute: 0 };
  assert.deepEqual(parseCampaignState(failed), failed, 'core failure does not require player death');
});

test('creation rejects invalid identities, seeds and unexpected state overrides', () => {
  for (const seed of [-1, 0x100000000, .5, NaN, null]) assert.throws(() => CampaignSession.create({ ...input(), worldSeed: seed }));
  for (const campaignId of ['', null, 'bad id']) assert.throws(() => CampaignSession.create({ ...input(), campaignId }));
  assert.throws(() => CampaignSession.create({ ...input(), worldMinute: 1440 }), /未知字段/);
  assert.throws(() => CampaignSession.create({ ...input(), lifecycle: { kind: 'failed' } }), /未知字段/);
  assert.throws(() => CampaignSession.create(null));
  const dead = input(); dead.player.hp = 0; assert.throws(() => CampaignSession.create(dead), /生命周期/);
});

test('campaign time commits once per advance and invalidates stale location checkpoints', () => {
  const session = CampaignSession.create(input()), stale = checkpoint(session);
  const before = session.getSnapshot();
  assert.deepEqual(session.advanceTime(0, 0).events, []);
  assert.equal(session.getClockReading().revision, 0);
  const result = session.advanceTime(0, 1320 * 2);
  assert.equal(result.worldMinute, 2880);
  assert.equal(result.events.length, 6);
  assert.deepEqual(session.getSnapshot(), { ...before, worldMinute: 2880, revision: 1 },
    'world jumps do not refill resources, refresh maps, tick infection or spend buff seconds');
  assert.equal(session.getClockReading().day, 3);
  assert.throws(() => session.commitCurrentLocation(0, stale), /过期/);
  assert.throws(() => session.advanceTime(0, 1), /过期/);
  assert.throws(() => session.endDay(0), /过期/);
  const current = checkpoint(session);
  current.location.initialized = true;
  current.location.lastVisitedDay = 3;
  session.commitCurrentLocation(1, current);
  assert.equal(session.getSnapshot().locations.outpost.lastVisitedDay, 3, 'state validation uses the same calendar');
  assert.equal(session.getClockReading().revision, 2);
});

test('campaign pause state is runtime-only and rejects backpack pause and non-daytime planning pause', () => {
  const session = CampaignSession.create(input()), before = session.getSnapshot();
  session.setTimePaused('storage', true);
  session.setTimePaused('construction', true);
  session.setTimePaused('blur', true);
  session.setTimePaused('storage', false);
  session.getClockReading().pauseReasons.splice(0);
  assert.deepEqual(session.advanceTime(0, 1200).events, []);
  assert.equal(session.endDay(0).worldMinute, 0, 'explicit skips also respect active pause reasons');
  assert.deepEqual(session.getSnapshot(), before, 'pause causes are not persisted and no revision is spent');
  session.setTimePaused('construction', false);
  assert.equal(session.getClockReading().paused, true);
  session.setTimePaused('blur', false);
  assert.throws(() => session.setTimePaused('backpack', true), /暂停/);
  assert.equal(session.advanceTime(0, 1).worldMinute, .8);
  session.endDay(1);
  assert.throws(() => session.setTimePaused('storage', true), /营地白天/);
  assert.throws(() => session.setTimePaused('construction', true), /营地白天/);
  assert.equal(session.getClockReading().paused, false);
  session.setTimePaused('menu', true);
  assert.equal(session.advanceTime(2, 120).worldMinute, 720);
});

test('ending daytime stops at 18:00 and preserves the full dusk and playable night', () => {
  const session = CampaignSession.create(input()), originalPlayer = session.getSnapshot().player;
  const dusk = session.endDay(0);
  assert.equal(dusk.worldMinute, 720);
  assert.deepEqual(dusk.events.map(e => e.type), ['DuskStarted']);
  assert.equal(session.getClockReading().phase, 'dusk');
  assert.throws(() => session.endDay(1), /营地白天/);
  assert.equal(session.advanceTime(1, 119).worldMinute, 839);
  const night = session.advanceTime(2, 1);
  assert.equal(night.worldMinute, 840);
  assert.deepEqual(night.events.map(e => e.type), ['NightStarted']);
  assert.equal(session.advanceTime(3, 120).worldMinute, 1080, 'midnight remains in the same survival day');
  const morning = session.advanceTime(4, 180);
  assert.equal(morning.worldMinute, 1440);
  assert.deepEqual(morning.events.map(e => e.type), ['DayStarted']);
  assert.deepEqual(session.getSnapshot().player, originalPlayer);
});

test('invalid or excessive clock operations leave the entire campaign checkpoint unchanged', () => {
  const session = CampaignSession.create(input()), before = session.getSnapshot();
  for (const seconds of [-1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.throws(() => session.advanceTime(0, seconds));
    assert.deepEqual(session.getSnapshot(), before);
  }
  for (const revision of [-1, .5, NaN, 1]) assert.throws(() => session.advanceTime(revision, 1), /版本/);
  assert.equal(session.advanceTime(0, 1).worldMinute, .8, 'failed plans did not change the session or clock');
});

test('campaign clock reports are detached and phase configuration remains independent per campaign', () => {
  const first = CampaignSession.create(input(), { daySeconds: 12, duskSeconds: 2, nightSeconds: 10 });
  const second = CampaignSession.create(input());
  const result = first.advanceTime(0, 14);
  result.worldMinute = 999;
  result.events[0].id = 'corrupted';
  result.events.push({ type: 'fake' });
  const reading = first.getClockReading();
  reading.worldMinute = 999;
  reading.revision = 999;
  reading.pauseReasons.push('menu');
  assert.equal(first.getClockReading().worldMinute, 840);
  assert.equal(first.getClockReading().revision, 1);
  assert.equal(first.getClockReading().paused, false);
  assert.deepEqual(first.advanceTime(1, 22).events.map(e => e.id), ['day-2:DayStarted', 'day-2:DuskStarted']);
  assert.equal(second.getClockReading().worldMinute, 0);
  assert.ok(Math.abs(second.advanceTime(0, 14).worldMinute - 11.2) < 1e-10);
});

test('death captures current world time and blocks ordinary advancement instead of skipping recovery', () => {
  const session = CampaignSession.create(input());
  session.advanceTime(0, 50);
  const death = checkpoint(session);
  death.player.hp = 0;
  death.reason = { kind: 'player-death', resolutionId: 'death-clock-01' };
  session.commitCurrentLocation(1, death);
  const before = session.getSnapshot();
  assert.equal(before.lifecycle.deathWorldMinute, 40);
  assert.throws(() => session.advanceTime(2, 1020), /待结算/);
  assert.throws(() => session.endDay(2), /营地白天/);
  assert.deepEqual(session.getSnapshot(), before);
});
