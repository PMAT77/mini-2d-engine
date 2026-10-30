/**
 * 把角色快照翻译成绘制命令。
 *
 * 顺序必须与迁移前的 Player.drawBody 完全一致：
 * 腿 → 双臂外层 → 双臂内层 → 手 → 背影 → 躯干 → 胸板 → 斜挎武器 → 手持武器 → 头 → 肩背外壳。
 * 这里不做任何状态判断，只做坐标/样式搬运；是否显示腿、头、外壳由快照参数决定。
 */

import type { BoneId, RenderPartId } from "../rig/RigTypes";
import { PLAYER_RIG } from "../rig/PlayerRig";
import type { CharacterRenderSnapshot } from "./CharacterSnapshot";
import type { DrawCommand, PaintRef } from "./DrawCommandList";

/**
 * 逐帧深度：翻滚中段把头收到躯干后方（先画头，再画躯干盖住），
 * 与伪高度一起把“滚过去的肩背”读出来。模块加载时算一次，避免每帧分配。
 */
const TUCKED_PART_ORDER: readonly RenderPartId[] = (() => {
  const base = PLAYER_RIG.renderParts;
  const headIndex = base.indexOf("head");
  const torsoIndex = base.indexOf("torso");
  if (headIndex < 0 || torsoIndex < 0) return base;
  const order = base.slice() as RenderPartId[];
  order.splice(headIndex, 1);
  order.splice(torsoIndex, 0, "head");
  return order;
})();

interface Sink {
  commands: DrawCommand[];
  nextGradientId: number;
}

function paint(color: string): PaintRef {
  return { kind: "color", color };
}

function gradientPaint(id: number): PaintRef {
  return { kind: "gradient", id };
}

function fillDisc(sink: Sink, x: number, y: number, radius: number, fill: PaintRef): void {
  sink.commands.push({ op: "beginPath" }, { op: "arc", x, y, radius }, { op: "fillStyle", paint: fill }, { op: "fill" });
}

function fillEllipse(
  sink: Sink, x: number, y: number, rx: number, ry: number, fill: PaintRef,
): void {
  sink.commands.push({ op: "beginPath" }, { op: "ellipse", x, y, rx, ry }, { op: "fillStyle", paint: fill }, { op: "fill" });
}

function strokeCapsule(
  sink: Sink, ax: number, ay: number, bx: number, by: number, width: number, color: string,
): void {
  sink.commands.push(
    { op: "beginPath" },
    { op: "moveTo", x: ax, y: ay },
    { op: "lineTo", x: bx, y: by },
    { op: "strokeStyle", color },
    { op: "lineWidth", value: width },
    { op: "lineCap", value: "round" },
    { op: "stroke" },
  );
}

function bone(snapshot: CharacterRenderSnapshot, id: BoneId): { x: number; y: number } {
  const world = snapshot.world.world[id];
  return { x: world.x * snapshot.size, y: world.y * snapshot.size };
}

