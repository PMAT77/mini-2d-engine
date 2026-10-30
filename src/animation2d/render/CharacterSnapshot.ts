/**
 * 一帧角色渲染快照：动画层与 Canvas 层之间唯一的契约。
 *
 * 快照是纯数据（数字 + 已解析的骨骼世界变换），构建后不再随游戏对象变化；
 * `render` 只读快照，`getRenderState` 之外不产生任何副作用。
 */

import type { Transform2D } from "../math/Transform2D";
import type { SocketId } from "../rig/RigTypes";
import type { GlobalPose2D, LocalPose2D } from "../pose/Pose2D";
import type { WeaponKind, WeaponSlot } from "../../objects/Weapon";

/** 旧 RollPose 中不随骨骼层级变化的形状参数（半径、透明度、外壳位置）。 */
export interface CharacterPoseParams {
  headR: number;
  headAlpha: number;
  /** 头部半径在静止姿态的基准值，用于还原旧绘制里的高光缩放。 */
  headBindR: number;
  bodyRx: number;
  bodyRy: number;
  backX: number;
  backY: number;
  backR: number;
  plateX: number;
  plateY: number;
  plateR: number;
  legAlpha: number;
  shellX: number;
  shellY: number;
  shellRx: number;
  shellRy: number;
  shellAlpha: number;
  weaponAngle: number;
}

export interface CharacterRenderSnapshot {
  /** 世界像素：一个身位的大小。 */
  size: number;
  /** 整个身体的视觉朝向（含翻滚方向权重），绘制时先旋转这个角。 */
  facing: number;
  /** 视觉缩放（呼吸）；碰撞体永远不用它。 */
  scale: number;
  /** 物理翻滚进度；0 表示站立/奔跑/瞄准。 */
  progress: number;
  rolling: boolean;
  stowedAlpha: number;
  activeSlot: WeaponSlot;
  weaponKind: WeaponKind;
  /** 伪高度（世界像素）：只有 rig 后端的翻滚段会大于 0，用于绘制缓冲外的地面阴影。 */
  altitudePx: number;
  /** 翻滚中段头 / 胸的逐帧深度：true 时渲染器把头收进躯干后方。 */
  depthTuck: boolean;
  /** 拳击视觉进度 0–1；0 表示没有拳击层。 */
  punchProgress: number;
  /** 受击晃动进度 0–1；只影响姿态，不影响生命或位移。 */
  hitReactProgress: number;
  /** 换弹进度 0–1；0 表示没有在换弹。只用于视觉手势。 */
  reloadProgress: number;
  pose: CharacterPoseParams;
  locals: LocalPose2D;
  world: GlobalPose2D;
  sockets: Readonly<Record<SocketId, Transform2D>>;
}
