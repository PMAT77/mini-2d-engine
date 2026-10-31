import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const {
  FLASHLIGHT_HUD,
  FlashlightHud,
  drawFlashlightHud,
  drawFlashlightHudAtLevel,
  getFlashlightHudRect,
} = load('ui/FlashlightHud');

const INK_METRICS = {
  '手电 · 开': { ascent: 11, descent: 1 },
  '手电 · 关': { ascent: 11, descent: 1 },
  G: { ascent: 5.109375, descent: 2.890625 },
};

function stubContext({ metrics = true } = {}) {
  const calls = {
    texts: [], fills: [], gradients: 0, strokes: [], saves: 0, restores: 0,
  };
  const stack = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: 'left', textBaseline: 'alphabetic', shadowColor: '', shadowBlur: 0,
    save() {
      calls.saves += 1;
      stack.push({
        fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, font: ctx.font,
        lineWidth: ctx.lineWidth, textAlign: ctx.textAlign, textBaseline: ctx.textBaseline,
        shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur,
      });
    },
    restore() {
      calls.restores += 1;
      const state = stack.pop();
      if (state) Object.assign(ctx, state);
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    roundRect() {},
    fill() { calls.fills.push(ctx.fillStyle); },
    stroke() {
      calls.strokes.push({
        style: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        glow: ctx.shadowColor,
        blur: ctx.shadowBlur,
      });
    },
    fillRect() {},
    fillText(text, x, y) {
      calls.texts.push({ text, x, y, fillStyle: ctx.fillStyle, font: ctx.font, baseline: ctx.textBaseline });
    },
    ...(metrics
      ? {
          measureText(text) {
            const ink = INK_METRICS[text] ?? { ascent: 11, descent: 1 };
            return { width: 0, actualBoundingBoxAscent: ink.ascent, actualBoundingBoxDescent: ink.descent };
          },
        }
      : {}),
    createLinearGradient() {
      calls.gradients += 1;
      return { addColorStop() {} };
    },
  };
  return { ctx, calls };
}

const card = { x: 796, y: 664, width: 280, height: 112 };
const chip = { x: 980, y: 630, width: 95, height: 26 };
const WHITE = 'rgba(242,248,250,1)';
const KEY_WHITE = '#b6c4cd';
const GREEN = 'rgba(121,226,160,1)';
const GREY = 'rgba(116,135,148,1)';

test('the flashlight bar sits above the card, right-aligned and 8px away', () => {
  const rect = getFlashlightHudRect(card);
  assert.deepEqual(rect, { x: 796 + 280 - 95, y: 664 - 8 - 26, width: 95, height: 26 });
  assert.equal(FLASHLIGHT_HUD.width, 95);
  assert.equal(FLASHLIGHT_HUD.height, 26);
  assert.equal(FLASHLIGHT_HUD.gap, 8);
});

test('the bar right edge can be pinned to the weapon list content edge', () => {
  const contentRight = 1058.2;
  const rect = getFlashlightHudRect(card, contentRight);
  assert.equal(rect.x + rect.width, contentRight);
  assert.deepEqual(rect, { x: contentRight - 95, y: 664 - 8 - 26, width: 95, height: 26 });
});

test('layout stays inside the 100~180ms transition window', () => {
  assert.ok(FLASHLIGHT_HUD.transitionSeconds >= 0.1);
  assert.ok(FLASHLIGHT_HUD.transitionSeconds <= 0.18);
});

