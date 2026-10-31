import type { WeaponLoadoutView, WeaponSlot, WeaponView } from "../objects/Weapon";
import type { Rect } from "./HudTypes";
import {
  WEAPON_HUD_SPRITES,
  getAmmoSpriteForView,
  getWeaponSpriteForView,
  normalizeContentBox,
  spriteContentAspect,
  weaponHudAssets,
} from "./WeaponHudAssets";
import type { WeaponHudSprite } from "./WeaponHudAssets";
import { drawBrush } from "./WeaponBrushTexture";

/**
 * 右侧武器列表的所有尺寸，单位是设计像素（1100×800 下 scale≈1）。
 * 运行时会按屏幕宽度/高度乘一个连续缩放系数，不做硬性最小值。
 */
export const WEAPON_LIST = {
  widthRatio: 0.36,
  minWidth: 300,
  maxWidth: 430,
  rightMargin: 22,
  rowHeight: 92,
  rowGap: 10,
  swapSeconds: 0.22,
  highlightSeconds: 0.14,
  scaleReferenceWidth: 400,
  minScale: 0.55,
  minHeightScale: 0.3,
  paddingLeft: 16,
  paddingRight: 20,
  magFontSize: 34,
  reserveFontSize: 17,
  slashFontSize: 18,
  bulletHeight: 32,
  bulletGapRatio: 0.24,
  bulletCount: 3,
  bulletFallbackAspect: 0.34,
  magGap: 24,
  slashGap: 10,
  reserveGap: 9,
  gunGap: 26,
  baselineRatio: 0.34,
  gunBottomOffsetRatio: 0.12,
  brushHeightRatio: 0.84,
  brushOffsetY: 1,
  brushPadLeftRatio: 0.27,
  brushPadRight: 8,
} as const;

/** 墨色：弹匣数字与子弹最亮，备用弹药与斜杠退到第二层级。 */
const INK = "#f2f8fa";
const RESERVE_INK = "#b6c4cd";
const SLASH_INK = "#93a3ad";
const FONT_FAMILY = '"Segoe UI", "Microsoft YaHei", sans-serif';

/** 选中/未选中的视觉目标值；跨行切换时在这两个值之间连续过渡。 */
const ACTIVE_BRUSH_ALPHA = 0.66;
const INACTIVE_BRUSH_ALPHA = 0.26;
const INACTIVE_GUN_ALPHA = 0.46;
const INACTIVE_INK_ALPHA = 0.5;
const BULLET_ALPHA_SCALE = 0.88;
/** 两行交叉时，被盖住的一行最多衰减到 55%：笔刷不会叠成黑块，数字也不会重影。 */
const CROSS_FADE = 0.78;

