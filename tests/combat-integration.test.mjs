import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { KnockbackMotion } = load('combat/KnockbackMotion');
const {
  createKnockbackProfile,
  computeKnockbackSpeed,
  computeHitIntensity,
} = load('combat/KnockbackProfiles');
const { circleCollider } = load('physics/Collider');
const { Chicken } = load('objects/Chicken');
const { MeatPickup } = load('objects/MeatPickup');
const { TileMap } = load('map/TileMap');
const { GameScene } = load('scenes/GameScene');
const { seededRandom } = load('map/WaterTerrain');
const idle = { isKeyDown: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const dryMap = (width = 60, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

const impact = (overrides = {}) => Object.freeze({
  damage: 10,
  point: Object.freeze({ x: 0, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
  impulse: 280,
  impactSpeed: 2600,
  initialSpeed: 2600,
  traveledDistance: 120,
  source: 'bullet',
  ...overrides,
});

/** 一个最小虚拟敌人：只有位置、直径与圆碰撞体，没有视觉与 AI。 */
const makeHost = (x, y, radius = 11) => {
  const host = {
    x,
    y,
    getSize: () => radius * 2,
    getCollider: () => circleCollider(host.x + radius, host.y + radius, radius),
  };
  return host;
};

const slide = (motion, seconds, frames = 1) => {
  for (let i = 0; i < frames; i++) motion.update(seconds / frames);
};

test('future enemies share one impulse but displace by their own mass and resistance', () => {
  const map = dryMap();
  const light = makeHost(300, 300);
  const heavy = makeHost(300, 400);
  const lightMotion = new KnockbackMotion(light, map, createKnockbackProfile());
  const heavyMotion = new KnockbackMotion(heavy, map, createKnockbackProfile({ mass: 6 }));

  assert.equal(lightMotion.addImpact(impact()), 280);
  assert.equal(heavyMotion.addImpact(impact()), 280 / 6);
  // 取 0.15 秒：两者都还在 stopSpeed 之上，位移比才等于质量比。
  slide(lightMotion, 0.15);
  slide(heavyMotion, 0.15);

  const lightDistance = light.x - 300;
  const heavyDistance = heavy.x - 300;
  assert.ok(Math.abs(lightDistance - 26.0) < 0.2, `light ${lightDistance}`);
  assert.ok(Math.abs(heavyDistance - 4.33) < 0.05, `heavy ${heavyDistance}`);
  assert.ok(Math.abs(lightDistance / heavyDistance - 6) < 0.05, 'same impact, six times the mass, one sixth the slide before the stop threshold');

  // 抗性只影响位移，不影响这次命中的数据本身。
  const resistant = makeHost(300, 200);
  const resistantMotion = new KnockbackMotion(resistant, map, createKnockbackProfile({ resistance: 0.5 }));
  assert.equal(resistantMotion.addImpact(impact()), 140);
  slide(resistantMotion, 0.15);
  assert.ok(Math.abs((resistant.x - 300) - 13.0) < 0.1);
});

test('maxSpeed clamps the slide and immune targets still receive a pose intensity', () => {
  const map = dryMap();
  const clamped = makeHost(300, 300);
  const clampedMotion = new KnockbackMotion(clamped, map, createKnockbackProfile());
  assert.equal(clampedMotion.addImpact(impact({ impulse: 100000 })), 360, 'impulse is clamped to maxSpeed');
  slide(clampedMotion, 0.3);
  assert.ok(clamped.x - 300 < 52);

  const immune = makeHost(300, 200);
  const immuneProfile = createKnockbackProfile({ immuneToDisplacement: true });
  const immuneMotion = new KnockbackMotion(immune, map, immuneProfile);
  assert.equal(computeKnockbackSpeed(impact(), immuneProfile), 0);
  assert.equal(immuneMotion.addImpact(impact()), 0);
  assert.equal(immuneMotion.isActive(), false);
  slide(immuneMotion, 0.5);
  assert.equal(immune.x, 300, 'immuneToDisplacement never moves the world position');
  assert.equal(immune.y, 200);
  const intensity = computeHitIntensity(impact(), immuneProfile, 0);
  assert.ok(intensity > 0.4 && intensity < 0.6, `immune targets still get a hit pose, got ${intensity}`);
});

test('invalid or oversized deltas never move the target outside its bounded slide', () => {
  const map = dryMap();
  const host = makeHost(300, 300);
  const motion = new KnockbackMotion(host, map, createKnockbackProfile());
  motion.addImpact(impact());
  for (const delta of [Number.NaN, -1, Number.POSITIVE_INFINITY, 0]) {
    const before = host.x;
    motion.update(delta);
    assert.ok(Number.isFinite(host.x));
    if (delta === 0) assert.equal(host.x, before);
  }
  // 一次超长 delta 会被截断到 0.5s，位移不超过解析上限。
  motion.update(10);
  assert.ok(Number.isFinite(host.x));
  assert.ok(host.x - 300 < 40, 'the slide is bounded by stopSpeed and max delta');
});

test('30, 60 and 144 FPS produce the same corpse endpoint', () => {
  const map = dryMap();
  const corpses = [30, 60, 144].map(() => {
    const chicken = new Chicken(300, 300, seededRandom(7));
    chicken.receiveHit(impact(), map);
    return chicken;
  });
  for (let i = 0; i < 30; i++) corpses[0].update(1 / 30, idle, map);
  for (let i = 0; i < 60; i++) corpses[1].update(1 / 60, idle, map);
  for (let i = 0; i < 144; i++) corpses[2].update(1 / 144, idle, map);
  const x = corpses.map(corpse => corpse.x);
  assert.ok(Math.max(...x) - Math.min(...x) < 0.2, `endpoints differ: ${x.join(', ')}`);
});

test('60 Hz and 120 Hz death slides agree at a fixed total time', () => {
  const map = dryMap();
  const sixty = new Chicken(300, 300, seededRandom(3));
  const hundredTwenty = new Chicken(300, 300, seededRandom(3));
  sixty.receiveHit(impact(), map);
  hundredTwenty.receiveHit(impact(), map);
  for (let i = 0; i < 18; i++) sixty.update(1 / 60, idle, map);
  for (let i = 0; i < 36; i++) hundredTwenty.update(1 / 120, idle, map);
  assert.ok(Math.abs(sixty.x - hundredTwenty.x) < 0.05, `${sixty.x} vs ${hundredTwenty.x}`);
  // 0.3 秒时两边都已经滑到收尾距离并结束滑行，端点仍由解析积分保证一致。
  assert.equal(sixty.getLifeState(), 'removed');
  assert.equal(hundredTwenty.getLifeState(), 'removed');
});

test('the death event fires while the corpse is still sliding, and the drop lands with the puff', () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.loaded = true;
  scene.map = dryMap();
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
  let finished = null;
  const consume = chicken.consumeDeathFinished.bind(chicken);
  chicken.consumeDeathFinished = () => {
    const event = consume();
    if (event) finished = event;
    return event;
  };

  const center = { x: chicken.x + Chicken.SIZE / 2, y: chicken.y + Chicken.SIZE / 2 };
  scene.player.shootAt(center, 1000, scene.map);
  let frames = 0;
  while (chicken.getLifeState() === 'alive' && frames < 20) {
    scene.update(1 / 60, idle);
    frames++;
  }
  assert.equal(chicken.getLifeState(), 'dying', 'the bullet must connect within a few frames');
  assert.equal(scene.meatPickups.length, 0, 'the hit frame must not drop meat');
  assert.equal(scene.particleSystem.getPerformanceStats().activeParticles, 0, 'no death puff on the hit frame');
  assert.equal(scene.chickens.length, 1, 'the dying corpse stays in the scene');

  while (scene.chickens.length > 0 && frames < 90) {
    scene.update(1 / 60, idle);
    frames++;
  }
  assert.equal(scene.chickens.length, 0);
  assert.ok(finished, 'the scene must consume exactly one death event');
  // 白雾在收尾距离处就播放，不等阻尼把尸体彻底拖停（彻底停下需要约 0.48 秒）。
  assert.ok(finished.elapsedSeconds >= 0.14, `finished too early: ${finished.elapsedSeconds}`);
  assert.ok(finished.elapsedSeconds < 0.3, `finished too late: ${finished.elapsedSeconds}`);
  assert.ok(Math.abs(finished.x - center.x) > 25, 'the death event follows most of the slide');
  assert.ok(Math.abs(finished.x - center.x) < 38.6, 'the corpse must not finish the whole slide');

  // 白烟与肉块同帧出现：事件帧既要有粒子，也要有肉块，落在同一个收尾位置。
  assert.ok(scene.particleSystem.getPerformanceStats().activeParticles > 0, 'the puff starts on the event frame');
  assert.equal(scene.meatPickups.length, 1, 'the meat drops on the same frame as the puff');
  assert.ok(Math.abs(scene.meatPickups[0].x - (finished.x - MeatPickup.SIZE / 2)) < 1e-9);
  assert.ok(Math.abs(scene.meatPickups[0].y - (finished.y - MeatPickup.SIZE / 2)) < 1e-9);
});
