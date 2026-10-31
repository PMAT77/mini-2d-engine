import type { Rect } from "./HudTypes";

/**
 * 手电状态条贴在武器列表上方，文案右缘与列表内容右缘对齐。
 * 视觉上只有一条软暗底，没有描边、没有胶囊轮廓，和武器行共用同一套 HUD 语言。
 */
export const FLASHLIGHT_HUD = {
  width: 95,
  height: 26,
  gap: 8,
  /** 软暗底的圆角只负责让暗底收边，不再构成按钮轮廓。 */
  radius: 9,
  /** 开/关渐变时长，落在需求给的 100~180ms 内。 */
  transitionSeconds: 0.15,
  iconLeft: 8,
  iconWidth: 10,
  iconHeight: 15,
  /** 图标与状态文字之间的间距：比早期版本松开一点，避免图标贴字。 */
  iconGap: 8,
  /** `G` 的右缘相对状态条右缘的内缩：0 表示字形推进边缘正好落在列表内容右缘。 */
  keyRight: 0,
} as const;

type Rgba = readonly [number, number, number, number];

/** 关灯：冷灰剪影；开灯：项目既有的荧光薄荷绿。 */
const OFF_PALETTE = {
  ink: [14, 22, 30, 0.44],
  inkEnd: [10, 16, 24, 0.04],
  icon: [116, 135, 148, 1],
  glow: [121, 226, 160, 0],
} as const satisfies Record<string, Rgba>;

const ON_PALETTE = {
  ink: [18, 44, 32, 0.52],
  inkEnd: [12, 28, 22, 0.05],
  icon: [121, 226, 160, 1],
  glow: [121, 226, 160, 0.5],
} as const satisfies Record<string, Rgba>;

type FlashlightPalette = { [K in keyof typeof ON_PALETTE]: Rgba };

/** 文案与图标同步开/关；快捷键提示沿用武器 HUD 的次级墨色，不另造一套颜色。 */
const TEXT_COLOR = "rgba(242,248,250,1)";
const KEY_COLOR = "#b6c4cd";

const FONT = '600 13px "Microsoft YaHei", "PingFang SC", sans-serif';
const KEY_FONT = '600 11px "Microsoft YaHei", "PingFang SC", sans-serif';
const ICON_STROKE = 1.8;
const ICON_HEAD_HEIGHT = 4;
const ICON_BODY_INSET = 0.9;
const SLASH_OVERSHOOT = 1.6;
/** 取不到墨迹度量时的基线估算：13px 中文墨迹高 12（上 11 / 下 1）。 */
const LABEL_BASELINE_FALLBACK = 5;
/** 同上，11px 的 `G` 墨迹高 8（上 5.1 / 下 2.9）。 */
const KEY_BASELINE_FALLBACK = 1;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function mix(from: Rgba, to: Rgba, level: number): Rgba {
  const t = clamp01(level);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    from[3] + (to[3] - from[3]) * t,
  ];
}

