import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { GoldPickup } = load('objects/GoldPickup');
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
const { rectangleCollider } = load('physics/Collider');
const { GOLD_FRAGMENT_SIZE } = load('map/TileType');
const emptyInput = { isKeyDown: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const makeScene = () => {
  const scene = new GameScene({ generateWater: false });
  scene.map.tiles.forEach(row => row.fill('default'));
  scene.map.tileHp.forEach(row => row.fill(0));
  scene.map.tileHighlight.forEach(row => row.fill(0));
  scene.player.x = scene.player.y = 100;
  scene.loaded = true;
  return scene;
};
const ore = (scene, col = 6, row = 4) => {
  scene.map.tiles[row][col] = 'mineral';
  scene.map.tileHp[row][col] = 100;
};
const damageRects = (map, cameraX = 0, cameraY = 0, delta = 0) => {
  const marks = [];
  map.draw({ beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},save(){},restore(){},clip(){},fillRect(x, y, width, height) {
    if (width === GOLD_FRAGMENT_SIZE && height === GOLD_FRAGMENT_SIZE) marks.push({ x, y, width, height, color: this.fillStyle });
  } }, cameraX, cameraY, 800, 600, delta);
  return marks;
};

test('strong bullet hits pay crossed stages and destruction tops up to twenty gold once', () => {
  const scene = makeScene(); ore(scene);
  const fire = () => new Bullet(new Vector2(200, 225), new Vector2(1000, 0), 60, scene.particleSystem).update(0.2, scene.map);
  fire();
  assert.equal(scene.map.tileHp[4][6], 40);
  assert.equal(scene.goldPickups.length, 6);
  fire();
  assert.equal(scene.map.tiles[4][6], 'default');
  assert.equal(scene.map.tileHp[4][6], 0);
  assert.equal(scene.map.tileHighlight[4][6], 0);
  assert.equal(scene.goldPickups.length, 20);
  assert.ok(scene.particleSystem.getPerformanceStats().activeParticles >= 32);
  assert.equal(scene.player.getGold(), 0);
  scene.map.damageTile(6, 4, 100);
  scene.map.breakTile(6, 4);
  assert.equal(scene.goldPickups.length, 20);
  ore(scene, 8, 4); scene.map.breakTile(8, 4);
  assert.equal(scene.goldPickups.length, 40, 'direct destruction uses the same drop path');
  scene.map.tiles[4][9] = 'wall'; scene.map.damageTile(9, 4, 1000);
  assert.equal(scene.map.tiles[4][9], 'wall');
  assert.equal(scene.goldPickups.length, 40);
});

test('all twenty pieces stay in walkable space throughout scattering, including enclosed map corners', () => {
  for (const random of [0, 0.5, 0.9999]) for (const [col, row] of [[0, 0], [99, 99], [6, 4]]) {
    const scene = makeScene();
    scene.map.tiles.forEach(line => line.fill('wall'));
    ore(scene, col, row);
    const original = Math.random;
    try { Math.random = () => random; scene.map.breakTile(col, row); }
    finally { Math.random = original; }
    assert.equal(scene.goldPickups.length, 20);
    for (let frame = 0; frame < 60; frame++) for (const piece of scene.goldPickups) {
      piece.update(1 / 60);
      assert.ok(scene.map.isShapeWalkable(piece.getCollider()), `blocked piece at ${piece.x}, ${piece.y}`);
    }
    assert.equal(new Set(scene.goldPickups.map(p => `${p.x},${p.y}`)).size, 20);
  }
});

