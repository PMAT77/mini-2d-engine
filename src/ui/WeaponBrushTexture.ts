/**
 * 程序化毛笔笔刷纹理。
 *
 * 生成流程：固定种子 → 归一化的多笔触带轮廓 + 干刷缺口/亮纤维/积墨数据（`BrushProfile`）
 * → 在离屏 Canvas 上逐带填充横向渐变、叠亮纤维与缺口 → 按「尺寸 × DPR」缓存。
 *
 * 参考图实测：选中行的笔触是比近黑场景更亮的板蓝灰湿墨（中段约 `rgb(34,48,64)` 以 α≈0.6
 * 合成，上下缘有 `rgb(110,140,170)` 的干刷亮纤维），而不是纯黑蒙版；未选中行几乎看不见。
 * 因此墨色取深板蓝而不是纯黑，否则在近黑场景上完全不显形。
 *
 * 笔刷只在尺寸或 DPR 变化时重建，每帧只 drawImage 一张已缓存的纹理；
 * 没有 DOM（Node 单测）时退回直接用同一份轮廓在主画布上填充（不擦除，避免打穿场景）。
 */
import type { Rect } from "./HudTypes";

export interface BrushPoint {
  x: number;
  y: number;
}

/**
 * 一笔里的细节痕迹：
 * `erase` 擦出干刷缺口，`ink` 让中段落墨更重，`fiber` 是边缘的亮色干刷纤维。
 */
export interface BrushStreak {
  x: number;
  y: number;
  length: number;
  thickness: number;
  alpha: number;
  /** 沿笔势的细微倾斜（归一化），让纤维不是一把直尺。 */
  slope?: number;
  kind: "erase" | "ink" | "fiber";
}

/** 一条笔触带：`start`/`end` 是它自己覆盖的归一化区间，两端错落才像一笔扫过。 */
export interface BrushBand {
  start: number;
  end: number;
  alpha: number;
  top: BrushPoint[];
  bottom: BrushPoint[];
}

export interface BrushProfile {
  seed: number;
  variant: number;
  /** 主体轮廓（等于 `bands[0]`），供回退绘制与外部读取。 */
  top: BrushPoint[];
  bottom: BrushPoint[];
  bands: BrushBand[];
  streaks: BrushStreak[];
}

/** 所有行共用同一个基础种子；变体号只用来让两行的轮廓略有差别。 */
export const BRUSH_BASE_SEED = 0x5eed1e;
export const BRUSH_STATIONS = 32;
/** 墨色：深板蓝黑（参考图实测中段合成色），不用纯蓝或金色描边。 */
export const BRUSH_INK = "34,48,64";
/** 干刷亮纤维色：笔触边缘的浅蓝灰，负责让笔刷在近黑场景上显形。 */
export const BRUSH_FIBER = "110,140,170";
/** 积墨内芯：少量更深的一段，避免主体读成一块均匀色块。 */
export const BRUSH_CORE = "4,8,14";

