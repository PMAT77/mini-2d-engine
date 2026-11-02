import type { Player } from '../objects/Player';
import type { Rect } from './HudTypes';
import { drawBrush } from './WeaponBrushTexture';

const WIDTH = 340;
const HEIGHT = 72;
const EMPTY = '#1D2C35';
const INK = '#D8DEDB';

/** 左下角的屏幕坐标；紧凑窗口向上让开生存状态、背包和武器区域。 */
export function getPlayerVitalsHudRect(width: number, height: number, reserved: readonly Rect[] = []): Rect {
  const margin = width < 650 ? 12 : 24;
  const scale = Math.max(0, Math.min(1, Math.max(.6, Math.min(width / 1100, height / 800)),
    (width - margin * 2) / WIDTH, (height - margin * 2) / HEIGHT));
  const rect = { x: margin, y: height - margin - HEIGHT * scale, width: WIDTH * scale, height: HEIGHT * scale };
  // 从下往上避让，移动后不会再次撞上已经检查过的区域。
  for (const area of [...reserved].sort((a, b) => b.y - a.y)) {
    if (area.width > 0 && area.height > 0 && rect.x < area.x + area.width && rect.x + rect.width > area.x
      && rect.y < area.y + area.height && rect.y + rect.height > area.y) {
      rect.y = area.y - 8 - rect.height;
    }
  }
  rect.y = Math.max(0, rect.y);
  return rect;
}

function fraction(value: number, max: number): number {
  return Number.isFinite(value) && Number.isFinite(max) && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}

/** 只读绘制，直接使用角色当前数值；调用方统一按 DPR 缩放。 */
export function drawPlayerVitalsHud(ctx: CanvasRenderingContext2D,
  player: Pick<Player, 'getHealth' | 'getMaxHealth' | 'getStamina' | 'getMaxStamina' | 'getIsExhausted'>,
  rect: Rect, dpr = 1): void {
  if (rect.width < 1 || rect.height < 1) return;
  const health = fraction(player.getHealth(), player.getMaxHealth());
  const stamina = fraction(player.getStamina(), player.getMaxStamina());
  const exhausted = player.getIsExhausted();
  const lowHealth = health <= .25;
  drawBrush(ctx, rect, { alpha: .32, dpr, variant: 2 });
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(rect.width / WIDTH, rect.height / HEIGHT);

  // 与背包负重条共用暗槽和细边线，不给整组 HUD 再套一层边框。
  ctx.beginPath();
  ctx.roundRect(44, 14, 280, 22, 3);
  ctx.fillStyle = EMPTY;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = lowHealth ? '#CF746A' : '#79E2A0';
  ctx.fillRect(45, 15, 278 * health, 20);
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(45, 15, 278 * health, 1);
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(44.5, 14.5, 279, 21, 3);
  ctx.strokeStyle = 'rgba(144,177,188,.28)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(60, 44, 264, 12, 2.5);
  ctx.fillStyle = EMPTY;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const segmentWidth = 50;
  for (let index = 0; index < 5; index++) {
    const x = 61 + index * (segmentWidth + 3);
    const fill = segmentWidth * Math.max(0, Math.min(1, stamina * 5 - index));
    ctx.fillStyle = exhausted ? '#50616b' : '#7BABB7';
    ctx.fillRect(x, 45, fill, 10);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(x, 45, fill, 1);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(60.5, 44.5, 263, 11, 2.5);
  ctx.strokeStyle = exhausted ? '#ffbc70' : 'rgba(144,177,188,.28)';
  ctx.stroke();

  // 图标独立于条形，灰白墨色与左侧生存状态图标一致。
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(22, 15, 6, 20, 1);
  ctx.roundRect(15, 22, 20, 6, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(41, 40); ctx.lineTo(32, 51); ctx.lineTo(38, 51);
  ctx.lineTo(35, 60); ctx.lineTo(49, 47); ctx.lineTo(42, 47); ctx.lineTo(46, 40);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
