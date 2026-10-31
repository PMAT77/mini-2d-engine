import type { Rect } from "./HudTypes";

/** 手电胶囊贴在武器列表上方，右对齐列表右缘。 */
export const FLASHLIGHT_HUD = {
  width: 96,
  height: 26,
  gap: 8,
  radius: 13,
} as const;

const ON_COLOR = "#ffce6b";
const OFF_LAMP = "#5b7480";
const OFF_TEXT = "#8fa6b4";
const PLATE = "rgba(12,18,26,0.8)";
const ON_BORDER = "rgba(255,206,107,0.65)";
const OFF_BORDER = "rgba(116,200,213,0.22)";
const FONT = '600 11px "Microsoft YaHei", "PingFang SC", sans-serif';
const KEY_FONT = '600 10px "Microsoft YaHei", "PingFang SC", sans-serif';

/** 由武器列表区域矩形得到手电胶囊矩形（逻辑像素）。 */
export function getFlashlightHudRect(anchor: Rect): Rect {
  return {
    x: anchor.x + anchor.width - FLASHLIGHT_HUD.width,
    y: anchor.y - FLASHLIGHT_HUD.gap - FLASHLIGHT_HUD.height,
    width: FLASHLIGHT_HUD.width,
    height: FLASHLIGHT_HUD.height,
  };
}

/** 画手电开关状态：开为暖琥珀 + 微光，关为冷灰。 */
export function drawFlashlightHud(ctx: CanvasRenderingContext2D, rect: Rect, on: boolean): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, FLASHLIGHT_HUD.radius);
  ctx.fillStyle = PLATE;
  ctx.fill();
  ctx.strokeStyle = on ? ON_BORDER : OFF_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  const cy = rect.y + rect.height / 2;
  const color = on ? ON_COLOR : OFF_LAMP;

  // 状态灯
  ctx.save();
  if (on) {
    ctx.shadowColor = ON_COLOR;
    ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.arc(rect.x + 12, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // 手电图标：竖直筒身 + 梯形灯头 + 两道光
  const iconX = rect.x + 21;
  ctx.fillStyle = on ? ON_COLOR : OFF_TEXT;
  ctx.fillRect(iconX, cy - 1.5, 5, 7);
  ctx.beginPath();
  ctx.moveTo(iconX - 1, cy - 4.5);
  ctx.lineTo(iconX + 6, cy - 4.5);
  ctx.lineTo(iconX + 5, cy - 1.5);
  ctx.lineTo(iconX, cy - 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = on ? 0.5 : 0.18;
  ctx.strokeStyle = on ? ON_COLOR : OFF_TEXT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(iconX + 1, cy - 6.5); ctx.lineTo(iconX, cy - 8.5);
  ctx.moveTo(iconX + 4, cy - 6.5); ctx.lineTo(iconX + 5, cy - 8.5);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = FONT;
  ctx.fillStyle = on ? ON_COLOR : OFF_TEXT;
  ctx.fillText(on ? "手电 开" : "手电 关", rect.x + 36, cy + 0.5);

  ctx.textAlign = "right";
  ctx.font = KEY_FONT;
  ctx.fillStyle = on ? "rgba(255,206,107,0.8)" : "rgba(143,166,180,0.8)";
  ctx.fillText("G", rect.x + rect.width - 10, cy + 0.5);
  ctx.restore();
}
