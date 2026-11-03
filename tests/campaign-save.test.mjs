import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { SaveRepository, ACTIVE_CAMPAIGN_KEY: ACTIVE, campaignSaveKey: key } = load('campaign/SaveRepository');
const { CampaignSession } = load('campaign/CampaignSession');
const { emptyLocationResume: runtime, parseLocationResume } = load('campaign/LocationResumeState');
const VERSION = 'test-content-v1';
class MemoryStorage {
  data = new Map(); failKey;
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.failKey?.(key)) throw new Error('quota'); this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
function state(id = 'campaign-one') {
  const result = CampaignSession.create({ campaignId: id, worldSeed: 0, definitionVersion: VERSION,
    outpostSpawn: { position: { x: 325.5, y: 475.5 }, facing: 0 }, player: {
      hp: 73, baseMaxHp: 100, infection: { infected: true, remainderSeconds: .7 },
      stamina: 23, baseMaxStamina: 100, exhausted: true, staminaRegenDelaySeconds: .3,
      weapons: { primary: null, secondary: null, activeSlot: 'melee', lastFirearmSlot: 'secondary' },
      consumables: { vaccine: 2, grenade: 1, smokeGrenade: 0 }, quickSlots: ['primary', 'vaccine', null, null],
      gold: 5, effects: [{ id: 'buff', stat: 'damage', value: .25, isMultiplier: true, remainingSeconds: 4.25 }],
      recovery: { rollCooldownSeconds: .1, fireCooldownSeconds: .2, meleeGraceSeconds: .3 },
      preferences: { autoReload: false, defaultReloadMode: 'load', flashlightOn: false },
    } }).getSnapshot();
  result.locations.outpost.initialized = true; result.locations.outpost.lastVisitedDay = 1;
  return result;
}
function repository(storage) { return new SaveRepository(storage, VERSION); }
function initial() {
  const storage = new MemoryStorage(), repo = repository(storage), value = state();
  assert.equal(repo.read().exists, false); repo.create(value, runtime());
  return { storage, repo, value };
}

test('complete autosaves alternate slots by sequence, keep backups and reject invalid snapshots atomically', () => {
  const { storage, repo, value } = initial();
  const first = storage.getItem(key(value.campaignId, 0));
  value.worldMinute = 720; value.revision = 50; value.player.hp = 41;
  repo.save(value, runtime());
  assert.equal(storage.getItem(key(value.campaignId, 0)), first);
  const read = repository(storage).read();
  assert.deepEqual(read.candidates.map(c => c.saveSequence), [2, 1]);
  assert.deepEqual(read.candidates[0].state, value);
  read.candidates[0].state.player.gold = 999;
  assert.equal(repository(storage).read().candidates[0].state.player.gold, 5);
  const before = new Map(storage.data), invalid = structuredClone(value); invalid.player.hp = NaN;
  assert.throws(() => repo.save(invalid, runtime())); assert.deepEqual(storage.data, before);
  value.revision++; repo.save(value, runtime());
  assert.deepEqual(repository(storage).read().candidates.map(c => c.saveSequence), [3, 2]);
});

test('corrupt latest autosave falls back and the next write preserves the recovered slot', () => {
  const { storage, repo, value } = initial(); value.player.hp = 20; repo.save(value, runtime());
  const bad = JSON.parse(storage.getItem(key(value.campaignId, 1))); bad.payload.player.hp = -1; bad.saveSequence = 19;
  storage.setItem(key(value.campaignId, 1), JSON.stringify(bad));
  const restored = repository(storage), read = restored.read();
  assert.equal(read.recovered, true); assert.equal(read.candidates[0].state.player.hp, 73);
  const backup = storage.getItem(key(value.campaignId, 0));
  restored.select(read.candidates[0]); restored.save(read.candidates[0].state, read.candidates[0].runtime);
  assert.equal(storage.getItem(key(value.campaignId, 0)), backup);
  assert.equal(repository(storage).read().candidates[0].saveSequence, 20);
  storage.setItem(key(value.campaignId, 0), '{'); storage.setItem(key(value.campaignId, 1), '{');
  const bytes = new Map(storage.data);
  assert.throws(() => repository(storage).read(), error => error.kind === 'corrupt'); assert.deepEqual(storage.data, bytes);
});

test('unsupported envelope, schema and content versions never silently load an older backup', () => {
  for (const mutate of [e => e.formatVersion = 2, e => e.payload.schemaVersion = 3,
    e => e.payload.definitionVersion = 'future-content', e => e.payload.locations.outpost.definitionVersion = 'future-content']) {
    const { storage, repo, value } = initial(); repo.save(value, runtime());
    const bad = JSON.parse(storage.getItem(key(value.campaignId, 1))); mutate(bad);
    storage.setItem(key(value.campaignId, 1), JSON.stringify(bad)); const before = new Map(storage.data);
    assert.throws(() => repository(storage).read(), error => error.kind === 'incompatible'); assert.deepEqual(storage.data, before);
  }
});

