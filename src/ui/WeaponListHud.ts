import type { WeaponLoadoutView, WeaponSlot, WeaponView } from "../objects/Weapon";
import type { Rect } from "./HudTypes";

/** 右侧武器列表的所有尺寸，单位是逻辑像素。 */
export const WEAPON_LIST = {
  widthRatio: 0.23,
  minWidth: 190,
  maxWidth: 260,
  rightMargin: 24,
  rowHeight: 42,
  rowGap: 3,
  radius: 7,
  swapSeconds: 0.22,
  iconWidth: 46,
  iconHeight: 30,
  countFont: '600 18px "Segoe UI", "Microsoft YaHei", sans-serif',
  bulletWidth: 4,
  bulletHeight: 10,
  bulletGap: 2,
  bulletCount: 3,
  rightPadding: 12,
  countGap: 8,
} as const;

const PLATE_ACTIVE = "rgba(12,18,26,0.82)";
const PLATE_INACTIVE = "rgba(12,18,26,0.46)";
const ACCENT = "rgba(242,248,250,0.92)";
const INK = "#f2f8fa";
const MUTED = "#c2d2da";

export interface WeaponListLayout {
  area: Rect;
  topRow: Rect;
  bottomRow: Rect;
}

export interface WeaponListRowStatus {
  slot: WeaponSlot;
  view: WeaponView;
  rect: Rect;
  active: boolean;
}

export interface WeaponListStatus {
  activeSlot: WeaponSlot;
  mode: "firearms" | "melee";
  swapProgress: number;
  rows: WeaponListRowStatus[];
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** 右侧两行列表的静态布局；区域在屏幕右缘垂直居中。 */
export function getWeaponListLayout(viewWidth: number, viewHeight: number): WeaponListLayout {
  const widthLimit = Math.max(0, finite(viewWidth));
  const heightLimit = Math.max(0, finite(viewHeight));
  const availableWidth = Math.max(0, widthLimit - 2 * WEAPON_LIST.rightMargin);
  const preferred = Math.min(
    WEAPON_LIST.maxWidth,
    Math.max(WEAPON_LIST.minWidth, widthLimit * WEAPON_LIST.widthRatio),
  );
  const width = Math.max(0, Math.min(preferred, availableWidth));
  const areaHeight = WEAPON_LIST.rowHeight * 2 + WEAPON_LIST.rowGap;
  const x = Math.max(0, widthLimit - WEAPON_LIST.rightMargin - width);
  const y = Math.max(0, (heightLimit - areaHeight) / 2);

  return {
    area: { x, y, width, height: areaHeight },
    topRow: { x, y, width, height: WEAPON_LIST.rowHeight },
    bottomRow: { x, y: y + WEAPON_LIST.rowHeight + WEAPON_LIST.rowGap, width, height: WEAPON_LIST.rowHeight },
  };
}

/** 当前手持枪械永远第一行；近战/空手只返回一行。 */
export function getWeaponListRows(loadout: WeaponLoadoutView): WeaponView[] {
  if (loadout.activeSlot === "melee") return [loadout.melee];
  return loadout.activeSlot === "primary"
    ? [loadout.primary, loadout.secondary]
    : [loadout.secondary, loadout.primary];
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function listBulletRects(row: Rect): Rect[] {
  const count = WEAPON_LIST.bulletCount;
  const totalWidth = count * WEAPON_LIST.bulletWidth + (count - 1) * WEAPON_LIST.bulletGap;
  const startX = row.x + row.width - WEAPON_LIST.rightPadding - totalWidth;
  const y = row.y + (row.height - WEAPON_LIST.bulletHeight) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * (WEAPON_LIST.bulletWidth + WEAPON_LIST.bulletGap),
    y,
    width: WEAPON_LIST.bulletWidth,
    height: WEAPON_LIST.bulletHeight,
  }));
}

function drawListBullet(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const radius = Math.max(0.5, rect.width / 2);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height - 2, radius);
  ctx.fill();
  ctx.fillRect(rect.x - 0.5, rect.y + rect.height - 2, rect.width + 1, 2);
}

function drawPistolIcon(ctx: CanvasRenderingContext2D): void {
  // 侧视手枪，枪口朝右：套筒、前后准星、握把、扳机护圈、扳机。
  ctx.beginPath();
  ctx.roundRect(4, 10, 28, 7, 2);
  ctx.fill();
  ctx.fillRect(26.5, 7.5, 2.5, 3);
  ctx.fillRect(5, 7.5, 2.5, 3);

  ctx.beginPath();
  ctx.moveTo(21, 17);
  ctx.lineTo(29, 17);
  ctx.lineTo(26, 31);
  ctx.lineTo(18.5, 31);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(11.5, 17.5);
  ctx.lineTo(11.5, 20.5);
  ctx.arc(15.5, 20.5, 4, 0, Math.PI);
  ctx.lineTo(19.5, 17.5);
  ctx.stroke();
  ctx.fillRect(14.6, 18.2, 1.8, 3.6);
}

function drawSmgIcon(ctx: CanvasRenderingContext2D): void {
  // 侧视冲锋枪，枪口朝右：长机匣、枪管、前握把、弧形弹匣、枪托。
  ctx.beginPath();
  ctx.roundRect(6, 11, 22, 7, 1.5);
  ctx.fill();
  ctx.fillRect(28, 13, 6, 3);
  ctx.fillRect(3, 12, 4, 5);
  // 枪管下的前握把
  ctx.beginPath();
  ctx.roundRect(20, 18, 4, 7, 1);
  ctx.fill();
  // 弹匣
  ctx.save();
  ctx.translate(13, 18);
  ctx.rotate(0.18);
  ctx.beginPath();
  ctx.roundRect(-2.5, 0, 5, 11, 1);
  ctx.fill();
  ctx.restore();
  // 后握把
  ctx.beginPath();
  ctx.moveTo(9, 18);
  ctx.lineTo(13, 18);
  ctx.lineTo(11, 27);
  ctx.lineTo(7.5, 27);
  ctx.closePath();
  ctx.fill();
  // 准星
  ctx.fillRect(26, 8.5, 1.8, 2.5);
}

