import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  CraterSystem, CRATER_HOLD_SECONDS, CRATER_FADE_SECONDS, CRATER_MIN_RADIUS, CRATER_MAX_RADIUS,
} = load('objects/CraterSystem');
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const { ParticleSystem } = load('objects/ParticleSystem');
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const ground = (width = 64, height = 32) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const seeded = (seed = 1) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const noSpread = { shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } };
const idle = { isKeyDown: () => false };

test('craters spawn only on dry ground and shrink to fit beside walls', () => {
  const map = ground();
  const craters = new CraterSystem(() => 1);
  assert.equal(craters.spawn(225, 225, map), true);
  assert.equal(craters.getActiveCount(), 1);
  const crater = craters.getCraters()[0];
  assert.ok(crater.radius >= CRATER_MIN_RADIUS && crater.radius <= CRATER_MAX_RADIUS);
  assert.equal(crater.alpha, 1);

  const water = ground();
  water.tiles.forEach(row => row.fill('water'));
  assert.equal(new CraterSystem(() => 1).spawn(225, 225, water), false);

  const wall = ground();
  wall.tiles[4][4] = 'wall';
  assert.equal(new CraterSystem(() => 1).spawn(225, 225, wall), false);

  const mineral = ground();
  mineral.tiles[4][4] = 'mineral';
  mineral.tileHp[4][4] = 100;
  assert.equal(new CraterSystem(() => 1).spawn(225, 225, mineral), false);

  assert.equal(new CraterSystem(() => 1).spawn(-1, 225, ground()), false);
  assert.equal(new CraterSystem(() => 1).spawn(64 * 50 + 1, 225, ground()), false);

  // 7 px from the wall: the random 5 px radius must shrink, not paint over the wall.
  const fitted = new CraterSystem(() => 1);
  assert.equal(fitted.spawn(193, 225, wall), true);
  assert.ok(fitted.getCraters()[0].radius < CRATER_MAX_RADIUS);
  // 5 px from the wall: even the minimum size cannot fit.
  assert.equal(new CraterSystem(() => 1).spawn(195, 225, wall), false);
});

test('craters stay opaque for three seconds, then fade smoothly and expire', () => {
  const craters = new CraterSystem(() => .5);
  assert.equal(craters.spawn(225, 225, ground()), true);
  craters.update(CRATER_HOLD_SECONDS - .01);
  assert.equal(craters.getCraters()[0].alpha, 1);
  craters.update(.02);
  assert.ok(craters.getCraters()[0].alpha < 1);
  craters.update(CRATER_FADE_SECONDS / 2 - .01);
  near(craters.getCraters()[0].alpha, .5, 1e-3);
  craters.update(CRATER_FADE_SECONDS);
  assert.equal(craters.getActiveCount(), 0);

  const stable = new CraterSystem(() => .5);
  stable.spawn(225, 225, ground());
  for (const delta of [-1, 0, NaN, Infinity]) stable.update(delta);
  assert.equal(stable.getActiveCount(), 1);
  assert.equal(stable.getCraters()[0].alpha, 1);
});

test('crater size, depth and shape vary within their bounds', () => {
  const craters = new CraterSystem(seeded());
  const map = ground();
  for (let i = 0; i < 40; i++) assert.equal(craters.spawn(225, 225, map), true);
  const views = craters.getCraters();
  const radii = views.map(view => view.radius), depths = views.map(view => view.depth);
  assert.ok(Math.min(...radii) < Math.max(...radii));
  assert.ok(Math.min(...depths) < Math.max(...depths));
  assert.ok(views.some(view => view.shape === 'circle'));
  assert.ok(views.some(view => view.shape === 'irregular'));
  assert.ok(radii.every(radius => radius >= CRATER_MIN_RADIUS && radius <= CRATER_MAX_RADIUS));
  assert.ok(depths.every(depth => depth >= .3 && depth <= 1));
});

test('drawing applies the fade alpha and culls craters outside the viewport', () => {
  const craters = new CraterSystem(() => .5);
  craters.spawn(225, 225, ground());
  craters.update(CRATER_HOLD_SECONDS + CRATER_FADE_SECONDS / 2);
  const calls = [];
  const gradient = { addColorStop() {} };
  const ctx = {
    globalAlpha: 1,
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    fill() { calls.push('fill'); },
    stroke() { calls.push('stroke'); },
    createRadialGradient() { return gradient; },
  };
  craters.draw(ctx, 0, 0, 800, 600);
  assert.ok(calls.includes('fill'));
  assert.ok(!calls.includes('stroke'), 'craters must not draw an outlined edge');
  assert.ok(ctx.globalAlpha > 0 && ctx.globalAlpha < 1);

  calls.length = 0;
  craters.draw(ctx, 5000, 5000, 800, 600);
  assert.deepEqual(calls, []);
});

test('player shots create craters only when they naturally land on dry ground', () => {
  const map = ground();
  const player = new Player(200.5, 200.5, undefined, new ParticleSystem());
  player.applyConfig(noSpread);
  player.update(0, idle, map);
  const craters = new CraterSystem(() => .5);
  player.setOnBulletLanded((x, y) => craters.spawn(x, y, map));
  player.shootAt({ x: 725, y: 225 });
  const bullet = player.getBullets()[0];
  bullet.update(10, map);
  assert.equal(bullet.getIsDestroyed(), true);
  assert.equal(craters.getActiveCount(), 1);
  near(craters.getCraters()[0].x, 725);
  near(craters.getCraters()[0].y, 225);

  const water = ground();
  water.tiles.forEach(row => row.fill('water'));
  const wet = new Player(200.5, 200.5, undefined, new ParticleSystem());
  wet.applyConfig(noSpread);
  wet.update(0, idle, water);
  const wetCraters = new CraterSystem(() => .5);
  wet.setOnBulletLanded((x, y) => wetCraters.spawn(x, y, water));
  wet.shootAt({ x: 725, y: 225 });
  wet.getBullets()[0].update(10, water);
  assert.equal(wetCraters.getActiveCount(), 0);

  const wall = ground();
  wall.tiles[4][6] = 'wall';
  const blocked = new Player(200.5, 200.5, undefined, new ParticleSystem());
  blocked.applyConfig(noSpread);
  blocked.update(0, idle, wall);
  const wallCraters = new CraterSystem(() => .5);
  blocked.setOnBulletLanded((x, y) => wallCraters.spawn(x, y, wall));
  blocked.shootAt({ x: 900, y: 225 });
  blocked.getBullets()[0].update(10, wall);
  assert.equal(wallCraters.getActiveCount(), 0);
});
