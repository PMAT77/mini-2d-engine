/**
 * 拾取提示的纯视觉层：鸭科夫风格的发现白点、E 键帽与白色环形进度。
 *
 * 只负责画，不判断按键、不结算拾取；坐标由调用方换算成屏幕 CSS 逻辑像素，
 * 所以相机缩放、震动与 DPR 都不会让标记偏离物品。
 */

import type { PickupMarkerStyle } from "../interaction/PickupTypes";

export interface PickupMarkerDraw {
  /** 屏幕 CSS 坐标。 */
  x: number;
  y: number;
  style: PickupMarkerStyle;
}

export interface PickupPromptDraw {
  x: number;
  y: number;
  /** 0..1，只有 holding 时才绘制进度环。 */
  progress: number;
  holding: boolean;
  /** AUTO 物品不会产生 prompt。 */
  label: string;
  /** 剪影触觉拾取时为 false：只给通用“拾取”，不带物品信息。 */
  named: boolean;
}

export interface PickupPromptScene {
  markers: readonly PickupMarkerDraw[];
  prompt: PickupPromptDraw | null;
}

/** 仓库现有键帽素材；按 CC BY-ND 许可只做运行时 drawImage 缩放，不另存修改版。 */
export const PICKUP_ICON_URL =
  "/assets/images/ui/keyboard-mouse/64/Keyboard_E.png";

/** 视觉规范（单位：屏幕 CSS 像素）。 */
export const PICKUP_ICON_SIZE = 34;
export const PICKUP_RING_RADIUS = 23;
export const PICKUP_RING_WIDTH = 2.8;
/** 标记相对物品锚点上移的偏移。 */
export const PICKUP_MARKER_OFFSET_Y = 18;
/** E 图标中心相对锚点上移的偏移。 */
export const PICKUP_ICON_OFFSET_Y = 34;

const WHITE = "#ffffff";
const GOLD = "#ffd76a";

export class PickupPromptRenderer {
  private icon: HTMLImageElement | null = null;
  private iconLoading = false;
  private iconFailed = false;

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

  draw(
    ctx: CanvasRenderingContext2D,
    scene: PickupPromptScene,
    timeSeconds: number,
  ): void {
    for (const marker of scene.markers) {
      this.drawMarker(ctx, marker, timeSeconds);
    }
    if (scene.prompt) this.drawPrompt(ctx, scene.prompt);
  }

  private drawMarker(
    ctx: CanvasRenderingContext2D,
    marker: PickupMarkerDraw,
    timeSeconds: number,
  ): void {
    if (marker.style === "none") return;
    const gold = marker.style === "goldDot";
    const color = gold ? GOLD : WHITE;
    // 1.2 秒一个呼吸周期；金色比白色更克制，避免和现有金块光晕叠加过亮。
    const breath = 0.5 + 0.5 * Math.sin((timeSeconds * Math.PI * 2) / 1.2);
    const baseAlpha = gold ? 0.62 : 0.78;
    const haloRadius = gold ? 5.5 : 7;
    const coreRadius = gold ? 1.8 : 2;

    ctx.save();
    ctx.translate(marker.x, marker.y - PICKUP_MARKER_OFFSET_Y);

    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloRadius);
    halo.addColorStop(0, withAlpha(color, (baseAlpha * (0.55 + breath * 0.45)) * 0.9));
    halo.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = withAlpha(color, baseAlpha + breath * (1 - baseAlpha) * 0.8);
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPrompt(
    ctx: CanvasRenderingContext2D,
    prompt: PickupPromptDraw,
  ): void {
    const centerX = prompt.x;
    const centerY = prompt.y - PICKUP_ICON_OFFSET_Y;
    const half = PICKUP_ICON_SIZE / 2;

    ctx.save();
    ctx.translate(centerX, centerY);

    if (this.icon) {
      ctx.drawImage(
        this.icon,
        -half,
        -half,
        PICKUP_ICON_SIZE,
        PICKUP_ICON_SIZE,
      );
    } else {
      this.drawFallbackKeycap(ctx);
    }

    if (prompt.holding && prompt.progress > 0) {
      this.drawProgressRing(ctx, prompt.progress);
    }

    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillText(prompt.label, 0, half + 13);
    ctx.fillStyle = WHITE;
    ctx.fillText(prompt.label, 0, half + 12);
    ctx.restore();
  }

  private drawProgressRing(
    ctx: CanvasRenderingContext2D,
    progress: number,
  ): void {
    const clamped = Math.min(1, Math.max(0, progress));
    const start = -Math.PI / 2;

    ctx.save();
    ctx.lineWidth = PICKUP_RING_WIDTH;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.arc(0, 0, PICKUP_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    if (clamped > 0) {
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = PICKUP_RING_WIDTH + 0.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      // 12 点方向起笔，顺时针增长。
      ctx.arc(0, 0, PICKUP_RING_RADIUS, start, start + clamped * Math.PI * 2, false);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFallbackKeycap(ctx: CanvasRenderingContext2D): void {
    const size = PICKUP_ICON_SIZE;
    const half = size / 2;
    ctx.save();
    ctx.fillStyle = "rgba(24, 26, 32, 0.92)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, -half, -half, size, size, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.font = "700 16px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", 0, 1);
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