test('gold scatters to randomized positions, persists on the floor, and only collects after landing', () => {
  const scene = makeScene(); ore(scene);
  const origin = rectangleCollider(300, 200, 50, 50);
  scene.map.breakTile(6, 4);
  assert.equal(scene.goldPickups.some(p => p.isCollidingWithShape(origin)), false);
  scene.update(0.2, emptyInput);
  assert.ok(scene.goldPickups.some(p => p.x !== 321 || p.y !== 221));
  assert.equal(scene.goldPickups.some(p => p.isCollidingWithShape(origin)), false);
  scene.update(1, emptyInput);
  const positions = scene.goldPickups.map(p => [p.x, p.y]);
  scene.update(120, emptyInput);
  assert.deepEqual(scene.goldPickups.map(p => [p.x, p.y]), positions);
  assert.equal(scene.goldPickups.length, 20);
  assert.equal(scene.player.getGold(), 0);
});

test('scene auto-picks up every landed square once and leaves health and boosts unchanged', () => {
  const scene = makeScene(); ore(scene);
  scene.player.takeDamage(50);
  scene.map.breakTile(6, 4);
  scene.update(1, emptyInput);
  while (scene.goldPickups.length) {
    const piece = scene.goldPickups[0], before = scene.goldPickups.length;
    scene.player.x = piece.x + GoldPickup.SIZE / 2 - scene.player.getSize() / 2;
    scene.player.y = piece.y + GoldPickup.SIZE / 2 - scene.player.getSize() / 2;
    scene.update(1 / 60, emptyInput);
    assert.ok(scene.goldPickups.length < before);
    assert.equal(scene.player.getGold() + scene.goldPickups.length, 20);
  }
  scene.update(1, emptyInput);
  assert.equal(scene.player.getGold(), 20);
  assert.equal(scene.player.getHealth(), 50);
  assert.equal(scene.modifierManager.getModifierCount(), 0);
});

test('normal and boosted player attacks give feedback on the first hit and every one or two hits thereafter', () => {
  for (const [boost, expected] of [
    [0, [2, 2, 4, 4, 6, 6, 8, 8, 10, 20]],
    [0.5, [2, 4, 4, 6, 8, 10, 20]],
    [1, [2, 4, 6, 8, 20]],
  ]) {
    const scene = makeScene(); ore(scene);
    scene.player.x = scene.player.y = 200;
    scene.player.setOnShootCallback(() => {});
    if (boost) scene.player.addModifier('damage', boost, 1, true);
    let previous = 0, lastDropHit = 0;
    for (let hit = 1; hit <= expected.length; hit++) {
      scene.player.shoot(new Vector2(1, 0));
      scene.player.update(0.2, emptyInput, scene.map);
      assert.equal(scene.goldPickups.length, expected[hit - 1]);
      if (scene.goldPickups.length > previous) {
        assert.ok(hit - lastDropHit <= 2);
        lastDropHit = hit;
      }
      previous = scene.goldPickups.length;
    }
    assert.equal(scene.map.tiles[4][6], 'default');
    assert.equal(scene.goldDroppedByTile.size, 0);
  }
});

test('invalid damage does nothing and lethal damage emits destruction instead of another damage event', () => {
  const scene = makeScene(); ore(scene);
  const events = [], damaged = scene.map.onTileDamaged, destroyed = scene.map.onTileDestroyed;
  scene.map.onTileDamaged = (...args) => { events.push(['damaged', ...args]); damaged(...args); };
  scene.map.onTileDestroyed = (...args) => { events.push(['destroyed', ...args]); destroyed(...args); };
  for (const amount of [0, -10, NaN, Infinity, -Infinity]) scene.map.damageTile(6, 4, amount);
  assert.equal(scene.map.tileHp[4][6], 100);
  assert.equal(scene.map.tileHighlight[4][6], 0);
  assert.equal(scene.goldPickups.length, 0);
  assert.deepEqual(events, []);
  scene.map.damageTile(6, 4, 10);
  assert.deepEqual(events, [['damaged', 6, 4, 'mineral', 90, 100]]);
  scene.map.damageTile(6, 4, 1000);
  scene.map.damageTile(6, 4, 10); scene.map.breakTile(6, 4);
  assert.deepEqual(events[1], ['destroyed', 6, 4, 'mineral']);
  assert.equal(events.length, 2);
  assert.equal(scene.goldPickups.length, 20);
  const oneShot = makeScene(); ore(oneShot);
  oneShot.map.damageTile(6, 4, 1000);
  assert.equal(oneShot.goldPickups.length, 20);
});

