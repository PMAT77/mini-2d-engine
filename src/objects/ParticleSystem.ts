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
   * 渲染所有活跃的粒子（批处理优化版本）
   */
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
    // 按颜色分组粒子以减少fillStyle切换
    const particlesByColor: { [key: string]: Particle[] } = {};

    // 分组
    this.particles.forEach(particle => {
      if (!particle.isAlive()) return;
      if (!particlesByColor[particle.getColor()]) {
        particlesByColor[particle.getColor()] = [];
      }
      particlesByColor[particle.getColor()].push(particle);
    });

    // 按颜色批次绘制
    Object.entries(particlesByColor).forEach(([color, particles]) => {
      ctx.save();
      ctx.fillStyle = color;

      particles.forEach(particle => {
        const pos = particle.getPosition();
        const size = particle.getSize();
        const alpha = particle.getAlpha();

        ctx.globalAlpha = alpha;
        // 使用简单的位置计算替代translate和rotate
        ctx.fillRect(
          pos.x - offsetX - size / 2,
          pos.y - offsetY - size / 2,
          size,
          size
        );
      });

      ctx.restore();
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