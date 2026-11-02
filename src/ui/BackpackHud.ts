import type { Rect } from './HudTypes';
import { drawBrush } from './WeaponBrushTexture';

const WIDTH = 400;
const HEIGHT = 132;
const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';

export interface BackpackLoad {
  weightKg: number;
  capacityKg: number;
}

const EMPTY_LOAD: Readonly<BackpackLoad> = { weightKg: 0, capacityKg: 30 };

export function getBackpackHudRect(width: number, height: number, weaponArea: Rect): Rect {
  const top = weaponArea.y + weaponArea.height + 10;
  const bottom = height - 18;
  const scale = Math.max(0, Math.min(1, weaponArea.width / WIDTH, (bottom - top) / HEIGHT));
  return {
    x: Math.max(0, width - 22 - WIDTH * scale),
    y: Math.max(0, bottom - HEIGHT * scale),
    width: WIDTH * scale,
    height: HEIGHT * scale,
  };
}

export class BackpackHud {
  private icon = typeof Image === 'undefined' ? null : new Image();

  constructor() {
    if (this.icon) {
      this.icon.decoding = 'async';
      this.icon.onerror = () => { this.icon = null; };
      this.icon.src = '/assets/images/ui/backpack.png';
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    weaponArea: Rect,
    dpr = 1,
    load: Readonly<BackpackLoad> = EMPTY_LOAD,
  ): void {
    const rect = getBackpackHudRect(width, height, weaponArea);
    if (rect.width <= 1 || rect.height <= 1) return;
    const weight = Number.isFinite(load.weightKg) ? Math.max(0, load.weightKg) : 0;
    const capacity = Number.isFinite(load.capacityKg) ? Math.max(0, load.capacityKg) : 0;
    const ratio = capacity > 0 ? Math.min(1, weight / capacity) : 0;

    drawBrush(ctx, rect, { alpha: 0.28, dpr, variant: 2 });
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(rect.width / WIDTH, rect.height / HEIGHT);

    if (this.icon?.complete && this.icon.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // 按源图透明内容边界裁取，保持图标比例，不把透明边距算进显示尺寸。
      ctx.drawImage(this.icon, 110, 79, 1035, 1127, 48, 18, 86, 86 * 1127 / 1035);
    }

    // 负重从下往上填充，圆角裁切让空载、满载都保持同一条槽体轮廓。
    ctx.beginPath();
    ctx.roundRect(156, 16, 16, 100, 8);
    ctx.fillStyle = '#1d2c35';
    ctx.fill();
    ctx.strokeStyle = 'rgba(144,177,188,.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    const fill = ctx.createLinearGradient(158, 0, 170, 0);
    fill.addColorStop(0, '#86ffe1');
    fill.addColorStop(1, '#28d9b0');
    ctx.fillStyle = fill;
    ctx.fillRect(158, 18 + 96 * (1 - ratio), 12, 96 * ratio);
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `500 16px ${FONT}`;
    ctx.fillStyle = '#b6d6cf';
    ctx.fillText('背包', 194, 39);
    ctx.beginPath();
    ctx.roundRect(236, 25, 27, 28, 8);
    ctx.fillStyle = 'rgba(69,137,113,.24)';
    ctx.fill();
    ctx.font = `600 18px ${FONT}`;
    ctx.fillStyle = '#a0e7ca';
    ctx.textAlign = 'center';
    ctx.fillText('B', 249.5, 39);

    ctx.textAlign = 'left';
    ctx.font = `700 36px ${FONT}`;
    ctx.fillStyle = '#f2f8fa';
    const value = weight.toFixed(1);
    ctx.fillText(value, 190, 86);
    const valueWidth = ctx.measureText(value).width;
    ctx.font = `400 22px ${FONT}`;
    ctx.fillStyle = '#93a3ad';
    ctx.fillText(`/ ${capacity} kg`, 190 + valueWidth + 12, 88);
    ctx.restore();
  }
}
