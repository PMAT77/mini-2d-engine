import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { TileTypeId, TILE_TYPES, SPECIAL_MINERAL_TYPES } = load('map/TileType');
const { PickupType, PICKUP_ICONS } = load('objects/PickupItem');
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
const { circleCollider } = load('physics/Collider');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
const input = { isKeyDown: () => false };
const types = [
  [TileTypeId.HEALTH_MINERAL, PickupType.HEALTH],
  [TileTypeId.SPEED_MINERAL, PickupType.SPEED_BOOST],
  [TileTypeId.FIRE_RATE_MINERAL, PickupType.FIRE_RATE_BOOST],
  [TileTypeId.BULLET_SPEED_MINERAL, PickupType.BULLET_SPEED_BOOST],
  [TileTypeId.DAMAGE_MINERAL, PickupType.DAMAGE_BOOST]
];
const sceneOf = () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.map.tiles.forEach(row => row.fill('default'));
  scene.map.tileHp.forEach(row => row.fill(0));
  scene.player.x = scene.player.y = 100;
  scene.loaded = true;
  return scene;
};
const ore = (scene, type, col = 6, row = 4) => {
  scene.map.tiles[row][col] = type;
  scene.map.tileHp[row][col] = 100;
};

test('every special ore pays only one matching pickup after lethal bullet damage, never partial loot or gold', () => {
  for (const [type, pickupType] of types) {
    const scene = sceneOf(); ore(scene, type);
    const fire = damage => new Bullet(new Vector2(200, 225), new Vector2(1000, 0), damage, scene.particleSystem).update(.2, scene.map);
    for (const damage of [10, 20, 20, 20, 20, 9]) {
      fire(damage);
      assert.equal(scene.pickupItems.length, 0, type);
      assert.equal(scene.goldPickups.length, 0, type);
    }
    assert.equal(scene.map.tileHp[4][6], 1);
    fire(1);
    assert.equal(scene.map.tiles[4][6], 'default');
    assert.equal(scene.map.tileHp[4][6], 0);
    assert.equal(scene.map.tileHighlight[4][6], 0);
    assert.equal(scene.map.mineralDamage.size, 0);
    assert.equal(scene.pickupItems.length, 1);
    assert.equal(scene.pickupItems[0].getType(), pickupType);
    assert.deepEqual([scene.pickupItems[0].x, scene.pickupItems[0].y], [305, 205]);
    scene.map.damageTile(6, 4, 100); scene.map.breakTile(6, 4);
    assert.equal(scene.pickupItems.length, 1);
    assert.equal(scene.goldPickups.length, 0);
  }
});

test('one-shot and direct destruction drop matching pickups in isolated edge tiles, without a five-pickup cap', () => {
  const scene = sceneOf(); scene.map.tiles.forEach(row => row.fill('wall'));
  let count = 0;
  for (const destroy of [(map, col, row) => map.damageTile(col, row, 1000), (map, col, row) => map.breakTile(col, row)]) {
    for (const [i, [type, pickupType]] of types.entries()) {
      const col = count < 5 ? i * 3 : 99 - i * 3, row = count < 5 ? 0 : 99;
      ore(scene, type, col, row);
      for (const amount of [0, -1, NaN, Infinity]) scene.map.damageTile(col, row, amount);
      assert.equal(scene.map.tileHp[row][col], 100);
      destroy(scene.map, col, row);
      const pickup = scene.pickupItems.at(-1);
      assert.equal(pickup.getType(), pickupType);
      assert.ok(scene.map.isShapeWalkable(pickup.getCollider()));
      assert.equal(scene.pickupItems.length, ++count);
      scene.map.breakTile(col, row);
      assert.equal(scene.pickupItems.length, count);
    }
  }
  scene.update(120, input);
  assert.equal(scene.pickupItems.length, 10, 'drops persist and no timed spawn occurs');
  assert.equal(scene.goldPickups.length, 0);
  for (const pickup of [...scene.pickupItems]) {
    scene.player.x = pickup.x + 20 - 24.5; scene.player.y = pickup.y + 20 - 24.5;
    assert.ok(scene.map.isShapeWalkable(scene.player.getCollider()), 'the player fits inside the cleared edge cell');
    const before = scene.pickupItems.length; scene.checkPickupCollisions();
    assert.equal(scene.pickupItems.length, before - 1);
  }
  const empty = sceneOf(); empty.update(120, input);
  assert.equal(empty.pickupItems.length, 0, 'an idle scene cannot spawn ground pickups');
});

