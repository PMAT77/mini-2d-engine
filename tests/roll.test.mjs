import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const { parsePlayerConfig, DEFAULT_ROLL } = load('objects/PlayerConfig');
const {
  getRollPose, ROLL_REST_POSE, rollFacingWeight, rollStowedAlpha, rollVisualAngle,
} = load('objects/RollPose');
const input = (...keys) => ({ isKeyDown: key => keys.includes(key), fire: keys.includes('MouseLeft') });
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);
const advance = (p, seconds, keys = input(), map, fps = 60) => {
  for (let left = seconds; left > 1e-9;) {
    const delta = Math.min(left, 1 / fps);
    p.update(delta, keys, map); left -= delta;
  }
};
const mapOf = () => {
  const map = new TileMap(40, 24, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

test('Space roll starts, locks its direction and falls back to body facing', () => {
  const p = new Player(0, 0);
  assert.equal(p.isRolling(), false);
  assert.equal(p.requestRoll(input('d')), true);
  assert.equal(p.isRolling(), true);
  near(p.getRollProgress(), 0);
  advance(p, 0.1);
  assert.ok(p.x > 1 && p.y === 0);
  assert.ok(p.getRollProgress() > 0.25 && p.getRollProgress() < 0.4);

  const still = new Player(0, 0);
  assert.equal(still.requestRoll(input()), true);
  advance(still, 0.1);
  assert.ok(still.x < -1, `facing roll moved ${still.x}`);
  near(still.y, 0);
});

test('default roll covers about 120px and stays frame-rate independent', () => {
  const distances = [];
  for (const fps of [30, 60, 144]) {
    const p = new Player(0, 0);
    assert.equal(p.requestRoll(input('d')), true);
    advance(p, 0.35, input(), undefined, fps);
    assert.equal(p.isRolling(), false);
    distances.push(p.x);
    assert.ok(Math.abs(p.x - 120) < 1, `${fps}fps rolled ${p.x}px`);
    near(p.getVelocity().length(), 0);
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.1, distances.join(', '));
});

test('roll direction stays locked when the stick reverses mid-roll', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  advance(p, 0.15, input('a'));
  assert.ok(p.x > 0);
  near(p.y, 0);
  assert.equal(p.requestRoll(input('a')), false);
});

test('roll cooldown blocks re-entry until the action and cooldown both end', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  assert.equal(p.requestRoll(input('d')), false);
  advance(p, 0.3);
  assert.equal(p.isRolling(), false);
  assert.ok(p.getRollCooldownRemaining() > 0.3);
  assert.equal(p.requestRoll(input('d')), false);
  advance(p, 0.45);
  assert.equal(p.requestRoll(input('d')), true);
});

test('roll spends stamina immediately, pauses regeneration and can exhaust the sprint lock', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  near(p.getStamina(), 80);
  advance(p, 0.2);
  near(p.getStamina(), 80); // no regen while rolling
  advance(p, 0.2);
  near(p.getStamina(), 80); // regen delay not elapsed yet

  const empty = new Player(0, 0);
  empty.setDebugState({ stamina: 20 });
  assert.equal(empty.requestRoll(input('d')), true);
  near(empty.getStamina(), 0);
  assert.equal(empty.getDebugState().exhausted, true);
  advance(empty, 0.1, input('d', 'Shift'));
  assert.equal(empty.getIsSprinting(), false);
});

test('rolling with too little stamina is ignored without cost or cooldown', () => {
  const p = new Player(0, 0);
  p.setDebugState({ stamina: 19 });
  assert.equal(p.requestRoll(input('d')), false);
  near(p.getRollCooldownRemaining(), 0);
  assert.equal(p.isRolling(), false);
  assert.ok(p.getStamina() >= 19);
  advance(p, 0.1, input('d'));
  assert.ok(p.x < 25, `ignored roll should only walk: ${p.x}`);
});

test('roll stays collision constrained and cannot cross a wall', () => {
  const map = mapOf(); map.tiles.forEach(row => { row[10] = 'wall'; });
  const p = new Player(449, 200);
  assert.equal(p.requestRoll(input('d')), true);
  advance(p, 0.35, input(), map);
  assert.equal(p.isRolling(), false);
  assert.ok(p.x > 449, 'roll should reach the wall');
  assert.ok(p.getCollider().bounds.x + p.getCollider().bounds.width <= 500.011);
  assert.ok(map.queryShape(p.getCollider()).every(c => c.depth <= 0.011));
});

