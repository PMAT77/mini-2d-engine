import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  BloodStainSystem, BLOOD_HOLD_SECONDS, BLOOD_FADE_SECONDS, BLOOD_MIN_RADIUS, BLOOD_MAX_RADIUS,
} = load('objects/BloodStainSystem');
const { Chicken } = load('objects/Chicken');
const { MeatPickup } = load('objects/MeatPickup');
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const idle = { isKeyDown: () => false, isBlocked: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const ground = (width = 64, height = 32) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const seeded = (seed = 1) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

test('blood only lands on dry walkable ground and shrinks to fit beside walls', () => {
  const map = ground();
  const blood = new BloodStainSystem(() => 1);
  assert.equal(blood.spawn(225, 225, map), true);
  assert.equal(blood.getActiveCount(), 1);
  const stain = blood.getStains()[0];
  assert.ok(stain.radius >= BLOOD_MIN_RADIUS && stain.radius <= BLOOD_MAX_RADIUS);
  assert.ok(stain.blobs >= 4 && stain.blobs <= 7);
  assert.equal(stain.alpha, 1);

  const water = ground();
  water.tiles.forEach(row => row.fill('water'));
  assert.equal(new BloodStainSystem(() => 1).spawn(225, 225, water), false);

  const wall = ground();
  wall.tiles[4][4] = 'wall';
  assert.equal(new BloodStainSystem(() => 1).spawn(225, 225, wall), false);

  const mineral = ground();
  mineral.tiles[4][4] = 'mineral';
  mineral.tileHp[4][4] = 100;
  assert.equal(new BloodStainSystem(() => 1).spawn(225, 225, mineral), false);

  assert.equal(new BloodStainSystem(() => 1).spawn(-1, 225, ground()), false);
  assert.equal(new BloodStainSystem(() => 1).spawn(NaN, 225, ground()), false);

  // 离墙 15 像素：随机到的最大半径必须缩小，血迹不能压到墙顶。
  const fitted = new BloodStainSystem(() => 1);
  assert.equal(fitted.spawn(185, 225, wall), true);
  assert.ok(fitted.getStains()[0].radius >= BLOOD_MIN_RADIUS);
  assert.ok(fitted.getStains()[0].radius < BLOOD_MAX_RADIUS);
  // 离墙 4 像素：连最小半径都放不下。
  assert.equal(new BloodStainSystem(() => 1).spawn(196, 225, wall), false);
});

test('blood holds for four seconds, then fades smoothly and expires', () => {
  const blood = new BloodStainSystem(() => .5);
  assert.equal(blood.spawn(225, 225, ground()), true);
  blood.update(BLOOD_HOLD_SECONDS - .01);
  assert.equal(blood.getStains()[0].alpha, 1);
  blood.update(.02);
  assert.ok(blood.getStains()[0].alpha < 1);
  blood.update(BLOOD_FADE_SECONDS / 2 - .01);
  near(blood.getStains()[0].alpha, .5, 1e-3);
  blood.update(BLOOD_FADE_SECONDS);
  assert.equal(blood.getActiveCount(), 0);

  const stable = new BloodStainSystem(() => .5);
  stable.spawn(225, 225, ground());
  for (const delta of [-1, 0, NaN, Infinity]) stable.update(delta);
  assert.equal(stable.getActiveCount(), 1);
  assert.equal(stable.getStains()[0].alpha, 1);
});

test('stain size and splatter layout vary within their bounds', () => {
  const blood = new BloodStainSystem(seeded());
  const map = ground();
  for (let i = 0; i < 40; i++) assert.equal(blood.spawn(225, 225, map), true);
  const views = blood.getStains();
  const radii = views.map(view => view.radius);
  assert.ok(Math.min(...radii) < Math.max(...radii), 'stain size must vary');
  assert.ok(radii.every(radius => radius >= BLOOD_MIN_RADIUS && radius <= BLOOD_MAX_RADIUS));
  assert.ok(views.some(view => view.blobs > 4) && views.some(view => view.blobs < 7));
});

const alphaOf = color => parseFloat(color.slice(color.lastIndexOf(',') + 1));

test('drawing applies the fade alpha, keeps a visible rim, never strokes, and culls offscreen stains', () => {
  const blood = new BloodStainSystem(() => .5);
  blood.spawn(225, 225, ground());
  blood.update(BLOOD_HOLD_SECONDS + BLOOD_FADE_SECONDS / 2);
  const calls = [];
  const stops = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    fill() { calls.push('fill'); },
    stroke() { calls.push('stroke'); },
    createRadialGradient() { return { addColorStop(offset, color) { stops.push({ offset, color }); } }; },
  };
  blood.draw(ctx, 0, 0, 800, 600);
  assert.ok(calls.includes('fill'));
  assert.ok(!calls.includes('stroke'), 'blood must not draw an outlined edge');
  assert.ok(ctx.globalAlpha > 0 && ctx.globalAlpha < 1);

  // 肉块会压在血迹正中：渐变靠边必须留下一圈看得见的血，不能一路淡到零。
  const rim = stops.find(stop => stop.offset >= 0.8 && stop.offset < 1);
  assert.ok(rim, 'gradient keeps a stop near the rim');
  assert.ok(alphaOf(rim.color) >= 0.25, 'rim keeps some opacity');
  assert.equal(alphaOf(stops.find(stop => stop.offset === 1).color), 0);

  calls.length = 0;
  blood.draw(ctx, 5000, 5000, 800, 600);
  assert.deepEqual(calls, []);
});

