/**
 * 拾取提示的纯视觉层：鸭科夫风格的小光点、物品右侧的 E + 拾取横向提示，
 * 以及贴合键帽外轮廓的圆角矩形进度框。
 *
 * 只负责画，不判断按键、不结算拾取；坐标由调用方换算成屏幕 CSS 逻辑像素，
 * 所以相机缩放、震动与 DPR 都不会让标记偏离物品。
 */

import type { PickupMarkerStyle } from "../interaction/PickupTypes";
import {
  MARKER_CLUSTER_DISTANCE,
  MARKER_GAP,
  PROMPT_SCREEN_MARGIN,
  markerDotPosition,
  placePickupPrompt,
  roundedRectOutline,
  secondaryMarkerIndices,
  type LayoutBox,
  type LayoutPoint,
  type PromptSide,
} from "./PickupLayout";

/** 仓库现有键帽素材；按 CC BY-ND 许可只做运行时 drawImage 缩放，不另存修改版。 */
export const PICKUP_ICON_URL =
  "/assets/images/ui/keyboard-mouse/64/Keyboard_E.png";

/** 视觉规范（单位：屏幕 CSS 像素）。 */
export const PICKUP_ICON_SIZE = 24;
/** E 键与“拾取”文字之间的间距。 */
export const PICKUP_ICON_TEXT_GAP = 5;
export const PICKUP_TEXT_SIZE = 11.5;
/** 键帽与进度框之间的空隙。 */
export const PICKUP_FRAME_GAP = 1.5;
/** 进度框线宽。 */
export const PICKUP_FRAME_LINE_WIDTH = 2;
/** 进度框圆角，与键帽视觉圆角协调。 */
export const PICKUP_FRAME_RADIUS = 8;
/** 进度框整体尺寸：键帽 + 空隙 + 线宽。 */
export const PICKUP_FRAME_SIZE =
  PICKUP_ICON_SIZE + (PICKUP_FRAME_GAP + PICKUP_FRAME_LINE_WIDTH / 2) * 2;

/** 高亮点尺寸。 */
export const PICKUP_MARKER_CORE_RADIUS = 2;
export const PICKUP_MARKER_HALO_RADIUS = 8;
/** 呼吸周期。 */
export const PICKUP_MARKER_BREATH_SECONDS = 1.3;
/** 提示淡入时间。 */
export const PICKUP_FADE_SECONDS = 0.13;
/** 完成拾取后提示淡出时间。 */
export const PICKUP_FADE_OUT_SECONDS = 0.12;
/** 完成反馈持续时间；不延迟真实结算。 */
export const PICKUP_COMPLETION_FLASH_SECONDS = 0.08;

export interface PickupMarkerDraw {
  /** 物品中心的屏幕 CSS 坐标。 */
  x: number;
  y: number;
  style: PickupMarkerStyle;
  /** 物品可见半高，用于把光点放在可见顶部之上。 */
  halfHeight: number;
  /** 是否是当前交互目标。 */
  target?: boolean;
}

export interface PickupPromptDraw {
  /** 物品中心的屏幕 CSS 坐标。 */
  x: number;
  y: number;
  /** 物品可见范围的半宽/半高（屏幕 CSS）。 */
  halfWidth: number;
  halfHeight: number;
  /** 0..1，只有 holding 时才绘制进度。 */
  progress: number;
  holding: boolean;
  /** AUTO 物品不会产生 prompt。 */
  label: string;
  /** 剪影触觉拾取时为 false：只给通用“拾取”，不带物品信息。 */
  named: boolean;
  /** 目标标识：目标变化时重新计算布局方向并重新淡入。 */
  key?: string;
}

export interface PickupPromptFeedback {
  x: number;
  y: number;
}

export interface PickupPromptViewport {
  width: number;
  height: number;
}

export interface PickupPromptScene {
  markers: readonly PickupMarkerDraw[];
  prompt: PickupPromptDraw | null;
  /** 完成拾取的短反馈；只用于视觉，不参与结算。 */
  feedback?: PickupPromptFeedback | null;
  /** 目标刚被拾取：让提示短暂淡出，而不是硬切。 */
  fadeOut?: boolean;
  /** 需要避让的 HUD 区域（屏幕 CSS），例如右侧武器列表与手电胶囊。 */
  obstacles?: readonly LayoutBox[];
  /** 当前屏幕 CSS 可见区域。 */
  viewport: PickupPromptViewport;
}