test('quota failure and failed new-campaign activation retain the previous complete campaign', () => {
  const { storage, repo, value } = initial(), before = new Map(storage.data);
  storage.failKey = () => true; value.player.hp = 20;
  assert.throws(() => repo.save(value, runtime()), error => error.kind === 'storage'); assert.deepEqual(storage.data, before);
  storage.failKey = key => key === ACTIVE;
  assert.throws(() => repo.create(state('campaign-two'), runtime()), error => error.kind === 'storage');
  assert.equal(storage.getItem(key('campaign-two', 0)), null, 'failed activation removes its unreferenced first slot');
  assert.equal(storage.getItem(ACTIVE), before.get(ACTIVE));
  assert.equal(repository(storage).read().candidates[0].state.player.hp, 73);
  storage.failKey = undefined; repo.save(value, runtime());
  assert.equal(repository(storage).read().candidates[0].state.player.hp, 20);
  repo.create(state('campaign-three'), runtime());
  assert.equal(repository(storage).read().candidates[0].state.campaignId, 'campaign-three');
  assert.equal(storage.getItem(key('campaign-one', 0)), null);
});

test('stale writers cannot overwrite changes or a replacement campaign from another window', () => {
  const { storage, repo, value } = initial(), stale = repository(storage); stale.read();
  value.player.gold = 8; repo.save(value, runtime()); const before = new Map(storage.data);
  assert.throws(() => stale.save(state(), runtime()), error => error.kind === 'conflict'); assert.deepEqual(storage.data, before);
  const other = repository(storage); other.read(); other.create(state('campaign-new'), runtime());
  assert.throws(() => repo.save(value, runtime()), error => error.kind === 'conflict');
  assert.equal(repository(storage).read().candidates[0].state.campaignId, 'campaign-new');
});

test('runtime-invalid latest slot can be rejected without replacing the good backup', () => {
  const { storage, repo, value } = initial(); value.presence.position.x = 0; repo.save(value, runtime());
  const restored = repository(storage), read = restored.read();
  restored.select(read.candidates[1]); const backup = storage.getItem(key(value.campaignId, 0));
  restored.save(read.candidates[1].state, read.candidates[1].runtime);
  assert.equal(storage.getItem(key(value.campaignId, 0)), backup);
  assert.equal(repository(storage).read().candidates[0].state.presence.position.x, 325.5);
});

test('restoring a campaign preserves time and terminal state without replay or offline simulation', () => {
  const value = state(); value.worldMinute = 1440;
  const restored = CampaignSession.restore(value);
  assert.deepEqual(restored.getSnapshot(), value);
  assert.deepEqual(restored.getClockReading().pauseReasons, []);
  assert.deepEqual(restored.advanceTime(0, 0).events, []);
  value.player.hp = 0; value.lifecycle = { kind: 'recovering', resolutionId: 'death-1', deathLocationId: 'outpost', deathWorldMinute: 1440, raidId: null };
  const dead = CampaignSession.restore(value);
  assert.deepEqual(dead.getSnapshot(), value); assert.throws(() => dead.advanceTime(0, 1), /待结算/);
});

test('unavailable storage and invalid active indexes fail explicitly without changing stored bytes', () => {
  const blocked = { getItem() { throw new Error('access denied'); }, setItem() { assert.fail('must not write'); }, removeItem() {} };
  assert.throws(() => repository(blocked).read(), error => error.kind === 'storage');
  for (const [raw, kind] of [['{', 'corrupt'], ['{"formatVersion":99,"campaignId":"later"}', 'incompatible']]) {
    const storage = new MemoryStorage(); storage.setItem(ACTIVE, raw);
    assert.throws(() => repository(storage).read(), error => error.kind === kind);
    assert.equal(storage.getItem(ACTIVE), raw); assert.equal(storage.data.size, 1);
  }
});

test('active runtime validates grenade ownership, finite physics, unique IDs and fixed-step remainder atomically', () => {
  const { storage, repo, value } = initial(), valid = runtime();
  valid.heldGrenade = { fuse: 2.5, target: { x: 800, y: 400 }, returnWeapon: 'primary' };
  valid.lastThrowableId = 3; valid.stepRemainder = .003;
  valid.bodies = [{ id: 3, kind: 'smokeGrenade', x: 800, y: 400, vx: 0, vy: 0, z: 0, vz: 0, rotation: 1,
    fuse: 4, landed: true, resting: true, smokeAge: 3 }];
  repo.save(value, valid);
  assert.deepEqual(repository(storage).read().candidates[0].runtime, valid);
  const before = new Map(storage.data);
  for (const change of [r => r.heldGrenade.fuse = NaN, r => r.bodies[0].vx = Infinity,
    r => r.bodies.push(r.bodies[0]), r => r.lastThrowableId = 2, r => r.stepRemainder = 1,
    r => r.bodies[0].smokeAge = 14, r => r.bodies[0].extra = 'callback']) {
    const bad = structuredClone(valid); change(bad);
    assert.throws(() => repo.save(value, bad)); assert.deepEqual(storage.data, before);
  }
  value.player.consumables.grenade = 0;
  assert.throws(() => parseLocationResume(valid, value.player), /库存/);
  assert.deepEqual(storage.data, before);
});
