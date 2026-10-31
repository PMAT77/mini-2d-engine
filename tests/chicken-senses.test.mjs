import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Chicken } = load('objects/Chicken');
const { TileMap } = load('map/TileMap');
const { NoiseSystem } = load('core/NoiseSystem');
const { seededRandom } = load('map/WaterTerrain');

globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const idle = { isKeyDown: () => false };
const dryMap = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const centerOf = chicken => ({ x: chicken.x + Chicken.SIZE / 2, y: chicken.y + Chicken.SIZE / 2 });
const sensesFor = (targetX, targetY, extras = {}) => ({
  targetX, targetY,
  lights: [],
  noiseEvents: [],
  soundSourceId: 'chicken-1',
  ...extras,
});

test('玩家站在近身范围内，小鸡确认后只尖叫一次并加速逃跑', () => {
  const map = dryMap();
  const chicken = new Chicken(500, 500, seededRandom(1));
  chicken.timer = 999;
  const start = centerOf(chicken);
  const senses = sensesFor(start.x + 50, start.y);

  let screams = 0;
  chicken.setOnCluckCallback(() => { screams += 1; });

  let maxSpeed = 0;
  let sawFlee = false;
  for (let frame = 0; frame < 90; frame++) {
    chicken.update(1 / 60, idle, map, senses);
    maxSpeed = Math.max(maxSpeed, chicken.velocity.length());
    if (chicken.getAlertState() === 'flee') sawFlee = true;
  }

  assert.equal(screams, 1, '一次发现只播放一次惊叫');
  assert.equal(sawFlee, true, '确认威胁后应进入逃跑');
  assert.ok(maxSpeed > 100, `逃跑速度应明显高于漫游，实际 ${maxSpeed}`);
  const end = centerOf(chicken);
  assert.ok(Math.hypot(end.x - start.x, end.y - start.y) > 40, '小鸡应确实离开了原位');
});

test('墙体挡住视线时，近处的玩家不会凭空惊动小鸡', () => {
  const map = dryMap(40, 30);
  for (let y = 0; y < 30; y++) map.tiles[y][12] = 'wall';
  const chicken = new Chicken(500, 500, seededRandom(2));
  chicken.timer = 999;
  const start = centerOf(chicken);
  const senses = sensesFor(start.x + 110, start.y);

  for (let frame = 0; frame < 60; frame++) chicken.update(1 / 60, idle, map, senses);

  assert.equal(chicken.getAlertState(), 'wander');
});

test('墙后的枪声仍能被听见并触发警觉', () => {
  const map = dryMap(40, 30);
  for (let y = 0; y < 30; y++) map.tiles[y][12] = 'wall';
  const chicken = new Chicken(500, 500, seededRandom(3));
  chicken.timer = 999;
  const start = centerOf(chicken);
  const noise = new NoiseSystem();
  noise.emit('gunshot', start.x + 120, start.y, { sourceId: 'player' });
  const senses = sensesFor(5000, 5000, { noiseEvents: noise.getEvents() });

  for (let frame = 0; frame < 30; frame++) chicken.update(1 / 60, idle, map, senses);

  assert.notEqual(chicken.getAlertState(), 'wander');
});

test('鸡叫不进入小鸡听觉，避免一只鸡带着整群连锁惊逃', () => {
  const map = dryMap();
  const chicken = new Chicken(500, 500, seededRandom(4));
  chicken.timer = 999;
  const start = centerOf(chicken);
  const noise = new NoiseSystem();
  noise.emit('cluck', start.x + 40, start.y, { sourceId: 'chicken-1', radius: 450 });
  noise.emit('cluck', start.x + 40, start.y, { sourceId: 'chicken-2', radius: 450 });
  const senses = sensesFor(5000, 5000, { noiseEvents: noise.getEvents() });

  for (let frame = 0; frame < 60; frame++) chicken.update(1 / 60, idle, map, senses);

  assert.equal(chicken.getAlertState(), 'wander');
});
