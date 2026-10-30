import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { FLASHLIGHT_HUD, drawFlashlightHud, getFlashlightHudRect } = load('ui/FlashlightHud');

function stubContext() {
  const calls = { texts: [], fills: [], strokes: 0, saves: 0, restores: 0, shadows: [] };
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: 'left', textBaseline: 'alphabetic', shadowColor: '', shadowBlur: 0,
    save() { calls.saves += 1; },
    restore() { calls.restores += 1; },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    roundRect() {},
    fill() { calls.fills.push(ctx.fillStyle); calls.shadows.push({ color: ctx.shadowColor, blur: ctx.shadowBlur }); },
    stroke() { calls.strokes += 1; },
    fillRect() {},
    fillText(text, x, y) { calls.texts.push({ text, x, y, fillStyle: ctx.fillStyle, font: ctx.font }); },
  };
  return { ctx, calls };
}

const card = { x: 796, y: 664, width: 280, height: 112 };

test('the flashlight capsule sits above the card, right-aligned and 8px away', () => {
  const rect = getFlashlightHudRect(card);
  assert.deepEqual(rect, { x: 796 + 280 - 96, y: 664 - 8 - 26, width: 96, height: 26 });
  assert.equal(FLASHLIGHT_HUD.width, 96);
  assert.equal(FLASHLIGHT_HUD.height, 26);
});

test('an on flashlight uses amber lamp, text and glow', () => {
  const { ctx, calls } = stubContext();
  drawFlashlightHud(ctx, { x: 980, y: 630, width: 96, height: 26 }, true);
  assert.deepEqual(calls.texts.map(entry => entry.text), ['手电 开', 'G']);
  assert.ok(calls.fills.includes('#ffce6b'), `fills: ${calls.fills.join(',')}`);
  assert.ok(calls.shadows.some(shadow => shadow.blur === 8 && shadow.color === '#ffce6b'));
  assert.equal(calls.saves, calls.restores);
});

test('an off flashlight goes cold grey without a glow', () => {
  const { ctx, calls } = stubContext();
  drawFlashlightHud(ctx, { x: 980, y: 630, width: 96, height: 26 }, false);
  assert.deepEqual(calls.texts.map(entry => entry.text), ['手电 关', 'G']);
  assert.ok(calls.fills.includes('#5b7480'));
  assert.ok(calls.fills.includes('#8fa6b4'));
  assert.ok(!calls.fills.includes('#ffce6b'));
  assert.ok(!calls.shadows.some(shadow => shadow.blur === 8));
  assert.equal(calls.saves, calls.restores);
});
