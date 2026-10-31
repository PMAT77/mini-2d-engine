import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const { parsePlayerConfig, DEFAULT_ROLL } = load('objects/PlayerConfig');
const {
  getRollPose, ROLL_REST_POSE, rollEntryBlend, rollExitBlend,
  rollFacingWeight, rollStowedAlpha, rollVisualAngle,
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
const aimAt = (x, y, fire = false) => ({ target: { x, y }, fire, face: true });
const poseDelta = (a, b) => Math.max(
  ...Object.keys(ROLL_REST_POSE).map(key => Math.abs(a[key] - b[key])),
);
const signedAngle = (a, b) => {
  const raw = (b - a) % (Math.PI * 2);
  return raw > Math.PI ? raw - Math.PI * 2 : raw <= -Math.PI ? raw + Math.PI * 2 : raw;
};

test('Space roll starts, locks its direction and falls back to body facing', () => {
  const p = new Player(0, 0);
  assert.equal(p.isRolling(), false);
  assert.equal(p.requestRoll(input('d')), true);
  assert.equal(p.isRolling(), true);
  near(p.getRollProgress(), 0);
  advance(p, 0.1);
  assert.ok(p.x > 1 && p.y === 0);
  near(p.getRollProgress(), 0.2);

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
    advance(p, 0.6, input(), undefined, fps);
    assert.equal(p.isRolling(), false);
    distances.push(p.x);
    assert.ok(Math.abs(p.x - 143) < 0.8, `${fps}fps rolled ${p.x}px`);
    near(p.getVelocity().length(), 0);
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.5, distances.join(', '));
});

test('holding a direction through a roll keeps moving without a startup pause', () => {
  const map = mapOf();
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  let rollingFrames = 0;
  for (let i = 0; i < 40; i++) {
    p.update(1 / 60, input('d'), map);
    if (!p.isRolling()) break;
    rollingFrames++;
  }
  // 翻滚 0.5 秒正好落在 60fps 的帧边界上，末帧速度接近 0；关键是交接后按正常起步曲线
  // 立刻跑起来，0.1 秒内就要回到常速，而不是卡在原地。
  assert.ok(Math.abs(rollingFrames - 29) <= 1, `roll lasted ${rollingFrames} frames`);
  for (let i = 0; i < 7; i++) p.update(1 / 60, input('d'), map);
  assert.ok(p.getVelocity().length() > 190, `0.117s after roll: ${p.getVelocity().length()}`);
  assert.ok(p.x > 143, `kept moving after roll: ${p.x}`);

  // 松开方向时不预热起步曲线，仍然正常停下。
  const released = new Player(0, 0);
  assert.equal(released.requestRoll(input('d')), true);
  for (let i = 0; i < 40 && released.isRolling(); i++) {
    released.update(1 / 60, input(), map);
  }
  released.update(1 / 60, input(), map);
  near(released.getVelocity().length(), 0);
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
  advance(p, 0.55);
  assert.equal(p.isRolling(), false);
  assert.ok(p.getRollCooldownRemaining() > 0.3);
  assert.equal(p.requestRoll(input('d')), false);
  advance(p, 0.4);
  assert.equal(p.requestRoll(input('d')), true);
});

test('roll spends stamina immediately, pauses regeneration and can exhaust the sprint lock', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  near(p.getStamina(), 90);
  advance(p, 0.2);
  near(p.getStamina(), 90); // no regen while rolling
  advance(p, 0.2);
  near(p.getStamina(), 90); // regen delay not elapsed yet

  const empty = new Player(0, 0);
  empty.setDebugState({ stamina: 10 });
  assert.equal(empty.requestRoll(input('d')), true);
  near(empty.getStamina(), 0);
  assert.equal(empty.getDebugState().exhausted, true);
  advance(empty, 0.1, input('d', 'Shift'));
  assert.equal(empty.getIsSprinting(), false);
});

test('rolling with too little stamina is ignored without cost or cooldown', () => {
  const p = new Player(0, 0);
  p.setDebugState({ stamina: 9 });
  assert.equal(p.requestRoll(input('d')), false);
  near(p.getRollCooldownRemaining(), 0);
  assert.equal(p.isRolling(), false);
  assert.ok(p.getStamina() >= 9);
  advance(p, 0.1, input('d'));
  assert.ok(p.x < 25, `ignored roll should only walk: ${p.x}`);
});

