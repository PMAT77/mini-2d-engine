import { Vector2 } from "../math/Vector2";

/**
 * 光源类，表示游戏中的一个点光源
 */
export class LightSource {
  private position: Vector2;
  private radius: number;
  private color: string;
  private intensity: number;
  private isActive: boolean;

  /**
   * 构造函数
   * @param position 光源位置
   * @param radius 光照半径
   * @param color 光照颜色
   * @param intensity 光照强度 (0-2)
   */
  constructor(
    position: Vector2,
    radius: number = 400, // 默认半径
    color: string = "#FFFFFF", // 光源颜色
    intensity: number = 1 // 默认强度
  ) {
    this.position = position.clone();
    this.radius = radius;
    this.color = color;
    this.intensity = Math.max(0, Math.min(2, intensity)); // 提高强度上限到2
    this.isActive = true;
  }

  /**
   * 更新光源状态
   * @param delta 时间增量
   */
  update(delta: number): void {
    // 可以在这里添加光源动画或其他效果
  }

  /**
   * 获取光源位置
   */
  getPosition(): Vector2 {
    return this.position;
  }

  /**
   * 设置光源位置
   */
  setPosition(position: Vector2): void {
    this.position = position.clone();
  }

  /**
   * 获取光照半径
   */
  getRadius(): number {
    return this.radius;
  }

  /**
   * 设置光照半径
   */
  setRadius(radius: number): void {
    this.radius = Math.max(0, radius);
  }

  /**
   * 获取光照颜色
   */
  getColor(): string {
    return this.color;
  }

  /**
   * 设置光照颜色
   */
  setColor(color: string): void {
    this.color = color;
  }

  /**
   * 获取光照强度
   */
  getIntensity(): number {
    return this.intensity;
  }

  /**
   * 设置光照强度
   */
  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(2, intensity)); // 提高强度上限到2
  }

  /**
   * 获取光源是否活跃
   */
  isLightActive(): boolean {
    return this.isActive;
  }

  /**
   * 设置光源活跃状态
   */
  setActive(active: boolean): void {
    this.isActive = active;
  }
}