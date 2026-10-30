/**
 * Forward Kinematics：把局部姿势组合成全局姿势。
 *
 * 复杂度 O(骨骼数)，不分配除结果对象以外的中间结构；结果只读使用。
 * 父骨骼必须先于子骨骼排列（PLAYER_RIG 已保证，测试也会校验）。
 */

import { composeTransforms, transform2D } from "../math/Transform2D";
import type { Transform2D } from "../math/Transform2D";
import type { BoneId, SkeletonDefinition, SocketId } from "../rig/RigTypes";
import type { GlobalPose2D, LocalPose2D } from "./Pose2D";
import { BONE_IDS } from "../rig/RigTypes";

export function solveForwardKinematics(
  rig: SkeletonDefinition,
  pose: Readonly<LocalPose2D>,
): GlobalPose2D {
  const world = {} as Record<BoneId, Transform2D>;
  for (const bone of rig.bones) {
    const local = pose.locals[bone.id];
    if (!bone.parent) {
      world[bone.id] = transform2D(local.x, local.y, local.rotation);
    } else {
      world[bone.id] = composeTransforms(world[bone.parent], local);
    }
  }
  return { world };
}

/** 解析插槽世界变换：骨骼世界变换 ∘ 插槽局部偏移。 */
export function resolveSockets(
  rig: SkeletonDefinition,
  global: Readonly<GlobalPose2D>,
): Record<SocketId, Transform2D> {
  const sockets = {} as Record<SocketId, Transform2D>;
  for (const socket of rig.sockets) {
    const bone = global.world[socket.bone];
    sockets[socket.id] = composeTransforms(
      bone,
      transform2D(socket.local.x, socket.local.y, socket.rotation),
    );
  }
  return sockets;
}

/** 单根骨骼的世界原点；缺省返回原点，避免上层到处判空。 */
export function bonePosition(global: Readonly<GlobalPose2D>, id: BoneId): { x: number; y: number } {
  const bone = global.world[id];
  return { x: bone.x, y: bone.y };
}

export function boneRotation(global: Readonly<GlobalPose2D>, id: BoneId): number {
  return global.world[id].rotation;
}

/** 校验：所有父骨骼都排在子骨骼之前，且 16 个 BoneId 全部出现。 */
export function isRigOrderValid(rig: SkeletonDefinition): boolean {
  if (rig.bones.length !== BONE_IDS.length) return false;
  const seen = new Set<BoneId>();
  for (const bone of rig.bones) {
    if (seen.has(bone.id)) return false;
    if (bone.parent !== null && !seen.has(bone.parent)) return false;
    seen.add(bone.id);
  }
  return seen.size === BONE_IDS.length;
}
