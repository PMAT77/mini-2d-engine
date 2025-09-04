import { Player } from "../objects/Player";
import { State } from "./State";

/**
 * 玩家射击状态
 * 处理玩家射击时的行为和视觉效果
 */
export const ShootingState: State<Player> = {
  name: "shooting",

  /**
   * 进入射击状态时触发
   * @param player 玩家实例
   */
  onEnter: (player: Player) => {
    // 射击逻辑在Player类的update方法中处理，此处不需要额外逻辑
  },

  /**
   * 射击状态更新
   * @param player 玩家实例
   * @param delta 时间增量（秒）
   */
  onUpdate: (player: Player, delta: number) => {
    // 射击动画效果在Player类的draw方法中实现
    // 射击冷却和子弹生成逻辑在Player类的update方法中处理
  },

  /**
   * 退出射击状态时触发
   * @param player 玩家实例
   */
  onExit: (player: Player) => {
    // 不需要特别的清理操作
  },
};