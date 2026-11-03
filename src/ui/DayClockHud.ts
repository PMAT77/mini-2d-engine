import { drawBrush } from './WeaponBrushTexture';
import { clockDigitPositions, DAY_CLOCK_TIMELINE, getDayClockHudLayout, getDayClockView } from './DayClockHudLayout';
import type { DayClockHudLayout, DayClockHudState } from './DayClockHudLayout';
import type { Rect } from './HudTypes';

const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';
const DIGITS = '"Consolas", "Liberation Mono", monospace';
const WHITE = '#e8e7e1';
const PHASE_COLORS = { day: '#d8bd78', dusk: '#bd8e63', night: '#93a9bd' };

function phaseIcon(ctx: CanvasRenderingContext2D, phase: 'day' | 'dusk' | 'night', x: number, y: number): void {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = ctx.fillStyle = PHASE_COLORS[phase];
  ctx.lineWidth = 1.7; ctx.lineCap = 'round';
  if (phase === 'night') {
    // 两段圆弧直接勾出月牙，不擦除背后的世界画面。
    ctx.beginPath(); ctx.arc(0, 0, 11, -.5 * Math.PI, .5 * Math.PI, true);
    ctx.bezierCurveTo(0, 8, -5, -5, 0, -11); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, 8, phase === 'dusk' ? Math.PI : 0, phase === 'dusk' ? 0 : Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      if (phase === 'dusk' && Math.sin(angle) > 0) continue;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12);
      ctx.lineTo(Math.cos(angle) * 16, Math.sin(angle) * 16); ctx.stroke();
    }
    if (phase === 'dusk') {
      ctx.beginPath(); ctx.moveTo(-16, 2); ctx.lineTo(16, 2); ctx.moveTo(-10, 7); ctx.lineTo(10, 7); ctx.stroke();
    }
  }
  ctx.restore();
}

function statusIcon(ctx: CanvasRenderingContext2D, kind: 'warning' | 'clock', x: number, y: number): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle;
  ctx.beginPath();
  if (kind === 'clock') {
    ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.moveTo(0, -5); ctx.lineTo(0, 0); ctx.lineTo(4, 3);
  } else {
    ctx.moveTo(0, -8); ctx.lineTo(9, 7); ctx.lineTo(-9, 7); ctx.closePath();
    ctx.moveTo(0, -3); ctx.lineTo(0, 1); ctx.moveTo(0, 4); ctx.lineTo(0, 4.2);
  }
  ctx.stroke(); ctx.restore();
}