test('even the smallest blood pool is wider than the meat chunk dropped on it', () => {
  assert.ok(BLOOD_MIN_RADIUS * 2 > MeatPickup.SIZE,
    `pool diameter ${BLOOD_MIN_RADIUS * 2} must exceed meat size ${MeatPickup.SIZE}`);
});

test('blood under an uncollected meat chunk stays until the chunk is gone', () => {
  const blood = new BloodStainSystem(() => .5);
  const release = blood.spawnSustained(225, 225, ground());
  assert.ok(release, 'a sustained splatter reports how to release it');

  // 肉块一直没捡：远超正常寿命后血迹仍原样留在原地。
  for (let second = 0; second < 60; second++) blood.update(1);
  assert.equal(blood.getActiveCount(), 1);
  assert.equal(blood.getStains()[0].alpha, 1);

  // 肉块被捡走后才重新开始 4 秒保留，再平滑淡出。
  release();
  blood.update(BLOOD_HOLD_SECONDS - .01);
  assert.equal(blood.getStains()[0].alpha, 1);
  blood.update(.02);
  assert.ok(blood.getStains()[0].alpha < 1);
  blood.update(BLOOD_FADE_SECONDS);
  assert.equal(blood.getActiveCount(), 0);
});

test('a chicken death leaves blood under the corpse until the meat chunk is picked up', () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.loaded = true;
  scene.map = ground();
  scene.player.x = 500;
  scene.player.y = 500;
  scene.player.applyConfig({ shooting: {
    spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0,
  } });

  const chicken = new Chicken(700, 500, seededRandom(1));
  chicken.walking = false;
  chicken.velocity.set(0, 0);
  chicken.timer = 999;
  scene.chickens = [chicken];
  const cx = chicken.x + Chicken.SIZE / 2, cy = chicken.y + Chicken.SIZE / 2;
  scene.player.shootAt({ x: cx, y: cy }, 1000, scene.map);

  for (let frame = 0; frame < 40 && scene.chickens.length > 0; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.chickens.length, 0, 'the corpse is removed after the death slide');
  const blood = scene.bloodStainSystem;
  assert.equal(blood.getActiveCount(), 1, 'one splatter is left under the corpse');

  const stain = blood.getStains()[0];
  // 血迹跟着尸体收尾位置，而不是死亡当帧的位置：尸体滑行后血迹会偏开一段。
  assert.ok(Math.hypot(stain.x - cx, stain.y - cy) > 1e-6, 'blood marks the final resting place');
  assert.ok(Math.hypot(stain.x - cx, stain.y - cy) < 120);

  for (let frame = 0; frame < 60 * (BLOOD_HOLD_SECONDS - 0.5); frame++) scene.update(1 / 60, idle);
  assert.equal(blood.getActiveCount(), 1, 'blood still marks the spot while the meat lies there');
  assert.equal(blood.getStains()[0].alpha, 1);

  // 肉块一直没捡，血迹就该一直在：远超 4＋1.6 秒也不消失。
  for (let frame = 0; frame < 60 * 4; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.meatPickups.length, 1, 'the chunk is still waiting on the ground');
  assert.equal(blood.getActiveCount(), 1, 'blood waits with the uncollected chunk');
  assert.equal(blood.getStains()[0].alpha, 1);

  // 捡走肉块（按键交互本身由拾取系统的单测覆盖），血迹这时才开始正常的保留与淡出。
  const meat = scene.meatPickups[0];
  scene.collectMeatPickup(meat);
  assert.equal(scene.meatPickups.length, 0, 'the chunk is collected');
  scene.update(1 / 60, idle);
  assert.equal(blood.getActiveCount(), 1, 'the blood is released, not dropped');
  assert.equal(blood.getStains()[0].alpha, 1);

  for (let frame = 0; frame < 60 * (BLOOD_HOLD_SECONDS - 0.5); frame++) scene.update(1 / 60, idle);
  assert.equal(blood.getStains()[0].alpha, 1, 'the hold restarts after the pickup');
  for (let frame = 0; frame < 60 * (BLOOD_FADE_SECONDS + 1); frame++) scene.update(1 / 60, idle);
  assert.equal(blood.getActiveCount(), 0, 'blood fades out once the chunk is gone');
});