export interface PickupPromptDebug {
  markers: {
    x: number;
    y: number;
    secondary: boolean;
    target: boolean;
  }[];
  promptBox: LayoutBox | null;
  promptSide: PromptSide | null;
  promptFade: number;
  promptCenter: LayoutPoint | null;
  textCenter: LayoutPoint | null;
}

const WHITE = "#ffffff";
const GOLD = "#ffd76a";

/** 提示文字：浅灰白，避免纯白在暗场景里过跳。 */
const PROMPT_TEXT_COLOR = "rgba(236, 239, 244, 0.94)";
const PROMPT_FONT = `700 ${PICKUP_TEXT_SIZE}px system-ui, -apple-system, "Segoe UI", sans-serif`;

export class PickupPromptRenderer {
  private icon: HTMLImageElement | null = null;
  private iconLoading = false;
  private iconFailed = false;

  private promptKey: string | null = null;
  private side: PromptSide | null = null;
  private fade = 0;
  private lastTime: number | null = null;
  private lastPromptCenter: LayoutPoint | null = null;

  /** 最近一次完整提示：完成拾取后用它做淡出，避免硬切。 */
  private lastPromptData: PickupPromptDraw | null = null;
  private lastPromptDots: readonly LayoutPoint[] = [];
  private lastPromptTargetIndex = -1;
  private fadingPrompt: PickupPromptDraw | null = null;
  private fadingDots: readonly LayoutPoint[] = [];
  private fadingTargetIndex = -1;
  private fadeOutElapsed = 0;

  private flashStart: number | null = null;
  private flashCenter: LayoutPoint | null = null;

  private debugState: PickupPromptDebug = {
    markers: [],
    promptBox: null,
    promptSide: null,
    promptFade: 0,
    promptCenter: null,
    textCenter: null,
  };

  constructor(private readonly iconUrl: string = PICKUP_ICON_URL) {}

