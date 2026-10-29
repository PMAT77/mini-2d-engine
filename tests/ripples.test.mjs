import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  RippleSystem, RIPPLE_PROBE_RADIUS, RIPPLE_BASE_RADIUS, RIPPLE_RADIUS_PER_DEPTH,
  RIPPLE_BASE_LIFE, RIPPLE_LIFE_PER_DEPTH, RIPPLE_ALPHA, RIPPLE_INNER_RATIO,
  RIPPLE_INNER_ALPHA, RIPPLE_ARC_HALF, RIPPLE_DRIFT_RATIO, RIPPLE_COLOR,
  RIPPLE_LINE_WIDTH, RIPPLE_MAX_COUNT,
} = load('objects/RippleSystem');
const { FootprintSystem, FOOTPRINT_SIDE_OFFSET } = load('objects/FootprintSystem');
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const TAU = Math.PI * 2;
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b} (±${epsilon})`);
const normalize = angle => ((angle % TAU) + TAU) % TAU;
const input = (...keys) => ({ isKeyDown: key => keys.includes(key) });
const dry = (width = 64, height = 32) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const fill = type => {
  const map = dry();
  map.tiles.forEach(row => row.fill(type));
  return map;
};
const strip = type => {
  const map = dry();
  map.tiles.forEach(row => { for (let col = 4; col < 10; col++) row[col] = type; });
  return map;
};
const advance = (player, seconds, keys, map, fps = 60) => {
  for (let left = seconds; left > 1e-9;) {
    const delta = Math.min(left, 1 / fps);
    player.update(delta, keys, map);
    left -= delta;
  }
};

test('ripples only spawn where the whole arc stays on water', () => {
  const water = fill('shallow_water');
  const ripples = new RippleSystem(() => 0.5);
  assert.equal(ripples.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: true }, water), true);
  assert.equal(ripples.getActiveCount(), 1);

  // 步点落在干地、墙、矿石或地图外时不产生涟漪，并保持一步只出现一种效果的语义。
  const land = new RippleSystem(() => 0.5);
  assert.equal(land.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: false }, dry()), false);
  assert.equal(land.spawn({ x: NaN, y: 300, angle: 0, wetness: 0, inWater: true }, water), false);
  assert.equal(land.spawn({ x: 300, y: 300, angle: NaN, wetness: 0, inWater: true }, water), false);
  assert.equal(land.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: true }, new TileMap(64, 32, { generateWater: false })), false);

  const walled = fill('shallow_water');
  walled.tiles[6][6] = 'wall';
  assert.equal(new RippleSystem(() => 0.5).spawn({ x: 325, y: 300, angle: 0, wetness: 0, inWater: true }, walled), false);

  const mineral = fill('shallow_water');
  mineral.tiles[6][6] = 'mineral';
  mineral.tileHp[6][6] = 100;
  assert.equal(new RippleSystem(() => 0.5).spawn({ x: 325, y: 300, angle: 0, wetness: 0, inWater: true }, mineral), false);

  const offMap = new RippleSystem(() => 0.5);
  assert.equal(offMap.spawn({ x: -10, y: 300, angle: 0, wetness: 0, inWater: true }, water), false);
  assert.equal(offMap.spawn({ x: 64 * 50 + 10, y: 300, angle: 0, wetness: 0, inWater: true }, water), false);

  // 岸线可缩小到整圈入水；缩到最小半径仍放不下就不生成。
  const shore = strip('shallow_water');
  const nearShore = new RippleSystem(() => 0.5);
  assert.equal(nearShore.spawn({ x: 208, y: 300, angle: 0, wetness: 0, inWater: true }, shore), true);
  const view = nearShore.getRipples()[0];
  assert.ok(view.maxRadius < RIPPLE_BASE_RADIUS, `expected shrunken ripple, got ${view.maxRadius}`);
  assert.equal(new RippleSystem(() => 0.5).spawn({ x: 202, y: 300, angle: 0, wetness: 0, inWater: true }, shore), false);
});

test('ripples alternate feet and keep the foot after a rejected step', () => {
  const map = strip('shallow_water');
  const ripples = new RippleSystem(() => 0.5);
  const sides = [];
  for (const x of [325, 375, 425, 475]) {
    assert.equal(ripples.spawn({ x, y: 300, angle: 0, wetness: 0, inWater: true }, map), true);
    sides.push(Math.sign(ripples.getRipples().at(-1).y - 300));
  }
  assert.deepEqual(sides, [1, -1, 1, -1]);
  for (const view of ripples.getRipples()) near(Math.abs(view.y - 300), FOOTPRINT_SIDE_OFFSET, 1e-9);

  const failed = new RippleSystem(() => 0.5);
  assert.equal(failed.spawn({ x: 150, y: 300, angle: 0, wetness: 0, inWater: false }, map), false);
  assert.equal(failed.spawn({ x: 325, y: 300, angle: 0, wetness: 0, inWater: true }, map), true);
  assert.ok(failed.getRipples()[0].y > 300, 'rejected step must not switch feet');
});

test('deeper water gives a larger and longer-lived ripple', () => {
  const shallow = new RippleSystem(() => 0.5);
  assert.equal(shallow.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: true }, fill('shallow_water')), true);
  const deep = new RippleSystem(() => 0.5);
  assert.equal(deep.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: true }, fill('deep_water')), true);

  const shallowView = shallow.getRipples()[0];
  const deepView = deep.getRipples()[0];
  near(shallowView.depth, 0);
  near(deepView.depth, 2);
  near(shallowView.maxRadius, RIPPLE_BASE_RADIUS);
  near(deepView.maxRadius, RIPPLE_BASE_RADIUS + RIPPLE_RADIUS_PER_DEPTH * 2);
  near(shallowView.life, RIPPLE_BASE_LIFE);
  near(deepView.life, RIPPLE_BASE_LIFE + RIPPLE_LIFE_PER_DEPTH * 2);
  assert.ok(deepView.maxRadius > shallowView.maxRadius);
  assert.ok(deepView.life > shallowView.life);
});

test('ripple radius grows, alpha fades and the centre drifts against the movement', () => {
  const map = fill('shallow_water');
  const ripples = new RippleSystem(() => 0.5);
  const step = { x: 300, y: 300, angle: 0, wetness: 0, inWater: true };
  assert.equal(ripples.spawn(step, map), true);
  const birth = ripples.getRipples()[0];
  near(birth.radius, RIPPLE_PROBE_RADIUS);
  near(birth.alpha, RIPPLE_ALPHA);
  near(birth.centerX, birth.x);
  near(birth.centerY, birth.y);

  ripples.update(birth.life / 2);
  const half = ripples.getRipples()[0];
  assert.ok(half.radius > birth.radius && half.radius < half.maxRadius);
  assert.ok(half.alpha > 0 && half.alpha < RIPPLE_ALPHA);
  // 向右走时圆心向左漂移，y 不变。
  near(half.centerX, birth.x - RIPPLE_DRIFT_RATIO * half.maxRadius * 0.75);
  near(half.centerY, birth.y, 1e-9);

  ripples.update(birth.life / 2);
  assert.equal(ripples.getActiveCount(), 0);

  const sideways = new RippleSystem(() => 0.5);
  assert.equal(sideways.spawn({ x: 300, y: 300, angle: Math.PI / 2, wetness: 0, inWater: true }, map), true);
  const sidewaysBirth = sideways.getRipples()[0];
  sideways.update(sidewaysBirth.life / 2);
  const sidewaysHalf = sideways.getRipples()[0];
  assert.ok(sidewaysHalf.centerY < sidewaysBirth.y, 'downward walk must drift the ripple upward');
  near(sidewaysHalf.centerX, sidewaysBirth.x, 1e-9);

  const stable = new RippleSystem(() => 0.5);
  stable.spawn(step, map);
  for (const delta of [-1, 0, NaN, Infinity]) stable.update(delta);
  assert.equal(stable.getActiveCount(), 1);
  near(stable.getRipples()[0].alpha, RIPPLE_ALPHA);
});

test('drawing strokes two backward arcs per ripple and culls off-screen ones', () => {
  const makeContext = () => {
    const calls = [], arcs = [], strokes = [];
    const ctx = {
      globalAlpha: 1, strokeStyle: '', lineWidth: 1,
      save() { calls.push('save'); },
      restore() { calls.push('restore'); },
      beginPath() { calls.push('beginPath'); },
      arc(x, y, radius, start, end) {
        calls.push('arc');
        arcs.push({ x, y, radius, start, end, alpha: this.globalAlpha });
      },
      stroke() { calls.push('stroke'); strokes.push({ alpha: this.globalAlpha, color: this.strokeStyle, width: this.lineWidth }); },
      fill() { calls.push('fill'); },
      ellipse() { calls.push('ellipse'); },
      createRadialGradient() { calls.push('gradient'); },
    };
    return { ctx, calls, arcs, strokes };
  };
  const map = fill('shallow_water');
  const ripples = new RippleSystem(() => 0.5);
  assert.equal(ripples.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: true }, map), true);

  const first = makeContext();
  ripples.draw(first.ctx, 0, 0, 800, 600);
  assert.deepEqual(first.calls.filter(call => call === 'arc').length, 2);
  assert.deepEqual(first.calls.filter(call => call === 'stroke').length, 2);
  assert.ok(!first.calls.includes('fill'));
  assert.ok(!first.calls.includes('ellipse'));
  assert.ok(!first.calls.includes('gradient'));
  assert.deepEqual(first.calls[0], 'save');
  assert.deepEqual(first.calls.at(-1), 'restore');
  for (const stroke of first.strokes) {
    assert.equal(stroke.color, RIPPLE_COLOR);
    near(stroke.width, RIPPLE_LINE_WIDTH);
  }
  near(first.strokes[0].alpha, RIPPLE_ALPHA);
  near(first.strokes[1].alpha, RIPPLE_ALPHA * RIPPLE_INNER_ALPHA);
  near(first.arcs[1].radius, first.arcs[0].radius * RIPPLE_INNER_RATIO);
  // 弧的缺口朝向行进方向：中心角落在行进反方向上，跨度为 216°。
  const back = Math.PI;
  for (const arc of first.arcs) {
    near(normalize((arc.start + arc.end) / 2), normalize(back), 1e-9);
    near(arc.end - arc.start, RIPPLE_ARC_HALF * 2);
  }

  ripples.update(ripples.getRipples()[0].life / 2);
  const faded = makeContext();
  ripples.draw(faded.ctx, 0, 0, 800, 600);
  assert.ok(faded.strokes[0].alpha > 0 && faded.strokes[0].alpha < RIPPLE_ALPHA);
  assert.ok(faded.arcs[0].x < 300, 'the faded ripple centre trails behind the step');

  const culled = makeContext();
  ripples.draw(culled.ctx, 5000, 5000, 800, 600);
  assert.deepEqual(culled.calls, ['save', 'restore']);
});

test('ripples are capped and never replace dry-ground footprints', () => {
  const map = fill('shallow_water');
  const capped = new RippleSystem(() => 0.5);
  for (let i = 0; i < RIPPLE_MAX_COUNT + 40; i++) {
    assert.equal(capped.spawn({ x: 300, y: 300, angle: 0, wetness: 0, inWater: true }, map), true);
  }
  assert.equal(capped.getActiveCount(), RIPPLE_MAX_COUNT);

  // 走水带：干地只出脚印，水里只出涟漪。
  const band = strip('shallow_water');
  const player = new Player(200, 300);
  const footprints = new FootprintSystem(() => 0.5);
  const ripples = new RippleSystem(() => 0.5);
  player.setOnFootstepCallback(step => {
    if (!footprints.spawn(step, band)) ripples.spawn(step, band);
  });
  advance(player, 3, input('d'), band);

  const prints = footprints.getFootprints();
  const waves = ripples.getRipples();
  assert.ok(prints.length > 0, 'dry ground must still leave footprints');
  assert.ok(waves.length > 0, 'wading must leave ripples');
  for (const view of prints) assert.ok(view.x < 200 || view.x > 500, `footprint at ${view.x} inside water`);
  for (const view of waves) assert.ok(view.x > 200 && view.x < 500, `ripple at ${view.x} outside water`);
});