/** 每把枪的视觉高度比例与局部对齐偏移，将来扩展 weaponId 时在这里加条目。 */
interface GunLayoutRatio {
  readonly heightRatio: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

const GUN_LAYOUT: Record<WeaponSlot, GunLayoutRatio> = {
  // 参考图里冲锋枪明显比手枪更高更长：手枪按自身宽高比缩到约主体高度的 8 成，
  // 两者都按底边贴近行基线，避免手枪看起来比长枪还“壮”。
  primary: { heightRatio: 0.8, offsetX: 0, offsetY: 0 },
  secondary: { heightRatio: 0.66, offsetX: 0, offsetY: 0 },
  melee: { heightRatio: 0.8, offsetX: 0, offsetY: 2 },
};

const WEAPON_SLOTS: readonly WeaponSlot[] = ["primary", "secondary", "melee"];

export interface WeaponListMetrics {
  scale: number;
  rowHeight: number;
  rowGap: number;
  magFontSize: number;
  reserveFontSize: number;
  slashFontSize: number;
  magFont: string;
  reserveFont: string;
  slashFont: string;
  bulletHeight: number;
  bulletGap: number;
  bulletCount: number;
  bulletFallbackWidth: number;
  paddingLeft: number;
  paddingRight: number;
  magGap: number;
  slashGap: number;
  reserveGap: number;
  gunGap: number;
  baselineRatio: number;
  gunBottomOffset: number;
  brushPadLeft: number;
  brushPadRight: number;
  brushHeight: number;
  brushOffsetY: number;
}

export interface WeaponListLayout {
  area: Rect;
  topRow: Rect;
  bottomRow: Rect;
  metrics: WeaponListMetrics;
}

/** 行状态：兼容旧字段，新增的都是只读视觉信息。 */
export interface WeaponListRowStatus {
  slot: WeaponSlot;
  view: WeaponView;
  rect: Rect;
  active: boolean;
  /** 选中亮度的连续过渡值（0..1），`active` 仍是布尔语义。 */
  highlight: number;
  brushRect: Rect;
  gunRect: Rect;
  ammoBox: Rect | null;
  /** 三枚弹药类型装饰的绘制矩形；近战/空手时为空数组。 */
  bullets: Rect[];
}

export interface WeaponListStatus {
  activeSlot: WeaponSlot;
  mode: "firearms" | "melee";
  swapProgress: number;
  rows: WeaponListRowStatus[];
}

export interface AmmoColumnEntry {
  readonly reserve: string | null;
  readonly magazine: string;
  readonly bulletWidth: number;
}

export interface WeaponAmmoColumn {
  readonly bulletCount: number;
  readonly bulletHeight: number;
  readonly bulletGap: number;
  readonly bulletRight: number;
  readonly bulletBlockWidth: number;
  /** 弹匣余弹（左、大号数字）的右边缘：数字右对齐。 */
  readonly magazineRight: number;
  /** 弹匣数字槽的左边缘（含个位数预留），枪械锚点由此推出。 */
  readonly magazineLeft: number;
  readonly magazineSlotWidth: number;
  readonly slashLeft: number;
  readonly slashRight: number;
  readonly slashWidth: number;
  /** 备用弹药（右、小号数字）的左边缘：数字左对齐。 */
  readonly reserveLeft: number;
  /** 备用弹药槽的右边缘，三枚子弹从它右侧的间距之后开始。 */
  readonly reserveRight: number;
  readonly reserveSlotWidth: number;
  /** 枪械图片右缘的统一锚点：主副武器的右端都停在这条线上。 */
  readonly gunRightX: number;
  readonly hasAmmo: boolean;
}

export interface WeaponRowLayout {
  slot: WeaponSlot;
  rect: Rect;
  brushRect: Rect;
  gunRect: Rect;
  bullets: Rect[];
  ammoBox: Rect | null;
  ammoBaselineY: number;
}

export type MeasureText = (text: string, font: string) => number;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function fontCss(weight: number, size: number): string {
  return `${weight} ${round1(Math.max(1, size))}px ${FONT_FAMILY}`;
}

/** 所有随缩放变化的尺寸集中在这里，布局与绘制读同一份数值。 */
export function getWeaponListMetrics(scale: number): WeaponListMetrics {
  const s = clamp(scale, 0.2, 1);
  const rowHeight = WEAPON_LIST.rowHeight * s;
  const bulletHeight = WEAPON_LIST.bulletHeight * s;
  return {
    scale: s,
    rowHeight,
    rowGap: WEAPON_LIST.rowGap * s,
    magFontSize: WEAPON_LIST.magFontSize * s,
    reserveFontSize: WEAPON_LIST.reserveFontSize * s,
    slashFontSize: WEAPON_LIST.slashFontSize * s,
    magFont: fontCss(700, WEAPON_LIST.magFontSize * s),
    reserveFont: fontCss(600, WEAPON_LIST.reserveFontSize * s),
    slashFont: fontCss(600, WEAPON_LIST.slashFontSize * s),
    bulletHeight,
    bulletGap: bulletHeight * WEAPON_LIST.bulletGapRatio,
    bulletCount: WEAPON_LIST.bulletCount,
    bulletFallbackWidth: bulletHeight * WEAPON_LIST.bulletFallbackAspect,
    paddingLeft: WEAPON_LIST.paddingLeft * s,
    paddingRight: WEAPON_LIST.paddingRight * s,
    magGap: WEAPON_LIST.magGap * s,
    slashGap: WEAPON_LIST.slashGap * s,
    reserveGap: WEAPON_LIST.reserveGap * s,
    gunGap: WEAPON_LIST.gunGap * s,
    baselineRatio: WEAPON_LIST.baselineRatio,
    gunBottomOffset: rowHeight * WEAPON_LIST.gunBottomOffsetRatio,
    brushPadLeft: rowHeight * WEAPON_LIST.brushPadLeftRatio,
    brushPadRight: WEAPON_LIST.brushPadRight * s,
    brushHeight: rowHeight * WEAPON_LIST.brushHeightRatio,
    brushOffsetY: WEAPON_LIST.brushOffsetY * s,
  };
}

/**
 * 右侧两行列表的静态布局；区域在屏幕右缘垂直居中。
 * 区域整体随窗口连续缩放，任何尺寸下都不会越出画布。
 */
export function getWeaponListLayout(viewWidth: number, viewHeight: number): WeaponListLayout {
  const widthLimit = Math.max(0, finite(viewWidth));
  const heightLimit = Math.max(0, finite(viewHeight));
  const availableWidth = Math.max(0, widthLimit - 2 * WEAPON_LIST.rightMargin);
  const preferred = Math.min(
    WEAPON_LIST.maxWidth,
    Math.max(WEAPON_LIST.minWidth, widthLimit * WEAPON_LIST.widthRatio),
  );
  const width = Math.max(0, Math.min(preferred, availableWidth));
  const designHeight = WEAPON_LIST.rowHeight * 2 + WEAPON_LIST.rowGap;
  const heightFit = heightLimit > 0 ? (heightLimit - 6) / designHeight : 1;
  const scale = Math.min(
    clamp(width / WEAPON_LIST.scaleReferenceWidth, WEAPON_LIST.minScale, 1),
    clamp(heightFit, WEAPON_LIST.minHeightScale, 1),
  );
  const metrics = getWeaponListMetrics(scale);
  const areaHeight = metrics.rowHeight * 2 + metrics.rowGap;
  const x = Math.max(0, widthLimit - WEAPON_LIST.rightMargin - width);
  const y = Math.max(0, (heightLimit - areaHeight) / 2);

  return {
    area: { x, y, width, height: areaHeight },
    topRow: { x, y, width, height: metrics.rowHeight },
    bottomRow: {
      x,
      y: y + metrics.rowHeight + metrics.rowGap,
      width,
      height: metrics.rowHeight,
    },
    metrics,
  };
}

/** 当前手持枪械永远第一行；近战/空手只返回一行。 */
export function getWeaponListRows(loadout: WeaponLoadoutView): WeaponView[] {
  if (loadout.activeSlot === "melee") return [loadout.melee];
  return loadout.activeSlot === "primary"
    ? [loadout.primary, loadout.secondary]
    : [loadout.secondary, loadout.primary];
}

/** 弹匣余弹：不包含膛内那一发。 */
export function formatMagazine(view: Pick<WeaponView, "magazineAmmo">): string {
  return String(Math.max(0, Math.floor(view.magazineAmmo)));
}

/** 备用弹药：`null` 表示无限，显示为 ∞；近战/空手没有弹药。 */
export function formatReserve(
  view: Pick<WeaponView, "kind" | "reserveAmmo">,
): string | null {
  if (view.kind !== "firearm") return null;
  if (view.reserveAmmo === null) return "∞";
  return String(Math.max(0, Math.floor(view.reserveAmmo)));
}

/** 单枚子弹图标的显示宽度：按该弹种可见内容的真实宽高比算。 */
export function getBulletWidth(
  view: Pick<WeaponView, "slot" | "kind">,
  metrics: WeaponListMetrics,
): number {
  const spriteId = getAmmoSpriteForView(view);
  const sprite = spriteId ? WEAPON_HUD_SPRITES[spriteId] : null;
  const aspect = sprite ? spriteContentAspect(sprite) : WEAPON_LIST.bulletFallbackAspect;
  return metrics.bulletHeight * aspect;
}

/**
 * 弹药列从右往左一次算完，两行共用同一份：
 * 三枚子弹固定贴右，弹匣数字、斜杠、备用弹药依次向左排，最后剩下的才是枪械区域。
 * 槽宽用 `00`/`∞` 做下限，避免余弹从 30 掉到 9 时整列跳动。
 */
export function measureWeaponAmmoColumn(
  rowRight: number,
  metrics: WeaponListMetrics,
  measure: MeasureText,
  entries: readonly AmmoColumnEntry[],
): WeaponAmmoColumn {
  const bulletCount = metrics.bulletCount;
  const bulletHeight = metrics.bulletHeight;
  const bulletGap = metrics.bulletGap;
  let bulletWidth = metrics.bulletFallbackWidth;
  for (const entry of entries) {
    if (Number.isFinite(entry.bulletWidth) && entry.bulletWidth > bulletWidth) {
      bulletWidth = entry.bulletWidth;
    }
  }

  const bulletBlockWidth = bulletCount * bulletWidth + Math.max(0, bulletCount - 1) * bulletGap;
  const bulletRight = rowRight - metrics.paddingRight;

  let magazineSlotWidth = measure("00", metrics.magFont);
  for (const entry of entries) {
    magazineSlotWidth = Math.max(magazineSlotWidth, measure(entry.magazine, metrics.magFont));
  }
  const bulletLeft = bulletRight - bulletBlockWidth;

  // 读数顺序从左到右是「弹匣余弹 / 备用弹药」，所以从右往左依次落位：
  // 三枚子弹 → 备用弹药槽 → 斜杠 → 弹匣数字 → 枪械右锚点。
  let reserveSlotWidth = measure("∞", metrics.reserveFont);
  for (const entry of entries) {
    const width = entry.reserve === null
      ? measure("∞", metrics.reserveFont)
      : Math.max(measure("00", metrics.reserveFont), measure(entry.reserve, metrics.reserveFont));
    reserveSlotWidth = Math.max(reserveSlotWidth, width);
  }
  const reserveRight = bulletLeft - metrics.magGap;
  const reserveLeft = reserveRight - reserveSlotWidth;

  const slashWidth = Math.max(1, measure("/", metrics.slashFont));
  const slashRight = reserveLeft - metrics.reserveGap;
  const slashLeft = slashRight - slashWidth;

  const magazineRight = slashLeft - metrics.slashGap;
  const magazineLeft = magazineRight - magazineSlotWidth;
  const gunRightX = magazineLeft - metrics.gunGap;

  return {
    bulletCount,
    bulletHeight,
    bulletGap,
    bulletRight,
    bulletBlockWidth,
    magazineRight,
    magazineLeft,
    magazineSlotWidth,
    slashLeft,
    slashRight,
    slashWidth,
    reserveLeft,
    reserveRight,
    reserveSlotWidth,
    gunRightX,
    hasAmmo: entries.length > 0,
  };
}

/**
 * 单行内容分区：枪械右端统一锚在 `ammo.gunRightX`，按原始宽高比 contain 缩放、
 * 下沿统一基线；笔刷左端跟着这一行的枪械轮廓走，所以手枪的笔刷自然更短。
 */
export function getWeaponRowLayout(
  view: WeaponView,
  rect: Rect,
  ammo: WeaponAmmoColumn,
  metrics: WeaponListMetrics,
): WeaponRowLayout {
  const rowHeight = rect.height;
  const ratio = GUN_LAYOUT[view.slot] ?? GUN_LAYOUT.secondary;
  const spriteId = getWeaponSpriteForView(view);
  const sprite = spriteId ? WEAPON_HUD_SPRITES[spriteId] : null;
  const aspect = sprite ? spriteContentAspect(sprite) : 1;

  const areaLeft = rect.x + metrics.paddingLeft;
  const availableWidth = Math.max(0, ammo.gunRightX - areaLeft);
  const maxHeight = Math.max(0, rowHeight - metrics.gunBottomOffset - 4 * metrics.scale);
  let gunHeight = Math.min(rowHeight * ratio.heightRatio, maxHeight);
  gunHeight = Math.min(gunHeight, availableWidth / Math.max(0.01, aspect));
  if (!(gunHeight > 0)) gunHeight = 0;
  const gunWidth = gunHeight * aspect;
  const gunRect: Rect = {
    x: ammo.gunRightX - gunWidth + ratio.offsetX * metrics.scale,
    y: rect.y + rowHeight - metrics.gunBottomOffset - gunHeight + ratio.offsetY * metrics.scale,
    width: gunWidth,
    height: gunHeight,
  };

  const brushHeight = metrics.brushHeight;
  const brushTop = rect.y + (rowHeight - brushHeight) / 2 + metrics.brushOffsetY;
  const brushLeft = Math.max(rect.x + 2 * metrics.scale, gunRect.x - metrics.brushPadLeft);
  // 有弹药列的行：笔刷一直延伸到数字/子弹下方（参考图的横向墨迹）；
  // 空手/近战行没有右侧内容，笔刷就贴着拳头收住，不能拖出一条空黑带。
  const brushRight = ammo.hasAmmo
    ? rect.x + rect.width - metrics.brushPadRight
    : Math.min(rect.x + rect.width - metrics.brushPadRight, gunRect.x + gunRect.width + metrics.brushPadLeft);
  const brushRect: Rect = {
    x: brushLeft,
    y: brushTop,
    width: Math.max(0, brushRight - brushLeft),
    height: brushHeight,
  };

  const bullets: Rect[] = [];
  const centerY = rect.y + rowHeight / 2;
  if (view.kind === "firearm") {
    const bulletHeight = metrics.bulletHeight;
    const bulletWidth = getBulletWidth(view, metrics);
    const gap = metrics.bulletGap;
    const blockWidth = metrics.bulletCount * bulletWidth + (metrics.bulletCount - 1) * gap;
    const startX = ammo.bulletRight - blockWidth;
    for (let index = 0; index < metrics.bulletCount; index += 1) {
      bullets.push({
        x: startX + index * (bulletWidth + gap),
        y: centerY - bulletHeight / 2,
        width: bulletWidth,
        height: bulletHeight,
      });
    }
  }

  const ammoBox: Rect | null = view.kind === "firearm"
    ? {
        x: ammo.magazineLeft,
        y: centerY - metrics.bulletHeight * 0.6,
        width: ammo.bulletRight - ammo.magazineLeft,
        height: metrics.bulletHeight * 1.2,
      }
    : null;

  return {
    slot: view.slot,
    rect,
    brushRect,
    gunRect,
    bullets,
    ammoBox,
    ammoBaselineY: centerY + metrics.magFontSize * metrics.baselineRatio,
  };
}

/** `measureText` 缺失（测试桩）时的估算：按字号与字符类别累加。 */
export function estimateTextWidth(text: string, font: string): number {
  const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = sizeMatch ? Number(sizeMatch[1]) : 16;
  let units = 0;
  for (const char of text) {
    if (char === "∞") units += 0.62;
    else if (char === "/") units += 0.32;
    else if (char >= "0" && char <= "9") units += 0.56;
    else if (char === ".") units += 0.28;
    else units += 0.5;
  }
  return Math.max(0, size * units);
}

/** HUD 只读取设备像素比来定纹理分辨率；坐标仍由 GameScene 的 DPR 变换负责。 */
function readDevicePixelRatio(ctx: CanvasRenderingContext2D): number {
  let ratio = 1;
  if (typeof ctx.getTransform === "function") {
    try {
      const transform = ctx.getTransform();
      if (transform && Number.isFinite(transform.a) && transform.a > 0) ratio = transform.a;
    } catch {
      ratio = 1;
    }
  }
  return clamp(ratio, 1, 2);
}

/** 按源图可见内容框绘制，透明边距不参与缩放。 */
function drawSpriteContent(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sprite: WeaponHudSprite,
  rect: Rect,
): void {
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const box = normalizeContentBox(sprite);
  if (box.x === 0 && box.y === 0 && box.width === 1 && box.height === 1) {
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    return;
  }
  ctx.drawImage(
    image,
    box.x * sprite.sourceWidth,
    box.y * sprite.sourceHeight,
    box.width * sprite.sourceWidth,
    box.height * sprite.sourceHeight,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

/** 素材缺失时的矢量弹丸：只做兜底，正常视觉一律走 PNG。 */
function drawAmmoFallback(ctx: CanvasRenderingContext2D, rect: Rect): void {
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const tip = Math.min(rect.width * 0.6, rect.height * 0.3);
  ctx.beginPath();
  ctx.moveTo(rect.x, rect.y + tip);
  ctx.quadraticCurveTo(rect.x + rect.width / 2, rect.y - tip * 0.4, rect.x + rect.width, rect.y + tip);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
  ctx.lineTo(rect.x, rect.y + rect.height);
  ctx.closePath();
  ctx.fill();
}

function drawAmmoIcon(
  ctx: CanvasRenderingContext2D,
  view: WeaponView,
  rect: Rect,
  dpr: number,
): void {
  const spriteId = getAmmoSpriteForView(view);
  const texture = spriteId
    ? weaponHudAssets.getAmmoTexture(spriteId, rect.width, rect.height, dpr)
    : null;
  if (texture) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(texture.canvas, rect.x, rect.y, rect.width, rect.height);
    return;
  }
  drawAmmoFallback(ctx, rect);
}

function drawPistolIcon(ctx: CanvasRenderingContext2D): void {
  // 侧视手枪，枪口朝左（与仓库 PNG 素材、参考图同向）：套筒、前后准星、握把、扳机护圈、扳机。
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
  // 侧视冲锋枪，枪口朝左：长机匣、枪管、前握把、弧形弹匣、枪托。
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

/** 图片未就绪/加载失败时的矢量回退；枪械镜像成枪口朝左，切图时不会突然翻转。 */
export function drawWeaponSilhouette(
  ctx: CanvasRenderingContext2D,
  view: WeaponView,
  box: Rect,
  color: string,
): void {
  const scale = Math.min(box.width / 36, box.height / 36);
  if (!(scale > 0)) return;

  ctx.save();
  if (view.kind === "firearm") {
    // 素材里枪口朝左：水平镜像后，图标与 PNG 的朝向一致。
    ctx.translate(box.x + (box.width + 36 * scale) / 2, box.y + (box.height - 36 * scale) / 2);
    ctx.scale(-scale, scale);
  } else {
    ctx.translate(box.x + (box.width - 36 * scale) / 2, box.y + (box.height - 36 * scale) / 2);
    ctx.scale(scale, scale);
  }
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

interface RowPlan {
  view: WeaponView;
  slot: WeaponSlot;
  active: boolean;
  highlight: number;
  fade: number;
  rect: Rect;
}

interface RowDrawItem extends RowPlan {
  content: WeaponRowLayout;
}

function drawWeaponRow(
  ctx: CanvasRenderingContext2D,
  item: RowDrawItem,
  metrics: WeaponListMetrics,
  ammo: WeaponAmmoColumn,
  dpr: number,
): void {
  const mix = clamp01(item.highlight);
  const fade = clamp01(item.fade);
  const brushAlpha = lerp(INACTIVE_BRUSH_ALPHA, ACTIVE_BRUSH_ALPHA, mix) * fade;
  const gunAlpha = lerp(INACTIVE_GUN_ALPHA, 1, mix) * fade;
  const inkAlpha = lerp(INACTIVE_INK_ALPHA, 1, mix) * fade;
  const { view, content } = item;

  ctx.save();
  try {
    ctx.globalCompositeOperation = "source-over";

    // 1) 毛笔笔刷：每行按自己的枪械轮廓决定左端起点。
    drawBrush(ctx, content.brushRect, {
      alpha: brushAlpha,
      dpr,
      variant: view.slot === "primary" ? 0 : 1,
    });

    // 2) 枪械原图（加载中/失败回退到矢量）。
    ctx.save();
    try {
      ctx.globalAlpha = gunAlpha;
      const spriteId = getWeaponSpriteForView(view);
      const image = spriteId ? weaponHudAssets.getImage(spriteId) : null;
      if (spriteId && image) {
        drawSpriteContent(ctx, image, WEAPON_HUD_SPRITES[spriteId], content.gunRect);
      } else {
        drawWeaponSilhouette(ctx, view, content.gunRect, INK);
      }
    } finally {
      ctx.restore();
    }

    if (view.kind !== "firearm") return;

    // 3)~6) 备用弹药 → 斜杠 → 弹匣余弹 → 三枚子弹，共用一条视觉基线。
    ctx.save();
    try {
      ctx.globalAlpha = inkAlpha;
      ctx.textBaseline = "alphabetic";
      const baselineY = content.ammoBaselineY;

      // 读数顺序：弹匣余弹（大）→ 斜杠 → 备用弹药（小）。
      ctx.font = metrics.magFont;
      ctx.textAlign = "right";
      ctx.fillStyle = INK;
      ctx.fillText(formatMagazine(view), ammo.magazineRight, baselineY);

      ctx.font = metrics.slashFont;
      ctx.textAlign = "left";
      ctx.fillStyle = SLASH_INK;
      ctx.fillText("/", ammo.slashLeft, baselineY);

      const reserve = formatReserve(view);
      if (reserve !== null) {
        ctx.font = metrics.reserveFont;
        ctx.textAlign = "left";
        ctx.fillStyle = RESERVE_INK;
        ctx.fillText(reserve, ammo.reserveLeft, baselineY);
      }

      ctx.globalAlpha = inkAlpha * BULLET_ALPHA_SCALE;
      ctx.fillStyle = INK;
      for (const bullet of content.bullets) drawAmmoIcon(ctx, view, bullet, dpr);
    } finally {
      ctx.restore();
    }
  } finally {
    ctx.restore();
  }
}

/** 右侧武器列表：缓存切枪动画进度，不读取玩家内部状态。 */
export class WeaponListHud {
  private previousActiveSlot: WeaponSlot | null = null;
  private swapProgress = 1;
  private highlight: Record<WeaponSlot, number> = { primary: 0, secondary: 1, melee: 0 };
  private highlightInitialized = false;
  private lastStatus: WeaponListStatus | null = null;
  private measureContext: CanvasRenderingContext2D | null = null;
  private readonly measureCache = new Map<string, number>();

  update(delta: number, loadout: WeaponLoadoutView): void {
    const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const next = loadout.activeSlot;
    const previous = this.previousActiveSlot;

    if (previous === null || next === "melee" || previous === "melee") {
      this.swapProgress = 1;
    } else if (next !== previous) {
      // 快速反向切枪：把进度镜像过来，两行从当前位置继续，不会瞬移回起点。
      this.swapProgress = clamp01(1 - this.swapProgress);
    }

    if (this.swapProgress < 1) {
      this.swapProgress = Math.min(1, this.swapProgress + step / WEAPON_LIST.swapSeconds);
    }
    this.previousActiveSlot = next;

    if (!this.highlightInitialized) {
      this.highlight = { primary: 0, secondary: 0, melee: 0 };
      this.highlight[next] = 1;
      this.highlightInitialized = true;
      return;
    }

    const rate = step / Math.max(0.001, WEAPON_LIST.highlightSeconds);
    for (const slot of WEAPON_SLOTS) {
      const goal = slot === next ? 1 : 0;
      const current = this.highlight[slot];
      const gap = goal - current;
      this.highlight[slot] = Math.abs(gap) <= rate ? goal : current + Math.sign(gap) * rate;
    }
  }

  getLastStatus(): WeaponListStatus | null {
    return this.lastStatus;
  }

  /** 选中亮度：从未 update 过（直接 draw）时按真实 active 直接取端点值。 */
  private highlightFor(slot: WeaponSlot, activeSlot: WeaponSlot): number {
    if (!this.highlightInitialized) return slot === activeSlot ? 1 : 0;
    return clamp01(this.highlight[slot]);
  }

  private createMeasure(ctx: CanvasRenderingContext2D): MeasureText {
    if (this.measureContext !== ctx) {
      this.measureContext = ctx;
      this.measureCache.clear();
    }
    return (text: string, font: string): number => {
      const key = `${font}|${text}`;
      const cached = this.measureCache.get(key);
      if (cached !== undefined) return cached;
      let width = 0;
      if (typeof ctx.measureText === "function") {
        const previousFont = ctx.font;
        try {
          ctx.font = font;
          width = ctx.measureText(text).width;
        } catch {
          width = 0;
        }
        ctx.font = previousFont;
      }
      if (!(width > 0)) width = estimateTextWidth(text, font);
      if (this.measureCache.size > 256) this.measureCache.clear();
      this.measureCache.set(key, width);
      return width;
    };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    loadout: WeaponLoadoutView,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const layout = getWeaponListLayout(viewWidth, viewHeight);
    const metrics = layout.metrics;
    const measure = this.createMeasure(ctx);
    const views = getWeaponListRows(loadout);
    const activeSlot = loadout.activeSlot;
    const ease = smoothstep(this.swapProgress);
    const swapping = views.length === 2 && this.swapProgress < 1;

    const plans: RowPlan[] = views.map((view, index) => {
      const base = index === 0 ? layout.topRow : layout.bottomRow;
      let y = base.y;
      if (swapping) {
        const from = index === 0 ? layout.bottomRow.y : layout.topRow.y;
        const to = index === 0 ? layout.topRow.y : layout.bottomRow.y;
        y = from + (to - from) * ease;
      }
      return {
        view,
        slot: view.slot,
        active: view.slot === activeSlot,
        highlight: this.highlightFor(view.slot, activeSlot),
        fade: 1,
        rect: { x: base.x, y, width: base.width, height: base.height },
      };
    });

    // 弹药列两行共用：数字与子弹的位置与枪图宽度无关，枪图右端因此有统一锚点。
    const ammo = measureWeaponAmmoColumn(
      layout.area.x + layout.area.width,
      metrics,
      measure,
      plans
        .filter(plan => plan.view.kind === "firearm")
        .map(plan => ({
          reserve: formatReserve(plan.view),
          magazine: formatMagazine(plan.view),
          bulletWidth: getBulletWidth(plan.view, metrics),
        })),
    );

    // 交换时两行重叠：被盖住的一行连续衰减，避免笔刷叠黑、枪身与数字重影。
    const overlap = plans.length === 2
      ? clamp01(
          (metrics.rowHeight - Math.abs(plans[0].rect.y - plans[1].rect.y)) /
            Math.max(1, metrics.rowHeight),
        )
      : 0;

    const items: RowDrawItem[] = plans.map(plan => ({
      ...plan,
      fade: plan.active ? 1 : 1 - CROSS_FADE * overlap,
      content: getWeaponRowLayout(plan.view, plan.rect, ammo, metrics),
    }));

    // status 行按 y 排序（保持既有语义：settled 时第一行就是上面那一行）。
    items.sort((a, b) => a.rect.y - b.rect.y || Number(a.active) - Number(b.active));

    this.lastStatus = {
      activeSlot,
      mode: activeSlot === "melee" ? "melee" : "firearms",
      swapProgress: this.swapProgress,
      rows: items.map(item => ({
        slot: item.slot,
        view: item.view,
        rect: item.rect,
        active: item.active,
        highlight: item.highlight,
        brushRect: item.content.brushRect,
        gunRect: item.content.gunRect,
        ammoBox: item.content.ammoBox,
        bullets: item.content.bullets,
      })),
    };

    const dpr = readDevicePixelRatio(ctx);
    ctx.save();
    try {
      // 绘制层级与 y 无关：非 active 行永远先画。否则交换后半段进场行 y 更小，
      // 会被退场行压住，出现“灰影压在新枪上”的闪跳。
      const drawOrder = [...items].sort(
        (a, b) => Number(a.active) - Number(b.active) || a.rect.y - b.rect.y,
      );
      for (const item of drawOrder) drawWeaponRow(ctx, item, metrics, ammo, dpr);
    } finally {
      ctx.restore();
    }
  }
}
