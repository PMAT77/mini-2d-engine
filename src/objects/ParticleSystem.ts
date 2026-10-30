import { Vector2 } from '../math/Vector2';
import { Particle } from './Particle';

/**
 * 粒子系统类，负责创建和管理多个粒子
 *
 * 热路径（update/draw）刻意避免逐帧分配：死亡粒子原地压缩、按颜色分组复用
 * Map 与数组、对象池复用粒子的内部向量。粒子的视觉参数（尺寸/透明度/颜色）
 * 全部保持逐粒子精度，不量化。
 */
export class ParticleSystem {
  /** 粒子列表 */
  private particles: Particle[] = [];

  /** 粒子对象池 */
  private particlePool: Particle[] = [];

  /** 最大粒子数量限制 */
  private maxParticles: number = 1000;

  /** 复用的颜色分组（字符串颜色 -> 粒子数组），避免每帧创建对象与数组。 */
  private readonly colorGroups = new Map<string, Particle[]>();

  /** 粒子包围盒，供迷雾/单位层按需裁剪；无粒子时 width/height 为 0。 */
  private bounds = { x: 0, y: 0, width: 0, height: 0 };

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
    const availableSlots = Math.max(0, this.maxParticles - this.particles.length);
    const actualCount = Math.min(count, availableSlots);

    for (let i = 0; i < actualCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speedFactor = Math.random() * speed;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const particleSize = size * (0.8 + Math.random() * 0.4);
      const particleLife = life * (0.8 + Math.random() * 0.4);
      this.spawn(pos.x, pos.y, Math.cos(angle) * speedFactor, Math.sin(angle) * speedFactor,
        particleSize, particleLife, color);
    }
  }

  /** Pool-aware particle creation that does not allocate vectors in steady state. */
  private spawn(x: number, y: number, vx: number, vy: number, size: number, life: number, color: string): void {
    let particle: Particle;
    if (this.particlePool.length > 0) {
      particle = this.particlePool.pop()!;
      particle.setState(x, y, vx, vy, size, life, color);
    } else {
      particle = new Particle(new Vector2(x, y), new Vector2(vx, vy), size, life, color);
    }
    this.particles.push(particle);
  }

  /**
   * 更新所有活跃的粒子。原地压缩，不产生每帧数组。
   */
  update(delta: number): void {
    const particles = this.particles;
    let alive = 0;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      particle.update(delta);
      if (!particle.isAlive()) {
        if (this.particlePool.length < 200) this.particlePool.push(particle);
        continue;
      }
      if (alive !== i) particles[alive] = particle;
      alive++;
    }
    if (alive !== particles.length) particles.length = alive;
  }

  /**
   * 渲染所有活跃的粒子（批处理 + 视口剔除，逐粒子透明度保持原样）
   */
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number,
    visibleAt?: (worldX: number, worldY: number) => boolean): void {
    const groups = this.colorGroups;
    for (const list of groups.values()) list.length = 0;

    const viewWidth = ctx.canvas?.width ?? Infinity;
    const viewHeight = ctx.canvas?.height ?? Infinity;
    const margin = 64;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      if (!particle.isAlive()) continue;
      const pos = particle.getPosition();
      if (visibleAt && !visibleAt(pos.x, pos.y)) continue;
      const x = pos.x - offsetX, y = pos.y - offsetY;
      if (x < -margin || y < -margin || x > viewWidth + margin || y > viewHeight + margin) continue;
      let list = groups.get(particle.getColor());
      if (!list) { list = []; groups.set(particle.getColor(), list); }
      list.push(particle);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (minX === Infinity) {
      if (this.bounds.width !== 0) this.bounds = { x: 0, y: 0, width: 0, height: 0 };
      return;
    }
    this.bounds = { x: minX + offsetX - 8, y: minY + offsetY - 8, width: maxX - minX + 16, height: maxY - minY + 16 };

    for (const [color, particles] of groups) {
      if (!particles.length) continue;
      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        const pos = particle.getPosition();
        const size = particle.getSize();
        ctx.globalAlpha = particle.getAlpha();
        ctx.fillRect(pos.x - offsetX - size / 2, pos.y - offsetY - size / 2, size, size);
      }
      ctx.restore();
    }
  }

  /** World-space bounds of the particles drawn last frame (empty when none were visible). */
  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds;
  }

  /**
   * 获取性能统计信息
   */
  getPerformanceStats(): {
    activeParticles: number;
    poolSize: number;
  } {
    return {
      activeParticles: this.particles.length,
      poolSize: this.particlePool.length
    };
  }

  /**
   * 清除所有粒子
   */
  clear(): void {
    this.particles = [];
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * 添加单个粒子
   */
  addParticle(options: {
    x: number;
    y: number;
    size: number;
    color: string;
    speed: number;
    angle: number;
    lifetime: number;
    fadeOut?: boolean;
  }): void {
    if (this.particles.length >= this.maxParticles) return;
    this.spawn(options.x, options.y, Math.cos(options.angle) * options.speed,
      Math.sin(options.angle) * options.speed, options.size, options.lifetime, options.color);
  }
}
