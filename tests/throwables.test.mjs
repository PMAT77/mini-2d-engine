import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { ConsumableInventory } = load('survival/ConsumableInventory');
const { ThrowableController } = load('throwables/ThrowableController');
const { launchThrowable, stepThrowable, previewThrow } = load('throwables/ThrowablePhysics');
const { SmokeSystem } = load('throwables/SmokeSystem');
const { THROWABLE_CONFIG: C, blastDamage } = load('throwables/ThrowableConfig');
const { TileMap } = load('map/TileMap');
const { GameScene } = load('scenes/GameScene');
const { VisionSensor } = load('ai/VisionSensor');
const { PerceptionSystem } = load('vision/PerceptionSystem');
const { createBackpackView } = load('ui/BackpackView');
const { Player } = load('objects/Player');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
const pointer = values => ({ active: true, leftDown: false, rightDown: true, leftPressed: false, leftReleased: false, aimFirePressed: false, ...values });
const ground = () => { const m = new TileMap(32, 24, { generateWater: false, seed: 42 }); m.tiles.forEach(r => r.fill('default')); m.tileHp.forEach(r => r.fill(0)); m.invalidateNavigation(); return m; };
const setup = () => {
  const map = ground(), scene = new GameScene({ map, playerSpawn: { x: 400, y: 400 }, chickenCount: 0, encounters: { shambler: 0, runner: 0, vaccines: 0, grenades: 0, tradingStations: 0, smokeGrenades: 0 } });
  scene.loaded = true; return { scene, map };
};

test('grenade reserves atomically, cannot cancel, keeps fuse on suspend and commits exactly once', () => {
  const inventory = new ConsumableInventory(), c = new ThrowableController(inventory); inventory.add('grenade', 2);
  assert.ok(c.equip('grenade', 'primary'));
  assert.equal(c.input(pointer({ leftPressed: true }), { x: 700, y: 400 }), false, 'left without right ownership cannot prime');
  c.input(pointer({ leftPressed: true, aimFirePressed: true }), { x: 700, y: 400 });
  assert.ok(c.locked); assert.equal(inventory.getCount('grenade'), 2); assert.equal(inventory.getAvailable('grenade'), 1);
  c.advance(1.2); assert.equal(c.cancel(), false); assert.equal(c.equip('smokeGrenade', 'secondary'), false);
  c.suspend(); assert.equal(c.input(pointer({ leftReleased: true })), false);
  assert.ok(Math.abs(c.fuse - 2.8) < 1e-9);
  c.input(pointer({ leftPressed: true })); assert.equal(c.input(pointer({ rightDown: false, leftReleased: true })), true);
  const item = c.commit(); assert.equal(item.kind, 'grenade'); assert.ok(Math.abs(item.fuse - 2.8) < 1e-9);
  assert.equal(inventory.getCount('grenade'), 1); assert.equal(c.held, 'grenade'); assert.equal(c.commit(), null);
  assert.equal(c.input(pointer({ leftDown: true })), false, 'holding cannot prepare the next one');
});

test('smoke preparation cancels without consuming and last item returns hand mode to empty', () => {
  const i = new ConsumableInventory(), c = new ThrowableController(i); i.add('smokeGrenade');
  c.equip('smokeGrenade', 'secondary'); c.input(pointer({ aimFirePressed: true }), { x: 600, y: 400 });
  c.advance(20); assert.equal(c.fuse, 4); c.cancel(); assert.equal(i.getAvailable('smokeGrenade'), 1);
  c.equip('smokeGrenade', 'secondary'); assert.ok(c.input(pointer({ aimFirePressed: true, leftReleased: true }), { x: 600, y: 400 }));
  c.commit(); assert.equal(c.held, null); assert.equal(c.returnWeapon, 'secondary'); assert.equal(i.getCount('smokeGrenade'), 0);
});

test('preview and projectile agree, bounce loses energy, world bounds and walls never tunnel', () => {
  const m = ground(); const origin = { x: 250, y: 300 }, target = { x: 650, y: 300 };
  for (let row = 0; row < m.height; row++) m.tiles[row][9] = 'wall'; m.invalidateNavigation();
  const preview = previewThrow('grenade', origin, target, m, 4), body = launchThrowable(1, 'grenade', origin, target, 4);
  let exploded = 0, bounced = 0, firstLanding;
  for (let i = 0; i < 480; i++) {
    stepThrowable(body, C.step, m, e => { if(e.type === 'explode') exploded++; if(e.type === 'bounce') bounced++; if(e.type === 'land') firstLanding = body.x; });
    assert.ok(body.x < 450 && body.x >= C.radius);
  }
  assert.equal(exploded, 1); assert.ok(bounced > 0); assert.ok(firstLanding !== undefined);
  assert.ok(Math.hypot(body.x - preview.end.x, body.y - preview.end.y) < .01);
  assert.ok(body.resting); assert.ok(body.dead);
});

