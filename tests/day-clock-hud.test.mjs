import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { getDayClockView, getDayClockHudLayout, clockDigitPositions, DAY_CLOCK_TIMELINE } = load('ui/DayClockHudLayout');
const { GameClock } = load('campaign/GameClock');
const { computeMinimapLayout, createMinimapConfig } = load('minimap/MinimapConfig');
const { getWeaponListLayout } = load('ui/WeaponListHud');
const view = (worldMinute, location = 'field', raid) => getDayClockView({ worldMinute, location, raid });

test('day clock uses the existing 06:00 survival-day and phase boundaries', () => {
  for (const [minute, day, phase, time] of [[0, 1, 'day', '06:00'], [719.99, 1, 'day', '17:59'],
    [720, 1, 'dusk', '18:00'], [839.99, 1, 'dusk', '19:59'], [840, 1, 'night', '20:00'],
    [1439.99, 1, 'night', '05:59'], [1440, 2, 'day', '06:00']]) {
    const reading = view(minute);
    assert.deepEqual([reading.day, reading.phase, reading.clockText], [day, phase, time]);
  }
});
test('timeline uses 12/2/10 world hours and keeps sub-minute precision', () => {
  assert.deepEqual(DAY_CLOCK_TIMELINE, { start: 0, dusk: .5, night: 7 / 12, end: 1 });
  for (const value of [0, .001, 360, 515.25, 720, 840, 1439.999]) assert.equal(view(value).progress, value / 1440);
  assert.equal(view(1440).progress, 0);
});
test('day padding expands at 100 without truncating the date', () => {
  for (const [day, expected] of [[1, '第 01 天'], [3, '第 03 天'], [99, '第 99 天'], [100, '第 100 天'], [1000, '第 1000 天']])
    assert.equal(view((day - 1) * 1440).dayText, expected);
});
test('all five time characters retain fixed positions for narrow and wide digits', () => {
  const slots = clockDigitPositions(357);
  assert.deepEqual(slots, [315, 336, 357, 378, 399]);
  for (const worldMinute of [305, 515, 1080, 1439]) {
    assert.equal(view(worldMinute).clockText.length, slots.length);
    assert.deepEqual(clockDigitPositions(357), slots);
  }
});
test('phase prompts reflect location, deadline and real raid data', () => {
  assert.equal(view(515).status, '距返程截止 03:25');
  assert.equal(view(515, 'camp').status, '白天整备时间');
  assert.equal(view(762, 'camp').status, '距夜袭开始 01:18');
  assert.equal(view(840, 'camp', { wave: 1, totalWaves: 2 }).status, '夜袭进行中 · 第 1 波 / 2');
  assert.equal(view(840, 'camp').status, '夜间防守时间');
  for (const time of [720, 840, 1439]) assert.equal(view(time).status, '已错过返程时间');
  assert.equal(view(1440).status, '距返程截止 12:00');
  assert.equal(view(719.99).status, '距返程截止 00:01');
});
test('last-hour hint warms gradually without a separate animation clock', () => {
  assert.equal(view(659).statusColor, view(660).statusColor);
  assert.notEqual(view(661).statusColor, view(690).statusColor);
  assert.notEqual(view(690).statusColor, view(719.99).statusColor);
});
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
test('CSS-pixel layouts stay centered, inside the viewport and clear of existing HUDs', () => {
  for (const [width, height] of [[2507, 1242], [1920, 1080], [1440, 900], [1100, 800], [800, 600], [640, 360], [390, 844], [320, 568]]) {
    const minimap = computeMinimapLayout(createMinimapConfig(), width, height);
    const reserved = [{ x: minimap.left, y: 0, width: minimap.diameter, height: minimap.top + minimap.diameter + 58 },
      { x: width - 108, y: 0, width: 108, height: 52 }, getWeaponListLayout(width, height).area];
    const layout = getDayClockHudLayout(width, height, reserved);
    assert.equal(layout.x + layout.width / 2, width / 2);
    assert.ok(layout.width >= 230, `${width}x${height} must remain readable: ${JSON.stringify(layout)}`);
    assert.ok(layout.y >= 12 && layout.y + layout.height <= height);
    for (const rect of reserved) assert.equal(overlap(layout, rect), false, `${width}x${height}`);
    if (width >= 1100) assert.deepEqual([layout.width, layout.height, layout.y], [500, 144, 12]);
    if (width <= 640) assert.equal(layout.compact, true);
    for (const dpr of [1, 1.25, 2, 3]) {
      assert.deepEqual(getDayClockHudLayout(width * dpr / dpr, height * dpr / dpr, reserved), layout);
    }
  }
});
test('paused world readings and repeated HUD reads never advance themselves', () => {
  const clock = new GameClock(); clock.setPaused('menu', true);
  let worldMinute = 515.25;
  const initial = view(worldMinute);
  for (let i = 0; i < 100; i++) {
    worldMinute = clock.advance(worldMinute, 100).worldMinute;
    assert.deepEqual(view(worldMinute), initial);
  }
});
test('backpack uses a compact header above its existing tabs', () => {
  const layout = getDayClockHudLayout(1440, 900, [], true);
  assert.deepEqual([layout.compact, layout.y, layout.width, layout.height], [true, 12, 300, 48]);
});
