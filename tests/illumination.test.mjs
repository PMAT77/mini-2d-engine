import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeMap, load, makeLight, makeObserver, makeTarget } from './vision-helpers.mjs';

const {
  lightStrengthAt,
  bestLightAt,
  bestLightForTarget,
  illuminationStrengthAt,
  canIdentifyPoint,
  canIdentifyTarget
} = load('vision/IlluminationProbe');
const { createVisionRules } = load('vision/VisionRules');

const rules = createVisionRules();
const close = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test('点光强度使用 lightFalloff，并限制 intensity', () => {
  const light = makeLight('l', 0, 0);
  close(lightStrengthAt(light, 0, 0), 1);
  const at50 = lightStrengthAt(light, 50, 0);
  assert.ok(at50 > 0.55 && at50 < 0.62, `at50=${at50}`);
  assert.equal(lightStrengthAt(light, 100, 0), 0);
  assert.equal(lightStrengthAt({ ...light, active: false }, 0, 0), 0);
  assert.equal(lightStrengthAt({ ...light, intensity: 2 }, 0, 0), 2);
  assert.equal(lightStrengthAt({ ...light, intensity: 5 }, 0, 0), 2);
});

test('innerRadius 内部为 0，innerFade 平滑过渡', () => {
  const base = makeLight('base', 0, 0);
  const inner = makeLight('inner', 0, 0, { innerRadius: 30, innerFade: 16 });
  assert.equal(lightStrengthAt(inner, 20, 0), 0);
  assert.equal(lightStrengthAt(inner, 30, 0), 0);
  const at38 = lightStrengthAt(inner, 38, 0);
  assert.ok(at38 > 0);
  assert.ok(at38 < lightStrengthAt(base, 38, 0));
  assert.ok(lightStrengthAt(inner, 46, 0) > 0);
  close(lightStrengthAt(inner, 60, 0), lightStrengthAt(base, 60, 0));
});

test('锥光方向、软边与背向遮挡', () => {
  const cone = makeLight('cone', 0, 0, { angle: Math.PI / 2, direction: 0, softness: 0.35 });
  assert.ok(lightStrengthAt(cone, 50, 0) > 0);
  assert.equal(lightStrengthAt(cone, 0, 50), 0);
  assert.ok(lightStrengthAt(cone, 50, 30) > 0);
  assert.equal(lightStrengthAt(cone, -50, 0), 0);

  const rotated = { ...cone, direction: Math.PI / 2 };
  assert.ok(lightStrengthAt(rotated, 0, 50) > 0);
  assert.equal(lightStrengthAt(rotated, 50, 0), 0);
});

test('bestLightAt 取最强光源，并要求光源到目标有视线', () => {
  const map = new FakeMap();
  const weak = makeLight('weak', 50, 0, { intensity: 0.5 });
  const strong = makeLight('strong', 0, 0);
  const hit = bestLightAt(map, 50, 0, [weak, strong], rules);
  assert.ok(hit);
  assert.equal(hit.light.id, 'strong');

  assert.equal(
    bestLightAt(map, 50, 0, [{ ...weak, revealsDetails: false }, { ...strong, active: false }], rules),
    null
  );

  const wall = new FakeMap([{ x: 20, y: -5, w: 10, h: 10 }]);
  assert.equal(bestLightAt(wall, 50, 0, [strong], rules), null);
  assert.equal(bestLightAt(map, 0, 0, [makeLight('dim', 0, 0, { intensity: 0.2 })], rules), null);
});

test('illuminationStrengthAt 默认取最强，可配置求和', () => {
  const map = new FakeMap();
  const a = makeLight('a', 0, 0, { intensity: 0.4 });
  const b = makeLight('b', 0, 0, { intensity: 0.4 });
  close(illuminationStrengthAt(map, 0, 0, [a], rules), 0.4);
  close(illuminationStrengthAt(map, 0, 0, [a, b], rules), 0.4);

  const sumRules = createVisionRules({ strongestLightOnly: false });
  close(illuminationStrengthAt(map, 0, 0, [a, b], sumRules), 0.8);
});

test('canIdentifyPoint/Target 需要范围、LOS 与有效照明', () => {
  const map = new FakeMap();
  const observer = makeObserver('o', 0, 0);
  const target = makeTarget('t', 50, 0);
  const light = makeLight('l', 0, 0, { intensity: 0.6 });

  assert.equal(canIdentifyPoint(map, observer, 50, 0, [light], rules), true);
  assert.equal(canIdentifyTarget(map, observer, target, [light], rules), true);
  assert.ok(bestLightForTarget(map, target, [light], rules));

  assert.equal(canIdentifyPoint(map, observer, 600, 0, [light], rules), false);
  assert.equal(canIdentifyPoint(map, observer, 50, 0, [], rules), false);
  assert.equal(canIdentifyPoint(map, observer, 50, 0, [{ ...light, revealsDetails: false }], rules), false);

  const wall = new FakeMap([{ x: 20, y: -5, w: 10, h: 10 }]);
  assert.equal(canIdentifyPoint(wall, observer, 50, 0, [light], rules), false);

  const ambient = createVisionRules({ ambientIdentifies: true });
  assert.equal(canIdentifyPoint(map, observer, 50, 0, [], ambient), true);
});
