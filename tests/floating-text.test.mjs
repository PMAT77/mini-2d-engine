import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  FloatingTextSystem, FLOATING_TEXT_HOLD_SECONDS, FLOATING_TEXT_FADE_SECONDS,
  FLOATING_TEXT_SPREAD, FLOATING_TEXT_MIN_RADIUS, FLOATING_TEXT_MAX_RADIUS,
  FLOATING_TEXT_TILT, FLOATING_TEXT_MAX_COUNT,
} = load('ui/FloatingTextSystem');
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b} (±${epsilon})`);
const TOTAL = FLOATING_TEXT_HOLD_SECONDS + FLOATING_TEXT_FADE_SECONDS;

test('pickup text scatters to both sides above the player and keeps a small tilt', () => {
  const sides = [];
  for (const value of [0, 1]) {
    const system = new FloatingTextSystem(() => value);
    system.spawn('金块+1', 500, 400);
    const [view] = system.getTexts();
    assert.equal(view.text, '金块+1');
    assert.equal(view.age, 0);
    assert.equal(view.alpha, 1);
    sides.push(Math.sign(view.x - 500));
    // 出生点始终在角色上方，距离落在配置的圆环里。
    assert.ok(view.y < 400, `y=${view.y} should be above the player`);
    const distance = Math.hypot(view.x - 500, view.y - 400);
    near(distance, value === 0 ? FLOATING_TEXT_MIN_RADIUS : FLOATING_TEXT_MAX_RADIUS, 1e-9);
    near(Math.abs(view.tilt), FLOATING_TEXT_TILT, 1e-9);
    // 偏角不会超过 ±60°：水平距离最多是半径的 sin(60°)。
    assert.ok(Math.abs(view.x - 500) <= distance * Math.sin(FLOATING_TEXT_SPREAD) + 1e-9);
  }
  assert.deepEqual(sides, [-1, 1]);

  const far = new FloatingTextSystem(() => 1);
  far.spawn('HP+5', 200, 300);
  const [view] = far.getTexts();
  near(Math.hypot(view.x - 200, view.y - 300), FLOATING_TEXT_MAX_RADIUS, 1e-9);
});

test('text stays solid for one second, then fades out over 0.4s and expires', () => {
  const system = new FloatingTextSystem(() => 0.5);
  system.spawn('HP+5', 300, 300);

  system.update(FLOATING_TEXT_HOLD_SECONDS);
  assert.equal(system.getTexts().length, 1);
  near(system.getTexts()[0].alpha, 1, 1e-9);

  system.update(FLOATING_TEXT_FADE_SECONDS / 2);
  near(system.getTexts()[0].alpha, 0.5, 1e-9);
  assert.equal(system.getTexts().length, 1);

  system.update(FLOATING_TEXT_FADE_SECONDS / 2 - 1e-6);
  assert.equal(system.getTexts().length, 1);

  system.update(1e-5);
  assert.equal(system.getTexts().length, 0);

  // 非法 delta 不应推进计时。
  const guarded = new FloatingTextSystem(() => 0.5);
  guarded.spawn('金块+1', 0, 0);
  guarded.update(NaN);
  guarded.update(-1);
  assert.equal(guarded.getTexts()[0].age, 0);
  assert.equal(guarded.getTexts()[0].alpha, 1);
});

test('a burst keeps only the newest texts and ignores malformed spawns', () => {
  const system = new FloatingTextSystem(() => 0.5);
  for (let i = 0; i < FLOATING_TEXT_MAX_COUNT + 5; i++) system.spawn(`+${i}`, 100, 100);
  const views = system.getTexts();
  assert.equal(views.length, FLOATING_TEXT_MAX_COUNT);
  assert.equal(views[0].text, '+5');
  assert.equal(views[views.length - 1].text, `+${FLOATING_TEXT_MAX_COUNT + 4}`);

  system.spawn('', 100, 100);
  system.spawn('金块+1', NaN, 100);
  system.spawn('金块+1', 100, Infinity);
  assert.equal(system.getTexts().length, FLOATING_TEXT_MAX_COUNT);
});

test('draw maps the text to screen space and lifts it while it lives', () => {
  const system = new FloatingTextSystem(() => 0.5);
  system.spawn('金块+3', 600, 800);
  const [view] = system.getTexts();
  const calls = [];
  const ctx = {
    save() {}, restore() {}, translate(x, y) { calls.push(['translate', x, y]); },
    rotate() {}, scale() {}, strokeText() {}, fillText() {},
  };
  const cameraX = 500, cameraY = 700, scaleCss = 0.85;

  system.draw(ctx, cameraX, cameraY, scaleCss);
  const [, x, y] = calls.find(call => call[0] === 'translate');
  near(x, (view.x - cameraX) * scaleCss, 1e-9);
  near(y, (view.y - cameraY) * scaleCss, 1e-9);

  system.update(TOTAL / 2);
  calls.length = 0;
  system.draw(ctx, cameraX, cameraY, scaleCss);
  const [, , risenY] = calls.find(call => call[0] === 'translate');
  near(risenY, y - 9, 1e-9);
});