test('roll stays collision constrained, keeps its collider and cannot cross a wall', () => {
  const map = mapOf(); map.tiles.forEach(row => { row[10] = 'wall'; });
  const p = new Player(449, 200);
  const before = p.getCollider();
  const radius = before.parts[0].radius;
  const width = before.bounds.width;
  const height = before.bounds.height;
  assert.equal(p.requestRoll(input('d')), true);
  let lastX = p.x;
  for (let i = 0; i < 30; i++) {
    p.update(1 / 60, input(), map);
    const collider = p.getCollider();
    near(collider.parts[0].radius, radius, 1e-9);
    near(collider.bounds.width, width, 1e-9);
    near(collider.bounds.height, height, 1e-9);
    assert.ok(p.x >= lastX - 1e-9, 'roll should not move backwards');
    lastX = p.x;
    assert.ok(collider.bounds.x + collider.bounds.width <= 500.011);
    assert.ok(map.queryShape(collider).every(hit => hit.depth <= 0.011));
  }
  assert.equal(p.isRolling(), false);
  assert.ok(p.x > 449, 'roll should reach the wall');
  assert.ok(p.getCollider().bounds.x + p.getCollider().bounds.width <= 500.011);
  assert.ok(map.queryShape(p.getCollider()).every(c => c.depth <= 0.011));

  // 一次 500ms 的长帧也必须靠子步完成碰撞，不能因为翻滚结束余量而穿墙。
  const long = new Player(449, 200);
  assert.equal(long.requestRoll(input('d')), true);
  long.update(0.5, input('d'), map);
  assert.equal(long.isRolling(), false);
  assert.ok(long.getCollider().bounds.x + long.getCollider().bounds.width <= 500.011);
  assert.ok(map.queryShape(long.getCollider()).every(c => c.depth <= 0.011));
});

test('roll config defaults, JSON file, validation, snapshot and application stay in sync', () => {
  assert.equal(DEFAULT_ROLL.duration, 0.5);
  assert.equal(DEFAULT_ROLL.speedMultiplier, 2.15);
  assert.equal(DEFAULT_ROLL.cooldown, 0.4);
  assert.equal(DEFAULT_ROLL.staminaCost, 10);
  const json = JSON.parse(readFileSync('public/configs/playerConfig.json', 'utf8'));
  assert.deepEqual(json.roll, DEFAULT_ROLL);

  assert.equal(parsePlayerConfig({ roll: { cooldown: 0, staminaCost: 0 } }).roll.cooldown, 0);
  assert.throws(() => parsePlayerConfig({ roll: { duration: 0 } }), /roll\.duration/);
  assert.throws(() => parsePlayerConfig({ roll: { speedMultiplier: 1 } }), /roll\.speedMultiplier/);
  assert.throws(() => parsePlayerConfig({ roll: { staminaCost: -1 } }), /roll\.staminaCost/);
  assert.throws(() => parsePlayerConfig({ roll: { cooldown: -1 } }), /roll\.cooldown/);
  assert.throws(() => parsePlayerConfig({ roll: { unknown: 1 } }), /未知配置项: roll\.unknown/);

  const p = new Player(0, 0);
  assert.deepEqual(p.getConfigSnapshot().roll, DEFAULT_ROLL);
  p.applyConfig({ roll: { duration: 0.2, speedMultiplier: 3, staminaCost: 10 } });
  assert.equal(p.getConfigSnapshot().roll.duration, 0.2);
  assert.equal(p.getConfigSnapshot().roll.speedMultiplier, 3);
  assert.equal(p.getConfigSnapshot().roll.staminaCost, 10);
  assert.equal(p.requestRoll(input('d')), true);
  near(p.getStamina(), 90);
  advance(p, 0.3);
  assert.ok(p.x > 75 && p.x < 85, `shortened roll moved ${p.x}px`);
});

// ---------------------------------------------------------------------------
// 程序化翻滚动画：姿态数据、插值、朝向混合与真实站立姿态衔接
// ---------------------------------------------------------------------------