  /** 预加载键帽图标；加载失败时退回矢量键帽，不影响交互逻辑。 */
  preload(): void {
    if (this.icon || this.iconLoading || this.iconFailed) return;
    if (typeof Image === "undefined") return;
    this.iconLoading = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      this.icon = image;
      this.iconLoading = false;
    };
    image.onerror = () => {
      this.iconFailed = true;
      this.iconLoading = false;
    };
    image.src = this.iconUrl;
  }

  /** 最近一帧的布局结果，供浏览器验收与截图定位使用。 */
  getDebugState(): PickupPromptDebug {
    return this.debugState;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    scene: PickupPromptScene,
    timeSeconds: number,
  ): void {
    const delta = this.lastTime === null
      ? 0
      : Math.min(0.1, Math.max(0, timeSeconds - this.lastTime));
    this.lastTime = timeSeconds;

    const prompt = scene.prompt;
    if (prompt) {
      this.lastPromptData = prompt;
      this.fadingPrompt = null;
      this.fadeOutElapsed = 0;
      if (prompt.key !== this.promptKey) {
        this.promptKey = prompt.key ?? null;
        this.side = null;
        this.fade = 0;
      }
      this.fade = Math.min(1, this.fade + delta / PICKUP_FADE_SECONDS);
    } else {
      this.promptKey = null;
      this.fade = 0;
      if (scene.fadeOut && this.lastPromptData && !this.fadingPrompt) {
        // 只在“拾取完成、物品已移除”这一安全时机淡出；
        // 感知或墙体导致的消失由调用方直接停掉提示，不能留下残影。
        this.fadingPrompt = this.lastPromptData;
        this.fadingDots = this.lastPromptDots;
        this.fadingTargetIndex = this.lastPromptTargetIndex;
        this.fadeOutElapsed = delta;
      } else if (this.fadingPrompt) {
        this.fadeOutElapsed += delta;
        if (this.fadeOutElapsed >= PICKUP_FADE_OUT_SECONDS) {
          this.fadingPrompt = null;
          this.side = null;
        }
      }
    }

    const dots: LayoutPoint[] = scene.markers.map(marker =>
      markerDotPosition(marker.x, marker.y, marker.halfHeight));
    const targetIndex = scene.markers.findIndex(marker => marker.target === true);
    const secondary = secondaryMarkerIndices(dots, targetIndex, MARKER_CLUSTER_DISTANCE);
    if (prompt) {
      this.lastPromptDots = dots;
      this.lastPromptTargetIndex = targetIndex;
    }

    this.debugState.markers = [];
    for (let index = 0; index < scene.markers.length; index += 1) {
      const marker = scene.markers[index];
      const dot = dots[index];
      const isSecondary = secondary.has(index);
      const isTarget = index === targetIndex;
      this.drawMarker(ctx, marker, dot, isSecondary, isTarget && !!prompt, timeSeconds);
      this.debugState.markers.push({
        x: dot.x,
        y: dot.y,
        secondary: isSecondary,
        target: isTarget,
      });
    }

    this.debugState.promptBox = null;
    this.debugState.promptSide = null;
    this.debugState.promptCenter = null;
    this.debugState.textCenter = null;
    this.debugState.promptFade = this.fade;

    if (prompt) {
      this.drawPrompt(
        ctx, prompt, dots, targetIndex, scene.viewport, scene.obstacles ?? [], this.fade,
      );
    } else if (this.fadingPrompt) {
      const alpha = Math.max(0, 1 - this.fadeOutElapsed / PICKUP_FADE_OUT_SECONDS);
      this.debugState.promptFade = alpha;
      this.drawPrompt(
        ctx,
        this.fadingPrompt,
        this.fadingDots,
        this.fadingTargetIndex,
        scene.viewport,
        scene.obstacles ?? [],
        alpha,
      );
    } else {
      this.side = null;
    }

    this.updateCompletionFlash(ctx, scene.feedback ?? null, timeSeconds);
  }

  private drawMarker(
    ctx: CanvasRenderingContext2D,
    marker: PickupMarkerDraw,
    dot: LayoutPoint,
    secondary: boolean,
    focused: boolean,
    timeSeconds: number,
  ): void {
    if (marker.style === "none") return;
    const gold = marker.style === "goldDot";
    const color = gold ? GOLD : WHITE;
    // 1.3 秒一个很轻的呼吸周期；核心几乎不缩放，只改变亮度。
    const breath = 0.5 + 0.5 * Math.sin((timeSeconds * Math.PI * 2) / PICKUP_MARKER_BREATH_SECONDS);
    const weight = secondary ? 0.28 : focused ? 0.7 : 1;
    const haloRadius = gold ? 6 : PICKUP_MARKER_HALO_RADIUS;
    const coreRadius = gold ? 1.6 : PICKUP_MARKER_CORE_RADIUS;
    const coreAlpha = (gold ? 0.72 : 0.92) * weight * (0.9 + breath * 0.1);
    const haloAlpha = (gold ? 0.16 : 0.26) * weight * (0.75 + breath * 0.25);

    ctx.save();
    ctx.translate(dot.x, dot.y);

    if (haloAlpha > 0.01) {
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloRadius);
      halo.addColorStop(0, withAlpha(color, haloAlpha));
      halo.addColorStop(0.55, withAlpha(color, haloAlpha * 0.42));
      halo.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = withAlpha(color, coreAlpha);
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPrompt(
    ctx: CanvasRenderingContext2D,
    prompt: PickupPromptDraw,
    dots: readonly LayoutPoint[],
    targetIndex: number,
    viewport: PickupPromptViewport,
    obstacles: readonly LayoutBox[],
    alpha: number,
  ): void {
    ctx.save();
    ctx.font = PROMPT_FONT;
    const textWidth = ctx.measureText(prompt.label).width;
    ctx.restore();

    const contentWidth = PICKUP_ICON_SIZE + PICKUP_ICON_TEXT_GAP + textWidth;
    const placement = placePickupPrompt({
      anchorX: prompt.x,
      anchorY: prompt.y,
      halfWidth: prompt.halfWidth,
      halfHeight: prompt.halfHeight,
      contentWidth,
      contentHeight: PICKUP_ICON_SIZE,
      markers: dots,
      targetMarker: targetIndex >= 0 ? dots[targetIndex] : null,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      previousSide: this.side,
      obstacles,
      margin: PROMPT_SCREEN_MARGIN,
    });
    this.side = placement.side;

    const fade = Math.max(0, Math.min(1, alpha));
    const lift = (1 - fade) * 3;
    const half = PICKUP_ICON_SIZE / 2;
    const textX = PICKUP_ICON_SIZE + PICKUP_ICON_TEXT_GAP;
    const { box } = placement;
    const center = { x: box.x + half, y: box.y + half };

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(box.x, box.y + lift);

    if (this.icon) {
      ctx.drawImage(this.icon, 0, 0, PICKUP_ICON_SIZE, PICKUP_ICON_SIZE);
    } else {
      this.drawFallbackKeycap(ctx);
    }

    if (prompt.holding) this.drawProgressFrame(ctx, prompt.progress);

    ctx.font = PROMPT_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = PROMPT_TEXT_COLOR;
    // 粗体文字与键帽在同一中线上，避免视觉上“文字偏低”。
    ctx.fillText(prompt.label, textX, half);
    ctx.restore();

    this.lastPromptCenter = { x: center.x, y: center.y };
    this.debugState.promptBox = { ...box };
    this.debugState.promptSide = placement.side;
    this.debugState.promptCenter = { ...center };
    this.debugState.textCenter = {
      x: box.x + textX + textWidth / 2,
      y: center.y,
    };
    this.debugState.promptFade = fade;
  }

  /**
   * 圆角矩形进度：轨道常驻低透明度，按住 E 后沿键帽外轮廓顺时针推进。
   * 路径几何按尺寸缓存，进度只决定描边长度。
   */
  private drawProgressFrame(ctx: CanvasRenderingContext2D, progress: number): void {
    const clamped = Math.min(1, Math.max(0, progress));
    const half = PICKUP_ICON_SIZE / 2;
    const frameHalf = PICKUP_FRAME_SIZE / 2;

    ctx.save();
    ctx.lineWidth = PICKUP_FRAME_LINE_WIDTH;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    roundRect(ctx, half - frameHalf, half - frameHalf, PICKUP_FRAME_SIZE, PICKUP_FRAME_SIZE, PICKUP_FRAME_RADIUS);
    ctx.stroke();

    if (clamped <= 0) {
      ctx.restore();
      return;
    }

    const outline = roundedRectOutline(PICKUP_FRAME_SIZE, PICKUP_FRAME_SIZE, PICKUP_FRAME_RADIUS);
    const target = outline.length * clamped;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    const first = outline.points[0];
    ctx.moveTo(half + first.x, half + first.y);
    for (let index = 1; index < outline.points.length; index += 1) {
      const point = outline.points[index];
      if (point.distance >= target) {
        const previous = outline.points[index - 1];
        const span = point.distance - previous.distance;
        const t = span <= 1e-6 ? 0 : (target - previous.distance) / span;
        ctx.lineTo(
          half + previous.x + (point.x - previous.x) * t,
          half + previous.y + (point.y - previous.y) * t,
        );
        break;
      }
      ctx.lineTo(half + point.x, half + point.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private updateCompletionFlash(
    ctx: CanvasRenderingContext2D,
    feedback: PickupPromptFeedback | null,
    timeSeconds: number,
  ): void {
    if (feedback && this.flashStart === null) {
      this.flashStart = timeSeconds;
      this.flashCenter = this.lastPromptCenter ?? { x: feedback.x, y: feedback.y - PICKUP_ICON_SIZE };
    }
    if (this.flashStart === null || !this.flashCenter) return;

    const progress = (timeSeconds - this.flashStart) / PICKUP_COMPLETION_FLASH_SECONDS;
    if (progress >= 1 || progress < 0) {
      this.flashStart = null;
      this.flashCenter = null;
      return;
    }

    const half = PICKUP_ICON_SIZE / 2;
    const frameHalf = PICKUP_FRAME_SIZE / 2;
    const grow = 1 + progress * 0.14;
    ctx.save();
    ctx.translate(this.flashCenter.x - half, this.flashCenter.y - half);
    ctx.globalAlpha = (1 - progress) * 0.9;
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 2.5;
    roundRect(
      ctx,
      half - frameHalf * grow,
      half - frameHalf * grow,
      PICKUP_FRAME_SIZE * grow,
      PICKUP_FRAME_SIZE * grow,
      PICKUP_FRAME_RADIUS + 1,
    );
    ctx.stroke();
    ctx.restore();
  }

  private drawFallbackKeycap(ctx: CanvasRenderingContext2D): void {
    const size = PICKUP_ICON_SIZE;
    const half = size / 2;
    ctx.save();
    ctx.fillStyle = "rgba(24, 26, 32, 0.92)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 0, 0, size, size, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.font = "700 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", half, half + 1);
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  const value = Math.min(1, Math.max(0, alpha));
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${value.toFixed(3)})`;
}

export { MARKER_GAP };
