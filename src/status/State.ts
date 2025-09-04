/**
 * 状态接口，定义游戏对象状态的基本行为
 * @template T 状态拥有者的类型，通常是游戏对象类
 */
export interface State<T> {
  /**
   * 状态名称，用于状态机识别和切换状态
   */
  name: string;

  /**
   * 进入状态时触发的回调
   * @param owner 状态拥有者实例
   */
  onEnter?: (owner: T) => void;

  /**
   * 状态更新时触发的回调
   * @param owner 状态拥有者实例
   * @param delta 时间增量（秒）
   */
  onUpdate?: (owner: T, delta: number) => void;

  /**
   * 退出状态时触发的回调
   * @param owner 状态拥有者实例
   */
  onExit?: (owner: T) => void;
}