const PHASES = [0, 0.25, 0.5, 0.75, 1];
const headOffset = pose => [pose.headX - pose.bodyX, pose.headY - pose.bodyY];
const leftHandOffset = pose => [pose.leftHandX - pose.bodyX, pose.leftHandY - pose.bodyY];
const aspect = pose => pose.bodyRx / pose.bodyRy;

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

test('末段起身持续完成，不是最后几帧突然回正', () => {
  const at = getRollPose;
  const rest = ROLL_REST_POSE;
  const d84 = poseDelta(at(0.84), rest);
  const d90 = poseDelta(at(0.9), rest);
  const d96 = poseDelta(at(0.96), rest);
  assert.ok(d84 > 0.05, `get-up should still have visible pose at 84%: ${d84}`);
  assert.ok(d90 < d84, `${d90} should be closer to rest than ${d84}`);
  assert.ok(d96 < d90, `${d96} should be closer to rest than ${d90}`);
  assert.ok(d96 > 0.005, 'the final settle should not be a single-frame snap');
  assert.ok(d96 < 0.06, 'the last 4% should already be near the rest pose');

  // 头在撑地起身阶段逐渐露出，而不是最后才弹出来。
  assert.ok(at(0.6).headAlpha < 0.5);
  assert.ok(at(0.7).headAlpha > 0.5);
  assert.ok(at(0.8).headAlpha > 0.85);
  assert.ok(at(0.9).headAlpha > 0.99);

  // 躯干持续展开，收势不是一帧完成。
  assert.ok(at(0.6).bodyRx < at(0.7).bodyRx);
  assert.ok(at(0.7).bodyRx < at(0.8).bodyRx);
  assert.ok(at(0.8).bodyRx < at(0.9).bodyRx);

  // 位置/尺寸逐帧连续：起身阶段的几何量不能靠一两帧瞬移完成。
  const positionKeys = Object.keys(rest).filter(key => !key.endsWith('Alpha'));
  let prev = at(0.6);
  let maxStep = 0;
  const step = (1 / 60) / DEFAULT_ROLL.duration;
  for (let p = 0.6 + step; p <= 1 + 1e-9; p += step) {
    const cur = at(Math.min(1, p));
    for (const key of positionKeys) maxStep = Math.max(maxStep, Math.abs(cur[key] - prev[key]));
    prev = cur;
  }
  assert.ok(maxStep < 0.12, `get-up jumped ${maxStep} in one 60fps frame`);

  // 透明度单独约束：头在肩背外壳下持续淡入（外壳本身也在淡出），
  // 不需要和位置同一个阈值，但同样不能一帧从 0 变 1。
  let prevAlpha = at(0.6).headAlpha;
  for (let p = 0.6 + step; p <= 1 + 1e-9; p += step) {
    const alpha = at(Math.min(1, p)).headAlpha;
    assert.ok(alpha >= prevAlpha - 1e-9, 'head alpha should fade in monotonically');
    assert.ok(alpha - prevAlpha <= 0.2, `head alpha jumped ${alpha - prevAlpha} in one frame`);
    prevAlpha = alpha;
  }
});

test('视觉朝向中段对齐 rollDirection，两端回到身体朝向且走最短弧', () => {
  const facing = -Math.PI / 2; // 鼠标瞄准北
  const roll = 0;              // 移动输入向东
  near(rollVisualAngle(0, facing, roll), facing, 1e-9);
  near(rollVisualAngle(1, facing, roll), facing, 1e-9);
  near(rollVisualAngle(0.5, facing, roll), roll, 1e-9);
  assert.ok(rollFacingWeight(0.5) > 0.999);
  assert.ok(rollFacingWeight(0.9) < 0.2);
  near(rollFacingWeight(0.12), 0, 1e-9);
  near(rollFacingWeight(0.3), 1, 1e-9);
  near(rollFacingWeight(0.58), 1, 1e-9);
  near(rollFacingWeight(0.84), 0, 1e-9);

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

  // 鼠标朝向与翻滚方向相差 90°/180° 时，旋转仍然是连续曲线，没有一帧跳变。
  for (const [from, to] of [[-Math.PI / 2, 0], [Math.PI, 0], [0, Math.PI]]) {
    let prev = rollVisualAngle(1e-4, from, to);
    for (let i = 1; i <= 2000; i++) {
      const p = 1e-4 + (1 - 2e-4) * i / 2000;
      const cur = rollVisualAngle(p, from, to);
      const step = Math.abs(signedAngle(prev, cur));
      assert.ok(step < 0.03, `visual angle jumped ${step} at p=${p.toFixed(4)}`);
      prev = cur;
    }
    near(rollVisualAngle(1 - 1e-4, from, to), from, 1e-9);
  }
});

