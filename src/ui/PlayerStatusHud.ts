import type { SurvivalSnapshot } from '../survival/PlayerSurvivalSystem';
import type { Rect } from './HudTypes';
import { getPlayerVitalsHudRect } from './PlayerVitalsHud';
import { getBackpackHudRect } from './BackpackHud';
import { getWeaponListLayout } from './WeaponListHud';

/** 展示余量，不引入饥饿/口渴玩法；未接入的数据保持满格。 */
export type PlayerStatusHudState = SurvivalSnapshot & {
  satietyRatio?: number;
  hydrationRatio?: number;
};

const INK = '#D8DEDB';
const EMPTY = '#34414B';
const DANGER = '#CF746A';
const ICONS = ['hunger', 'thirst', 'infection'] as const;
type StatusIcon = typeof ICONS[number];

/** 左下角三项纵排；与生命/体力条共用背包和武器的避让基准。 */
export function getPlayerStatusHudRect(width: number, height: number,
  weaponArea: Rect = getWeaponListLayout(width, height).area): Rect {
  const compact = width < 650 || height <= 600;
  const diameter = compact ? 32 : 44;
  const step = compact ? 44 : 60;
  const scale = Math.max(0, Math.min(1, (width - 24) / (diameter * 60 / 44), (height - 16) / (diameter + step * 2)));
  const w = diameter * 60 / 44 * scale;
  const h = (diameter + step * 2) * scale;
  // 先让生命/体力条避开右侧 HUD，再把图标放到其上沿，竖屏时也保持顺序。
  const bottom = compact ? Math.max(24, height - getPlayerVitalsHudRect(width, height,
    [getBackpackHudRect(width, height, weaponArea), weaponArea]).y + 8) : 200;
  return {
    x: Math.max(0, Math.min(compact ? 16 : 50, width - w)),
    y: Math.max(0, height - bottom - h), width: w, height: h,
  };
}

function ratio(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, Math.min(1, value));
}

/** 每格可部分填充；0/1 对应全空/全满，从顶部顺时针推进。 */
function drawSegments(ctx: CanvasRenderingContext2D, x: number, y: number, diameter: number, value: number, color: string): void {
  const step = Math.PI * 2 / 12;
  const gap = Math.PI / 90;
  ctx.lineWidth = 3 * diameter / 44;
  ctx.lineCap = 'butt';
  for (let i = 0; i < 12; i++) {
    const start = -Math.PI / 2 + i * step + gap;
    const span = step - gap * 2;
    ctx.beginPath(); ctx.arc(x, y, diameter / 2 - ctx.lineWidth / 2, start, start + span);
    ctx.strokeStyle = EMPTY; ctx.stroke();
    const fill = Math.max(0, Math.min(1, value * 12 - i));
    if (fill > 0) {
      ctx.beginPath(); ctx.arc(x, y, diameter / 2 - ctx.lineWidth / 2, start, start + span * fill);
      ctx.strokeStyle = value <= .25 ? DANGER : color; ctx.stroke();
    }
  }
}

/** 将原图 alpha 与磨损细节缓存成小尺寸墨色图，逐帧只 drawImage。 */
function tint(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, 96, 96);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color; ctx.fillRect(0, 0, 96, 96);
  return canvas;
}

/** 只读屏幕 HUD；状态变更与感染计时仍由 survival 管理。 */
export class PlayerStatusHud {
  private readonly icons = new Map<StatusIcon | 'infection-active', HTMLCanvasElement>();
  readonly ready: Promise<void>;

  constructor() {
    this.ready = Promise.all(ICONS.map(async name => {
      if (typeof Image === 'undefined' || typeof document === 'undefined') return;
      const image = new Image();
      image.decoding = 'async';
      image.src = `/assets/images/ui/status/${name}.png`;
      try {
        await image.decode();
        this.icons.set(name, tint(image, INK));
        if (name === 'infection') this.icons.set('infection-active', tint(image, DANGER));
      } catch {
        // 装饰素材失败不阻止游戏加载，状态刻度仍然可见。
        console.warn(`状态图标加载失败: ${name}`);
      }
    })).then(() => undefined);
  }

  draw(ctx: CanvasRenderingContext2D, status: PlayerStatusHudState, width: number, height: number, weaponArea?: Rect): void {
    const r = getPlayerStatusHudRect(width, height, weaponArea);
    if (r.width < 1 || r.height < 1) return;
    const diameter = r.width * 44 / 60;
    const step = (r.height - diameter) / 2;
    const scale = diameter / 44;
    const values = [ratio(status.satietyRatio), ratio(status.hydrationRatio)];
    ctx.save();
    if (!status.alive) ctx.globalAlpha *= .35;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (let i = 0; i < ICONS.length; i++) {
      const x = r.x + diameter / 2, y = r.y + diameter / 2 + step * i;
      ctx.beginPath(); ctx.arc(x, y, diameter / 2 - 4 * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,13,18,.55)'; ctx.fill();
      if (i < 2) drawSegments(ctx, x, y, diameter, values[i], i === 0 ? '#C1AA79' : '#7BABB7');
      const icon = this.icons.get(i === 2 && status.infected ? 'infection-active' : ICONS[i]);
      if (icon) {
        ctx.save();
        if (i === 2 && !status.infected) ctx.globalAlpha *= .36;
        const size = (i === 2 ? 38 : 34) * scale;
        ctx.drawImage(icon, x - size / 2, y - size / 2, size, size);
        ctx.restore();
      }
      if (i === 2 && status.alive && status.infected && status.vaccines > 0) {
        const keyX = r.x + diameter + 2 * scale;
        ctx.fillStyle = 'rgba(8,13,18,.75)';
        ctx.fillRect(keyX, y - 8 * scale, 13 * scale, 16 * scale);
        ctx.strokeStyle = '#7C6A66'; ctx.lineWidth = scale;
        ctx.strokeRect(keyX + .5 * scale, y - 7.5 * scale, 12 * scale, 15 * scale);
        ctx.font = `600 ${Math.max(9, 11 * scale)}px "Segoe UI",sans-serif`;
        ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('V', keyX + 6.5 * scale, y + .5 * scale);
      }
    }
    ctx.restore();
  }
}
