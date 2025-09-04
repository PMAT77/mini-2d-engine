import { Player } from "../objects/Player";
import { State } from "./State";

/**
 * 玩家空闲状态
 * 处理玩家静止不动时的行为和视觉效果
 */
export const IdleState: State<Player> = {
  name: "idle",

  /**
   * 进入空闲状态时触发
   * @param player 玩家实例
   */
  onEnter: (player: Player) => {
    player.setIdleTime(0); // 重置待机计时器
  },

  /**
   * 空闲状态更新
   * @param player 玩家实例
   * @param delta 时间增量（秒）
   */
  onUpdate: (player: Player, delta: number) => {
    // 更新待机计时器，用于呼吸动画效果
    player.setIdleTime(player.getIdleTime() + delta);
  },

  /**
   * 退出空闲状态时触发
   * @param player 玩家实例
   */
  onExit: (player: Player) => {
    // 不需要特别的清理，因为Player类在update中会管理缩放
  },
};