test('smoke starts on first touchdown, water removes bounce, hand and airborne fuses expire', () => {
  const m = ground(), origin = { x: 500, y: 500 };
  const smoke = launchThrowable(1, 'smokeGrenade', origin, { x: 700, y: 500 });
  m.getShapeSpeedFactor = (_, water) => { water.fraction = 1; return .5; };
  assert.equal(smoke.smokeAge, -1);
  for (let i = 0; i < 120; i++) { stepThrowable(smoke, C.step, m); if (smoke.landed) assert.equal(smoke.z, 0); }
  assert.ok(smoke.smokeAge > 0); assert.equal(smoke.vz, 0);
  const grenade = launchThrowable(2, 'grenade', origin, { x: 900, y: 500 }, .1);
  for (let i = 0; i < 12; i++) stepThrowable(grenade, C.step, m);
  assert.ok(grenade.dead && grenade.z > 0);
});

test('smoke obeys walls, overlaps cap density, blocks AI, hides detail and never explores through smoke', () => {
  const m = ground(); for (let row = 0; row < m.height; row++) m.tiles[row][12] = 'wall'; m.invalidateNavigation();
  const smoke = new SmokeSystem(m), b = launchThrowable(1, 'smokeGrenade', { x: 530, y: 510 }, { x: 530, y: 510 });
  b.smokeAge = 2; smoke.sync([b, { ...b, id: 2 }]); m.sightOpacity = smoke.opacity;
  assert.equal(smoke.density(530, 510), 1); assert.equal(smoke.density(630, 510), 0);
  assert.ok(smoke.opacity(400, 510, 580, 510) > .9);
  const viewer = { x: 490, y: 510, facing: 0 }, target = { x: 530, y: 510 };
  assert.equal(new VisionSensor().sense(2, m, viewer, target, []).visible, false);
  const p = new PerceptionSystem({ map: m, terrain: m });
  p.update(1, [{ ...viewer, id: 'player', nearSenseRadius: 100, maxObservationRange: 450 }], [], [
    { ...target, id: 'near', category: 'enemy', bounds: { ...target, width: 20, height: 20 } },
    { x: 570, y: 510, id: 'far', category: 'enemy', bounds: { x: 570, y: 510, width: 20, height: 20 } },
  ]);
  assert.equal(p.getView('player', 'near').level, 'silhouette'); assert.equal(p.getView('player', 'near').alpha, 0);
  assert.equal(p.getView('player', 'far').level, 'hidden'); assert.equal(p.canIdentify('player', 530, 510), false);
  assert.equal(p.getTerrainRecall('player', 570, 510), 'unknown');
  b.smokeAge = 14; smoke.sync([b]); assert.equal(smoke.density(530, 510), 0);
});

test('explosions damage players and enemies once, walls block, terrain survives and no head bonus applies', () => {
  const { scene, map } = setup(); scene.player.x = 300; scene.player.y = 500;
  const z = scene.getEnemySystem().add('shambler', { x: 520, y: 520 });
  scene.explodeThrowable(520, 520); assert.ok(z.getHealth() < z.config.maxHealth); assert.equal(scene.player.getHealth(), 100);
  const hp = scene.player.getHealth(); scene.explodeThrowable(410, 520); assert.ok(scene.player.getHealth() < hp);
  assert.equal(blastDamage(0), 120); assert.equal(blastDamage(40), 120); assert.equal(blastDamage(180), 0);
  const other = setup(); for(let y=0;y<other.map.height;y++) other.map.tiles[y][10]='wall'; other.map.invalidateNavigation();
  const blocked = other.scene.getEnemySystem().add('shambler', { x: 570, y: 420 });
  other.scene.explodeThrowable(480, 420); assert.equal(blocked.getHealth(), blocked.config.maxHealth); assert.equal(other.map.tiles[8][10], 'wall');
});

test('scene fixed physics agrees at 30/60/144 FPS and locked actions cannot bypass grenade ownership', () => {
  const endpoints = [];
  for (const fps of [30,60,144]) {
    const {scene} = setup(); scene.player.x=100;scene.player.y=100;
    scene.throwableBodies.push(launchThrowable(1,'grenade',{x:500,y:500},{x:800,y:500}));
    for(let i=0;i<fps*3;i++) scene.updateThrowables(1/fps,false);
    endpoints.push([scene.throwableBodies[0].x, scene.throwableBodies[0].y]);
    scene.survival.inventory.add('grenade'); scene.activateInventoryItem('grenade','gameplay');
    scene.throwable.input(pointer({aimFirePressed:true}),{x:700,y:100});
    assert.match(scene.activateInventoryItem('primary','gameplay'), /已拉环/);
    assert.match(scene.dropBackpackItem('grenade'), /已拉环/); assert.match(scene.bindQuickSlot('grenade',1), /已拉环/);
    scene.player.takeDamage(100);scene.updateThrowables(.01,false);
    assert.equal(scene.survival.inventory.getCount('grenade'),0);assert.ok(scene.throwableBodies.some(b=>b.id!==1 || b.x<200));
  }
  assert.deepEqual(endpoints[0],endpoints[1]);assert.deepEqual(endpoints[1],endpoints[2]);
});

test('inventory shares quantities, weights and preparation lock across list and hotbar', () => {
  const p = new Player(0,0), view = createBackpackView(p.getWeaponLoadoutView(), 2, null, ['grenade'], {grenade:2,smokeGrenade:2}, 'grenade', true);
  assert.equal(view.load.weightKg,5.7);assert.equal(view.items.find(i=>i.id==='grenade').quantity,2);
  assert.ok(view.items.every(i=>!i.canDrop && i.disabledReason));
});