test('partial drops start and travel outside live ore, walls, deep water and map edges', () => {
  for (const random of [0, 0.5, 0.9999]) for (const side of ['left', 'right', 'top', 'bottom']) {
    const scene = makeScene();
    scene.map.tiles.forEach(row => row.fill('wall'));
    const [col, row] = side === 'left' || side === 'top' ? [1, 1] : [98, 98];
    ore(scene, col, row);
    const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const dy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
    scene.map.tiles[row + dy][col + dx] = 'default';
    scene.map.tiles[row - dy][col - dx] = 'ultra_deep_water';
    scene.player.x = (col + dx) * 50; scene.player.y = (row + dy) * 50;
    const original = Math.random;
    try { Math.random = () => random; scene.map.damageTile(col, row, 10); }
    finally { Math.random = original; }
    assert.equal(scene.goldPickups.length, 2);
    assert.equal(scene.map.tiles[row][col], 'mineral');
    const starts = scene.goldPickups.map(piece => [piece.x, piece.y]);
    for (let frame = 0; frame <= 60; frame++) for (const piece of scene.goldPickups) {
      assert.ok(scene.map.isShapeWalkable(piece.getCollider()), `${side}: blocked at ${piece.x}, ${piece.y}`);
      piece.update(1 / 60);
    }
    scene.goldPickups.forEach((piece, i) => {
      const start = rectangleCollider(starts[i][0], starts[i][1], GoldPickup.SIZE, GoldPickup.SIZE);
      assert.equal(scene.map.castShape(start, { x: piece.x - starts[i][0], y: piece.y - starts[i][1] }), null);
    });
  }
});

test('blocked partial payouts retry without losing gold and destruction clears per-ore accounting', () => {
  const scene = makeScene();
  scene.map.tiles.forEach(row => row.fill('wall')); ore(scene);
  scene.map.damageTile(6, 4, 30);
  assert.equal(scene.goldPickups.length, 0);
  scene.map.tiles[4][5] = 'default';
  scene.map.damageTile(6, 4, 1); // No new threshold: retry the four pieces already earned.
  assert.equal(scene.goldPickups.length, 4);
  scene.map.damageTile(6, 4, 100);
  assert.equal(scene.goldPickups.length, 20);
  assert.equal(scene.goldDroppedByTile.size, 0);
  ore(scene); scene.map.breakTile(6, 4);
  assert.equal(scene.goldPickups.length, 40, 'a new ore at the same position has its own full payout');

  const closed = makeScene(); closed.map.tiles.forEach(row => row.fill('wall')); ore(closed, 0, 0);
  closed.map.damageTile(0, 0, 90);
  assert.equal(closed.goldPickups.length, 0);
  closed.map.damageTile(0, 0, 10);
  assert.equal(closed.goldPickups.length, 20);
  closed.goldPickups.forEach(piece => assert.ok(closed.map.isShapeWalkable(piece.getCollider())));
});

test('partially mined ore and adjacent ore have independent twenty-gold budgets', () => {
  const scene = makeScene(); ore(scene); ore(scene, 7, 4);
  scene.map.damageTile(6, 4, 10); scene.map.damageTile(7, 4, 10);
  assert.equal(scene.goldPickups.length, 4);
  scene.map.breakTile(6, 4);
  assert.equal(scene.goldPickups.length, 22);
  scene.map.breakTile(7, 4);
  assert.equal(scene.goldPickups.length, 40);
  assert.equal(scene.goldDroppedByTile.size, 0);
});

