import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { VisionSensor } = load('ai/VisionSensor');
const { createSenseRules } = load('ai/SenseRules');

const openMap = () => ({ blocksLightAt: () => false, getBlockingPolygons: () => [] });
const wallMap = x => ({
  blocksLightAt: () => false,
  getBlockingPolygons: () => [{
    vertices: [{ x, y: -500 }, { x, y: 500 }, { x: x + 6, y: 500 }, { x: x + 6, y: -500 }],
  }],
});
const flashlight = (x, y, direction = 0) => ({
  id: 'flashlight',
  x, y,
  radius: 400,
  direction,
  angle: Math.PI / 2,
  softness: 0.1,
  innerRadius: 0,
  innerFade: 16,
  intensity: 0.8,
  active: true,
  revealsDetails: true,
  kind: 'flashlight',
});

test('近距离全向：背对目标也能发现，但要等确认时间', () => {
  const sensor = new VisionSensor(createSenseRules());
  const behind = sensor.sense(0.05, openMap(), { x: 0, y: 0, facing: 0 }, { x: -60, y: 0 });
  assert.equal(behind.detected, true);
  assert.equal(behind.visible, false, '0.05 秒不足 0.12 秒确认时间');
  const confirmed = sensor.sense(0.1, openMap(), { x: 0, y: 0, facing: 0 }, { x: -60, y: 0 });
  assert.equal(confirmed.visible, true);
});

test('远距离只看正面 240 度，背后的目标不进入视野', () => {
  const sensor = new VisionSensor(createSenseRules());
  const sample = sensor.sense(0.5, openMap(), { x: 0, y: 0, facing: Math.PI }, { x: 150, y: 0 });
  assert.equal(sample.detected, false, '目标在正后方，超出 ±120 度');
});

test('无光时视觉距离是 120，超出即隐藏', () => {
  const sensor = new VisionSensor(createSenseRules());
  const sample = sensor.sense(0.5, openMap(), { x: 0, y: 0, facing: 0 }, { x: 150, y: 0 });
  assert.equal(sample.detected, false);
});

test('被手电照到的目标可看 200 且标记 illuminated', () => {
  const sensor = new VisionSensor(createSenseRules());
  const lights = [flashlight(50, 0)];
  const sample = sensor.sense(0.2, openMap(), { x: 0, y: 0, facing: 0 }, { x: 150, y: 0 }, lights);
  assert.equal(sample.illuminated, true);
  assert.equal(sample.detected, true);
  assert.equal(sample.visible, true);
});

test('墙后的目标即使落在黑暗视觉距离内也不可见', () => {
  const sensor = new VisionSensor(createSenseRules());
  const sample = sensor.sense(0.5, wallMap(60), { x: 0, y: 0, facing: 0 }, { x: 100, y: 0 });
  assert.equal(sample.detected, false);
});

test('墙挡不住手电时也不应因为“有灯”而看到墙后目标', () => {
  const sensor = new VisionSensor(createSenseRules());
  const lights = [flashlight(30, 0)];
  const sample = sensor.sense(0.5, wallMap(80), { x: 0, y: 0, facing: 0 }, { x: 150, y: 0 }, lights);
  assert.equal(sample.illuminated, false, '光源本身被墙挡住');
  assert.equal(sample.detected, false);
});

test('离开视野后确认计时清零，不会累计散点观察', () => {
  const sensor = new VisionSensor(createSenseRules());
  sensor.sense(0.1, openMap(), { x: 0, y: 0, facing: 0 }, { x: -60, y: 0 });
  sensor.sense(0.1, openMap(), { x: 0, y: 0, facing: Math.PI }, { x: 150, y: 0 });
  const sample = sensor.sense(0.05, openMap(), { x: 0, y: 0, facing: 0 }, { x: -60, y: 0 });
  assert.equal(sample.visible, false);
});
