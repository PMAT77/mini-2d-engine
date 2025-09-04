import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { ParticleSystem } from "./ParticleSystem";

/**
 * 子弹类，负责处理子弹的物理运动、碰撞检测和渲染逻辑
 */
export class Bullet {
  /** 子弹当前位置 */
  private pos: Vector2;

  /** 子弹当前速度向量 */
  private velocity: Vector2;

  /** 子弹大小（直径） */
  private size = 10;

  /** 子弹是否已被销毁的标志 */
  private isDestroyed = false;

  /** 子弹渲染颜色 */
  private color = "yellow";

  /** 子弹造成的伤害值 */
  private damage: number;

  /** 粒子系统引用 */
  private particleSystem?: ParticleSystem;

  /**
   * 构造一个新的子弹实例
   * @param pos 子弹初始位置
   * @param velocity 子弹初始速度向量
   * @param damage 子弹造成的伤害值（默认10）
   * @param particleSystem 可选的粒子系统引用
   */
  constructor(
    pos: Vector2,
    velocity: Vector2,
    damage = 10,
    particleSystem?: ParticleSystem
  ) {
    // 克隆位置向量以避免引用同一对象
    this.pos = pos.clone();

    // 校准发射位置，使子弹中心与指定位置对齐
    this.pos.set(
      this.pos.x - this.size / 2,
      this.pos.y - this.size / 2
    );

    // 克隆速度向量以避免引用同一对象
    this.velocity = velocity.clone();
    this.damage = damage;
    this.particleSystem = particleSystem;
  }

  /**
   * 更新子弹状态
   * @param delta 时间增量（毫秒）
   * @param map 可选的地图引用，用于碰撞检测
   */
  update(delta: number, map?: TileMap): void {
    // 如果子弹已被销毁，则不进行更新
    if (this.isDestroyed) return;

    // 计算新的位置
    const newX = this.pos.x + this.velocity.x * delta;
    const newY = this.pos.y + this.velocity.y * delta;

    // 检查是否与地图发生碰撞
    if (map) {
      const hit = map.getTileAtRect(newX, newY, this.size);
      if (hit) {
        // 创建爆炸效果
        if (this.particleSystem) {
          const hitPos = new Vector2(
            this.pos.x + this.size / 2,
            this.pos.y + this.size / 2
          );
          // 根据子弹颜色生成相应的爆炸效果
          this.particleSystem.createExplosion(
            hitPos,
            8,
            400,
            10,
            0.2,
            this.color === "yellow" ? ["yellow", "orange", "red"] : [this.color]
          );
        }

        // 对命中的瓦片造成伤害
        map.damageTile(hit.col, hit.row, this.damage);
        // 标记子弹为已销毁
        this.isDestroyed = true;
        return;
      }

      // 检查子弹是否超出地图范围
      const mapPixelWidth = map.width * map.tileSize;
      const mapPixelHeight = map.height * map.tileSize;

      // 当子弹完全离开地图区域时销毁
      if (newX + this.size < 0 ||
        newX > mapPixelWidth ||
        newY + this.size < 0 ||
        newY > mapPixelHeight) {
        this.destroy();
        return;
      }
    }

    // 更新子弹位置
    this.pos.x = newX;
    this.pos.y = newY;
  }

  /**
   * 渲染子弹
   * @param ctx Canvas渲染上下文
   * @param offsetX 水平偏移量（默认0）
   * @param offsetY 垂直偏移量（默认0）
   */
  draw(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    // 如果子弹已被销毁，则不进行渲染
    if (this.isDestroyed) return;

    // 保存当前渲染状态
    ctx.save();

    // 设置子弹颜色
    ctx.fillStyle = this.color;

    // 绘制圆形子弹
    ctx.beginPath();
    ctx.arc(
      this.pos.x - offsetX + this.size / 2,
      this.pos.y - offsetY + this.size / 2,
      this.size / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // 恢复之前的渲染状态
    ctx.restore();
  }

  /**
   * 获取子弹是否已被销毁的状态
   * @returns 子弹是否已被销毁
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * 设置子弹为已销毁状态
   */
  destroy(): void {
    // 创建爆炸效果
    if (this.particleSystem) {
      const hitPos = new Vector2(
        this.pos.x + this.size / 2,
        this.pos.y + this.size / 2
      );
      this.particleSystem.createExplosion(
        hitPos,
        6,
        100,
        4,
        0.15,
        this.color === "yellow" ? ["yellow", "orange", "red"] : [this.color]
      );
    }

    this.isDestroyed = true;
  }

  /**
   * 获取子弹当前位置
   * @returns 子弹位置的克隆
   */
  getPosition(): Vector2 {
    return this.pos.clone();
  }

  /**
   * 获取子弹大小
   * @returns 子弹大小
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 获取子弹伤害值
   * @returns 子弹伤害值
   */
  getDamage(): number {
    return this.damage;
  }

  /**
   * 设置子弹颜色
   * @param color 新的颜色值
   */
  setColor(color: string): void {
    this.color = color;
  }
}