import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  FootprintSystem, FOOTPRINT_DRY_SECONDS, FOOTPRINT_WET_SECONDS,
  FOOTPRINT_DRY_ALPHA, FOOTPRINT_SIDE_OFFSET, FOOTPRINT_MAX_COUNT,
} = load('objects/FootprintSystem');
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b} (±${epsilon})`);
const input = (...keys) => ({ isKeyDown: key => keys.includes(key) });
const idle = input();
const dry = (width = 64, height = 32) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const advance = (player, seconds, keys, map, fps = 60) => {
  for (let left = seconds; left > 1e-9;) {
    const delta = Math.min(left, 1 / fps);
    player.update(delta, keys, map);
    left -= delta;
  }
};
const wetFirst = map => {
  const player = new Player(450, 300);
  const footprints = new FootprintSystem(() => 0.5);
  player.setOnFootstepCallback(step => footprints.spawn(step, map));
  advance(player, 3, input('d'), map);
  return footprints.getFootprints();
};

test('footprints alternate sides along the path and only land on dry walkable ground', () => {
  const map = dry();
  const footprints = new FootprintSystem(() => 0.5);
  for (let i = 0; i < 4; i++) {
    assert.equal(footprints.spawn({ x: 200 + i * 100, y: 300, angle: 0, wetness: 0 }, map), true);
  }
  const views = footprints.getFootprints();
  assert.equal(views.length, 4);
  assert.deepEqual(views.map(view => Math.sign(view.y - 300)), [1, -1, 1, -1]);
  for (const view of views) near(Math.abs(view.y - 300), FOOTPRINT_SIDE_OFFSET, 1e-9);
  near(views[0].x, 200, 1e-9);

  const water = dry();
  water.tiles.forEach(row => row.fill('shallow_water'));
  assert.equal(new FootprintSystem(() => 0.5).spawn({ x: 300, y: 300, angle: 0, wetness: 0 }, water), false);

  const wall = dry();
  wall.tiles[6][6] = 'wall';
  assert.equal(new FootprintSystem(() => 0.5).spawn({ x: 325, y: 325, angle: 0, wetness: 0 }, wall), false);

  const mineral = dry();
  mineral.tiles[6][6] = 'mineral';
  mineral.tileHp[6][6] = 100;
  assert.equal(new FootprintSystem(() => 0.5).spawn({ x: 325, y: 325, angle: 0, wetness: 0 }, mineral), false);

  const offMap = new FootprintSystem(() => 0.5);
  assert.equal(offMap.spawn({ x: -10, y: 300, angle: 0, wetness: 0 }, dry()), false);
  assert.equal(offMap.spawn({ x: 64 * 50 + 10, y: 300, angle: 0, wetness: 0 }, dry()), false);
  assert.equal(offMap.spawn({ x: NaN, y: 300, angle: 0, wetness: 0 }, dry()), false);
  assert.equal(offMap.spawn({ x: 300, y: 300, angle: 0, wetness: NaN }, dry()), false);

  const blocked = dry();
  blocked.tiles[6][6] = 'wall';
  const failed = new FootprintSystem(() => 0.5);
  assert.equal(failed.spawn({ x: 325, y: 325, angle: 0, wetness: 0 }, blocked), false);
  assert.equal(failed.spawn({ x: 200, y: 300, angle: 0, wetness: 0 }, blocked), true);
  // 失败的那枚不换脚：第一枚成功脚印仍以 +1 侧落下。
  near(failed.getFootprints()[0].y, 300 + FOOTPRINT_SIDE_OFFSET, 1e-9);
});

test('wet footprints start deeper, grow larger and outlive dry ones; fading is bounded', () => {
  const map = dry();
  const footprints = new FootprintSystem(() => 0.5);
  assert.equal(footprints.spawn({ x: 300, y: 300, angle: 0, wetness: 0 }, map), true);
  assert.equal(footprints.spawn({ x: 500, y: 300, angle: 0, wetness: 1 }, map), true);
  const [dryView, wetView] = footprints.getFootprints();
  assert.ok(wetView.alpha > dryView.alpha);
  assert.ok(wetView.length > dryView.length);
  assert.ok(wetView.width > dryView.width);
  near(dryView.alpha, FOOTPRINT_DRY_ALPHA);
  near(dryView.maxLife, FOOTPRINT_DRY_SECONDS);
  near(wetView.maxLife, FOOTPRINT_WET_SECONDS);

  footprints.update(FOOTPRINT_DRY_SECONDS + 0.01);
  assert.equal(footprints.getActiveCount(), 1);
  assert.equal(footprints.getFootprints()[0].wetness, 1);
  footprints.update(FOOTPRINT_WET_SECONDS - FOOTPRINT_DRY_SECONDS);
  assert.equal(footprints.getActiveCount(), 0);

  const fading = new FootprintSystem(() => 0.5);
  fading.spawn({ x: 300, y: 300, angle: 0, wetness: 0 }, map);
  near(fading.getFootprints()[0].alpha, FOOTPRINT_DRY_ALPHA);
  fading.update(FOOTPRINT_DRY_SECONDS / 2);
  const half = fading.getFootprints()[0].alpha;
  assert.ok(half > 0 && half < FOOTPRINT_DRY_ALPHA);

  const stable = new FootprintSystem(() => 0.5);
  stable.spawn({ x: 300, y: 300, angle: 0, wetness: 0 }, map);
  for (const delta of [-1, 0, NaN, Infinity]) stable.update(delta);
  assert.equal(stable.getActiveCount(), 1);
  near(stable.getFootprints()[0].alpha, FOOTPRINT_DRY_ALPHA);

  const capped = new FootprintSystem(() => 0.5);
  for (let i = 0; i < FOOTPRINT_MAX_COUNT + 40; i++) {
    assert.equal(capped.spawn({ x: 300, y: 300, angle: 0, wetness: 0 }, map), true);
  }
  assert.equal(capped.getActiveCount(), FOOTPRINT_MAX_COUNT);
});

test('drawing uses current alpha, neutral colors and culls off-screen footprints', () => {
  const makeContext = () => {
    const calls = [], alphas = [], colors = [];
    const ctx = {
      globalAlpha: 1, fillStyle: '',
      save() { calls.push('save'); },
      restore() { calls.push('restore'); },
      beginPath() { calls.push('beginPath'); },
      ellipse() { calls.push('ellipse'); },
      fill() { calls.push('fill'); alphas.push(this.globalAlpha); colors.push(this.fillStyle); },
    };
    return { ctx, calls, alphas, colors };
  };
  const map = dry();

  const drySystem = new FootprintSystem(() => 0.5);
  drySystem.spawn({ x: 300, y: 300, angle: 0, wetness: 0 }, map);
  const first = makeContext();
  drySystem.draw(first.ctx, 0, 0, 800, 600);
  assert.equal(first.alphas.length, 1);
  near(first.alphas[0], FOOTPRINT_DRY_ALPHA);
  assert.equal(first.colors[0], '#ffffff');
  assert.deepEqual(first.calls.filter(call => call === 'ellipse').length, 2);

  drySystem.update(FOOTPRINT_DRY_SECONDS / 2);
  const faded = makeContext();
  drySystem.draw(faded.ctx, 0, 0, 800, 600);
  assert.ok(faded.alphas[0] > 0 && faded.alphas[0] < FOOTPRINT_DRY_ALPHA);

  const culled = makeContext();
  drySystem.draw(culled.ctx, 5000, 5000, 800, 600);
  assert.ok(!culled.calls.includes('fill'));
  assert.ok(!culled.calls.includes('ellipse'));
  assert.deepEqual(culled.calls, ['save', 'restore']);

  const wetSystem = new FootprintSystem(() => 0.5);
  wetSystem.spawn({ x: 300, y: 300, angle: 0, wetness: 1 }, map);
  const wet = makeContext();
  wetSystem.draw(wet.ctx, 0, 0, 800, 600);
  assert.equal(wet.colors[0], '#e6f7ff');
});

test('player emits one step every 26px only while moving with input', () => {
  const map = dry();
  const player = new Player(200, 200);
  player.update(0, idle, map);
  const steps = [];
  player.setOnFootstepCallback(step => steps.push(step));
  advance(player, 1, input('d'), map);
  assert.ok(steps.length >= 5, `expected at least 5 steps, got ${steps.length}`);
  for (let i = 1; i < steps.length; i++) {
    near(Math.hypot(steps[i].x - steps[i - 1].x, steps[i].y - steps[i - 1].y), 26, 0.001);
  }
  assert.ok(steps.every(step => step.wetness === 0));

  const still = new Player(200, 200);
  const idleSteps = [];
  still.setOnFootstepCallback(step => idleSteps.push(step));
  advance(still, 0.5, idle, map);
  assert.equal(idleSteps.length, 0);

  const walls = dry();
  walls.tiles.forEach(row => row.fill('wall'));
  const blockedPlayer = new Player(200, 200);
  blockedPlayer.update(0, idle, walls);
  const blockedSteps = [];
  blockedPlayer.setOnFootstepCallback(step => blockedSteps.push(step));
  advance(blockedPlayer, 0.5, input('d'), walls);
  assert.equal(blockedSteps.length, 0);
});

test('steps leaving water are wet for 1.5s, scale with depth and never draw in water', () => {
  const strip = type => {
    const map = dry();
    map.tiles.forEach(row => { for (let col = 4; col < 10; col++) row[col] = type; });
    return map;
  };
  const shallow = strip('shallow_water');
  const deep = strip('deep_water');
  const shallowViews = wetFirst(shallow);
  const deepViews = wetFirst(deep);

  assert.ok(shallowViews.length >= 5, `shallow prints: ${shallowViews.length}`);
  assert.ok(deepViews.length >= 5, `deep prints: ${deepViews.length}`);

  const water = new Set(['shallow_water', 'water', 'deep_water', 'ultra_deep_water']);
  for (const [map, views] of [[shallow, shallowViews], [deep, deepViews]]) {
    for (const view of views) {
      const col = Math.floor(view.x / 50), row = Math.floor(view.y / 50);
      assert.ok(!water.has(map.tiles[row][col]), `footprint at ${view.x},${view.y} is in water`);
    }
  }

  near(shallowViews[0].wetness, 0.35);
  near(deepViews[0].wetness, 1);
  assert.ok(deepViews[0].wetness > shallowViews[0].wetness);
  assert.equal(shallowViews.at(-1).wetness, 0);
  assert.equal(deepViews.at(-1).wetness, 0);
});