/** 颜色都走 rgba 字符串，端点与中间态同一条路径，单测可以直接比字符串。 */
function rgba(color: Rgba): string {
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${color[3]})`;
}

function paletteAt(level: number): FlashlightPalette {
  return {
    ink: mix(OFF_PALETTE.ink, ON_PALETTE.ink, level),
    inkEnd: mix(OFF_PALETTE.inkEnd, ON_PALETTE.inkEnd, level),
    icon: mix(OFF_PALETTE.icon, ON_PALETTE.icon, level),
    glow: mix(OFF_PALETTE.glow, ON_PALETTE.glow, level),
  };
}

/**
 * 让文字墨迹（而不是字体行盒）垂直居中。
 * `textBaseline = "middle"` 按字体行盒对齐，CJK 墨迹会被抬到中心上方，
 * 所以这里用 measureText 的 actualBoundingBox 反推基线，让墨迹正中落在 `cy` 上；
 * 取不到墨迹度量时退回按字号估算的偏移。
 */
function inkCenteredBaseline(
  ctx: CanvasRenderingContext2D,
  text: string,
  cy: number,
  fallback: number,
): number {
  if (typeof ctx.measureText === "function") {
    const metrics = ctx.measureText(text);
    const ascent = metrics?.actualBoundingBoxAscent;
    const descent = metrics?.actualBoundingBoxDescent;
    if (typeof ascent === "number" && Number.isFinite(ascent) && typeof descent === "number" && Number.isFinite(descent)) {
      return cy + (ascent - descent) / 2;
    }
  }
  return cy + fallback;
}

/**
 * 由武器列表区域矩形得到手电状态条矩形（逻辑像素）。
 * `contentRight` 传入列表内容的右缘（弹药列右缘），文案右缘与它对齐。
 */export function getFlashlightHudRect(anchor: Rect, contentRight?: number): Rect {
  const right = contentRight ?? anchor.x + anchor.width;
  return {
    x: right - FLASHLIGHT_HUD.width,
    y: anchor.y - FLASHLIGHT_HUD.gap - FLASHLIGHT_HUD.height,
    width: FLASHLIGHT_HUD.width,
    height: FLASHLIGHT_HUD.height,
  };
}

/**
 * 竖向手电剪影（参考图样式）：上宽灯头 + 略窄筒身，约 2px 外轮廓勾出；
 * 关闭时同一轮廓上再压一道对角斜杠，表示“已关闭”，开启时斜杠消失并带绿色柔光。
 * 只描图标本身，容器仍然只填不描，保持“无边框 HUD”的语义。
 */
function drawLampIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  palette: FlashlightPalette,
  level: number,
  on: boolean,
): void {
  const bx = rect.x + FLASHLIGHT_HUD.iconLeft;
  const cy = rect.y + rect.height / 2;
  const width = FLASHLIGHT_HUD.iconWidth;
  const height = FLASHLIGHT_HUD.iconHeight;
  const top = cy - height / 2;
  const glow = clamp01(level);

  ctx.save();
  ctx.strokeStyle = rgba(palette.icon);
  ctx.lineWidth = ICON_STROKE;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (glow > 0.05) {
    ctx.shadowColor = rgba(palette.glow);
    ctx.shadowBlur = 5 * glow;
  }

  // 灯头：略宽、上缘圆角，底边就是参考图里的那道横梁。
  ctx.beginPath();
  ctx.roundRect(bx, top, width, ICON_HEAD_HEIGHT, 1.4);
  ctx.stroke();

  // 筒身：比灯头窄一点，底角更圆，顶边与灯头底边重合形成分割线。
  ctx.beginPath();
  ctx.roundRect(
    bx + ICON_BODY_INSET,
    top + ICON_HEAD_HEIGHT,
    width - ICON_BODY_INSET * 2,
    height - ICON_HEAD_HEIGHT,
    2,
  );
  ctx.stroke();
  ctx.restore();

  // 关灯：一道路径斜杠压过轮廓，两端略微出头，就是参考图里的“关”标记。
  if (!on) {
    ctx.save();
    ctx.strokeStyle = rgba(palette.icon);
    ctx.lineWidth = ICON_STROKE;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bx - SLASH_OVERSHOOT, top - SLASH_OVERSHOOT);
    ctx.lineTo(bx + width + SLASH_OVERSHOOT, top + height + SLASH_OVERSHOOT);
    ctx.stroke();
    ctx.restore();
  }
}

/** 按 0~1 的等级画手电状态条：文字始终白色，图标颜色与柔光连续插值。 */
export function drawFlashlightHudAtLevel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  level: number,
  on: boolean,
  _dpr = 1,
): void {
  const t = clamp01(level);
  const palette = paletteAt(t);
  const cy = rect.y + rect.height / 2;

  ctx.save();

  // 唯一的底：左浓右淡的软暗底，没有任何 stroke。
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, FLASHLIGHT_HUD.radius);
  const ink = palette.ink;
  if (typeof ctx.createLinearGradient === "function") {
    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y);
    gradient.addColorStop(0, rgba(ink));
    gradient.addColorStop(0.58, rgba([ink[0], ink[1], ink[2], ink[3] * 0.6]));
    gradient.addColorStop(1, rgba(palette.inkEnd));
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = rgba(ink);
  }
  ctx.fill();

  drawLampIcon(ctx, rect, palette, t, on);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = FONT;
  ctx.fillStyle = TEXT_COLOR;
  const label = on ? "手电 · 开" : "手电 · 关";
  ctx.fillText(
    label,
    rect.x + FLASHLIGHT_HUD.iconLeft + FLASHLIGHT_HUD.iconWidth + FLASHLIGHT_HUD.iconGap,
    inkCenteredBaseline(ctx, label, cy, LABEL_BASELINE_FALLBACK),
  );

  // G 是次级操作提示：字号更小、沿用武器 HUD 的次级墨色，不抢主状态。
  ctx.textAlign = "right";
  ctx.font = KEY_FONT;
  ctx.fillStyle = KEY_COLOR;
  ctx.fillText(
    "G",
    rect.x + rect.width - FLASHLIGHT_HUD.keyRight,
    inkCenteredBaseline(ctx, "G", cy, KEY_BASELINE_FALLBACK),
  );

  ctx.restore();
}

/** 纯函数入口：不带动画状态，按开关直接画终态，测试与截图脚本用。 */
export function drawFlashlightHud(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  on: boolean,
  dpr = 1,
): void {
  drawFlashlightHudAtLevel(ctx, rect, on ? 1 : 0, on, dpr);
}

/** 手电 HUD 的动画状态机：短渐变、无闪烁，首帧直接吸附到目标避免进场淡入。 */
export class FlashlightHud {
  private level: number | null = null;
  private on = true;

  /** 每帧推进一次渐变；delta 异常时保持不动。 */
  update(delta: number, on: boolean): void {
    this.on = on;
    const target = on ? 1 : 0;
    if (this.level === null) {
      this.level = target;
      return;
    }
    const step = Number.isFinite(delta) && delta > 0
      ? delta / FLASHLIGHT_HUD.transitionSeconds
      : 0;
    if (this.level < target) this.level = Math.min(target, this.level + step);
    else if (this.level > target) this.level = Math.max(target, this.level - step);
  }

  draw(ctx: CanvasRenderingContext2D, rect: Rect, dpr = 1): void {
    const level = this.level === null ? (this.on ? 1 : 0) : this.level;
    drawFlashlightHudAtLevel(ctx, rect, level, this.on, dpr);
  }

  /** 当前渐变等级：0 全关，1 全开。 */
  getLevel(): number {
    return this.level === null ? (this.on ? 1 : 0) : this.level;
  }

  isOn(): boolean {
    return this.on;
  }
}