test('roll config is validated, snapshotted and applied', () => {
  assert.equal(parsePlayerConfig({ roll: { cooldown: 0, staminaCost: 0 } }).roll.cooldown, 0);
  assert.throws(() => parsePlayerConfig({ roll: { duration: 0 } }), /roll\.duration/);
  assert.throws(() => parsePlayerConfig({ roll: { speedMultiplier: 1 } }), /roll\.speedMultiplier/);
  assert.throws(() => parsePlayerConfig({ roll: { staminaCost: -1 } }), /roll\.staminaCost/);
  assert.throws(() => parsePlayerConfig({ roll: { cooldown: -1 } }), /roll\.cooldown/);
  assert.throws(() => parsePlayerConfig({ roll: { unknown: 1 } }), /未知配置项: roll\.unknown/);

  const p = new Player(0, 0);
  assert.deepEqual(p.getConfigSnapshot().roll, DEFAULT_ROLL);
  p.applyConfig({ roll: { duration: 0.2, staminaCost: 10 } });
  assert.equal(p.getConfigSnapshot().roll.duration, 0.2);
  assert.equal(p.getConfigSnapshot().roll.staminaCost, 10);
  assert.equal(p.requestRoll(input('d')), true);
  near(p.getStamina(), 90);
  advance(p, 0.3);
  assert.ok(p.x > 75 && p.x < 85, `shortened roll moved ${p.x}px`);
});

// ---------------------------------------------------------------------------
// 程序化翻滚动画：姿态数据、朝向混合与渲染层
// ---------------------------------------------------------------------------

const PHASES = [0, 0.25, 0.5, 0.75, 1];
const headOffset = pose => [pose.headX - pose.bodyX, pose.headY - pose.bodyY];
const leftHandOffset = pose => [pose.leftHandX - pose.bodyX, pose.leftHandY - pose.bodyY];
const aspect = pose => pose.bodyRx / pose.bodyRy;
const angleOf = (x, y) => Math.atan2(y, x);
const signedAngle = (a, b) => {
  const raw = (b - a) % (Math.PI * 2);
  return raw > Math.PI ? raw - Math.PI * 2 : raw <= -Math.PI ? raw + Math.PI * 2 : raw;
};

test('每个阶段的头部、躯干、手臂与腿各自运动，而不是整体缩放压扁', () => {
  const poses = PHASES.map(getRollPose);
  const moving = [0.25, 0.5, 0.75].map(getRollPose);
  const rest = getRollPose(0);

  // 头相对躯干的位置逐个不同 => 头能独立低头/前伸/缩回。
  const headKeys = [rest, ...moving].map(pose => headOffset(pose).map(v => v.toFixed(4)).join(','));
  assert.equal(new Set(headKeys).size, 4, headKeys.join(' | '));

  // 手相对躯干也各自不同 => 手臂独立于躯干。
  const handKeys = [rest, ...moving].map(pose => leftHandOffset(pose).map(v => v.toFixed(4)).join(','));
  assert.equal(new Set(handKeys).size, 4, handKeys.join(' | '));
  // 100% 回到与 0% 完全相同的姿态。
  assert.deepEqual(poses[0], poses[poses.length - 1]);

  // 躯干不是等比缩放：蜷缩时宽高比明显变小。
  const mid = getRollPose(0.5);
  assert.ok(aspect(getRollPose(0)) - aspect(mid) > 0.1, `${aspect(mid)}`);
  assert.ok(mid.bodyRx < ROLL_REST_POSE.bodyRx - 0.08);
  assert.ok(mid.bodyRy > 0.3);

  // 腿部只在翻滚过程中出现（站立看不见）。
  near(getRollPose(0).legAlpha, 0, 1e-9);
  near(getRollPose(1).legAlpha, 0, 1e-9);
  assert.ok(mid.legAlpha > 0.95);
  assert.ok(getRollPose(0.35).legAlpha > 0.4);

  // 中段头被肩背遮住，两端头完整。
  near(getRollPose(0).headAlpha, 1, 1e-9);
  assert.ok(mid.headAlpha < 0.05);
  near(getRollPose(1).headAlpha, 1, 1e-9);
  assert.ok(mid.shellAlpha > 0.95);
  near(getRollPose(0).shellAlpha, 0, 1e-9);
  near(getRollPose(1).shellAlpha, 0, 1e-9);
});

