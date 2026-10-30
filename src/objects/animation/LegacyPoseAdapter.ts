/**
 * 旧 RollPose → 新骨架数据的单向适配。
 *
 * 适配方向固定为“旧数据是权威、骨架子节点由旧数据推导”：
 * 取每根骨骼在旧姿态里的绝对坐标，减去父骨骼的绝对坐标得到局部偏移。
 * 这样 FK 还原出的肩/肘/手/髋/膝/脚与旧绘制坐标重合，
 * 不需要对 bind 姿态做任何逆变换，也不会引入两套互相漂移的绑定值。
 */

import type { Transform2D } from "../../animation2d/math/Transform2D";
import { transform2D } from "../../animation2d/math/Transform2D";
import type { BoneId } from "../../animation2d/rig/RigTypes";
import type { LocalPose2D } from "../../animation2d/pose/Pose2D";
import type { CharacterPoseParams } from "../../animation2d/render/CharacterSnapshot";
import type { RollPose } from "../RollPose";
import { ROLL_REST_POSE } from "../RollPose";

type MutableLocals = Record<BoneId, Transform2D>;

/** 旧绘制里由躯干外缘推出的髋点；骨骼层显式建模后必须用同一表达式。 */
export function legacyHip(pose: RollPose, side: -1 | 1): { x: number; y: number } {
  return {
    x: pose.bodyX - pose.bodyRx * .4,
    y: side * pose.bodyRy * .38,
  };
}

export function legacyPoseToLocalPose(pose: RollPose): LocalPose2D {
  const locals = {} as MutableLocals;
  const bodyX = pose.bodyX, bodyY = pose.bodyY;
  const hipLeft = legacyHip(pose, -1);
  const hipRight = legacyHip(pose, 1);

  locals.visualRoot = transform2D(0, 0, 0);
  locals.pelvis = transform2D(bodyX, bodyY, 0);
  locals.torso = transform2D(0, 0, 0);
  locals.head = transform2D(pose.headX - bodyX, pose.headY - bodyY, 0);

  locals.shoulderL = transform2D(pose.leftShoulderX - bodyX, pose.leftShoulderY - bodyY, 0);
  locals.elbowL = transform2D(pose.leftElbowX - pose.leftShoulderX, pose.leftElbowY - pose.leftShoulderY, 0);
  locals.handL = transform2D(pose.leftHandX - pose.leftElbowX, pose.leftHandY - pose.leftElbowY, 0);

  locals.shoulderR = transform2D(pose.rightShoulderX - bodyX, pose.rightShoulderY - bodyY, 0);
  locals.elbowR = transform2D(pose.rightElbowX - pose.rightShoulderX, pose.rightElbowY - pose.rightShoulderY, 0);
  locals.handR = transform2D(pose.rightHandX - pose.rightElbowX, pose.rightHandY - pose.rightElbowY, 0);

  locals.hipL = transform2D(hipLeft.x - bodyX, hipLeft.y - bodyY, 0);
  locals.kneeL = transform2D(pose.leftKneeX - hipLeft.x, pose.leftKneeY - hipLeft.y, 0);
  locals.footL = transform2D(pose.leftFootX - pose.leftKneeX, pose.leftFootY - pose.leftKneeY, 0);

  locals.hipR = transform2D(hipRight.x - bodyX, hipRight.y - bodyY, 0);
  locals.kneeR = transform2D(pose.rightKneeX - hipRight.x, pose.rightKneeY - hipRight.y, 0);
  locals.footR = transform2D(pose.rightFootX - pose.rightKneeX, pose.rightFootY - pose.rightKneeY, 0);

  return { locals };
}

export function legacyPoseToParams(pose: RollPose): CharacterPoseParams {
  return {
    headR: pose.headR,
    headAlpha: pose.headAlpha,
    headBindR: ROLL_REST_POSE.headR,
    bodyRx: pose.bodyRx,
    bodyRy: pose.bodyRy,
    backX: pose.backX,
    backY: pose.backY,
    backR: pose.backR,
    plateX: pose.plateX,
    plateY: pose.plateY,
    plateR: pose.plateR,
    legAlpha: pose.legAlpha,
    shellX: pose.shellX,
    shellY: pose.shellY,
    shellRx: pose.shellRx,
    shellRy: pose.shellRy,
    shellAlpha: pose.shellAlpha,
    weaponAngle: pose.weaponAngle,
  };
}
