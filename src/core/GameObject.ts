import { Input } from "./Input";

/**
 * 游戏对象抽象基类
 * 所有在游戏中可更新和渲染的对象都应继承自此类
 */
export abstract class GameObject {
  /**
   * 对象在游戏世界中的X坐标
   */
  public x: number;

  /**
   * 对象在游戏世界中的Y坐标
   */
  public y: number;

  /**
   * 构造函数
   * @param x 初始X坐标
   * @param y 初始Y坐标
   */
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /**
   * 更新游戏对象的状态
   * @param delta 时间增量（秒），表示从上一帧到当前帧经过的时间
   * @param input 输入系统，用于获取用户输入
   */
  public abstract update(delta: number, input: Input): void;

  /**
   * 绘制游戏对象到画布
   * @param ctx Canvas 2D渲染上下文
   */
  public abstract draw(ctx: CanvasRenderingContext2D): void;
}