/**
 * 最小姿势分层：在 base 局部姿态之上叠加骨骼偏移。
 *
 * 只提供“相对偏移”而不是绝对目标姿势，这样 action 层不需要知道 base 的手肘形状，
 * 也不会把 base 的位移覆盖掉。命中反应是 additive：每帧都从 base 重新计算，
 * 不把上一帧结果当输入，因此没有累积漂移。
 */

import type { BoneId } from "../rig/RigTypes";
import { BONE_IDS } from "../rig/RigTypes";
import { transform2D } from "../math/Transform2D";
import type { LocalPose2D } from "./Pose2D";

export interface BonePoseOffset {
  x?: number;
  y?: number;
  rotation?: number;
}

export type PoseOffsets = Partial<Record<BoneId, BonePoseOffset>>;

/**
 * 返回叠加后的新姿势；base 不被修改。weight 夹到 0–1，
 * weight<=0 时直接克隆 base，保证“没有分层”的帧与旧结果逐位一致。
 */
export function poseWithOffsets(
  base: Readonly<LocalPose2D>,
  offsets: Readonly<PoseOffsets>,
  weight: number,
): LocalPose2D {
  const clamped = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
  const locals = {} as Record<BoneId, import("../math/Transform2D").Transform2D>;
  for (const id of BONE_IDS) {
    const current = base.locals[id];
    const offset = offsets[id];
    if (clamped <= 0 || !offset) {
      locals[id] = transform2D(current.x, current.y, current.rotation);
      continue;
    }
    locals[id] = transform2D(
      current.x + (offset.x ?? 0) * clamped,
      current.y + (offset.y ?? 0) * clamped,
      current.rotation + (offset.rotation ?? 0) * clamped,
    );
  }
  return { locals };
}
