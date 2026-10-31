import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { ChickenBehavior } = load('ai/ChickenBehavior');
const { createSenseRules } = load('ai/SenseRules');

const rules = createSenseRules();
const fixedRandom = () => 0;
const threat = { x: 120, y: 0 };

test('漫游被惊到只尖叫一次，随后进入逃跑并刷新威胁位置', () => {
  const behavior = new ChickenBehavior(rules, fixedRandom);

  let view = behavior.update(0.016, threat);
  assert.equal(view.state, 'startled');
  assert.equal(view.justStartled, true);

  view = behavior.update(0.05, threat);
  assert.equal(view.state, 'startled');
  assert.equal(view.justStartled, false, '同一次发现不应再次尖叫');

  view = behavior.update(0.1, threat);
  assert.equal(view.state, 'flee');

  // 逃跑途中再次感知威胁：只延长逃跑、刷新位置，不重新播放惊叫。
  view = behavior.update(0.6, { x: 200, y: 40 });
  assert.equal(view.state, 'flee');
  assert.equal(view.justStartled, false);
  assert.equal(behavior.getThreatX(), 200);
  assert.equal(behavior.getThreatY(), 40);
});

test('逃跑计时走完后进入恢复，安全后回到漫游', () => {
  const behavior = new ChickenBehavior(rules, fixedRandom);
  behavior.update(0.016, threat);
  behavior.update(0.13, threat); // startled -> flee
  assert.equal(behavior.getState(), 'flee');

  behavior.update(1.0, null); // flee 结束 -> recover
  assert.equal(behavior.getState(), 'recover');

  behavior.update(0.6, null); // recover 结束 -> wander
  assert.equal(behavior.getState(), 'wander');
});

test('恢复期再被威胁只会重新警觉，不重复惊叫', () => {
  const behavior = new ChickenBehavior(rules, fixedRandom);
  behavior.update(0.016, threat);
  behavior.update(0.13, threat);
  behavior.update(1.0, null);
  assert.equal(behavior.getState(), 'recover');

  const view = behavior.update(0.016, threat);
  assert.equal(view.state, 'startled');
  assert.equal(view.justStartled, false);
});

test('没有威胁时状态机不会自己启动', () => {
  const behavior = new ChickenBehavior(rules, fixedRandom);
  for (let frame = 0; frame < 60; frame++) {
    assert.equal(behavior.update(1 / 60, null).state, 'wander');
  }
});
