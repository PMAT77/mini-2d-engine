import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { TileMap } = load('map/TileMap');
const { VisionSensor } = load('ai/VisionSensor');
const { HearingSensor } = load('ai/HearingSensor');
const { NoiseSystem } = load('core/NoiseSystem');
const { ZOMBIE_CONFIG, validateZombieConfig } = load('enemies/ZombieConfig');
const { ZombieBehavior } = load('enemies/ZombieBehavior');
const { EnemySystem, selectPlayerNoises } = load('enemies/EnemySystem');
const { ActorCollisionWorld } = load('physics/ActorCollisionWorld');
const { seededRandom } = load('map/WaterTerrain');
const makeMap = () => { const m = new TileMap(24, 24, { seed: 7, generateWater: false }); m.tiles.forEach(r => r.fill('default')); m.invalidateNavigation(); return m; };

test('hearing consumes only heard individual ids, so an older fresh sound can become audible later', () => {
  const m = makeMap(), bus = new NoiseSystem(), sensor = new HearingSensor();
  const older = bus.emit('gunshot', 500, 125, { sourceId: 'player', radius: 300 });
  const newer = bus.emit('footstep', 125, 125, { sourceId: 'player' });
  assert.deepEqual(sensor.poll(m, { x: 125, y: 125 }, bus.getEvents()).map(s => s.eventId), [newer.id]);
  assert.deepEqual(sensor.poll(m, { x: 450, y: 125 }, bus.getEvents()).map(s => s.eventId), [older.id]);
  assert.equal(sensor.poll(m, { x: 450, y: 125 }, bus.getEvents()).length, 0);
  bus.update(.31); sensor.poll(m, { x: 450, y: 125 }, bus.getEvents()); assert.equal(sensor.heardIds.size, 0);
});

test('flashlight exposure uses the beam at the viewer while still requiring facing, LOS and confirmation', () => {
  const m = makeMap(), rules = ZOMBIE_CONFIG.shambler.senses;
  const viewer = { x: 325, y: 125, facing: Math.PI }, target = { x: 125, y: 125, emittingLightId: 'flashlight' };
  const lamp = { id: 'flashlight', x: 125, y: 125, radius: 600, intensity: 2, active: true, revealsDetails: true, angle: Math.PI / 3, direction: 0, innerRadius: 40 };
  const v = new VisionSensor(rules);
  assert.equal(v.sense(.2, m, viewer, target, [{ ...lamp, active: false }]).detected, false);
  assert.equal(v.sense(.2, m, viewer, target, [lamp]).visible, false);
  assert.equal(v.sense(.1, m, viewer, target, [lamp]).visible, true);
  assert.equal(v.sense(1, m, { ...viewer, facing: 0 }, target, [lamp]).visible, false);
  assert.equal(v.sense(1, m, viewer, target, [{ ...lamp, direction: Math.PI }]).visible, false);
  m.tiles[2][4] = 'wall'; m.invalidateNavigation(); assert.equal(v.sense(1, m, viewer, target, [lamp]).visible, false);
  const near = new VisionSensor({ ...rules, nearHalfAngleDeg: 20 });
  assert.equal(near.sense(1, m, { x: 125, y: 125, facing: 0 }, { x: 100, y: 125 }).detected, false);
});

test('behavior chases last legal sight only, searches after expiry and accepts fresh player sounds', () => {
  const b = new ZombieBehavior(ZOMBIE_CONFIG.runner, seededRandom(12)), center = { x: 100, y: 100 };
  b.update(.1, center, { x: 300, y: 100 }, null); assert.equal(b.getState(), 'chase');
  b.update(1, center, null, null); assert.deepEqual(b.getGoal(), { x: 300, y: 100 });
  b.update(2.01, center, null, null); assert.equal(b.getState(), 'search');
  b.update(.1, center, null, { x: 150, y: 400 }); assert.equal(b.getState(), 'investigate'); assert.deepEqual(b.getGoal(), { x: 150, y: 400 });
  b.clearTarget(); assert.equal(b.getState(), 'wander'); assert.equal(b.memory.visual(3), null);
  assert.throws(() => validateZombieConfig({ ...ZOMBIE_CONFIG.runner, infectionChance: 2 }));
});

test('source filtering rejects unknown and zombie/chicken noises; wall-hidden gunfire only creates investigation', () => {
  const m = makeMap(), bus = new NoiseSystem(), world = new ActorCollisionWorld(m), system = new EnemySystem(m, world, 8);
  for (let y = 0; y < 24; y++) m.tiles[y][5] = 'wall'; m.invalidateNavigation();
  const z = system.add('shambler', { x: 225, y: 225 }, 0);
  bus.emit('gunshot', 325, 225); bus.emit('cluck', 225, 225, { sourceId: 'chicken-1' }); bus.emit('footstep', 225, 225, { sourceId: 'zombie-2' });
  assert.equal(selectPlayerNoises(bus.getEvents()).length, 0);
  bus.emit('gunshot', 325, 225, { sourceId: 'player' });
  system.update(1 / 30, { target: { x: 325, y: 225, radius: 24.5, alive: true }, lights: [], playerNoises: selectPlayerNoises(bus.getEvents()) });
  assert.equal(system.snapshot()[0].state, 'investigate');
  assert.ok(z.x < 250);
  system.dispose(); assert.equal(world.size, 0); assert.equal(system.navigation.stats.active <= 4, true);
});

test('seeded two-kind encounters use connected dry legal positions and independent decision streams', () => {
  const m = makeMap(), origin = { x: 600, y: 600 };
  const make = (counts = {}) => { const s = new EnemySystem(m, new ActorCollisionWorld(m), 123); s.spawn(counts, origin); return s; };
  const a = make(), b = make();
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.equal(a.zombies.length, 20);
  assert.deepEqual(a.spawnReports.map(r => [r.kind, r.requested, r.spawned, r.skipped]),
    [['shambler', 10, 10, 0], ['runner', 10, 10, 0]]);
  assert.equal(make({ shambler: 3, runner: 0 }).zombies.length, 3, 'explicit encounter counts still override defaults');
  for (const z of a.zombies) { const p = z.getCenter(), d = Math.hypot(p.x - origin.x, p.y - origin.y); assert.ok(d >= 350 && d <= 900); assert.ok(m.isShapeWalkable(z.getCollider())); assert.equal(m.getShapeSpeedFactor(z.getCollider()), 1); }
});
