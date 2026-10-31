/**
 * 拾取提示的纯视觉层：鸭科夫风格的小光点、E 键帽提示，
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
export const PICKUP_ICON_SIZE = 28;
/** 键帽与进度框之间的空隙。 */
export const PICKUP_FRAME_GAP = 0;
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
/** 完成拾取后提示向下淡出的时间。 */
export const PICKUP_FADE_OUT_SECONDS = 0.12;

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
  /** 玩家位于物品右侧：提示停在物品上方，否则停在右侧。 */
  preferAbove?: boolean;
  /** 目标标识：目标变化时重新计算布局方向并重新淡入。 */
  key?: string;
}

export interface PickupPromptViewport {
  width: number;
  height: number;
}

export interface PickupPromptScene {
  markers: readonly PickupMarkerDraw[];
  prompt: PickupPromptDraw | null;
  /** 目标刚被拾取：让提示向下淡出，而不是硬切。 */
  fadeOut?: boolean;
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
}

const WHITE = "#ffffff";
const GOLD = "#ffd76a";

export class PickupPromptRenderer {
  private icon: HTMLImageElement | null = null;
  private iconLoading = false;
  private iconFailed = false;

  private promptKey: string | null = null;
  private side: PromptSide | null = null;
  private fade = 0;
  private lastTime: number | null = null;

  /** 最近一次完整提示：完成拾取后用它做向下淡出，避免硬切。 */
  private lastPromptData: PickupPromptDraw | null = null;
  private fadingPrompt: PickupPromptDraw | null = null;
  private fadeOutElapsed = 0;

  private debugState: PickupPromptDebug = {
    markers: [],
    promptBox: null,
    promptSide: null,
    promptFade: 0,
    promptCenter: null,
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
        // 用满圈进度淡出，避免把上一帧的半圈残留成第二道“重影”。
        this.fadingPrompt = { ...this.lastPromptData, progress: 1, holding: true };
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
    this.debugState.promptFade = this.fade;

    if (prompt) {
      this.drawPrompt(ctx, prompt, scene.viewport, this.fade);
    } else if (this.fadingPrompt) {
      const alpha = Math.max(0, 1 - this.fadeOutElapsed / PICKUP_FADE_OUT_SECONDS);
      this.debugState.promptFade = alpha;
      this.drawPrompt(ctx, this.fadingPrompt, scene.viewport, alpha);
    } else {
      this.side = null;
    }
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
    viewport: PickupPromptViewport,
    alpha: number,
  ): void {
    // 按住期间锁定方向：目标不变就不因为玩家小幅移动而左右跳。
    const preferAbove = prompt.holding && this.side
      ? this.side === "above"
      : prompt.preferAbove === true;
    const placement = placePickupPrompt({
      anchorX: prompt.x,
      anchorY: prompt.y,
      halfWidth: prompt.halfWidth,
      halfHeight: prompt.halfHeight,
      contentWidth: PICKUP_ICON_SIZE,
      contentHeight: PICKUP_ICON_SIZE,
      preferAbove,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      margin: PROMPT_SCREEN_MARGIN,
    });
    this.side = placement.side;

    const fade = Math.max(0, Math.min(1, alpha));
    // 出现时轻微上移，消失时向下淡出。
    const lift = (1 - fade) * 3;
    const half = PICKUP_ICON_SIZE / 2;
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
    ctx.restore();

    this.debugState.promptBox = { ...box };
    this.debugState.promptSide = placement.side;
    this.debugState.promptCenter = { ...center };
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
