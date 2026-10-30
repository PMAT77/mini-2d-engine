/**
 * 姿势数据容器。
 *
 * LocalPose2D 保存每根骨骼相对父骨骼的变换；GlobalPose2D 是 FK 求解后的结果。
 * 两者都只含数字，不含 Canvas 状态，方便在 Node 中逐帧比对。
 */

import { transform2D } from "../math/Transform2D";
import type { Transform2D } from "../math/Transform2D";
import type { BoneId } from "../rig/RigTypes";
import { BONE_IDS } from "../rig/RigTypes";

export interface LocalPose2D {
  locals: Record<BoneId, Transform2D>;
}

export interface GlobalPose2D {
  world: Record<BoneId, Transform2D>;
}

/** 生成一份所有骨骼都在原点的局部姿势；适配器与测试用它兜底。 */
export function createEmptyLocalPose(): LocalPose2D {
  const locals = {} as Record<BoneId, Transform2D>;
  for (const id of BONE_IDS) locals[id] = transform2D(0, 0, 0);
  return { locals };
}

export function cloneLocalPose(pose: Readonly<LocalPose2D>): LocalPose2D {
  const locals = {} as Record<BoneId, Transform2D>;
  for (const id of BONE_IDS) {
    const source = pose.locals[id];
    locals[id] = transform2D(source.x, source.y, source.rotation);
  }
  return { locals };
}

export function cloneBoneIds(): readonly BoneId[] {
  return BONE_IDS;
}
