import { Vector2 } from "../math/Vector2";
import { Particle } from "./Particle";

/**
 * 粒子系统类，负责创建和管理多个粒子
 */
export class ParticleSystem {
  /** 粒子列表 */
  private particles: Particle[] = [];

  /**
   * 创建爆炸效果
   * @param pos 爆炸中心位置
   * @param count 粒子数量
   * @param speed 粒子最大速度
   * @param size 粒子初始尺寸
   * @param life 粒子生命周期
   * @param colors 粒子颜色列表
   */
  createExplosion(
    pos: Vector2,
    count: number = 10,
    speed: number = 200,
    size: number = 5,
    life: number = 0.3,
    colors: string[] = ["yellow", "orange", "red"]
  ): void {
    for (let i = 0; i < count; i++) {
      // 随机方向
      const angle = Math.random() * Math.PI * 2;
      const velocity = new Vector2(
        Math.cos(angle) * (Math.random() * speed),
        Math.sin(angle) * (Math.random() * speed)
      );

      // 随机颜色
      const color = colors[Math.floor(Math.random() * colors.length)];

      // 随机大小和生命周期
      const particleSize = size * (0.8 + Math.random() * 0.4);
      const particleLife = life * (0.8 + Math.random() * 0.4);

      // 创建粒子
      const particle = new Particle(pos, velocity, particleSize, particleLife, color);
      this.particles.push(particle);
    }
  }

  /**
   * 更新所有活跃的粒子
   * @param delta 时间增量（毫秒）
   */
  update(delta: number): void {
    // 更新粒子并过滤掉不活跃的粒子
    this.particles = this.particles.filter(particle => {
      particle.update(delta);
      return particle.isAlive();
    });
  }

  /**
   * 渲染所有活跃的粒子
   * @param ctx Canvas渲染上下文
   * @param offsetX 水平偏移量
   * @param offsetY 垂直偏移量
   */
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
    this.particles.forEach(particle => {
      particle.draw(ctx, offsetX, offsetY);
    });
  }

  /**
   * 获取当前活跃的粒子数量
   * @returns 活跃粒子数量
   */
  getParticleCount(): number {
    return this.particles.length;
  }

  /**
   * 清除所有粒子
   */
  clear(): void {
    this.particles = [];
  }
}