function drawFistIcon(ctx: CanvasRenderingContext2D): void {
  // 空手：握拳的手背与四指关节。
  ctx.beginPath();
  ctx.roundRect(9, 15, 17, 12, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(16, 10, 12, 7, 3);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(14, 18); ctx.lineTo(14, 24);
  ctx.moveTo(18, 18); ctx.lineTo(18, 24);
  ctx.moveTo(22, 18); ctx.lineTo(22, 24);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(6, 19, 5, 8, 2);
  ctx.fill();
}

function drawKnifeIcon(ctx: CanvasRenderingContext2D): void {
  // 斜置短刀：刀身、护手、握柄。
  ctx.beginPath();
  ctx.moveTo(8.5, 26.5);
  ctx.lineTo(24, 8);
  ctx.lineTo(27.5, 11.5);
  ctx.lineTo(11.5, 29.5);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6.5, 24.5);
  ctx.lineTo(13, 31);
  ctx.stroke();
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(8, 28.5);
  ctx.lineTo(4.5, 32);
  ctx.stroke();
}

function drawWeaponSilhouette(
  ctx: CanvasRenderingContext2D,
  view: WeaponView,
  box: Rect,
  color: string,
): void {
  const scale = Math.min(box.width / 36, box.height / 36);
  if (!(scale > 0)) return;

  ctx.save();
  ctx.translate(box.x + (box.width - 36 * scale) / 2, box.y + (box.height - 36 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (view.kind === "empty") {
    drawFistIcon(ctx);
  } else if (view.kind === "melee") {
    drawKnifeIcon(ctx);
  } else if (view.slot === "primary") {
    drawSmgIcon(ctx);
  } else {
    drawPistolIcon(ctx);
  }
  ctx.restore();
}

/** 右侧武器列表：缓存切枪动画进度，不读取玩家内部状态。 */
export class WeaponListHud {
  private previousActiveSlot: WeaponSlot | null = null;
  private swapProgress = 1;
  private lastStatus: WeaponListStatus | null = null;

  update(delta: number, loadout: WeaponLoadoutView): void {
    const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const next = loadout.activeSlot;
    const previous = this.previousActiveSlot;

    if (previous === null || next === "melee" || previous === "melee") {
      this.swapProgress = 1;
    } else if (next !== previous) {
      this.swapProgress = 0;
    }

    if (this.swapProgress < 1) {
      this.swapProgress = Math.min(1, this.swapProgress + step / WEAPON_LIST.swapSeconds);
    }
    this.previousActiveSlot = next;
  }

  getLastStatus(): WeaponListStatus | null {
    return this.lastStatus;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    loadout: WeaponLoadoutView,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const layout = getWeaponListLayout(viewWidth, viewHeight);
    const views = getWeaponListRows(loadout);
    const activeSlot = loadout.activeSlot;
    const ease = smoothstep(this.swapProgress);
    const swapping = views.length === 2 && this.swapProgress < 1;

    const rows: WeaponListRowStatus[] = views.map((view, index) => {
      const base = index === 0 ? layout.topRow : layout.bottomRow;
      let y = base.y;
      if (swapping) {
        const from = index === 0 ? layout.bottomRow.y : layout.topRow.y;
        const to = index === 0 ? layout.topRow.y : layout.bottomRow.y;
        y = from + (to - from) * ease;
      }
      return {
        slot: view.slot,
        view,
        rect: { x: base.x, y, width: base.width, height: base.height },
        active: view.slot === activeSlot,
      };
    });

    // 交换时两行会重叠；按 y 排序，同高时让当前武器最后画。
    rows.sort((a, b) => a.rect.y - b.rect.y || Number(a.active) - Number(b.active));

    this.lastStatus = {
      activeSlot,
      mode: activeSlot === "melee" ? "melee" : "firearms",
      swapProgress: this.swapProgress,
      rows,
    };

    ctx.save();
    for (const row of rows) this.drawRow(ctx, row);
    ctx.restore();
  }

  private drawRow(ctx: CanvasRenderingContext2D, row: WeaponListRowStatus): void {
    const { rect, active, view } = row;
    ctx.save();

    ctx.beginPath();
    ctx.roundRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1), WEAPON_LIST.radius);
    ctx.fillStyle = active ? PLATE_ACTIVE : PLATE_INACTIVE;
    ctx.fill();

    if (active) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(rect.x + 1, rect.y + 7, 2, Math.max(0, rect.height - 14));
    } else {
      ctx.globalAlpha *= 0.55;
    }

    const color = active ? INK : MUTED;
    drawWeaponSilhouette(ctx, view, {
      x: rect.x + 10,
      y: rect.y + (rect.height - WEAPON_LIST.iconHeight) / 2,
      width: WEAPON_LIST.iconWidth,
      height: WEAPON_LIST.iconHeight,
    }, color);

    if (view.kind === "firearm") {
      const bullets = listBulletRects(rect);
      const countRight = bullets[0].x - WEAPON_LIST.countGap;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = WEAPON_LIST.countFont;
      ctx.fillStyle = color;
      ctx.fillText(String(Math.max(0, Math.floor(view.magazineAmmo))), countRight, rect.y + rect.height / 2 + 0.5);
      ctx.fillStyle = color;
      for (const bullet of bullets) drawListBullet(ctx, bullet);
    }

    ctx.restore();
  }
}