const MAX_BRUSH_TEXTURES = 12;
const MIN_TEXTURE_DPR = 1;
const MAX_TEXTURE_DPR = 2;
const TAU = Math.PI * 2;
/** 笔触带的底色权重：主体结构交给笔毛层，带只负责一层湿墨薄雾与柔和收边。 */
const BAND_WASH_ALPHA = 0.8;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep01(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 固定种子的 32 位 PRNG：同一种子必然得到同一份轮廓。 */
export function createBrushRandom(seed: number): () => number {
  let state = (Number.isFinite(seed) ? Math.floor(seed) : BRUSH_BASE_SEED) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成一笔横向笔刷：主体饱满、两侧有错落的细笔触带，上下缘带低频起伏与高频纤维。
 * 坐标全部归一化（x、y 都在 0..1），因此与最终像素尺寸无关，可跨分辨率复用。
 */
export function createBrushProfile(seed: number = BRUSH_BASE_SEED, variant = 0): BrushProfile {
  const random = createBrushRandom(seed + variant * 7919);
  const count = BRUSH_STATIONS;

  const phaseA = random() * TAU;
  const phaseB = random() * TAU;
  const phaseC = random() * TAU;
  const bodyThickness = 0.72 + random() * 0.16;
  const centerShift = (random() - 0.5) * 0.05;
  const leftTaper = 0.035 + random() * 0.035;
  const rightTaper = 0.06 + random() * 0.05;

  const centerAt = (t: number): number => clamp01(0.5 + centerShift
    + Math.sin(t * TAU * 0.62 + phaseA) * 0.03
    + Math.sin(t * TAU * 1.9 + phaseB) * 0.012);
  const edgeWave = (t: number): number => Math.sin(t * TAU * 1.35 + phaseC) * 0.5
    + Math.sin(t * TAU * 3.3 + phaseA) * 0.3;
  const envelopeAt = (t: number): number => Math.pow(
    smoothstep01(0, leftTaper, t) * (1 - smoothstep01(1 - rightTaper, 1, t)),
    0.42,
  );

  const makeBand = (
    start: number,
    end: number,
    alpha: number,
    thicknessScale: number,
    yShift: number,
    softness: number,
  ): BrushBand => {
    const top: BrushPoint[] = [];
    const bottom: BrushPoint[] = [];
    // 每条带自己的低频起伏（2~6 个鼓包）：并集边缘才会读成干刷的层次，而不是一条光滑曲线。
    const bumpFreqA = 3.2 + random() * 2.6;
    const bumpFreqB = 6.4 + random() * 3.6;
    const bumpPhase = random() * TAU;
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const window = smoothstep01(start, start + softness, t)
        * (1 - smoothstep01(end - softness, end, t));
      // 起笔/收笔很短的过渡 + 中段接近满厚：椭圆会读成光斑，不能走椭圆。
      const strength = envelopeAt(t) * Math.pow(clamp01(window), 0.45);
      const center = centerAt(t) + yShift;
      const bump = 1 + (Math.sin(t * TAU * bumpFreqA + bumpPhase) * 0.6
        + Math.sin(t * TAU * bumpFreqB + bumpPhase * 1.7) * 0.4) * 0.07;
      const half = bodyThickness * thicknessScale * 0.5 * strength * Math.max(0.15, bump);
      const wave = edgeWave(t) * 0.16;
      const jitterTop = (random() - 0.5) * 0.055 * strength;
      const jitterBottom = (random() - 0.5) * 0.055 * strength;
      top.push({ x: t, y: clamp01(center - half * (1 + wave) + jitterTop) });
      bottom.push({ x: t, y: clamp01(center + half * (1 - wave * 0.8) + jitterBottom) });
    }
    return { start, end, alpha, top, bottom };
  };

  // 主体 + 8 条错落的副笔触：副带更细、起止更短甚至比主体更长，两端因此散成干刷纤维，
  // 而不是一枚圆头胶囊。
  const bands: BrushBand[] = [
    makeBand(0.045, 0.955, 1, 1, 0, 0.04),
    makeBand(0.02, 0.99, 0.5, 0.72, -0.045, 0.05),
    makeBand(0.03, 0.975, 0.45, 0.64, 0.05, 0.05),
    makeBand(0, 0.9, 0.34, 0.3, -0.1, 0.06),
    makeBand(0.06, 1, 0.3, 0.26, 0.12, 0.06),
    makeBand(0, 0.44, 0.26, 0.22, -0.16, 0.09),
    makeBand(0.5, 1, 0.24, 0.2, 0.19, 0.09),
    makeBand(0.14, 0.52, 0.26, 0.13, -0.2, 0.09),
    makeBand(0.44, 0.87, 0.22, 0.11, 0.21, 0.09),
  ];
  const top = bands[0].top;
  const bottom = bands[0].bottom;

  const stationAt = (t: number): number => Math.max(0, Math.min(count - 1, Math.round(t * (count - 1))));

  const streaks: BrushStreak[] = [];

  // 干刷纤维：亮色细线沿着笔势散布在上下缘与主体内部，是笔触在近黑场景上显形的关键。
  for (let index = 0; index < 46; index += 1) {
    const at = clamp01(random() * 0.92);
    const station = stationAt(at);
    const nearEdge = random() < 0.6;
    const upper = random() < 0.55;
    const edge = upper ? top[station].y : bottom[station].y;
    const inside = (top[station].y + bottom[station].y) / 2;
    const y = nearEdge
      ? edge + (upper ? 1 : -1) * (0.002 + random() * 0.022)
      : inside + (random() - 0.5) * Math.abs(bottom[station].y - top[station].y) * 0.7;
    streaks.push({
      x: at,
      y: clamp01(y),
      length: 0.08 + random() * 0.22,
      thickness: 0.016 + random() * 0.028,
      alpha: 0.16 + random() * 0.2,
      slope: (random() - 0.5) * 0.14,
      kind: "fiber",
    });
  }

  // 上缘的高光纤维：参考图里笔触上缘更亮，是整笔最先被读到的轮廓。
  for (let index = 0; index < 3; index += 1) {
    const at = 0.08 + random() * 0.3;
    const station = stationAt(at);
    streaks.push({
      x: at,
      y: clamp01(top[station].y + 0.008 + random() * 0.014),
      length: 0.2 + random() * 0.26,
      thickness: 0.02 + random() * 0.016,
      alpha: 0.2 + random() * 0.12,
      slope: (random() - 0.5) * 0.03,
      kind: "fiber",
    });
  }

  // 干刷缺口：贴边、沿笔势的细长擦除，两端更密，避免边缘读成一条直线。
  for (let index = 0; index < 30; index += 1) {
    const at = clamp01(random() < 0.5 ? 0.01 + random() * 0.22 : 0.74 + random() * 0.25);
    const upper = random() < 0.5;
    const station = stationAt(at);
    const edge = upper ? top[station].y : bottom[station].y;
    const toward = upper ? 1 : -1;
    streaks.push({
      x: at,
      y: clamp01(edge + toward * (0.01 + random() * 0.14)),
      length: 0.04 + random() * 0.2,
      thickness: 0.03 + random() * 0.05,
      alpha: 0.24 + random() * 0.36,
      kind: "erase",
    });
  }

  // 中部横向断墨：细长擦除，让主体分出笔丝层次，而不是一块实心色。
  for (let index = 0; index < 10; index += 1) {
    streaks.push({
      x: 0.04 + random() * 0.55,
      y: 0.28 + random() * 0.44,
      length: 0.08 + random() * 0.24,
      thickness: 0.02 + random() * 0.03,
      alpha: 0.1 + random() * 0.18,
      kind: "erase",
    });
  }

  // 积墨：中段几道更深的横向笔芯，避免主体是一块均匀色。
  for (let index = 0; index < 12; index += 1) {
    streaks.push({
      x: 0.06 + random() * 0.64,
      y: 0.3 + random() * 0.38,
      length: 0.08 + random() * 0.26,
      thickness: 0.04 + random() * 0.07,
      alpha: 0.04 + random() * 0.08,
      kind: "ink",
    });
  }

  return { seed, variant, top, bottom, bands, streaks };
}

/** 把一条笔触带的归一化轮廓用平滑二次曲线描到目标矩形上。 */
function traceBand(ctx: CanvasRenderingContext2D, band: BrushBand, rect: Rect): void {
  const { top, bottom } = band;
  if (top.length < 2 || bottom.length < 2) return;
  const px = (point: BrushPoint): number => rect.x + point.x * rect.width;
  const py = (point: BrushPoint): number => rect.y + point.y * rect.height;

  ctx.beginPath();
  ctx.moveTo(px(top[0]), py(top[0]));
  for (let index = 1; index < top.length - 1; index += 1) {
    const next = top[index + 1];
    ctx.quadraticCurveTo(px(top[index]), py(top[index]),
      (px(top[index]) + px(next)) / 2, (py(top[index]) + py(next)) / 2);
  }
  const lastTop = top[top.length - 1];
  ctx.lineTo(px(lastTop), py(lastTop));
  const lastBottom = bottom[bottom.length - 1];
  ctx.lineTo(px(lastBottom), py(lastBottom));
  for (let index = bottom.length - 2; index > 0; index -= 1) {
    const next = bottom[index - 1];
    ctx.quadraticCurveTo(px(bottom[index]), py(bottom[index]),
      (px(bottom[index]) + px(next)) / 2, (py(bottom[index]) + py(next)) / 2);
  }
  const firstBottom = bottom[0];
  ctx.lineTo(px(firstBottom), py(firstBottom));
  ctx.closePath();
}

/** 描主笔触带（保留旧导出，回退路径与外部测试都从这一笔开始）。 */
export function traceBrushPath(
  ctx: CanvasRenderingContext2D,
  profile: BrushProfile,
  rect: Rect,
): void {
  const band = profile.bands && profile.bands.length > 0
    ? profile.bands[0]
    : { start: 0, end: 1, alpha: 1, top: profile.top, bottom: profile.bottom };
  traceBand(ctx, band, rect);
}

/** 横向透明度渐变：两端逐步衰减，中段保持连续主体，不是硬切边。 */
function createInkGradient(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: string = BRUSH_INK,
): CanvasGradient | string {
  if (typeof ctx.createLinearGradient !== "function") return `rgba(${color},0.9)`;
  const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y);
  const stops: Array<[number, number]> = [
    [0, 0],
    [0.035, 0.18],
    [0.09, 0.55],
    [0.18, 0.84],
    [0.3, 1],
    [0.7, 1],
    [0.84, 0.88],
    [0.93, 0.52],
    [0.975, 0.2],
    [1, 0],
  ];
  for (const [offset, alpha] of stops) {
    gradient.addColorStop(offset, `rgba(${color},${alpha.toFixed(3)})`);
  }
  return gradient;
}

