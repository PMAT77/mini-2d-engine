import { Vector2 } from "../math/Vector2";

/**
 * 粒子类，表示游戏中的单个粒子效果
 */
export class Particle {
  /** 粒子当前位置 */
  private pos: Vector2;

  /** 粒子当前速度向量 */
  private velocity: Vector2;

  /** 粒子当前尺寸 */
  private size: number;

  /** 粒子初始尺寸 */
  private initialSize: number;

  /** 粒子生命周期 */
  private life: number;

  /** 粒子最大生命周期 */
  private maxLife: number;

  /** 粒子颜色 */
  private color: string;

  /** 粒子是否活跃 */
  private isActive: boolean = true;

  /** 粒子旋转角度 */
  private rotation: number = 0;

  /** 粒子旋转速度 */
  private rotationSpeed: number = 0;

  /** 粒子透明度 */
  private alpha: number = 1;

  /** 粒子透明度衰减速率 */
  private alphaDecay: number = 0;

  /** 粒子尺寸衰减速率 */
  private sizeDecay: number = 0;

  /**
   * 构造一个新的粒子实例
   * @param pos 粒子初始位置
   * @param velocity 粒子初始速度向量
   * @param size 粒子初始尺寸
   * @param life 粒子生命周期（毫秒）
   * @param color 粒子颜色
   */
  constructor(
    pos: Vector2,
    velocity: Vector2,
    size: number,
    life: number,
    color: string
  ) {
    this.pos = pos.clone();
    this.velocity = velocity.clone();
    this.size = size;
    this.initialSize = size;
    this.life = life;
    this.maxLife = life;
    this.color = color;

    // 随机旋转角度和速度
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 10; // -5 到 5 弧度/秒

    // 设置透明度衰减
    this.alpha = 1;
    this.alphaDecay = 1 / life; // 线性衰减

    // 设置尺寸衰减
    this.sizeDecay = this.size / life;
  }

  /**
   * 更新粒子状态
   * @param delta 时间增量（毫秒）
   */
  update(delta: number): void {
    if (!this.isActive) return;

    // 减少生命值
    this.life -= delta;
    if (this.life <= 0) {
      this.isActive = false;
      return;
    }

    // 更新位置
    this.pos.x += this.velocity.x * delta;
    this.pos.y += this.velocity.y * delta;

    // 更新旋转
    this.rotation += this.rotationSpeed * delta;

    // 更新透明度和尺寸
    this.alpha = Math.max(0, 1 - this.alphaDecay * (this.maxLife - this.life));
    this.size = Math.max(0, this.initialSize - this.sizeDecay * (this.maxLife - this.life));
  }

  /**
   * 渲染粒子
   * @param ctx Canvas渲染上下文
   * @param offsetX 水平偏移量（默认0）
   * @param offsetY 垂直偏移量（默认0）
   */
  draw(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    if (!this.isActive) return;

    ctx.save();

    // 设置透明度
    ctx.globalAlpha = this.alpha;

    // 移动到粒子中心并应用旋转
    ctx.translate(this.pos.x - offsetX, this.pos.y - offsetY);
    ctx.rotate(this.rotation);

    // 设置颜色并绘制粒子
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);

    ctx.restore();
  }

  /**
   * 获取粒子是否活跃
   * @returns 粒子是否活跃
   */
  isAlive(): boolean {
    return this.isActive;
  }
}