test('入场/收尾混合权重在真实姿态与翻滚姿态之间平滑过渡', () => {
  near(rollEntryBlend(0), 0, 1e-9);
  near(rollEntryBlend(0.06), 0.5, 1e-9);
  near(rollEntryBlend(0.12), 1, 1e-9);
  near(rollExitBlend(0.84), 0, 1e-9);
  near(rollExitBlend(0.92), 0.5, 1e-9);
  near(rollExitBlend(1), 1, 1e-9);
  for (let i = 1; i <= 100; i++) {
    assert.ok(rollEntryBlend(i / 100) >= rollEntryBlend((i - 1) / 100));
    assert.ok(rollExitBlend(i / 100) >= rollExitBlend((i - 1) / 100));
  }
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
    assert.ok(rec.scales.length >= 1, 'the rig renderer should scale at least once');
    for (const [sx, sy] of rec.scales) {
      near(sx, sy, 1e-9);
      assert.ok(sx > 0.6 && sx < 1.4, `scale ${sx}`);
    }
    // 朝向：中段对齐 rollDirection（向东），起滚/收尾回到鼠标朝向（向北）。
    // rotates[0] 是整帧的整体朝向；后面的是武器等局部旋转。
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
  advance(p, 0.3);
  assert.equal(p.isRolling(), false);
  assert.ok(Math.abs(p.x - 143) < 1.5, `roll moved ${p.x}px`);
});

test('起滚与收尾混合到真实站立姿态，而不是固定 REST', () => {
  const p = new Player(200, 200);
  const map = mapOf();
  const aim = aimAt(700, 120);
  for (let i = 0; i < 30; i++) p.update(1 / 60, input('d'), map, aim);
  p.switchWeapon('secondary');
  p.update(1 / 60, input('d'), map, aim);
  p.rollDirection.set(1, 0);

  const normal = p.getRenderState();
  assert.equal(normal.rolling, false);
  assert.equal(normal.progress, 0);
  assert.ok(poseDelta(normal.pose, ROLL_REST_POSE) > 0.1, 'aim/run pose should differ from the fixed REST pose');

  // 起滚第一帧：姿态、朝向、缩放都应与刚刚的正常帧连续。
  p.rollTimeLeft = p.roll.duration * (1 - 1e-4);
  const entry = p.getRenderState();
  assert.equal(entry.rolling, true);
  assert.ok(poseDelta(entry.pose, normal.pose) < 0.01, `entry pose jumped ${poseDelta(entry.pose, normal.pose)}`);
  near(entry.angle, normal.angle, 1e-9);
  near(entry.scale, normal.scale, 1e-9);
  near(entry.stowedAlpha, 1, 1e-9);

  // 中段确实完全是翻滚姿态（证明上面的连续不是因为姿态始终没变）。
  p.rollTimeLeft = p.roll.duration * 0.5;
  const mid = p.getRenderState();
  assert.ok(poseDelta(mid.pose, normal.pose) > 0.1, 'mid roll should look clearly different');

  // 收尾最后一帧：同样回到当前真实站立姿态（含抬枪、换枪偏移、跑步摇摆）。
  p.rollTimeLeft = p.roll.duration * 1e-4;
  const tail = p.getRenderState();
  assert.equal(tail.rolling, true);
  near(tail.progress, 0.9999, 1e-4);
  assert.ok(poseDelta(tail.pose, normal.pose) < 0.01, `tail pose jumped ${poseDelta(tail.pose, normal.pose)}`);
  near(tail.angle, normal.angle, 1e-9);
  near(tail.scale, normal.scale, 1e-9);
  near(tail.stowedAlpha, 1, 1e-9);
});