/** 无时钟、定时器或输入监听；每次绘制完全取决于调用方传入的世界状态。 */
export function drawDayClockHud(ctx: CanvasRenderingContext2D, state: Readonly<DayClockHudState>, layout: DayClockHudLayout, dpr = 1): void {
  if (layout.scale <= 0) return;
  const view = getDayClockView(state), compact = layout.compact;
  const width = layout.designWidth, height = layout.designHeight;
  ctx.save(); ctx.scale(layout.scale, layout.scale);
  drawBrush(ctx, { x: 0, y: -9, width, height: height + 18 }, { alpha: .84, dpr: dpr * layout.scale, variant: 3, tone: 'charcoal' });
  ctx.fillStyle = WHITE; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.font = `600 ${compact ? 23 : 30}px ${FONT}`;
  // 固定左区宽度；三位天数自然扩展，更长的日期仅在左区缩字。
  const dayX = compact ? 73 : 142, dayWidth = compact ? 124 : 186;
  ctx.fillText(view.dayText, dayX, compact ? 14 : 33, dayWidth);
  const divider = compact ? 145 : 250;
  ctx.strokeStyle = 'rgba(232,231,225,.34)'; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.moveTo(divider, compact ? 3 : 13); ctx.lineTo(divider, compact ? 26 : 59); ctx.stroke();
  phaseIcon(ctx, view.phase, compact ? 169 : 285, compact ? 14 : 19);
  if (!compact) {
    ctx.textAlign = 'left'; ctx.font = `600 16px ${FONT}`; ctx.fillText(view.phaseText, 317, 19);
  }
  ctx.textAlign = 'center'; ctx.font = `600 ${compact ? 28 : 34}px ${DIGITS}`;
  const clockX = compact ? 230 : 357;
  const positions = clockDigitPositions(clockX);
  [...view.clockText].forEach((digit, i) => ctx.fillText(digit, positions[i], compact ? 15 : 49));
  if (!compact) {
    const start = 40, end = width - start, trackWidth = end - start, trackY = 79;
    const gradient = ctx.createLinearGradient(start, 0, end, 0);
    for (const [at, color] of [[0, '#cccac0'], [.47, '#d6c79f'], [.5, '#c8aa78'], [.57, '#a77d60'], [.6, '#687785'], [1, '#465b6b']] as const)
      gradient.addColorStop(at, color);
    ctx.strokeStyle = gradient; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(start, trackY); ctx.lineTo(end, trackY); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(235,231,219,.6)';
    for (const at of [DAY_CLOCK_TIMELINE.dusk, DAY_CLOCK_TIMELINE.night]) {
      const x = start + trackWidth * at;
      ctx.beginPath(); ctx.moveTo(x, trackY - 5); ctx.lineTo(x, trackY + 5); ctx.stroke();
    }
    ctx.fillStyle = view.statusColor; ctx.strokeStyle = 'rgba(8,10,12,.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(start + trackWidth * view.progress, trackY, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#deddd7'; ctx.font = `500 13px ${FONT}`;
    ctx.fillText('06:00', start, 99);
    ctx.fillText('18:00 返程截止', start + trackWidth * DAY_CLOCK_TIMELINE.dusk, 99);
    ctx.fillText('次日 06:00', end, 99);
  }
  ctx.fillStyle = view.statusColor; ctx.font = `500 ${compact ? 14 : 18}px ${FONT}`;
  const statusWidth = ctx.measureText(view.status).width, iconSpace = view.statusIcon ? 25 : 0;
  const statusX = (width - statusWidth - iconSpace) / 2;
  const statusY = compact ? 38 : 127;
  if (view.statusIcon) statusIcon(ctx, view.statusIcon, statusX + 8, statusY);
  ctx.textAlign = 'left'; ctx.fillText(view.status, statusX + iconSpace, statusY);
  ctx.restore();
}

/** 独立的透明 Canvas 层使时间在背包与暂停遮罩上仍可见；不接管鼠标或键盘。 */
export class DayClockHud {
  private canvas?: HTMLCanvasElement;
  private root?: HTMLDivElement;
  attach(): void {
    if (this.canvas) return;
    this.canvas = document.createElement('canvas'); this.canvas.dataset.dayClockHud = '';
    this.canvas.setAttribute('role', 'timer'); this.canvas.setAttribute('aria-live', 'off');
    this.canvas.style.cssText = 'position:fixed;pointer-events:none;z-index:1101;border:0;margin:0;padding:0;box-sizing:content-box;background:transparent';
    this.root = document.createElement('div'); this.root.dataset.dayClockLayer = '';
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1101';
    this.root.append(this.canvas); document.body.append(this.root);
  }
  draw(state: Readonly<DayClockHudState> | null, width: number, height: number, dpr: number, reserved: readonly Rect[], compact = false): DayClockHudLayout {
    const layout = getDayClockHudLayout(width, height, reserved, compact), canvas = this.canvas;
    if (!canvas) return layout;
    canvas.hidden = state === null || layout.scale <= 0;
    if (!state || canvas.hidden) return layout;
    const pixelWidth = Math.ceil(layout.width * dpr), pixelHeight = Math.ceil(layout.height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.left = `${layout.x}px`; canvas.style.top = `${layout.y}px`;
    canvas.style.width = `${layout.width}px`; canvas.style.height = `${layout.height}px`;
    const view = getDayClockView(state);
    canvas.setAttribute('aria-label', `${view.dayText} ${view.phaseText} ${view.clockText}，${view.status}`);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      drawDayClockHud(ctx, state, layout, dpr);
    }
    return layout;
  }
  dispose(): void { this.root?.remove(); this.root = undefined; this.canvas = undefined; }
}
