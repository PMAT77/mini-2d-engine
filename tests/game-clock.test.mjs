import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameClock, readGameTime, getGameDay, DEFAULT_PHASE_DURATIONS } = load('campaign/GameClock');
const { advanceWithEmptyNights } = load('campaign/PrototypeNight');
const types = result => result.events.map(event => event.type);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, actual + ' != ' + expected);

test('clock derives survival days and phases from 06:00, without changing raid day at midnight', () => {
  const cases = [
    [0, 1, 6, 0, 'day'], [719.99, 1, 17, 59, 'day'], [720, 1, 18, 0, 'dusk'],
    [839.99, 1, 19, 59, 'dusk'], [840, 1, 20, 0, 'night'], [1080, 1, 0, 0, 'night'],
    [1439.99, 1, 5, 59, 'night'], [1440, 2, 6, 0, 'day'], [2880, 3, 6, 0, 'day'],
  ];
  for (const [worldMinute, day, hour, minute, phase] of cases) {
    assert.deepEqual(readGameTime(worldMinute), { worldMinute, day, hour, minute, phase });
    assert.equal(getGameDay(worldMinute), day);
  }
});

test('generic clock uses each phase duration and keeps the full night', () => {
  const clock = new GameClock();
  assert.equal(clock.read(0).secondsToNextBoundary, 900);
  const dusk = clock.advance(0, 900);
  assert.equal(dusk.worldMinute, 720);
  assert.deepEqual(dusk.events, [{ id: 'day-1:DuskStarted', type: 'DuskStarted', worldMinute: 720, day: 1 }]);
  const night = clock.advance(720, 120);
  assert.equal(night.worldMinute, 840);
  assert.deepEqual(types(night), ['NightStarted']);
  const morning = clock.advance(840, 300);
  assert.equal(morning.worldMinute, 1440);
  assert.deepEqual(morning.events, [{ id: 'day-2:DayStarted', type: 'DayStarted', worldMinute: 1440, day: 2 }]);
  assert.equal(clock.advance(840, 120).worldMinute, 1080, 'midnight is not an additional date event');
  assert.deepEqual(clock.advance(840, 120).events, []);
});

test('a large step consumes remaining seconds at the new rate and emits ordered boundaries once', () => {
  const clock = new GameClock();
  const result = clock.advance(719.6, 422.5);
  close(result.worldMinute, 1441.6);
  assert.equal(result.fromWorldMinute, 719.6);
  assert.deepEqual(result.events.map(e => e.worldMinute), [720, 840, 1440]);
  assert.deepEqual(types(result), ['DuskStarted', 'NightStarted', 'DayStarted']);
  const multiDay = clock.advance(0, 1320 * 3);
  assert.equal(multiDay.worldMinute, 4320);
  assert.equal(multiDay.events.length, 9);
  assert.equal(new Set(multiDay.events.map(e => e.id)).size, 9);
});

test('explicit jumps enumerate (start, end] and do not replay a boundary after reconstruction', () => {
  const result = new GameClock().advanceTo(719, 2880);
  assert.deepEqual(result.events.map(e => e.worldMinute), [720, 840, 1440, 2160, 2280, 2880]);
  for (const saved of [720, 840, 1440]) {
    const restored = new GameClock();
    assert.deepEqual(restored.advance(saved, 0).events, []);
    assert.deepEqual(restored.advanceTo(saved, saved).events, []);
    assert.deepEqual(restored.advance(saved, .25).events, []);
  }
  const near = new GameClock().advanceTo(719, 720 - 1e-8);
  assert.deepEqual(near.events, [], 'explicit target jumps never snap past their requested endpoint');
  assert.deepEqual(types(new GameClock().advanceTo(near.worldMinute, 720)), ['DuskStarted']);
  assert.throws(() => new GameClock().advanceTo(720, 719), /倒退/);
});

test('custom phase durations are copied, validated and independent across clocks', () => {
  const config = { daySeconds: 12, duskSeconds: 2, nightSeconds: 10 };
  const fast = new GameClock(config);
  config.daySeconds = 999;
  assert.equal(fast.advance(0, 12).worldMinute, 720);
  assert.equal(fast.advance(0, 24).worldMinute, 1440);
  close(new GameClock().advance(0, 12).worldMinute, 9.6);
  assert.ok(Object.isFrozen(DEFAULT_PHASE_DURATIONS));
  for (const invalid of [null, [], {}, { ...config, extra: 1 }, { ...config, daySeconds: 0 },
    { ...config, duskSeconds: -1 }, { ...config, nightSeconds: Infinity },
    { ...config, daySeconds: NaN }, { ...config, daySeconds: '12' },
    { ...config, daySeconds: Number.MIN_VALUE }]) {
    assert.throws(() => new GameClock(invalid));
  }
});

test('pause reasons are independent and idempotent, with no elapsed-time catchup', () => {
  const clock = new GameClock();
  clock.setPaused('menu', true);
  clock.setPaused('menu', true);
  clock.setPaused('blur', true);
  clock.setPaused('hidden', true);
  clock.getPauseReasons().splice(0);
  assert.deepEqual(clock.getPauseReasons(), ['menu', 'blur', 'hidden']);
  clock.setPaused('menu', false);
  assert.deepEqual(clock.advance(719, 9000), { fromWorldMinute: 719, worldMinute: 719, events: [] });
  assert.equal(clock.advanceTo(719, 2880).worldMinute, 719);
  clock.setPaused('blur', false);
  assert.equal(clock.isPaused(), true);
  clock.setPaused('hidden', false);
  assert.equal(clock.isPaused(), false);
  close(clock.advance(719, 1).worldMinute, 719.8);
  for (const reason of ['loading', 'storage', 'construction', 'debug']) {
    clock.setPaused(reason, true);
    assert.equal(clock.advance(840, 300).worldMinute, 840);
    clock.setPaused(reason, false);
  }
  assert.throws(() => clock.setPaused('backpack', true), /暂停/);
  assert.throws(() => clock.setPaused('menu', 1), /暂停/);
});