test('ore drops collect once through the existing health and independent refreshable boost rules', () => {
  const scene = sceneOf(); scene.player.takeDamage(80);
  const getters = [() => scene.player.getMaxSpeed(), () => scene.player.getFireRate(),
    () => scene.player.getBulletSpeed(), () => scene.player.getModifiedValue(10, 'damage')];
  const base = getters.map(get => get());
  for (const [i, [type]] of types.entries()) {
    ore(scene, type); scene.map.breakTile(6, 4);
    scene.player.x = 300.5; scene.player.y = 200.5;
    scene.update(0, input);
    assert.equal(scene.pickupItems.length, 0);
    assert.equal(scene.modifierManager.getModifierCount(), i);
    if (i === 0) assert.equal(scene.player.getHealth(), 70);
    else assert.notEqual(getters[i - 1](), base[i - 1]);
  }
  ore(scene, TileTypeId.SPEED_MINERAL); scene.map.breakTile(6, 4); scene.update(0, input);
  assert.equal(scene.modifierManager.getModifierCount(), 4, 'same-stat pickups refresh rather than stack');
  scene.update(9, input);
  assert.equal(scene.modifierManager.getModifierCount(), 0);
  assert.deepEqual(getters.map(get => get()), base);
  assert.equal(scene.player.getHealth(), 70);
  assert.equal(scene.player.getGold(), 0);
});

test('special ores block movement, bullets and light until destruction and retain stable tinted damage under their icons', () => {
  for (const [type, pickupType] of types) {
    const scene = sceneOf(); ore(scene, type);
    const map = scene.map, body = circleCollider(325, 225, 20);
    assert.equal(TILE_TYPES[type].durability, 100);
    assert.equal(map.isShapeWalkable(body), false);
    assert.equal(map.blocksLightAt(325, 225), true);
    assert.ok(map.castShape(circleCollider(250, 225, 2), { x: 100, y: 0 }, 'projectile'));
    const edges = map.getShadowEdges(250, 225, 200);
    const render = () => {
      const calls = [];
      map.draw({ beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},clip(){},save() {}, restore() {}, fillRect(x, y, w, h) { if (w === 8 && h === 8) calls.push([x, y, this.fillStyle]); },
        fillText(icon) { calls.push(icon); } }, 37.25, 19.75, 800, 600, .2);
      return calls;
    };
    map.damageTile(6, 4, 10);
    const first = render();
    assert.equal(first.length, 4); assert.equal(first.at(-1), PICKUP_ICONS[pickupType]);
    assert.deepEqual(render(), first);
    map.damageTile(6, 4, 40);
    const half = render();
    assert.equal(half.length, 13); assert.deepEqual(half.slice(0, 3), first.slice(0, 3));
    assert.equal(new Set(half.slice(0, -1).map(mark => mark[2])).size, 4);
    assert.deepEqual(map.getShadowEdges(250, 225, 200), edges);
    map.breakTile(6, 4);
    assert.equal(map.isShapeWalkable(body), true);
    assert.equal(map.blocksLightAt(325, 225), false);
    assert.equal(map.castShape(circleCollider(250, 225, 2), { x: 100, y: 0 }, 'projectile'), null);
    assert.deepEqual(render(), []);
  }
});

test('seeded generation keeps gold ore as the only drop-bearing tile', () => {
  let minerals = 0;
  for (const seed of [0, 1, 42, 8351, 99999, 72, 8352, 2026, 1234, 9876]) {
    const a = new TileMap(100, 100, { seed }), b = new TileMap(100, 100, { seed });
    assert.deepEqual(a.tiles, b.tiles); assert.deepEqual(a.tileHp, b.tileHp);
    assert.deepEqual(a.water.lakes, b.water.lakes);
    for (let row = 0; row < a.height; row++) for (let col = 0; col < a.width; col++) {
      const type = a.tiles[row][col];
      if (type === 'mineral') { minerals++; assert.equal(a.tileHp[row][col], 100); }
      assert.ok(!SPECIAL_MINERAL_TYPES.includes(type), `unexpected ${type} at ${col},${row}`);
    }
  }
  assert.ok(minerals > 0, 'generated maps still contain gold ore');
});

test('removing the special replacement pass preserves the original seeded base geometry and water layout', () => {
  // Captured from the generator before the special-ore replacement pass was removed.
  const snapshots = [
    [0, '775e2c17f81ee80a19d1890ad5301c64f179424f21f5952d1b9327c7a207b450', '6cccc8d8620d4b6954e59c147ddc7733900f1a8a4a7d670fc0356e7f5b8619a8'],
    [42, 'ae312e9626723fb103f296b04fe978302395e9bf1c71ed1f478070d622cca724', 'e339772050a0e925968c90c3a5730de4040c2e0a75846595fb375aec1b05b345'],
    [8351, '3c46f2e2bf3a310709112bd9c07e8f0308127b5cf4138ff8d6722d56e945af8b', 'fffa80464137c990007cd5a936421774e272ac0f8bca4919080d456af8eb2270']
  ];
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const [seed, water, base] of snapshots) {
    const map = new TileMap(100, 100, { seed });
    assert.equal(hash(map.water.lakes), water);
    assert.equal(hash(map.tiles.map(row => row.map(type => SPECIAL_MINERAL_TYPES.includes(type) ? 'mineral' : type))), base);
  }
});