/** 沿笔势两端渐隐的笔触：避免出现一条条端头生硬的方块。 */
function taperStroke(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  alpha: number,
): string | CanvasGradient {
  if (typeof ctx.createLinearGradient !== "function") return `rgba(${color},${alpha})`;
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, `rgba(${color},0)`);
  gradient.addColorStop(0.26, `rgba(${color},${(alpha * 0.8).toFixed(3)})`);
  gradient.addColorStop(0.74, `rgba(${color},${alpha.toFixed(3)})`);
  gradient.addColorStop(1, `rgba(${color},0)`);
  return gradient;
}

/**
 * 逐条画细节痕迹。进入时记录调用方的 alpha 与合成模式，退出时原样还原，
 * 否则笔刷的透明度会泄漏给后续 HUD。`erase` 在回退路径为 false，
 * 避免 `destination-out` 把游戏画面擦穿；`atop` 让亮纤维只落在笔触内部，
 * 不会变成穿过整行画布的直线。
 */
function drawStreaks(
  ctx: CanvasRenderingContext2D,
  profile: BrushProfile,
  rect: Rect,
  options: { erase: boolean; atop: boolean },
): void {
  const startAlpha = ctx.globalAlpha;
  const startComposite = ctx.globalCompositeOperation;
  const startCap = ctx.lineCap;
  for (const streak of profile.streaks) {
    if (streak.kind === "erase" && !options.erase) continue;
    const x = rect.x + streak.x * rect.width;
    const y = rect.y + streak.y * rect.height;
    const length = Math.max(1, streak.length * rect.width);
    const endY = y + (streak.slope ?? 0) * rect.height;
    if (streak.kind === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#02060c";
      ctx.globalAlpha = clamp01(startAlpha * streak.alpha);
      ctx.lineCap = "round";
    } else {
      // 纤维/墨芯两端渐隐，横看是笔丝，不是一条条方块。
      ctx.globalCompositeOperation = options.atop ? "source-atop" : "source-over";
      ctx.strokeStyle = taperStroke(
        ctx,
        x,
        y,
        x + length,
        endY,
        streak.kind === "ink" ? BRUSH_CORE : BRUSH_FIBER,
        clamp01(streak.alpha),
      );
      ctx.globalAlpha = startAlpha;
      ctx.lineCap = "round";
    }
    ctx.lineWidth = Math.max(1, streak.thickness * rect.height);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, endY);
    ctx.stroke();
  }
  ctx.globalAlpha = startAlpha;
  ctx.globalCompositeOperation = startComposite;
  ctx.lineCap = startCap;
}

