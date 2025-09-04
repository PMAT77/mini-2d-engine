import { Player } from "../objects/Player";
import { State } from "./State";

/**
 * 玩家移动状态
 * 处理玩家移动时的行为和视觉效果
 */
export const MovingState: State<Player> = {
  name: "moving",

  /**
   * 进入移动状态时触发
   * @param player 玩家实例
   */
  onEnter: (player: Player) => {
    player.setIdleTime(0);  // 重置待机计时器，防止待机动画残留
    player.setWalkTime(0); // 初始化走路动画计时器
  },

  /**
   * 移动状态更新
   * @param player 玩家实例
   * @param delta 时间增量（秒）
   */
  onUpdate: (player: Player, delta: number) => {
    // 更新走路动画计时器
    player.setWalkTime(player.getWalkTime() + delta)
  },

  /**
   * 退出移动状态时触发
   * @param player 玩家实例
   */
  onExit: (player: Player) => {
    // 不需要特别的清理，因为Player类在update中会管理缩放
  },
};