test('ore damage grows from three to twenty-four distinct gold-sized marks without changing existing marks or geometry', () => {
  const scene = makeScene(); ore(scene);
  const map = scene.map, edges = map.getShadowEdges(250, 225, 300);
  assert.equal(GOLD_FRAGMENT_SIZE, GoldPickup.SIZE);
  assert.equal(GOLD_FRAGMENT_SIZE, 8);
  assert.deepEqual(damageRects(map), []);
  map.damageTile(6, 4, 10);
  const first = damageRects(map);
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map(mark => mark.color)).size, 3);
  map.damageTile(6, 4, 40);
  const half = damageRects(map);
  assert.equal(half.length, 12);
  assert.deepEqual(half.slice(0, 3), first);
  assert.equal(new Set(half.map(mark => mark.color)).size, 4);
  map.damageTile(6, 4, 40);
  assert.equal(damageRects(map).length, 22);
  map.damageTile(6, 4, 9);
  const maximum = damageRects(map);
  assert.equal(maximum.length, 24);
  assert.deepEqual(maximum.slice(0, 12), half);
  assert.equal(new Set(maximum.map(mark => `${mark.x},${mark.y}`)).size, 24);
  for (const mark of maximum) {
    assert.equal(mark.width, GoldPickup.SIZE); assert.equal(mark.height, GoldPickup.SIZE);
    assert.ok(mark.x >= 301 && mark.x + mark.width <= 349);
    assert.ok(mark.y >= 201 && mark.y + mark.height <= 249);
  }
  assert.deepEqual(map.getShadowEdges(250, 225, 300), edges);
  assert.equal(map.isShapeWalkable(rectangleCollider(310, 210, 8, 8)), false);
});

test('damage survives flashing, repeated drawing and fractional cameras without new randomness', () => {
  const scene = makeScene(); ore(scene);
  scene.map.damageTile(6, 4, 50);
  const expected = damageRects(scene.map), original = Math.random;
  try {
    Math.random = () => { throw new Error('damage must not rerandomize while drawing'); };
    assert.deepEqual(damageRects(scene.map, 0, 0, 0.2), expected);
    assert.equal(scene.map.tileHighlight[4][6], 0);
    assert.deepEqual(damageRects(scene.map), expected);
    for (const [cameraX, cameraY] of [[0.35, 0.65], [37.25, 19.75], [-0.5, -0.5]]) {
      const actual = damageRects(scene.map, cameraX, cameraY);
      assert.deepEqual(actual, expected.map(mark => ({ ...mark,
        x: Math.round(mark.x - cameraX), y: Math.round(mark.y - cameraY) })));
    }
  } finally { Math.random = original; }
});

test('damage affects only hit ore, ignores invalid attacks and resets on either destruction path', () => {
  const scene = makeScene(); ore(scene); ore(scene, 7, 4);
  scene.map.tiles[4][5] = 'wall';
  for (const amount of [0, -10, NaN, Infinity]) scene.map.damageTile(6, 4, amount);
  scene.map.damageTile(5, 4, 10);
  assert.equal(scene.map.mineralDamage.size, 0);
  const original = Math.random;
  try { Math.random = () => 0; scene.map.damageTile(6, 4, 10); }
  finally { Math.random = original; }
  const old = damageRects(scene.map);
  assert.equal(old.length, 3);
  assert.ok(old.every(mark => mark.x >= 301 && mark.x + mark.width <= 349));
  scene.map.breakTile(6, 4);
  assert.equal(scene.map.mineralDamage.size, 0);
  assert.deepEqual(damageRects(scene.map), []);
  ore(scene);
  assert.deepEqual(damageRects(scene.map), []);
  try { Math.random = () => 0.9999; scene.map.damageTile(6, 4, 10); }
  finally { Math.random = original; }
  assert.notDeepEqual(damageRects(scene.map), old);
  scene.map.damageTile(6, 4, 90);
  assert.equal(scene.map.mineralDamage.size, 0);
  scene.map.damageTile(7, 4, 100);
  assert.equal(scene.map.mineralDamage.size, 0);
  assert.deepEqual(damageRects(scene.map), []);
});
