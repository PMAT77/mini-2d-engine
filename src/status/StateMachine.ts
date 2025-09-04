import { State } from "./State";

/**
 * 状态机类，负责管理游戏对象的状态切换和更新
 * @template T 状态拥有者的类型，通常是游戏对象类
 */
export class StateMachine<T> {
  /**
   * 状态拥有者实例
   */
  private owner: T;

  /**
   * 存储所有可用状态的映射表
   */
  private states: Map<string, State<T>> = new Map();

  /**
   * 当前激活的状态
   */
  private currentState?: State<T>;

  /**
   * 构造函数
   * @param owner 状态拥有者实例
   */
  constructor(owner: T) {
    this.owner = owner;
  }

  /**
   * 添加新状态到状态机
   * @param state 要添加的状态对象
   */
  public addState(state: State<T>): void {
    this.states.set(state.name, state);
  }

  /**
   * 切换到指定名称的状态
   * @param name 目标状态名称
   */
  public changeState(name: string): void {
    // 如果当前状态已经是目标状态，则不执行任何操作
    if (this.currentState?.name === name) return;

    // 退出当前状态
    this.currentState?.onExit?.(this.owner);

    // 切换到新状态
    this.currentState = this.states.get(name);

    // 进入新状态
    this.currentState?.onEnter?.(this.owner);
  }

  /**
   * 更新当前状态
   * @param delta 时间增量（秒）
   */
  public update(delta: number): void {
    this.currentState?.onUpdate?.(this.owner, delta);
  }

  /**
   * 获取当前状态名称
   * @returns 当前状态名称，如果没有活动状态则返回undefined
   */
  public getStateName(): string | undefined {
    return this.currentState?.name;
  }
}