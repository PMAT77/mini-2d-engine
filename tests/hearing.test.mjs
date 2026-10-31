import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { computeAudibleGain } = load('core/SoundAttenuation');
const { NoiseSystem } = load('core/NoiseSystem');
const { HearingSensor } = load('ai/HearingSensor');
const { createSenseRules } = load('ai/SenseRules');

const OPEN_RANGE = 450;

function openMap() {
  return {
    blocksLightAt: () => false,
    getBlockingPolygons: () => [],
  };
}

/** 在 x = 100 处竖一面墙，用于验证声音的墙体衰减。 */
function wallMap(wallX = 100) {
  return {
    blocksLightAt: () => false,
    getBlockingPolygons: () => [{
      vertices: [
        { x: wallX, y: -100 },
        { x: wallX, y: 100 },
        { x: wallX + 10, y: 100 },
        { x: wallX + 10, y: -100 },
      ],
    }],
  };
}

function emitCluck(noise, x, y) {
  noise.emit('cluck', x, y, { radius: OPEN_RANGE });
}

const close = (actual, expected, epsilon = 1e-5) => Math.abs(actual - expected) <= epsilon;

test('可听增益：近场稳定、中距离缓降、边界归零', () => {
  assert.ok(close(computeAudibleGain(0, OPEN_RANGE), 1));
  assert.ok(close(computeAudibleGain(-10, OPEN_RANGE), 1), '负距离按 0 处理');
  assert.ok(close(computeAudibleGain(225, OPEN_RANGE), 0.5140817));
  assert.ok(close(computeAudibleGain(400, OPEN_RANGE), 0.1056396));
  assert.ok(close(computeAudibleGain(OPEN_RANGE, OPEN_RANGE), 0));
  assert.ok(close(computeAudibleGain(OPEN_RANGE + 1, OPEN_RANGE), 0));
  assert.equal(computeAudibleGain(10, 0), 0);
  assert.equal(computeAudibleGain(Number.NaN, OPEN_RANGE), 0);
});

test('可听增益：随距离单调不增', () => {
  let previous = 1;
  for (let distance = 0; distance <= OPEN_RANGE; distance += 10) {
    const gain = computeAudibleGain(distance, OPEN_RANGE);
    assert.ok(gain <= previous + 1e-9, `distance ${distance} 的增益不应回升`);
    previous = gain;
  }
  assert.equal(previous, 0);
});

test('听见：200px 的鸡叫（响度 0.45）超过默认听阈', () => {
  const noise = new NoiseSystem();
  emitCluck(noise, 200, 0);
  const sensor = new HearingSensor();
  const heard = sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents());

  assert.equal(heard.length, 1);
  assert.equal(heard[0].kind, 'sound');
  assert.equal(heard[0].eventId, 1);
  assert.equal(heard[0].noiseKind, 'cluck');
  assert.equal(heard[0].x, 200);
  assert.equal(heard[0].y, 0);
  assert.ok(close(heard[0].distance, 200));
  assert.ok(close(heard[0].gain, 0.590164));
  assert.ok(close(heard[0].strength, 0.45 * 0.590164));
});

test('听不见：同一声音在 400px 处已低于 0.08 听阈', () => {
  const noise = new NoiseSystem();
  emitCluck(noise, 400, 0);
  const sensor = new HearingSensor();
  assert.deepEqual(sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents()), []);
});

test('墙体衰减：200px 隔墙仍能听见，350px 隔墙已低于听阈', () => {
  const nearNoise = new NoiseSystem();
  emitCluck(nearNoise, 200, 0);
  const ear = new HearingSensor();
  const near = ear.poll(wallMap(), { x: 0, y: 0 }, nearNoise.getEvents());
  assert.equal(near.length, 1);
  assert.ok(close(near[0].gain, 0.590164 * 0.4));
  assert.ok(close(near[0].strength, 0.45 * 0.590164 * 0.4));

  const farNoise = new NoiseSystem();
  emitCluck(farNoise, 350, 0);
  const sheltered = new HearingSensor();
  assert.deepEqual(sheltered.poll(wallMap(), { x: 0, y: 0 }, farNoise.getEvents()), []);
});

test('开阔地：350px 的鸡叫仍能听见（与隔墙形成对照）', () => {
  const noise = new NoiseSystem();
  emitCluck(noise, 350, 0);
  const sensor = new HearingSensor();
  const heard = sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents());
  assert.equal(heard.length, 1);
  assert.ok(heard[0].strength > 0.08);
});

test('枪声：近距离强烈、550px 处不再触发听觉', () => {
  const nearNoise = new NoiseSystem();
  nearNoise.emit('gunshot', 30, 0);
  const near = new HearingSensor().poll(openMap(), { x: 0, y: 0 }, nearNoise.getEvents());
  assert.equal(near.length, 1);
  assert.ok(near[0].strength > 0.99);

  const farNoise = new NoiseSystem();
  farNoise.emit('gunshot', 550, 0);
  assert.deepEqual(new HearingSensor().poll(openMap(), { x: 0, y: 0 }, farNoise.getEvents()), []);
});

test('去重：同一个噪声事件只产生一次听觉刺激', () => {
  const noise = new NoiseSystem();
  emitCluck(noise, 200, 0);
  const sensor = new HearingSensor();

  assert.equal(sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents()).length, 1);
  assert.equal(sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents()).length, 0);

  emitCluck(noise, 210, 0);
  assert.equal(sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents()).length, 1);
});

test('听阈覆盖：过高的门槛不会消费事件，放宽后仍能听见', () => {
  const noise = new NoiseSystem();
  emitCluck(noise, 200, 0);
  const sensor = new HearingSensor();

  assert.deepEqual(sensor.poll(openMap(), { x: 0, y: 0, threshold: 0.5 }, noise.getEvents()), []);
  assert.equal(sensor.getLastProcessedId(), 0);

  const heard = sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents());
  assert.equal(heard.length, 1);
});

test('新鲜度：超过 0.3s 的旧声音不再触发感知，新事件不受影响', () => {
  const noise = new NoiseSystem();
  emitCluck(noise, 200, 0);
  noise.update(0.31);

  const sensor = new HearingSensor();
  assert.deepEqual(sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents()), []);

  emitCluck(noise, 202, 0);
  const heard = sensor.poll(openMap(), { x: 0, y: 0 }, noise.getEvents());
  assert.equal(heard.length, 1);
  assert.equal(heard[0].eventId, 2);
});

test('结果按刺激强度降序排列', () => {
  const noise = new NoiseSystem();
  noise.emit('footstep', 100, 0);
  noise.emit('gunshot', 200, 0);
  const heard = new HearingSensor().poll(openMap(), { x: 0, y: 0 }, noise.getEvents());

  assert.equal(heard.length, 2);
  assert.equal(heard[0].noiseKind, 'gunshot');
  assert.equal(heard[1].noiseKind, 'footstep');
  assert.ok(heard[0].strength > heard[1].strength);
});

test('SenseRules 校验：非法值抛错，覆盖值生效', () => {
  assert.throws(() => createSenseRules({ freshnessSeconds: -1 }), /SenseRules\.freshnessSeconds/);
  assert.throws(() => createSenseRules({ hearingThreshold: Number.NaN }), /SenseRules\.hearingThreshold/);
  assert.throws(() => createSenseRules({ wallAttenuation: 1.5 }), /SenseRules\.wallAttenuation/);
  assert.throws(() => createSenseRules({ nearSenseRadius: 0 }), /SenseRules\.nearSenseRadius/);
  assert.equal(createSenseRules({ hearingThreshold: 0.2 }).hearingThreshold, 0.2);
});