test('an on flashlight draws a green outline torch with a soft glow and white copy', () => {
  const { ctx, calls } = stubContext();
  drawFlashlightHud(ctx, chip, true);
  assert.deepEqual(calls.texts.map(entry => entry.text), ['手电 · 开', 'G']);
  // 文案始终白色；只有图标随状态变色。
  assert.equal(calls.texts[0].fillStyle, WHITE);
  assert.equal(calls.texts[1].fillStyle, KEY_WHITE);
  assert.ok(calls.texts[1].font.includes('11px'), 'G 应比状态文字小一号');
  // 文字墨迹（不是字体行盒）与图标共用同一条垂直中线。
  const centerY = chip.y + chip.height / 2;
  assert.equal(calls.texts[0].baseline, 'alphabetic');
  assert.equal(calls.texts[0].y, centerY + (11 - 1) / 2);
  assert.equal(calls.texts[1].y, centerY + (5.109375 - 2.890625) / 2);
  // 开灯：灯头 + 筒身两笔绿色轮廓，无斜杠，带绿色柔光。
  assert.equal(calls.strokes.length, 2);
  for (const stroke of calls.strokes) {
    assert.equal(stroke.style, GREEN);
    assert.equal(stroke.glow, 'rgba(121,226,160,0.5)');
    assert.equal(stroke.blur, 5);
  }
  // 容器只有一层无描边的软暗底，不画任何灯芯填充。
  assert.equal(calls.gradients, 1);
  assert.equal(calls.fills.length, 1);
  assert.equal(calls.saves, calls.restores);
});

test('falls back to estimated baselines when the canvas cannot measure text', () => {
  const { ctx, calls } = stubContext({ metrics: false });
  drawFlashlightHud(ctx, chip, true);
  const centerY = chip.y + chip.height / 2;
  assert.equal(calls.texts[0].y, centerY + 5);
  assert.equal(calls.texts[1].y, centerY + 1);
});

test('an off flashlight keeps white copy and adds a grey slash over the outline', () => {
  const { ctx, calls } = stubContext();
  drawFlashlightHud(ctx, chip, false);
  assert.deepEqual(calls.texts.map(entry => entry.text), ['手电 · 关', 'G']);
  assert.equal(calls.texts[0].fillStyle, WHITE);
  assert.equal(calls.texts[1].fillStyle, KEY_WHITE);
  // 关灯：轮廓两笔 + 斜杠一笔，全部冷灰且没有柔光。
  assert.equal(calls.strokes.length, 3);
  for (const stroke of calls.strokes) {
    assert.equal(stroke.style, GREY);
    assert.equal(stroke.blur, 0);
  }
  assert.equal(calls.fills.length, 1);
  assert.equal(calls.saves, calls.restores);
});

test('a mid transition blends the icon colour while the target label and slash stay put', () => {
  const { ctx, calls } = stubContext();
  drawFlashlightHudAtLevel(ctx, chip, 0.5, false);
  assert.deepEqual(calls.texts.map(entry => entry.text), ['手电 · 关', 'G']);
  assert.equal(calls.texts[0].fillStyle, WHITE);
  assert.equal(calls.strokes.length, 3);
  for (const stroke of calls.strokes) {
    assert.notEqual(stroke.style, GREY);
    assert.notEqual(stroke.style, GREEN);
  }
  const [head, body, slash] = calls.strokes;
  for (const stroke of [head, body]) {
    assert.ok(stroke.blur > 0 && stroke.blur < 5, `blur: ${stroke.blur}`);
  }
  assert.equal(slash.blur, 0, '斜杠不发光');
  assert.equal(calls.saves, calls.restores);
});

test('the animated hud snaps on the first update and fades at 150ms', () => {
  const hud = new FlashlightHud();
  hud.update(1 / 60, true);
  assert.equal(hud.getLevel(), 1);
  assert.equal(hud.isOn(), true);

  hud.update(1 / 60, false);
  assert.ok(hud.getLevel() > 0 && hud.getLevel() < 1, `level: ${hud.getLevel()}`);
  hud.update(0.3, false);
  assert.equal(hud.getLevel(), 0);
  assert.equal(hud.isOn(), false);

  // 异常 delta 不推进也不反向。
  hud.update(-1, false);
  assert.equal(hud.getLevel(), 0);
  hud.update(Number.NaN, false);
  assert.equal(hud.getLevel(), 0);
  hud.update(1 / 60, true);
  assert.ok(hud.getLevel() > 0 && hud.getLevel() < 0.5, `level: ${hud.getLevel()}`);
});

test('the hud draws the current level and the target state', () => {
  const hud = new FlashlightHud();
  hud.update(1, true);
  const { ctx, calls } = stubContext();
  hud.draw(ctx, chip);
  assert.deepEqual(calls.texts.map(entry => entry.text), ['手电 · 开', 'G']);
  assert.equal(calls.saves, calls.restores);
});