test('姿态插值连续，0%/100% 精确回到站立姿态', () => {
  assert.deepEqual(getRollPose(0), ROLL_REST_POSE);
  assert.deepEqual(getRollPose(1), ROLL_REST_POSE);
  assert.deepEqual(getRollPose(-0.4), ROLL_REST_POSE);
  assert.deepEqual(getRollPose(1.7), ROLL_REST_POSE);

  const keys = Object.keys(ROLL_REST_POSE);
  let prev = getRollPose(0);
  for (let i = 1; i <= 1000; i++) {
    const cur = getRollPose(i / 1000);
    for (const key of keys) {
      const step = Math.abs(cur[key] - prev[key]);
      assert.ok(step < 0.02, `${key} jumped ${step} at p=${(i / 1000).toFixed(3)}`);
    }
    prev = cur;
  }
  // 起滚与收尾必须落在同一个形状上，否则动画结束会跳一帧。
  for (const key of keys) near(getRollPose(0.999)[key], getRollPose(0)[key], 0.06);
});

test('视觉朝向中段对齐 rollDirection，两端回到身体朝向且走最短弧', () => {
  const facing = -Math.PI / 2; // 鼠标瞄准北
  const roll = 0;              // 移动输入向东
  near(rollVisualAngle(0, facing, roll), facing, 1e-9);
  near(rollVisualAngle(1, facing, roll), facing, 1e-9);
  near(rollVisualAngle(0.5, facing, roll), roll, 1e-9);
  assert.ok(rollFacingWeight(0.5) > 0.999);
  assert.ok(rollFacingWeight(0.9) < 0.2);

  // 八个方向的翻滚都能在中段完全对齐，且两端归位。
  for (let i = 0; i < 8; i++) {
    const dir = -Math.PI + i * Math.PI / 4;
    near(signedAngle(rollVisualAngle(0.5, facing, dir), dir), 0, 1e-9);
    near(rollVisualAngle(0, facing, dir), facing, 1e-9);
    near(rollVisualAngle(1, facing, dir), facing, 1e-9);
  }

  // 最短弧：默认站立朝向西(-π)，向东(0) 翻滚不会绕 2π 反向转一圈。
  const west = Math.PI;
  const angle = rollVisualAngle(0.5, west, 0);
  assert.ok(Math.abs(signedAngle(west, angle)) <= Math.PI + 1e-9);
  near(signedAngle(west, angle), Math.PI, 1e-9);
});

test('背部武器只在起滚和收尾短暂淡出，中段完全隐藏', () => {
  near(rollStowedAlpha(0), 1, 1e-9);
  near(rollStowedAlpha(0.25), 0, 1e-9);
  near(rollStowedAlpha(0.5), 0, 1e-9);
  near(rollStowedAlpha(1), 1, 1e-9);
  assert.ok(rollStowedAlpha(0.1) > 0 && rollStowedAlpha(0.1) < 1);
  assert.ok(rollStowedAlpha(0.9) > 0 && rollStowedAlpha(0.9) < 1);
});

