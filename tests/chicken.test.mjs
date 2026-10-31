import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Chicken } = load('objects/Chicken');
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');
const idleInput = { isKeyDown: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const dryMap = (width = 40, height = 24) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const centerOf = chicken => ({ x: chicken.x + Chicken.SIZE / 2, y: chicken.y + Chicken.SIZE / 2 });

test('spawn places chickens on dry walkable ground near the center and degrades safely', () => {
  const map = dryMap(60, 40);
  const center = { x: 1500, y: 1000 };
  const chickens = Chicken.spawn(map, 6, center, seededRandom(1234));
  assert.equal(chickens.length, 6);
  chickens.forEach((chicken, index) => {
    const position = centerOf(chicken);
    const distance = Math.hypot(position.x - center.x, position.y - center.y);
    assert.ok(distance >= 180 - 1e-9 && distance <= 1100 + 1e-9, `spawn distance: ${distance}`);
    assert.ok(Number.isFinite(chicken.x) && Number.isFinite(chicken.y));
    const body = chicken.getCollider();
    assert.ok(map.isShapeWalkable(body), 'spawn body must be walkable');
    assert.equal(map.getShapeSpeedFactor(body), 1, 'spawn body must be dry');
    for (const other of chickens.slice(index + 1)) {
      assert.ok(Math.hypot(chicken.x - other.x, chicken.y - other.y) >= 70, 'chickens must stay spaced');
    }
  });

  const blocked = dryMap(10, 10);
  blocked.tiles.forEach(row => row.fill('wall'));
  assert.deepEqual(Chicken.spawn(blocked, 6, { x: 250, y: 250 }, seededRandom(2)), []);
  assert.deepEqual(Chicken.spawn(map, 0, center, seededRandom(3)), []);
});

test('the game scene adds sixty roaming chickens on dry ground', () => {
  const scene = new GameScene({ seed: 42 });
  const map = scene.map;
  assert.equal(scene.chickens.length, 60);
  scene.chickens.forEach(chicken => {
    const body = chicken.getCollider();
    assert.ok(map.isShapeWalkable(body));
    assert.equal(map.getShapeSpeedFactor(body), 1);
  });

  scene.loaded = true;
  const before = scene.chickens.map(chicken => ({ x: chicken.x, y: chicken.y }));
  for (let frame = 0; frame < 300; frame++) scene.update(1 / 60, idleInput);
  const moved = scene.chickens.some((chicken, index) =>
    Math.hypot(chicken.x - before[index].x, chicken.y - before[index].y) > 2);
  assert.ok(moved, 'at least one chicken should roam');
  scene.chickens.forEach(chicken => {
    const body = chicken.getCollider();
    assert.ok(Number.isFinite(chicken.x) && Number.isFinite(chicken.y));
    assert.ok(map.isShapeWalkable(body));
    assert.equal(map.getShapeSpeedFactor(body), 1);
  });
});

test('a seeded chicken wanders without leaving dry walkable ground, even across long frames', () => {  const map = dryMap(40, 24);
  for (let row = 0; row < map.height; row++) map.tiles[row][20] = 'wall';
  for (let col = 8; col < 14; col++) map.tiles[8][col] = 'shallow_water';

  const chicken = new Chicken(600, 600, seededRandom(7));
  let distance = 0;
  let previous = { x: chicken.x, y: chicken.y };
  for (let frame = 0; frame < 3600; frame++) {
    chicken.update(1 / 60, idleInput, map);
    const body = chicken.getCollider();
    assert.ok(Number.isFinite(chicken.x) && Number.isFinite(chicken.y));
    assert.ok(chicken.x >= 0 && chicken.y >= 0);
    assert.ok(chicken.x + Chicken.SIZE <= map.width * map.tileSize);
    assert.ok(chicken.y + Chicken.SIZE <= map.height * map.tileSize);
    assert.ok(map.isShapeWalkable(body), `frame ${frame}: body entered a wall or ore`);
    assert.equal(map.getShapeSpeedFactor(body), 1, `frame ${frame}: body entered water`);
    distance += Math.hypot(chicken.x - previous.x, chicken.y - previous.y);
    previous = { x: chicken.x, y: chicken.y };
  }
  assert.ok(distance > 200, `wandering distance: ${distance}`);

  const longFrame = new Chicken(600, 600, seededRandom(8));
  longFrame.update(0.5, idleInput, map);
  assert.ok(Number.isFinite(longFrame.x) && Number.isFinite(longFrame.y));
  assert.ok(map.isShapeWalkable(longFrame.getCollider()));
  assert.equal(map.getShapeSpeedFactor(longFrame.getCollider()), 1);
  const x = longFrame.x, y = longFrame.y;
  longFrame.update(-1, idleInput, map);
  longFrame.update(NaN, idleInput, map);
  assert.equal(longFrame.x, x);
  assert.equal(longFrame.y, y);
});

test('chickens die to a single default hit and expose a swept hit test', () => {
  const chicken = new Chicken(100, 100, seededRandom(1));
  assert.equal(chicken.isAlive(), true);
  assert.equal(chicken.getHealth(), Chicken.MAX_HEALTH);
  assert.equal(chicken.getMaxHealth(), 1);
  assert.equal(chicken.takeDamage(10), true, 'one default bullet is lethal');
  assert.equal(chicken.isAlive(), false);
  assert.equal(chicken.getHealth(), 0);
  assert.equal(chicken.takeDamage(10), false, 'dead chickens ignore further damage');
  assert.equal(chicken.takeDamage(NaN), false);
  assert.equal(chicken.takeDamage(-1), false);

  const target = new Chicken(200, 200, seededRandom(2));
  const cx = target.x + Chicken.SIZE / 2, cy = target.y + Chicken.SIZE / 2;
  const fraction = target.hitTestSegment(cx - 100, cy, cx + 100, cy, 5);
  // 命中半径 = 本体 11 + 子弹 5，接触点距起点 100 - 16。
  assert.ok(fraction !== null);
  assert.ok(Math.abs(fraction - (100 - 16) / 200) < 1e-9);
  assert.equal(target.hitTestSegment(cx - 100, cy + 50, cx + 100, cy + 50, 5), null);
  assert.equal(target.hitTestSegment(cx, cy, cx + 10, cy, 5), 0, 'starting inside hits immediately');
  target.takeDamage(1000);
  assert.equal(target.hitTestSegment(cx - 100, cy, cx + 100, cy, 5), null, 'dead chickens are not hittable');
  assert.equal(target.getLifeState(), 'dying');
  assert.equal(target.isPerceptionTarget(), true, 'corpses stay perceivable while they slide');
  const map = dryMap();
  for (let frame = 0; frame < 12; frame++) target.update(1 / 60, idleInput, map);
  assert.equal(target.getLifeState(), 'removed');
  const finished = target.consumeDeathFinished();
  assert.ok(finished, 'death completion is reported once');
  assert.ok(Math.abs(finished.x - (target.x + Chicken.SIZE / 2)) < 1e-9);
  assert.ok(Math.abs(finished.y - (target.y + Chicken.SIZE / 2)) < 1e-9);
  assert.equal(target.consumeDeathFinished(), null);
});

test('the chicken shadow is cast away from the light and remains culled off screen', () => {
  const calls = [];
  const coordinates = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    fillStyle: '',
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    translate(x, y) { coordinates.push(x, y); },
    rotate(angle) { coordinates.push(angle); },
    beginPath() {},
    moveTo(x, y) { coordinates.push(x, y); },
    lineTo(x, y) { coordinates.push(x, y); },
    quadraticCurveTo(x, y, x2, y2) { coordinates.push(x, y, x2, y2); },
    closePath() {},
    ellipse() {},
    fill() { calls.push('fill'); },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const chicken = new Chicken(500, 300, seededRandom(1));
  chicken.drawShadow(ctx, 0, 0, { x: 100, y: 300 });
  assert.ok(calls.filter(call => call === 'fill').length >= 2);
  assert.equal(calls.filter(call => call === 'save').length, calls.filter(call => call === 'restore').length);
  assert.ok(coordinates.length > 0 && coordinates.every(Number.isFinite));

  const count = calls.length;
  chicken.drawShadow(ctx, 1000, 1000, { x: 0, y: 0 });
  assert.equal(calls.length, count, 'off-screen shadow is culled');
  const dead = new Chicken(500, 300, seededRandom(3));
  dead.takeDamage(1000);
  const beforeDyingShadow = calls.length;
  dead.drawShadow(ctx, 0, 0, { x: 0, y: 0 });
  assert.ok(calls.length > beforeDyingShadow, 'dying corpses keep their ground shadow');

  const map = dryMap();
  for (let frame = 0; frame < 12; frame++) dead.update(1 / 60, idleInput, map);
  assert.equal(dead.getLifeState(), 'removed');
  const afterRemoval = calls.length;
  dead.drawShadow(ctx, 0, 0, { x: 0, y: 0 });
  assert.equal(calls.length, afterRemoval, 'removed corpses cast no shadow');
});

test('drawing culls off-screen chickens and paints finite low-poly facets', () => {
  const calls = [];
  const coordinates = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    fillStyle: '',
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    translate(x, y) { coordinates.push(x, y); },
    rotate() {},
    scale() {},
    beginPath() {},
    moveTo(x, y) { coordinates.push(x, y); },
    lineTo(x, y) { coordinates.push(x, y); },
    closePath() {},
    fill() { calls.push('fill'); },
    ellipse() {},
    arc(x, y, radius) { coordinates.push(x, y, radius); },
  };
  const chicken = new Chicken(100, 100, seededRandom(1));
  chicken.draw(ctx, 1000, 1000);
  assert.deepEqual(calls, [], 'off-screen chickens are not drawn');

  chicken.x = 500;
  chicken.y = 300;
  chicken.draw(ctx, 0, 0);
  assert.ok(calls.filter(call => call === 'fill').length >= 12, 'body, head and features are filled');
  assert.equal(calls.filter(call => call === 'save').length, calls.filter(call => call === 'restore').length);
  assert.ok(coordinates.length > 0 && coordinates.every(Number.isFinite));

  const dying = new Chicken(500, 300, seededRandom(2));
  dying.takeDamage(1000);
  const fillsBeforeDying = calls.filter(call => call === 'fill').length;
  dying.draw(ctx, 0, 0);
  assert.ok(calls.filter(call => call === 'fill').length > fillsBeforeDying, 'dying corpses are still painted');

  const map = dryMap();
  for (let frame = 0; frame < 12; frame++) dying.update(1 / 60, idleInput, map);
  assert.equal(dying.getLifeState(), 'removed');
  const beforeRemoved = calls.length;
  dying.draw(ctx, 0, 0);
  assert.equal(calls.length, beforeRemoved, 'removed chickens are no longer painted');
});