test('invalid times and unrepresentable or excessive advances fail without poisoning later calculations', () => {
  const clock = new GameClock();
  for (const invalid of [-1, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => clock.read(invalid));
    assert.throws(() => clock.advance(invalid, 0));
    assert.throws(() => clock.advanceTo(0, invalid));
  }
  for (const invalid of [-1, NaN, Infinity, '1', null]) assert.throws(() => clock.advance(0, invalid));
  assert.throws(() => clock.advance(Number.MAX_SAFE_INTEGER, .001), /精度/);
  assert.throws(() => clock.advance(Number.MAX_SAFE_INTEGER, 900), /安全范围/);
  assert.throws(() => clock.advanceTo(0, 1440 * 2000), /过多阶段/);
  assert.throws(() => clock.advance(0, Number.MAX_VALUE), /过多阶段/);
  clock.setPaused('menu', true);
  assert.throws(() => clock.advance(0, NaN), /模拟时间/);
  assert.throws(() => clock.advanceTo(720, 0), /倒退/);
  clock.setPaused('menu', false);
  assert.equal(clock.advance(0, 1).worldMinute, .8);
});

test('equal accepted simulation time at 30, 60 and 144 FPS yields the same generic clock and events', () => {
  const seconds = 1320 * 3 + 17, expected = new GameClock().advance(0, seconds);
  for (const fps of [30, 60, 144]) {
    const clock = new GameClock(), events = [];
    let worldMinute = 0;
    for (let frame = 0; frame < seconds * fps; frame++) {
      const step = clock.advance(worldMinute, 1 / fps);
      worldMinute = step.worldMinute;
      events.push(...step.events);
    }
    close(worldMinute, expected.worldMinute);
    assert.deepEqual(events, expected.events, 'events at ' + fps + ' FPS');
  }
});

test('empty-night coordinator emits night and next morning together even when a step ends exactly at 20:00', () => {
  const clock = new GameClock();
  const result = advanceWithEmptyNights(clock, 720, 120);
  assert.equal(result.worldMinute, 1440);
  assert.deepEqual(types(result), ['NightStarted', 'DayStarted']);
  assert.deepEqual(result.events.map(e => e.worldMinute), [840, 1440]);
  assert.equal(clock.advance(720, 120).worldMinute, 840, 'temporary policy is not embedded in the generic clock');
  assert.equal(advanceWithEmptyNights(clock, 0, 1020).worldMinute, 1440);
});

test('empty nights consume no simulation seconds and preserve the remainder across multiple days', () => {
  const clock = new GameClock();
  const result = advanceWithEmptyNights(clock, 0, 1020 * 3 + 17);
  close(result.worldMinute, 4320 + 13.6);
  assert.deepEqual(result.events.map(e => e.worldMinute), [720, 840, 1440, 2160, 2280, 2880, 3600, 3720, 4320]);
  assert.equal(new Set(result.events.map(e => e.id)).size, result.events.length);
  assert.equal(advanceWithEmptyNights(new GameClock({ daySeconds: 12, duskSeconds: 2, nightSeconds: 1000 }), 0, 14).worldMinute, 1440);
});

test('restored night skips once on the next positive step without replaying NightStarted', () => {
  for (const saved of [840, 1080, 1439]) {
    const clock = new GameClock();
    assert.equal(advanceWithEmptyNights(clock, saved, 0).worldMinute, saved);
    clock.setPaused('loading', true);
    assert.equal(advanceWithEmptyNights(clock, saved, 10).worldMinute, saved);
    clock.setPaused('loading', false);
    const result = advanceWithEmptyNights(clock, saved, 1);
    close(result.worldMinute, 1440.8);
    assert.deepEqual(types(result), ['DayStarted']);
    assert.deepEqual(advanceWithEmptyNights(clock, result.worldMinute, 1).events, []);
  }
});

test('equal simulation time at 30, 60 and 144 FPS yields the same empty-night progression', () => {
  const seconds = 1020 * 3 + 17, expected = advanceWithEmptyNights(new GameClock(), 0, seconds);
  for (const fps of [30, 60, 144]) {
    const clock = new GameClock(), events = [];
    let worldMinute = 0;
    for (let frame = 0; frame < seconds * fps; frame++) {
      const step = advanceWithEmptyNights(clock, worldMinute, 1 / fps);
      worldMinute = step.worldMinute;
      events.push(...step.events);
    }
    close(worldMinute, expected.worldMinute);
    assert.deepEqual(events, expected.events, 'empty nights at ' + fps + ' FPS');
  }
});

test('empty-night calculations reject invalid or excessive steps, including while paused', () => {
  const clock = new GameClock();
  for (const invalid of [-1, NaN, Infinity, '1', null]) assert.throws(() => advanceWithEmptyNights(clock, 0, invalid));
  assert.throws(() => advanceWithEmptyNights(clock, 0, Number.MAX_VALUE), /过多阶段/);
  clock.setPaused('hidden', true);
  assert.throws(() => advanceWithEmptyNights(clock, 840, NaN), /模拟时间/);
  assert.equal(advanceWithEmptyNights(clock, 840, 1200).worldMinute, 840);
});