/** 记录绘制调用；transform 是空实现，所以坐标仍是角色局部坐标。 */
function shapeRecorder() {
  const arcs = [], ellipses = [], rotates = [], scales = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, rotate(a) { rotates.push(a); },
    scale(x, y) { scales.push([x, y]); },
    fillRect() {}, clearRect() {}, drawImage() {}, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    arc(x, y, r) { arcs.push({ x, y, r }); },
    ellipse(x, y, rx, ry) { ellipses.push({ x, y, rx, ry }); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  return { ctx, arcs, ellipses, rotates, scales };
}

function rollFrame(progress, { facing = -Math.PI / 2, roll = 0 } = {}) {
  const rec = shapeRecorder();
  const p = new Player(200, 200);
  p.wadingCanvas = { width: 0, height: 0, getContext: () => rec.ctx };
  p.currentRotation = facing + Math.PI;
  p.rollDirection.x = Math.cos(roll);
  p.rollDirection.y = Math.sin(roll);
  p.rollTimeLeft = progress <= 0 ? 0 : p.roll.duration * (1 - progress);
  p.draw(rec.ctx, 0, 0);
  return { p, rec };
}

test('翻滚渲染帧不再压扁或镜像，旋转对齐翻滚方向且不出离屏缓冲', () => {
  const size = 49;
  const extent = {};
  const signatures = [];

  for (const progress of [0, 0.25, 0.5, 0.75]) {
    const { p, rec } = rollFrame(progress);
    // 每一帧只允许一个等比缩放（呼吸），不能出现负值/压扁/镜像。
    assert.ok(rec.scales.length >= 1, 'drawModel should scale at least once');
    for (const [sx, sy] of rec.scales) {
      near(sx, sy, 1e-9);
      assert.ok(sx > 0.6 && sx < 1.4, `scale ${sx}`);
    }
    // 朝向：中段对齐 rollDirection（向东），起滚/收尾回到鼠标朝向（向北）。
    // rotates[0] 是 drawModel 的整体朝向；后面的是武器等局部旋转。
    assert.ok(rec.rotates.length >= 1);
    const expected = progress === 0 ? -Math.PI / 2 : rollVisualAngle(progress, -Math.PI / 2, 0);
    near(rec.rotates[0], expected, 1e-9);

    // 绘制内容不超出离屏缓冲（半宽 extent/2）。
    const half = p.wadingCanvas.width / 2;
    extent[progress] = half;
    for (const shape of rec.arcs) {
      assert.ok(Math.abs(shape.x) + shape.r <= half + 1e-6, `arc out of buffer at ${progress}: ${shape.x}+${shape.r}`);
    }
    for (const shape of rec.ellipses) {
      assert.ok(Math.abs(shape.x) + shape.rx <= half + 1e-6, `ellipse x out of buffer at ${progress}`);
      assert.ok(Math.abs(shape.y) + shape.ry <= half + 1e-6, `ellipse y out of buffer at ${progress}`);
    }

    const pose = getRollPose(progress);
    const expectedHeadR = pose.headR * size;
    const heads = rec.arcs.filter(a => Math.abs(a.r - expectedHeadR) < 1e-6);
    if (pose.headAlpha <= 0.001) {
      // 头被肩背完全遮住：这一帧没有头，也没有任何整体镜像。
      assert.equal(heads.length, 0, 'mid roll should not draw the head');
    } else {
      assert.equal(heads.length, 1, `expected one head arc at ${progress}`);
      assert.ok(pose.headAlpha > 0.1);
    }
    // 翻滚中段会画简化腿（站立没有）；站立帧的腿 alpha 为 0，所以不会多出胶囊。
    signatures.push(rec.arcs.length + ':' + rec.arcs.map(a => a.r.toFixed(2)).join(',')
      + '|' + rec.ellipses.map(e => `${e.rx.toFixed(2)}x${e.ry.toFixed(2)}`).join(','));
  }

  // 0 / 25% / 50% / 75% 四帧的绘制内容互不相同 => 关键姿态在渲染层可区分。
  assert.equal(new Set(signatures).size, signatures.length, signatures.join(' | '));
  // 缓冲尺寸跨帧稳定（水体遮罩复用同一块 canvas）。
  assert.equal(new Set(Object.values(extent)).size, 1, JSON.stringify(extent));
});

test('翻滚中的八方向与鼠标朝向无关，方向只体现在变换角度上', () => {
  const signatures = [];
  for (let i = 0; i < 8; i++) {
    const roll = -Math.PI + i * Math.PI / 4;
    const { rec } = rollFrame(0.5, { facing: -Math.PI / 2, roll });
    near(signedAngle(rec.rotates[0], roll), 0, 1e-9);
    signatures.push(rec.arcs.map(a => `${a.x.toFixed(2)},${a.y.toFixed(2)},${a.r.toFixed(2)}`).join(';'));
  }
  // 局部姿态与方向无关：八个方向共用同一套姿态数据，方向只由 canvas 旋转表达。
  assert.equal(new Set(signatures).size, 1);
  assert.ok(signatures[0].length > 0);
});

test('翻滚动画与物理完全解耦：碰撞体、位移和朝向锁定都不受影响', () => {
  const p = new Player(0, 0);
  const before = p.getCollider();
  const radius = before.parts[0].radius;
  assert.equal(p.requestRoll(input('d')), true);
  let lastX = p.x;
  for (let i = 0; i < 12; i++) {
    // 反向输入不解锁方向，也不该被动画影响。
    advance(p, 1 / 60, input('a'));
    const collider = p.getCollider();
    near(collider.parts[0].radius, radius, 1e-9);
    near(collider.bounds.width, before.bounds.width, 1e-9);
    near(collider.bounds.height, before.bounds.height, 1e-9);
    assert.ok(p.x >= lastX, 'roll should keep moving forward');
    lastX = p.x;
    near(p.y, 0, 1e-9);
    assert.ok(p.isRolling(), 'roll should still be running');
  }
  advance(p, 0.2);
  assert.equal(p.isRolling(), false);
  assert.ok(Math.abs(p.x - 120) < 1.5, `roll moved ${p.x}px`);
});
