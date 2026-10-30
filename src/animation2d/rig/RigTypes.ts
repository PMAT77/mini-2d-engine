/**
 * 骨架数据类型：只描述层级、绑定姿态、插槽与部件顺序，不含任何绘制或玩法逻辑。
 *
 * 单位与 RollPose 一致：1 = 一个玩家身位，局部 +x 朝前、+y 为右手侧。
 */

import type { Vec2, Transform2D } from "../math/Transform2D";

/**
 * 16 根骨骼。数组顺序即求解顺序：父骨骼必须排在子骨骼之前。
 * 腿的髋点不在 RollPose 数据里（旧绘制由躯干外缘推出），这里显式建模。
 */
export type BoneId =
  | "visualRoot"
  | "pelvis"
  | "torso"
  | "head"
  | "shoulderL"
  | "elbowL"
  | "handL"
  | "shoulderR"
  | "elbowR"
  | "handR"
  | "hipL"
  | "kneeL"
  | "footL"
  | "hipR"
  | "kneeR"
  | "footR";

export const BONE_IDS: readonly BoneId[] = [
  "visualRoot",
  "pelvis",
  "torso",
  "head",
  "shoulderL",
  "elbowL",
  "handL",
  "shoulderR",
  "elbowR",
  "handR",
  "hipL",
  "kneeL",
  "footL",
  "hipR",
  "kneeR",
  "footR",
];

export interface BoneDef {
  id: BoneId;
  /** 根骨骼为 null。 */
  parent: BoneId | null;
  /** 绑定姿态下的骨骼原点（父空间）。 */
  bind: Vec2;
}

/**
 * 插槽：挂在骨骼上的局部挂点，用于武器、枪口等后续阶段。
 * phase 1 只求解并暴露给快照，不参与当前绘制。
 */
export type SocketId =
  | "mainGrip"
  | "supportGrip"
  | "visualMuzzle"
  | "stowedPrimary"
  | "stowedSecondary";

export const SOCKET_IDS: readonly SocketId[] = [
  "mainGrip",
  "supportGrip",
  "visualMuzzle",
  "stowedPrimary",
  "stowedSecondary",
];

export interface SocketDef {
  id: SocketId;
  bone: BoneId;
  local: Vec2;
  rotation: number;
}

/**
 * 绘制部件。顺序就是迁移前 Player.drawBody 的绘制顺序：
 * 腿 → 双臂外层 → 双臂内层 → 手 → 背影 → 躯干 → 胸板 → 枪 → 头 → 肩背外壳。
 */
export type RenderPartId =
  | "legLeftUpper"
  | "legLeftLower"
  | "legLeftFoot"
  | "legRightUpper"
  | "legRightLower"
  | "legRightFoot"
  | "armOuterLeft"
  | "armOuterRight"
  | "armInnerLeft"
  | "armInnerRight"
  | "handLeft"
  | "handRight"
  | "back"
  | "torso"
  | "plate"
  | "stowedWeapons"
  | "heldWeapon"
  | "head"
  | "shell"
  | "shellDetail";

/** 动画分层用的骨链；phase 1 只用于掩码测试，不改变现有表现。 */
export type ChainId = "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

export const CHAIN_IDS: readonly ChainId[] = ["leftArm", "rightArm", "leftLeg", "rightLeg"];

export interface BlendChain {
  id: ChainId;
  bones: readonly BoneId[];
}

export interface SkeletonDefinition {
  readonly bones: readonly BoneDef[];
  readonly indexById: Readonly<Record<BoneId, number>>;
  readonly sockets: readonly SocketDef[];
  readonly socketIndexById: Readonly<Record<SocketId, number>>;
  readonly renderParts: readonly RenderPartId[];
  readonly chains: readonly BlendChain[];
}

export interface SkeletonBindPose {
  readonly locals: Readonly<Record<BoneId, Transform2D>>;
}
