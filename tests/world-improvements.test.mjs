import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { Player } = load('objects/Player');
const { createQuickSlotViews } = load('ui/BackpackView');
const { SoundRippleSystem } = load('objects/SoundRippleSystem');
const { launchThrowable } = load('throwables/ThrowablePhysics');
const { VACCINE_PICKUP_CONFIG } = load('interaction/PickupTypes');
const { circleCollider } = load('physics/Collider');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
const setup = (count = 0) => {
  const map = new TileMap(30, 24, { generateWater: false, seed: 42 });
  map.tiles.forEach(r => r.fill('default')); map.tileHp.forEach(r => r.fill(0)); map.invalidateNavigation();
  const scene = new GameScene({ map, seed: 42, playerSpawn: { x: 300, y: 300 }, chickenCount: 0, encounters: { shambler: 0, runner: 0, tradingStations: count } });
  scene.loaded = true; return { map, scene };
};

test('blast destroys exposed minerals once, leaves shielded tiles and actors safe, and updates navigation/drops', () => {
  const { map, scene } = setup(); scene.player.x = 100; scene.player.y = 100;
  for (const col of [10, 11]) { map.tiles[8][col] = 'mineral'; map.tileHp[8][col] = 100; }
  map.invalidateNavigation(); const revision = map.getNavigationRevision();
  const zombie = scene.enemies.add('shambler', { x: 575, y: 425 });
  scene.explodeThrowable(480, 425);
  assert.equal(map.tiles[8][10], 'default'); assert.equal(map.tileHp[8][11], 100);
  assert.equal(zombie.getHealth(), zombie.config.maxHealth);
  assert.ok(map.getNavigationRevision() > revision); assert.ok(scene.goldPickups.length > 0);
  assert.ok(scene.camera.shakeMagnitude > 0); assert.equal(scene.player.x, 100);
});

test('blast damages an exposed edge mineral without destroying it, and never destroys walls', () => {
  const { map, scene } = setup();
  map.tiles[8][13] = 'mineral'; map.tileHp[8][13] = 100;
  map.tiles[11][10] = 'wall'; map.invalidateNavigation();
  scene.explodeThrowable(480, 425);
  assert.ok(map.tileHp[8][13] > 0 && map.tileHp[8][13] < 100);
  assert.equal(map.tiles[11][10], 'wall');
});

test('zero-count quick bindings retain identity, restore availability and also cover dropped firearms', () => {
  const player = new Player(0, 0), bindings = ['grenade', 'vaccine', 'primary', null];
  player.dropWeapon('primary');
  let view = createQuickSlotViews(player.getWeaponLoadoutView(), 0, {}, bindings);
  assert.deepEqual(view.slice(0, 3).map(i => [i.id, i.quantity, i.available]), [['grenade', 0, false], ['vaccine', 0, false], ['primary', 0, false]]);
  const icon = view[0].icon;
  view = createQuickSlotViews(player.getWeaponLoadoutView(), 2, { grenade: 1 }, bindings);
  assert.equal(view[0].icon, icon); assert.equal(view[0].available, true); assert.equal(view[1].quantity, 2);
  assert.deepEqual(bindings, ['grenade', 'vaccine', 'primary', null]);
});

test('smoke permits tactile pickups without revealing loot, but not through a wall or out of reach', () => {
  const { map, scene } = setup(), p = scene.player.getVisionState();
  const body = launchThrowable(3, 'smokeGrenade', p, p); body.smokeAge = 2; scene.smoke.sync([body]);
  const decide = (x, y) => scene.resolvePickupDecision(VACCINE_PICKUP_CONFIG, 'hidden', Math.hypot(x - p.x, y - p.y), { x, y }, p, 450);
  assert.deepEqual(decide(p.x + 35, p.y), { marker: false, prompt: true, named: false });
  assert.equal(decide(p.x + 80, p.y).prompt, false);
  const col = Math.floor((p.x + 40) / 50), row = Math.floor(p.y / 50); map.tiles[row][col] = 'wall'; map.invalidateNavigation();
  assert.equal(decide(p.x + 65, p.y).prompt, false);
});

test('explosion ripples are deduplicated warm double rings, with offscreen arcs projected to the viewport', () => {
  const system = new SoundRippleSystem(), cue = { x: 2000, y: 400, strength: .8, distance: 700, eventId: 1, occluded: false, style: 'explosion' };
  assert.equal(system.spawn(cue), true); assert.equal(system.spawn(cue), false);
  const arcs = [], colors = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, stroke() { colors.push(this.strokeStyle); }, arc(...a) { arcs.push(a); } };
  system.draw(ctx, 0, 0, 800, 600);
  assert.equal(arcs.length, 2); assert.ok(arcs.every(a => a[0] >= 0 && a[0] <= 800 && a[1] >= 0 && a[1] <= 600));
  assert.ok(colors.every(c => c === '#e8bd83'));
  system.update(2); assert.equal(system.getActiveCount(), 0);
});

test('backpack blocks input while simulation stays live; explicit pause freezes a cooked grenade', () => {
  const { scene } = setup();
  scene.game = { input: { clear() {}, setBlocked(value) { this.blocked = value; } } };
  scene.backpackPanel = { isOpen: () => true, refresh() {} };
  scene.syncModalState(); assert.equal(scene.isWorldPaused(), false); assert.equal(scene.game.input.blocked, true);
  scene.survival.inventory.add('grenade'); scene.throwable.equip('grenade', 'secondary');
  scene.throwable.input({ aimedLeftPressed: true, leftReleased: false }, { x: 700, y: 300 });
  scene.updateThrowables(1, false); assert.ok(Math.abs(scene.throwable.fuse - 3) < .01);
  scene.explicitPaused = true; scene.syncModalState(); assert.equal(scene.isWorldPaused(), true);
  scene.update(1, { isKeyDown: () => false }); assert.ok(Math.abs(scene.throwable.fuse - 3) < .01);
});

test('stations use reproducible reachable dry positions, have solid bases, and T fires once per press', () => {
  const { scene, map } = setup(2), other = setup(2).scene;
  scene.spawnTradingStations(); other.spawnTradingStations();
  assert.equal(scene.getTradingStationState().stations.length, 2);
  assert.deepEqual(scene.getTradingStationState(), other.getTradingStationState());
  const station = scene.tradingStations[0]; assert.equal(map.isShapeWalkable(circleCollider(station.x, station.y, 8)), false);
  scene.player.x = station.x - 75; scene.player.y = station.y - 24.5;
  let requests = 0; scene.showPickupText = () => requests++;
  const input = { isKeyDown: () => true };
  scene.updateTradingStation(input); scene.updateTradingStation(input); assert.equal(requests, 1);
  assert.equal(scene.lastTradingStationId, station.id); assert.equal(scene.isWorldPaused(), false);
  scene.updateTradingStation({ isKeyDown: () => false }); scene.updateTradingStation(input); assert.equal(requests, 2);
});