test('呼吸缩放在起滚与收尾两端连续，中段回到 1', () => {
  const p = new Player(300, 300);
  p.setIdleTime(1.2);
  p.rollDirection.set(1, 0);
  const normal = p.getRenderState();
  assert.ok(normal.scale > 1.01, `idle breath scale should be visible: ${normal.scale}`);

  p.rollTimeLeft = p.roll.duration * (1 - 1e-4);
  near(p.getRenderState().scale, normal.scale, 1e-3);
  p.rollTimeLeft = p.roll.duration * 0.5;
  near(p.getRenderState().scale, 1, 1e-9);
  p.rollTimeLeft = p.roll.duration * 1e-4;
  near(p.getRenderState().scale, normal.scale, 1e-3);
});

test('瞄准、换枪、奔跑中的翻滚逐帧连续，收尾回到真实姿态', () => {
  const p = new Player(200, 200);
  const map = mapOf();
  const aim = aimAt(200, -500); // 朝北瞄准，向东翻滚 => 90° 的视觉差
  for (let i = 0; i < 30; i++) p.update(1 / 60, input('d'), map, aim);
  p.switchWeapon('secondary');
  p.update(1 / 60, input('d'), map, aim);
  assert.equal(p.requestRoll(input('d')), true);

  let prev = p.getRenderState();
  let maxPoseStep = 0;
  let maxAngleStep = 0;
  for (let i = 0; i < 30; i++) {
    p.update(1 / 60, input('d'), map, aim);
    const state = p.getRenderState();
    maxPoseStep = Math.max(maxPoseStep, poseDelta(prev.pose, state.pose));
    maxAngleStep = Math.max(maxAngleStep, Math.abs(signedAngle(prev.angle, state.angle)));
    prev = state;
  }
  assert.ok(maxPoseStep < 0.35, `pose jumped ${maxPoseStep} in one frame`);
  assert.ok(maxAngleStep < 0.6, `visual rotation jumped ${maxAngleStep} rad in one frame`);
  assert.equal(p.isRolling(), false);
  const normal = p.getRenderState();
  assert.equal(normal.rolling, false);
  assert.ok(poseDelta(prev.pose, normal.pose) < 0.08, 'last roll frame should be close to the normal pose');
});

test('正常姿态构造支持空手、手枪与主武器', () => {
  const p = new Player(0, 0);
  p.setIdleTime(0.7);
  for (const slot of ['melee', 'secondary', 'primary']) {
    p.switchWeapon(slot);
    p.weaponSwapTime = 0;
    const pose = p.getNormalPose();
    for (const [key, value] of Object.entries(pose)) {
      assert.ok(Number.isFinite(value), `${slot}.${key} is not finite`);
    }
    const state = p.getRenderState();
    assert.equal(state.rolling, false);
    for (const [key, value] of Object.entries(state.pose)) {
      assert.ok(Number.isFinite(value), `${slot}.render.${key} is not finite`);
    }
  }
});

test('长帧跨过翻滚结束点时，物理状态正确且余下时间继续普通移动', () => {
  const map = mapOf();
  const idle = new Player(0, 0);
  assert.equal(idle.requestRoll(input('d')), true);
  idle.update(0.55, input(), map);
  assert.equal(idle.isRolling(), false);
  assert.ok(Math.abs(idle.x - 143) < 0.8, `long frame rolled ${idle.x}px`);
  near(idle.getVelocity().length(), 0);
  near(idle.getRollCooldownRemaining(), 0.35, 0.01);
  assert.equal(idle.getRollProgress(), 0);

  const moving = new Player(0, 0);
  assert.equal(moving.requestRoll(input('d')), true);
  moving.update(0.55, input('d'), map);
  assert.equal(moving.isRolling(), false);
  // 0.5s 翻滚 + 0.05s 普通移动，余量不能被丢掉。
  assert.ok(moving.x > 143 && moving.x < 165, `long frame with input moved ${moving.x}px`);
  assert.ok(moving.getVelocity().length() > 0);

  const exact = new Player(0, 0);
  assert.equal(exact.requestRoll(input('d')), true);
  exact.update(DEFAULT_ROLL.duration, input(), map);
  assert.equal(exact.isRolling(), false);
  assert.ok(Math.abs(exact.x - 143) < 0.8, `exact end frame moved ${exact.x}px`);
  exact.update(0.1, input(), map);
  assert.equal(exact.isRolling(), false);
});
