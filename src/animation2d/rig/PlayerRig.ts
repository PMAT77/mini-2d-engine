/**
 * 玩家骨架定义。
 *
 * 绑定姿态直接取旧 RollPose 的静止值：
 * - 躯干/胸板/肩背外壳是绘制派生量，不是骨骼；
 * - 头、肩、肘、手、髋、膝、脚是骨骼，末端位置由旧数据表给出；
 * - 肩→肘→手的局部偏移与旧版“肘在肩手连线上”的常量一致，
 *   所以把姿势映射进骨架后，FK 还原出来的点与旧绘制坐标重合。
 */

import { transform2D } from "../math/Transform2D";
import type { SkeletonBindPose, SkeletonDefinition } from "./RigTypes";
import { BONE_IDS } from "./RigTypes";

export const PLAYER_RIG: SkeletonDefinition = {
  bones: [
    { id: "visualRoot", parent: null, bind: { x: 0, y: 0 } },
    { id: "pelvis", parent: "visualRoot", bind: { x: 0, y: 0 } },
    { id: "torso", parent: "pelvis", bind: { x: 0, y: 0 } },
    { id: "head", parent: "torso", bind: { x: .09, y: 0 } },
    { id: "shoulderL", parent: "torso", bind: { x: 0, y: -.31 } },
    { id: "elbowL", parent: "shoulderL", bind: { x: .024, y: -.09 } },
    { id: "handL", parent: "elbowL", bind: { x: .016, y: -.06 } },
    { id: "shoulderR", parent: "torso", bind: { x: 0, y: .31 } },
    { id: "elbowR", parent: "shoulderR", bind: { x: .024, y: .09 } },
    { id: "handR", parent: "elbowR", bind: { x: .016, y: .06 } },
    { id: "hipL", parent: "pelvis", bind: { x: -.162, y: -.1539 } },
    { id: "kneeL", parent: "hipL", bind: { x: -.018, y: -.0061 } },
    { id: "footL", parent: "kneeL", bind: { x: -.12, y: -.04 } },
    { id: "hipR", parent: "pelvis", bind: { x: -.162, y: .1539 } },
    { id: "kneeR", parent: "hipR", bind: { x: -.018, y: .0061 } },
    { id: "footR", parent: "kneeR", bind: { x: -.12, y: .04 } },
  ],
  indexById: BONE_IDS.reduce((index, id, position) => {
    index[id] = position;
    return index;
  }, {} as Record<(typeof BONE_IDS)[number], number>),
  sockets: [
    { id: "mainGrip", bone: "handR", local: { x: -.02, y: .015 }, rotation: 0 },
    { id: "supportGrip", bone: "handL", local: { x: 0, y: 0 }, rotation: 0 },
    { id: "visualMuzzle", bone: "handR", local: { x: .34, y: .015 }, rotation: 0 },
    { id: "stowedPrimary", bone: "torso", local: { x: -.08, y: 0 }, rotation: -.55 },
    { id: "stowedSecondary", bone: "pelvis", local: { x: -.18, y: .38 }, rotation: .55 },
  ],
  socketIndexById: {
    mainGrip: 0,
    supportGrip: 1,
    visualMuzzle: 2,
    stowedPrimary: 3,
    stowedSecondary: 4,
  },
  renderParts: [
    "legLeftUpper",
    "legLeftLower",
    "legLeftFoot",
    "legRightUpper",
    "legRightLower",
    "legRightFoot",
    "armOuterLeft",
    "armOuterRight",
    "armInnerLeft",
    "armInnerRight",
    "handLeft",
    "handRight",
    "back",
    "torso",
    "plate",
    "stowedWeapons",
    "heldWeapon",
    "head",
    "shell",
    "shellDetail",
  ],
  chains: [
    { id: "leftArm", bones: ["shoulderL", "elbowL", "handL"] },
    { id: "rightArm", bones: ["shoulderR", "elbowR", "handR"] },
    { id: "leftLeg", bones: ["hipL", "kneeL", "footL"] },
    { id: "rightLeg", bones: ["hipR", "kneeR", "footR"] },
  ],
};

/** 绑定姿态的局部变换：与旧 ROLL_REST_POSE 的派生结果一致，供适配器与测试对照。 */
export const PLAYER_BIND_POSE: SkeletonBindPose = {
  locals: PLAYER_RIG.bones.reduce((locals, bone) => {
    (locals as Record<string, import("../math/Transform2D").Transform2D>)[bone.id] = transform2D(bone.bind.x, bone.bind.y, 0);
    return locals;
  }, {} as Record<string, import("../math/Transform2D").Transform2D>) as SkeletonBindPose["locals"],
};
