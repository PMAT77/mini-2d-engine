/**
 * Canvas 渲染器：把快照回放到 2D 上下文。
 *
 * 只负责整体变换（平移到角色中心、旋转、缩放）与命令回放；
 * 部件顺序、颜色、半径全部来自 PlayerRenderParts，便于测试逐命令比对。
 */

import type { CharacterRenderSnapshot } from "./CharacterSnapshot";
import { executeDrawCommands } from "./DrawCommandList";
import type { DrawCommand } from "./DrawCommandList";
import { buildPlayerPartCommands } from "./PlayerRenderParts";

export function buildCharacterCommands(
  snapshot: CharacterRenderSnapshot,
  centerX: number,
  centerY: number,
): DrawCommand[] {
  return [
    { op: "save" },
    { op: "translate", x: centerX, y: centerY },
    { op: "rotate", radians: snapshot.facing },
    { op: "scale", x: snapshot.scale, y: snapshot.scale },
    ...buildPlayerPartCommands(snapshot),
    { op: "restore" },
  ];
}

export function renderCharacterSnapshot(
  ctx: CanvasRenderingContext2D,
  snapshot: CharacterRenderSnapshot,
  centerX: number,
  centerY: number,
): void {
  executeDrawCommands(ctx, buildCharacterCommands(snapshot, centerX, centerY));
}

export class CharacterCanvasRenderer {
  buildCommands(
    snapshot: CharacterRenderSnapshot,
    centerX: number,
    centerY: number,
  ): DrawCommand[] {
    return buildCharacterCommands(snapshot, centerX, centerY);
  }

  render(
    ctx: CanvasRenderingContext2D,
    snapshot: CharacterRenderSnapshot,
    centerX: number,
    centerY: number,
  ): void {
    renderCharacterSnapshot(ctx, snapshot, centerX, centerY);
  }
}

/**
 * 缓冲外的地面阴影：altitudePx 是伪高度（0 = 完全贴地）。
 * 越高阴影越小、越淡，用来把翻滚的“腾空”读出来。
 * 必须由调用方画在角色离屏缓冲之外，否则会被水纹 source-atop 染色。
 */
export function drawCharacterShadow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  altitudePx: number,
): void {
  if (!(altitudePx > 0) || !(size > 0)) return;
  const lift = Math.min(1, altitudePx / Math.max(1, size * .3));
  const radiusX = Math.max(size * .12, size * (.5 - lift * .14));
  const radiusY = Math.max(size * .07, size * (.32 - lift * .1));
  ctx.save();
  // 用平移表达落点，形状本身留在原点：调用方可以安全地复用同一个记录型上下文。
  ctx.translate(centerX, centerY);
  ctx.globalAlpha = .30 - lift * .10;
  ctx.fillStyle = "#0a161b";
  ctx.beginPath();
  ctx.ellipse(0, size * .34, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