/** 在目标上下文上逐带绘制笔刷（回退路径，也是无 DOM 时唯一路径）。 */
function paintBrush(
  ctx: CanvasRenderingContext2D,
  profile: BrushProfile,
  rect: Rect,
  allowErase: boolean,
): void {
  const gradient = createInkGradient(ctx, rect);
  const baseAlpha = clamp01(ctx.globalAlpha);
  ctx.fillStyle = gradient;
  for (const band of profile.bands) {
    traceBand(ctx, band, rect);
    // 逐带叠加：重叠处自然变浓，边缘处只留下一层薄雾。
    ctx.globalAlpha = clamp01(baseAlpha * band.alpha * BAND_WASH_ALPHA);
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;
  drawStreaks(ctx, profile, rect, { erase: allowErase, atop: false });
}

function renderBrushTexture(
  profile: BrushProfile,
  width: number,
  height: number,
  dpr: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvasWidth = Math.max(4, Math.round(width * dpr));
  const canvasHeight = Math.max(4, Math.round(height * dpr));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const rect: Rect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    const gradient = createInkGradient(ctx, rect);
    for (const band of profile.bands) {
      traceBand(ctx, band, rect);
      ctx.globalAlpha = clamp01(band.alpha * BAND_WASH_ALPHA);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawStreaks(ctx, profile, rect, { erase: true, atop: true });
    return canvas;
  } catch {
    return null;
  }
}

function textureDpr(value: number): number {
  if (!Number.isFinite(value)) return MIN_TEXTURE_DPR;
  return Math.min(MAX_TEXTURE_DPR, Math.max(MIN_TEXTURE_DPR, value));
}

/** 笔刷缓存：轮廓与纹理各缓存一层，同尺寸同 DPR 直接复用。 */
export class WeaponBrushTextures {
  private readonly profiles = new Map<string, BrushProfile>();
  private readonly canvases = new Map<string, HTMLCanvasElement>();
  private profileBuilds = 0;
  private canvasBuilds = 0;

  getProfile(seed: number = BRUSH_BASE_SEED, variant = 0): BrushProfile {
    const key = `${seed >>> 0}:${variant}`;
    const cached = this.profiles.get(key);
    if (cached) return cached;
    const profile = createBrushProfile(seed, variant);
    this.profileBuilds += 1;
    this.profiles.set(key, profile);
    return profile;
  }

  getCanvas(
    width: number,
    height: number,
    dpr: number,
    seed: number,
    variant: number,
  ): HTMLCanvasElement | null {
    if (!(width > 0) || !(height > 0)) return null;
    const ratio = textureDpr(dpr);
    const key = `${seed >>> 0}:${variant}:${Math.round(width)}x${Math.round(height)}@${ratio}`;
    const cached = this.canvases.get(key);
    if (cached) return cached;
    const canvas = renderBrushTexture(
      this.getProfile(seed, variant),
      Math.round(width),
      Math.round(height),
      ratio,
    );
    // 没有 DOM 或创建失败时不缓存，避免把一次性失败钉死。
    if (!canvas) return null;
    this.canvasBuilds += 1;
    this.canvases.set(key, canvas);
    if (this.canvases.size > MAX_BRUSH_TEXTURES) {
      const oldest = this.canvases.keys().next().value;
      if (oldest !== undefined) this.canvases.delete(oldest);
    }
    return canvas;
  }

  stats(): { profileBuilds: number; canvasBuilds: number; profiles: number; canvases: number } {
    return {
      profileBuilds: this.profileBuilds,
      canvasBuilds: this.canvasBuilds,
      profiles: this.profiles.size,
      canvases: this.canvases.size,
    };
  }

  reset(): void {
    this.profiles.clear();
    this.canvases.clear();
    this.profileBuilds = 0;
    this.canvasBuilds = 0;
  }
}

export const weaponBrushTextures = new WeaponBrushTextures();

export interface BrushDrawOptions {
  /** 期望的中央有效透明度（纹理中段自身接近不透明，逐带与纤维在此之上做纹理）。 */
  alpha: number;
  dpr?: number;
  seed?: number;
  variant?: number;
}

/**
 * 画一笔笔刷。只做一次 `drawImage`（缓存命中时），不重复构造路径与渐变。
 */
export function drawBrush(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: BrushDrawOptions,
): void {
  const alpha = Number.isFinite(options.alpha) ? clamp01(options.alpha) : 0;
  if (alpha <= 0) return;
  if (!(rect.width > 1) || !(rect.height > 1)) return;
  const seed = options.seed ?? BRUSH_BASE_SEED;
  const variant = options.variant ?? 0;
  const dpr = textureDpr(options.dpr ?? 1);
  const profile = weaponBrushTextures.getProfile(seed, variant);
  const canvas = weaponBrushTextures.getCanvas(rect.width, rect.height, dpr, seed, variant);

  ctx.save();
  try {
    ctx.globalAlpha = alpha;
    if (canvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height);
    } else {
      paintBrush(ctx, profile, rect, false);
    }
  } finally {
    ctx.restore();
  }
}
