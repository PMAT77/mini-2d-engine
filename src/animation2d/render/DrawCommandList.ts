/**
 * 绘制命令列表：把“画什么”与“用哪个 Canvas 上下文画”分开。
 *
 * 生产路径在 CharacterCanvasRenderer 里把命令直接回放到真实 ctx；
 * 测试路径把同一份命令回放到录制上下文，与迁移前逐部件绘制的调用序列逐项比对。
 * 这里只做机械回放，不含任何角色逻辑。
 */

import type { Vec2 } from "../math/Transform2D";
import type { WeaponKind, WeaponSlot } from "../../objects/Weapon";
import { drawHeldWeapon, drawStowedWeapons } from "../../objects/WeaponVisuals";

export interface GradientStop {
  offset: number;
  color: string;
}

export type GradientSpec =
  | { kind: "linear"; x0: number; y0: number; x1: number; y1: number; stops: readonly GradientStop[] }
  | {
    kind: "radial";
    x0: number; y0: number; r0: number;
    x1: number; y1: number; r1: number;
    stops: readonly GradientStop[];
  };

export type PaintRef =
  | { kind: "color"; color: string }
  | { kind: "gradient"; id: number };

export type DrawCommand =
  | { op: "save" }
  | { op: "restore" }
  | { op: "translate"; x: number; y: number }
  | { op: "rotate"; radians: number }
  | { op: "scale"; x: number; y: number }
  | { op: "globalAlpha"; value: number }
  | { op: "defineGradient"; id: number; spec: GradientSpec }
  | { op: "fillStyle"; paint: PaintRef }
  | { op: "strokeStyle"; color: string }
  | { op: "lineWidth"; value: number }
  | { op: "lineCap"; value: "butt" | "round" | "square" }
  | { op: "beginPath" }
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  | { op: "arc"; x: number; y: number; radius: number }
  | { op: "ellipse"; x: number; y: number; rx: number; ry: number }
  | { op: "fill" }
  | { op: "stroke" }
  | { op: "drawStowedWeapons"; size: number; activeSlot: WeaponSlot; alpha: number }
  | {
    op: "drawHeldWeapon";
    size: number;
    kind: WeaponKind;
    slot: WeaponSlot;
    hand: Vec2;
    angle: number;
  };

/** 把命令序列回放到任意 2D 上下文；渐变按 id 复用到 Map 里。 */
export function executeDrawCommands(
  ctx: CanvasRenderingContext2D,
  commands: readonly DrawCommand[],
): void {
  const gradients = new Map<number, CanvasGradient>();
  for (const command of commands) {
    switch (command.op) {
      case "save": ctx.save(); break;
      case "restore": ctx.restore(); break;
      case "translate": ctx.translate(command.x, command.y); break;
      case "rotate": ctx.rotate(command.radians); break;
      case "scale": ctx.scale(command.x, command.y); break;
      case "globalAlpha": ctx.globalAlpha = command.value; break;
      case "defineGradient":
        gradients.set(command.id, createGradient(ctx, command.spec));
        break;
      case "fillStyle":
        ctx.fillStyle = command.paint.kind === "color"
          ? command.paint.color
          : requireGradient(gradients, command.paint.id);
        break;
      case "strokeStyle": ctx.strokeStyle = command.color; break;
      case "lineWidth": ctx.lineWidth = command.value; break;
      case "lineCap": ctx.lineCap = command.value; break;
      case "beginPath": ctx.beginPath(); break;
      case "moveTo": ctx.moveTo(command.x, command.y); break;
      case "lineTo": ctx.lineTo(command.x, command.y); break;
      case "arc": ctx.arc(command.x, command.y, command.radius, 0, Math.PI * 2); break;
      case "ellipse": ctx.ellipse(command.x, command.y, command.rx, command.ry, 0, 0, Math.PI * 2); break;
      case "fill": ctx.fill(); break;
      case "stroke": ctx.stroke(); break;
      case "drawStowedWeapons":
        drawStowedWeapons(ctx, command.size, command.activeSlot, command.alpha);
        break;
      case "drawHeldWeapon":
        drawHeldWeapon(ctx, command.size, command.kind, command.slot, command.hand, command.angle);
        break;
      default: {
        const exhaustive: never = command;
        throw new Error(`unknown draw command: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
}

function createGradient(ctx: CanvasRenderingContext2D, spec: GradientSpec): CanvasGradient {
  const gradient = spec.kind === "linear"
    ? ctx.createLinearGradient(spec.x0, spec.y0, spec.x1, spec.y1)
    : ctx.createRadialGradient(spec.x0, spec.y0, spec.r0, spec.x1, spec.y1, spec.r1);
  for (const stop of spec.stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

function requireGradient(gradients: Map<number, CanvasGradient>, id: number): CanvasGradient {
  const gradient = gradients.get(id);
  if (!gradient) throw new Error(`draw command referenced missing gradient ${id}`);
  return gradient;
}
