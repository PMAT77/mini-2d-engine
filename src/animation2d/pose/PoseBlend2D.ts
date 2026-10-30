/**
 * 姿势混合：按骨骼权重线性插值，旋转走最短弧。
 *
 * phase 1 只提供数据层能力与测试；阶段四的分层动画会在这里挂 base/aim/action 层，
 * 但当前绘制路径不依赖它，避免提前引入未被使用的运行时开销。
 */

import { shortestAngleDelta } from "../math/angles";
import { transform2D } from "../math/Transform2D";
import type { BoneId, SkeletonDefinition } from "../rig/RigTypes";
import { BONE_IDS } from "../rig/RigTypes";
import { cloneLocalPose } from "./Pose2D";
import type { LocalPose2D } from "./Pose2D";

export function blendLocalPoses(
  from: Readonly<LocalPose2D>,
  to: Readonly<LocalPose2D>,
  t: number,
): LocalPose2D {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  // 端点必须精确等于源姿势：调用方（翻滚入场/出场混合）依赖这一点做逐像素比对。
  if (clamped <= 0) return cloneLocalPose(from);
  if (clamped >= 1) return cloneLocalPose(to);
  const locals = {} as Record<BoneId, import("../math/Transform2D").Transform2D>;
  for (const id of BONE_IDS) {
    const a = from.locals[id], b = to.locals[id];
    locals[id] = transform2D(
      a.x + (b.x - a.x) * clamped,
      a.y + (b.y - a.y) * clamped,
      a.rotation + shortestAngleDelta(a.rotation, b.rotation) * clamped,
    );
  }
  return { locals };
}

/**
 * 只混合被掩码覆盖的骨骼；未覆盖的骨骼完全保留 base。
 * 权重会被逐骨夹到 0–1，因此同一姿势可以给不同链不同权重。
 */
export function blendMaskedPoses(
  base: Readonly<LocalPose2D>,
  layer: Readonly<LocalPose2D>,
  weights: Partial<Record<BoneId, number>>,
): LocalPose2D {
  const locals = {} as Record<BoneId, import("../math/Transform2D").Transform2D>;
  for (const id of BONE_IDS) {
    const a = base.locals[id], b = layer.locals[id];
    const raw = weights[id];
    const t = raw === undefined ? 0 : Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    locals[id] = t <= 0
      ? transform2D(a.x, a.y, a.rotation)
      : transform2D(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.rotation + shortestAngleDelta(a.rotation, b.rotation) * t,
      );
  }
  return { locals };
}

/** 生成一条骨链的掩码，给 blendMaskedPoses 使用。 */
export function chainWeights(
  rig: SkeletonDefinition,
  chainId: SkeletonDefinition["chains"][number]["id"],
  weight: number,
): Partial<Record<BoneId, number>> {
  const chain = rig.chains.find(candidate => candidate.id === chainId);
  if (!chain) return {};
  const weights: Partial<Record<BoneId, number>> = {};
  for (const bone of chain.bones) weights[bone] = weight;
  return weights;
}
