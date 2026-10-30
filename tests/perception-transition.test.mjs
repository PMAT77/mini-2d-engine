import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeMap, load, makeLight, makeObserver, makeTarget, makeTerrain } from './vision-helpers.mjs';

const { PerceptionSystem } = load('vision/PerceptionSystem');
const { createVisionRules } = load('vision/VisionRules');

const EPS = 1e-9;
const close = (actual, expected, eps = EPS) => Math.abs(actual - expected) <= eps;
const newSystem = (rules = createVisionRules()) =>
  new PerceptionSystem({ map: new FakeMap(), terrain: makeTerrain(), rules });

test('黑暗近身：剪影权重按 dt 线性增长，完整形象保持 0', () => {
  const system = newSystem();
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('t', 120, 150);

  let previous = 0;
  for (let i = 0; i < 5; i += 1) {
    system.update(0.05, [observer], [], [target]);
    const view = system.getView('p', 't');
    assert.equal(view.level, 'silhouette');
    assert.equal(view.alpha, 0);
    assert.ok(view.silhouette > previous, `silhouette weight should grow, got ${JSON.stringify(view)}`);
    assert.ok(close(view.silhouette, Math.min(1, previous + 0.05 / 0.25)),
      `silhouette step should follow dt/fade, got ${JSON.stringify(view)}`);
    previous = view.silhouette;
  }

  system.update(0.5, [observer], [], [target]);
  assert.ok(close(system.getView('p', 't').silhouette, 1));
});

test('近身辨识：完整形象与剪影互补，照明褪去时彩色让位给灰色剪影', () => {
  const system = newSystem();
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('t', 120, 150);
  const light = makeLight('flashlight', 120, 150);

  system.update(0.06, [observer], [light], [target]);
  const early = system.getView('p', 't');
  assert.equal(early.level, 'silhouette', '确认时间未满前不能提前进入 identified');
  assert.ok(close(early.alpha, 0.5));
  assert.equal(early.silhouette, 0);

  system.update(0.06, [observer], [light], [target]);
  const identified = system.getView('p', 't');
  assert.equal(identified.level, 'identified');
  assert.ok(close(identified.alpha, 1));
  assert.equal(identified.silhouette, 0);

  const off = { ...light, active: false };
  system.update(0.05, [observer], [off], [target]);
  const fading = system.getView('p', 't');
  assert.equal(fading.level, 'identified', '淡出期间保持语义层级，避免 UI 突跳');
  assert.ok(close(fading.alpha, 0.8));
  assert.ok(close(fading.silhouette, 0.2));
  assert.ok(close(fading.alpha + fading.silhouette, 1), '近身时两个权重必须互补');

  system.update(0.1, [observer], [off], [target]);
  const mixed = system.getView('p', 't');
  assert.ok(close(mixed.alpha, 0.4));
  assert.ok(close(mixed.silhouette, 0.6));

  system.update(0.2, [observer], [off], [target]);
  const settled = system.getView('p', 't');
  assert.equal(settled.level, 'silhouette');
  assert.equal(settled.alpha, 0);
  assert.ok(close(settled.silhouette, 1));
});

test('近身之外失去照明：只淡出完整形象，不凭空生成剪影', () => {
  const system = newSystem();
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('t', 200, 150);
  const light = makeLight('flashlight', 200, 150);

  system.update(0.2, [observer], [light], [target]);
  assert.equal(system.getView('p', 't').level, 'identified');

  const off = { ...light, active: false };
  for (let i = 0; i < 4; i += 1) {
    system.update(0.05, [observer], [off], [target]);
    const view = system.getView('p', 't');
    assert.equal(view.silhouette, 0, `远处失光不能生成剪影，got ${JSON.stringify(view)}`);
  }

  system.update(0.2, [observer], [off], [target]);
  const gone = system.getView('p', 't');
  assert.equal(gone.level, 'hidden');
  assert.equal(gone.alpha, 0);
  assert.equal(gone.silhouette, 0);
});

test('墙体硬遮挡：视觉权重立即清零，不走渐隐', () => {
  const map = new FakeMap([{ x: 130, y: 0, w: 30, h: 300 }]);
  const system = new PerceptionSystem({ map, terrain: makeTerrain(), rules: createVisionRules() });
  const observer = makeObserver('p', 50, 150);
  const visible = makeTarget('t', 120, 150);
  const hidden = makeTarget('t', 170, 150);
  const light = makeLight('flashlight', 120, 150);

  system.update(0.2, [observer], [light], [visible]);
  assert.equal(system.getView('p', 't').level, 'identified');

  system.update(0.01, [observer], [light], [hidden]);
  const view = system.getView('p', 't');
  assert.equal(view.level, 'hidden');
  assert.equal(view.alpha, 0);
  assert.equal(view.silhouette, 0);
});

test('光照边缘滞回：强度在阈值附近抖动时不再灰彩闪烁', () => {
  const system = newSystem();
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('t', 200, 150);
  const strong = makeLight('flashlight', 200, 150, { intensity: 0.31 });
  const weak = { ...strong, intensity: 0.25 };

  // 阈值 0.3，滞回系数 0.8 → 退出阈值 0.24；0.25 仍应维持已点亮状态。
  system.update(0.2, [observer], [strong], [target]);
  assert.equal(system.getView('p', 't').level, 'identified');

  let flips = 0;
  for (let i = 0; i < 20; i += 1) {
    const before = system.getView('p', 't').level;
    system.update(1 / 60, [observer], [i % 2 === 0 ? weak : strong], [target]);
    const after = system.getView('p', 't');
    if (after.level !== before) flips += 1;
    assert.equal(after.level, 'identified', `frame ${i} should stay identified, got ${JSON.stringify(after)}`);
    assert.ok(close(after.alpha, 1));
  }
  assert.equal(flips, 0);
});

test('过渡与帧率无关：1/60 步进与单步积分结果一致', () => {
  const rules = createVisionRules();
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('t', 200, 150);
  const light = makeLight('flashlight', 200, 150);

  const single = newSystem(rules);
  const stepped = newSystem(rules);
  single.update(0.1, [observer], [light], [target]);
  for (let i = 0; i < 6; i += 1) stepped.update(1 / 60, [observer], [light], [target]);
  assert.ok(close(single.getView('p', 't').alpha, stepped.getView('p', 't').alpha),
    '点亮阶段应与帧率无关');

  single.update(0.2, [observer], [light], [target]);
  stepped.update(0.2, [observer], [light], [target]);
  const off = { ...light, active: false };
  single.update(0.1, [observer], [off], [target]);
  for (let i = 0; i < 6; i += 1) stepped.update(1 / 60, [observer], [off], [target]);
  assert.ok(close(single.getView('p', 't').alpha, stepped.getView('p', 't').alpha),
    '淡出阶段应与帧率无关');
});

test('VisionRules 校验辨识滞回系数', () => {
  assert.equal(createVisionRules().identifyLightHysteresis, 0.8);
  assert.equal(createVisionRules({ identifyLightHysteresis: 0.5 }).identifyLightHysteresis, 0.5);
  assert.throws(() => createVisionRules({ identifyLightHysteresis: 0 }), /辨识光照滞回系数/);
  assert.throws(() => createVisionRules({ identifyLightHysteresis: 1.2 }), /辨识光照滞回系数/);
  assert.throws(() => createVisionRules({ identifyLightHysteresis: Number.NaN }), /辨识光照滞回系数/);
});