/** 只生成部件命令，不含外层 translate/rotate/scale；渲染器负责整体变换。 */
export function buildPlayerPartCommands(snapshot: CharacterRenderSnapshot): DrawCommand[] {
  const sink: Sink = { commands: [], nextGradientId: 0 };
  const s = snapshot.size;
  const pose = snapshot.pose;
  const legVisible = pose.legAlpha > .001;

  const defineLinear = (x0: number, y0: number, x1: number, y1: number, stops: ReadonlyArray<{ offset: number; color: string }>): number => {
    const id = sink.nextGradientId++;
    sink.commands.push({ op: "defineGradient", id, spec: { kind: "linear", x0, y0, x1, y1, stops } });
    return id;
  };
  const defineRadial = (
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
    stops: ReadonlyArray<{ offset: number; color: string }>,
  ): number => {
    const id = sink.nextGradientId++;
    sink.commands.push({ op: "defineGradient", id, spec: { kind: "radial", x0, y0, r0, x1, y1, r1, stops } });
    return id;
  };

  const leftHip = bone(snapshot, "hipL");
  const leftKnee = bone(snapshot, "kneeL");
  const leftFoot = bone(snapshot, "footL");
  const rightHip = bone(snapshot, "hipR");
  const rightKnee = bone(snapshot, "kneeR");
  const rightFoot = bone(snapshot, "footR");
  const leftShoulder = bone(snapshot, "shoulderL");
  const leftElbow = bone(snapshot, "elbowL");
  const leftHand = bone(snapshot, "handL");
  const rightShoulder = bone(snapshot, "shoulderR");
  const rightElbow = bone(snapshot, "elbowR");
  const rightHand = bone(snapshot, "handR");

  for (const part of snapshot.depthTuck ? TUCKED_PART_ORDER : PLAYER_RIG.renderParts) {
    if (part === "legLeftUpper" && legVisible) {
      sink.commands.push({ op: "save" }, { op: "globalAlpha", value: Math.min(1, pose.legAlpha) });
    }
    switch (part) {
      case "legLeftUpper":
        if (legVisible) strokeCapsule(sink, leftHip.x, leftHip.y, leftKnee.x, leftKnee.y, s * .13, "#1d3f4b");
        break;
      case "legLeftLower":
        if (legVisible) strokeCapsule(sink, leftKnee.x, leftKnee.y, leftFoot.x, leftFoot.y, s * .11, "#1d3f4b");
        break;
      case "legLeftFoot":
        if (legVisible) fillDisc(sink, leftFoot.x, leftFoot.y, s * .055, paint("#2b5560"));
        break;
      case "legRightUpper":
        if (legVisible) strokeCapsule(sink, rightHip.x, rightHip.y, rightKnee.x, rightKnee.y, s * .13, "#1d3f4b");
        break;
      case "legRightLower":
        if (legVisible) strokeCapsule(sink, rightKnee.x, rightKnee.y, rightFoot.x, rightFoot.y, s * .11, "#1d3f4b");
        break;
      case "legRightFoot":
        if (legVisible) {
          fillDisc(sink, rightFoot.x, rightFoot.y, s * .055, paint("#2b5560"));
          sink.commands.push({ op: "restore" });
        }
        break;
      case "armOuterLeft":
        strokeCapsule(sink, leftShoulder.x, leftShoulder.y, leftElbow.x, leftElbow.y, s * .22, "#183c4a");
        strokeCapsule(sink, leftElbow.x, leftElbow.y, leftHand.x, leftHand.y, s * .22, "#183c4a");
        break;
      case "armOuterRight":
        strokeCapsule(sink, rightShoulder.x, rightShoulder.y, rightElbow.x, rightElbow.y, s * .22, "#183c4a");
        strokeCapsule(sink, rightElbow.x, rightElbow.y, rightHand.x, rightHand.y, s * .22, "#183c4a");
        break;
      case "armInnerLeft":
        strokeCapsule(sink, leftShoulder.x, leftShoulder.y, leftElbow.x, leftElbow.y, s * .15, "#4d8999");
        strokeCapsule(sink, leftElbow.x, leftElbow.y, leftHand.x, leftHand.y, s * .15, "#4d8999");
        break;
      case "armInnerRight":
        strokeCapsule(sink, rightShoulder.x, rightShoulder.y, rightElbow.x, rightElbow.y, s * .15, "#4d8999");
        strokeCapsule(sink, rightElbow.x, rightElbow.y, rightHand.x, rightHand.y, s * .15, "#4d8999");
        break;
      case "handLeft":
        fillDisc(sink, leftHand.x, leftHand.y, s * .085, paint("#e5ccb0"));
        break;
      case "handRight":
        fillDisc(sink, rightHand.x, rightHand.y, s * .085, paint("#eed7b9"));
        break;
      case "back":
        fillDisc(sink, pose.backX * s, pose.backY * s, pose.backR * s, paint("#102c39"));
        break;
      case "torso": {
        const bx = snapshot.world.world.pelvis.x * s;
        const by = snapshot.world.world.pelvis.y * s;
        const gradientId = defineLinear(
          bx - s * .4, by + s * .3, bx + s * .35, by - s * .3,
          [{ offset: 0, color: "#245362" }, { offset: 1, color: "#73b4bf" }],
        );
        if (Math.abs(pose.bodyRx - pose.bodyRy) < 1e-6) {
          fillDisc(sink, bx, by, pose.bodyRx * s, gradientPaint(gradientId));
        } else {
          fillEllipse(sink, bx, by, pose.bodyRx * s, pose.bodyRy * s, gradientPaint(gradientId));
        }
        break;
      }
      case "plate":
        fillDisc(sink, pose.plateX * s, pose.plateY * s, pose.plateR * s, paint("#23404a"));
        break;
      case "stowedWeapons":
        sink.commands.push({
          op: "drawStowedWeapons",
          size: s,
          activeSlot: snapshot.activeSlot,
          alpha: snapshot.stowedAlpha,
        });
        break;
      case "heldWeapon": {
        // 握把原点由 socket 接管：mainGrip 已包含 -0.02s/+0.015s 的握点偏移。
        const grip = snapshot.sockets.mainGrip;
        sink.commands.push({
          op: "drawHeldWeapon",
          size: s,
          kind: snapshot.weaponKind,
          slot: snapshot.activeSlot,
          hand: { x: grip.x * s, y: grip.y * s },
          angle: pose.weaponAngle,
        });
        break;
      }
      case "head":
        if (pose.headAlpha > .001) {
          const hx = snapshot.world.world.head.x * s;
          const hy = snapshot.world.world.head.y * s;
          const k = pose.headR / pose.headBindR;
          sink.commands.push({ op: "save" }, { op: "globalAlpha", value: Math.min(1, pose.headAlpha) });
          const gradientId = defineRadial(
            hx + s * .07 * k, hy - s * .12 * k, s * .015 * k,
            hx, hy, s * .28 * k,
            [
              { offset: 0, color: "#fff1d6" },
              { offset: .65, color: "#ead3b2" },
              { offset: 1, color: "#b49a7a" },
            ],
          );
          fillDisc(sink, hx, hy, pose.headR * s, gradientPaint(gradientId));
          strokeCapsule(
            sink,
            hx + s * .13 * k, hy - s * .08 * k,
            hx + s * .18 * k, hy + s * .025 * k,
            s * .035 * k, "#fff4dd",
          );
          sink.commands.push({ op: "restore" });
        }
        break;
      case "shell":
        if (pose.shellAlpha > .001) {
          const alpha = Math.min(1, pose.shellAlpha);
          const sx = pose.shellX * s, sy = pose.shellY * s;
          const rx = pose.shellRx * s, ry = pose.shellRy * s;
          sink.commands.push({ op: "save" }, { op: "globalAlpha", value: alpha });
          const gradientId = defineLinear(
            sx - rx, sy, sx + rx, sy,
            [
              { offset: 0, color: "#16343e" },
              { offset: .6, color: "#1f4854" },
              { offset: 1, color: "#2f6572" },
            ],
          );
          fillEllipse(sink, sx, sy, rx, ry, gradientPaint(gradientId));
        }
        break;
      case "shellDetail":
        if (pose.shellAlpha > .001) {
          const sx = pose.shellX * s, sy = pose.shellY * s;
          const alpha = Math.min(1, pose.shellAlpha);
          const detail = Math.max(0, Math.min(1, (alpha - .35) / .5));
          if (detail > .001) {
            sink.commands.push({ op: "globalAlpha", value: alpha * detail });
            strokeCapsule(sink, sx + s * .22, sy, sx - s * .26, sy, s * .05, "#0f2831");
            strokeCapsule(sink, sx + s * .20, sy - s * .035, sx - s * .24, sy - s * .035, s * .018, "#3d7b89");
            strokeCapsule(sink, sx + s * .10, sy - s * .13, sx - s * .08, sy - s * .21, s * .12, "#2d6573");
            strokeCapsule(sink, sx + s * .10, sy + s * .13, sx - s * .08, sy + s * .21, s * .12, "#2d6573");
          }
          sink.commands.push({ op: "restore" });
        }
        break;
      default: {
        const exhaustive: never = part;
        throw new Error(`unknown render part: ${String(exhaustive)}`);
      }
    }
  }

  return sink.commands;
}
