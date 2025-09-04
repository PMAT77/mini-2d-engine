import { Vector2 } from "../math/Vector2";
import { Particle } from "./Particle";

/**
 * 粒子系统类，负责创建和管理多个粒子
 */
export class ParticleSystem {
  /** 粒子列表 */
  private particles: Particle[] = [];

  /** 粒子对象池 */
  private particlePool: Particle[] = [];

  /** 最大粒子数量限制 */
  private maxParticles: number = 1000;

  /**
   * 创建爆炸效果
   */
  createExplosion(
    pos: Vector2,
    count: number = 10,
    speed: number = 200,
    size: number = 5,
    life: number = 0.3,
    colors: string[] = ["yellow", "orange", "red"]
  ): void {
    // 计算实际可创建的粒子数（受最大粒子数限制）
    const availableSlots = Math.max(0, this.maxParticles - this.particles.length);
    const actualCount = Math.min(count, availableSlots);

    for (let i = 0; i < actualCount; i++) {
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

      // 从对象池获取粒子或创建新粒子
      let particle: Particle;
      if (this.particlePool.length > 0) {
        particle = this.particlePool.pop()!;
        particle.reset(pos, velocity, particleSize, particleLife, color);
      } else {
        particle = new Particle(pos, velocity, particleSize, particleLife, color);
      }
      this.particles.push(particle);
    }
  }

  /**
   * 更新所有活跃的粒子
   */
  update(delta: number): void {
    // 更新粒子并过滤掉不活跃的粒子
    this.particles = this.particles.filter(particle => {
      particle.update(delta);
      if (!particle.isAlive()) {
        // 不活跃的粒子放回对象池
        if (this.particlePool.length < 200) { // 限制对象池大小
          this.particlePool.push(particle);
        }
        return false;
      }
      return true;
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