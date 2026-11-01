import type { TileMap } from '../map/TileMap';
import type { BulletImpact } from '../combat/CombatTypes';
import { circleCollider } from '../physics/Collider';

interface Drop { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; }

/** Cosmetic blood uses a separate random stream and never registers gameplay bodies. */
export class ZombieGoreSystem {
  private drops: Drop[] = [];
  constructor(private readonly map: TileMap, private readonly random: () => number) {}

  hit(impact: BulletImpact): void {
    const angle = Math.atan2(impact.direction.y, impact.direction.x);
    for (let i = 0; i < 6 && this.drops.length < 256; i++) {
      const a = angle + (this.random() - .5) * 1.8, speed = 45 + this.random() * 85;
      this.drops.push({ x: impact.point.x, y: impact.point.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        age: 0, life: .16 + this.random() * .14, size: 1.5 + this.random() * 2.5 });
    }
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    let alive = 0;
    for (const d of this.drops) {
      d.age += delta;
      if (d.age >= d.life) continue;
      const motion = this.map.resolveMotion(circleCollider(d.x, d.y, 1), { x: d.vx * delta, y: d.vy * delta });
      d.x = motion.collider.pose.x; d.y = motion.collider.pose.y;
      d.vx *= Math.exp(-6 * delta); d.vy *= Math.exp(-6 * delta);
      this.drops[alive++] = d;
    }
    this.drops.length = alive;
  }

  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, visibleAt?: (x: number, y: number) => boolean): void {
    ctx.save();
    for (const d of this.drops) {
      if (d.x < ox - 8 || d.y < oy - 8 || d.x > ox + ctx.canvas.width + 8 || d.y > oy + ctx.canvas.height + 8 ||
        (visibleAt && !visibleAt(d.x, d.y))) continue;
      ctx.globalAlpha = 1 - d.age / d.life; ctx.fillStyle = '#b52b2c';
      ctx.fillRect(d.x - ox - d.size / 2, d.y - oy - d.size / 2, d.size, d.size);
    }
    ctx.restore();
  }
  snapshot() { return { drops: this.drops.map(d => ({ ...d })) }; }
  clear(): void { this.drops = []; }
}
