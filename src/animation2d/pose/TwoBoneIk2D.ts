/**
 * 二骨 IK：用余弦定理把中段关节摆到目标可达的圆周上。
 *
 * 只用于阶段三的接触约束链（翻滚时的支撑手 / 支撑脚），
 * 输入是已经由 FK 求出的全局（body-local）姿态。
 * 与旧渲染一致，这条路径上的骨骼旋转恒为 0，局部量就是相对父关节的平移；
 * 目标不可达时返回 false，调用方必须原样回落到 clip 姿态，不做强制拉伸。
 */

import type { BoneId } from "../rig/RigTypes";
import type { GlobalPose2D, LocalPose2D } from "./Pose2D";

export interface IkTarget {
  x: number;
  y: number;
}

const EPSILON = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 求解失败时不修改 `locals`。
 * `target` 与 `world` 使用同一坐标系（body-local，单位 = 身高）。
 */
export function solveTwoBoneIk(
  locals: LocalPose2D,
  world: GlobalPose2D,
  rootBone: BoneId,
  midBone: BoneId,
  endBone: BoneId,
  target: IkTarget,
): boolean {
  const root = world.world[rootBone];
  const mid = world.world[midBone];
  const end = world.world[endBone];
  const l1 = Math.hypot(mid.x - root.x, mid.y - root.y);
  const l2 = Math.hypot(end.x - mid.x, end.y - mid.y);
  if (!(l1 > EPSILON) || !(l2 > EPSILON)) return false;

  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance > l1 + l2 - EPSILON || distance < Math.abs(l1 - l2) + EPSILON) {
    return false;
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const cosine = clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
  const angle = Math.acos(cosine);

  // 保持当前肘/膝的弯曲方向，避免 IK 解出反关节。
  const cross = ux * (mid.y - root.y) - uy * (mid.x - root.x);
  const side = cross >= 0 ? 1 : -1;
  const cos = Math.cos(angle * side);
  const sin = Math.sin(angle * side);
  const elbowX = root.x + (ux * cos - uy * sin) * l1;
  const elbowY = root.y + (ux * sin + uy * cos) * l1;
  const reachX = root.x + ux * distance;
  const reachY = root.y + uy * distance;

  const cosRoot = Math.cos(-root.rotation);
  const sinRoot = Math.sin(-root.rotation);
  const midLocal = locals.locals[midBone];
  const endLocal = locals.locals[endBone];
  const midDx = elbowX - root.x;
  const midDy = elbowY - root.y;
  const endDx = reachX - elbowX;
  const endDy = reachY - elbowY;

  midLocal.x = midDx * cosRoot - midDy * sinRoot;
  midLocal.y = midDx * sinRoot + midDy * cosRoot;
  midLocal.rotation = 0;
  endLocal.x = endDx * cosRoot - endDy * sinRoot;
  endLocal.y = endDx * sinRoot + endDy * cosRoot;
  endLocal.rotation = 0;
  return true;
}
