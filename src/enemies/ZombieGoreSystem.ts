import type { TileMap } from '../map/TileMap';
import type { BulletImpact } from '../combat/CombatTypes';
import type { ZombieDeathEvent } from './Zombie';
import { ZombieRenderer } from './ZombieRenderer';
import type { ZombiePart } from './ZombieRenderer';
import { ZOMBIE_CONFIG } from './ZombieConfig';
import { computeKnockbackSpeed } from '../combat/KnockbackProfiles';
import { COMBAT_FEEDBACK as C, hitFlashAlpha } from '../combat/CombatFeedbackConfig';
import { GroundEffectGrid } from '../objects/GroundEffectGrid';
import { circleCollider } from '../physics/Collider';

interface Drop { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; }
interface Fragment extends ZombiePart {
  vx: number; vy: number; spin: number; age: number; flight: number; lift: number; radius: number; wet: boolean;
}
type VisibleAt = (x: number, y: number) => boolean;

/** Cosmetic bodies only: bounded flight simulation, permanent indexed ground remains. */
export class ZombieGoreSystem {
  private drops: Drop[] = [];
  private flying: Fragment[] = [];
  private readonly settled = new GroundEffectGrid<Fragment>();
  private readonly deaths = new Set<string>();
  private readonly water = { fraction: 0, depth: 0 };
  private physicsSteps = 0;
  private drawCandidates = 0;
  constructor(private readonly map: TileMap, private readonly random: () => number) {}

  hit(impact: BulletImpact): void {
    if (![impact.point.x, impact.point.y, impact.direction.x, impact.direction.y].every(Number.isFinite)) return;
    const angle = Math.atan2(impact.direction.y, impact.direction.x);
    for (let i = 0; i < 6 && this.drops.length < C.maxBloodDrops; i++) {
      const a = angle + (this.random() - .5) * 1.8, speed = 45 + this.random() * 85;
      this.drops.push({ x: impact.point.x, y: impact.point.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        age: 0, life: .16 + this.random() * .14, size: 1.5 + this.random() * 2.5 });
    }
  }

  burst(death: ZombieDeathEvent): void {
    if (this.deaths.has(death.id)) return;
    this.deaths.add(death.id);
    const impulse = computeKnockbackSpeed(death.impact, ZOMBIE_CONFIG[death.kind].knockback, true) * C.fragmentImpulseScale;
    const directionLength = Math.hypot(death.impact.direction.x, death.impact.direction.y);
    const dx = directionLength > 1e-6 ? death.impact.direction.x / directionLength : 0;
    const dy = directionLength > 1e-6 ? death.impact.direction.y / directionLength : 0;
    const parts = ZombieRenderer.parts(death.pose).slice(0, C.fragmentsPerDeath);
    parts.forEach((part, i) => {
      const width = part.width * .85, height = part.height * .85, radius = Math.hypot(width, height) / 2;
      const initial = this.map.resolveMotion(circleCollider(death.x, death.y, radius), { x: part.x - death.x, y: part.y - death.y }).collider.pose;
      const angle = i / parts.length * Math.PI * 2 + (this.random() - .5) * .7, speed = C.fragmentMinSpeed + this.random() * (C.fragmentMaxSpeed - C.fragmentMinSpeed);
      let vx = Math.cos(angle) * speed + dx * impulse, vy = Math.sin(angle) * speed + dy * impulse;
      const scale = Math.min(1, C.fragmentSpeedLimit / Math.max(1, Math.hypot(vx, vy))); vx *= scale; vy *= scale;
      const f: Fragment = { ...part, x: initial.x, y: initial.y, width, height, radius, vx, vy,
        spin: (this.random() < .5 ? -1 : 1) * (6 + this.random() * 7), age: 0,
        flight: C.fragmentMinFlight + this.random() * (C.fragmentMaxFlight - C.fragmentMinFlight), lift: 12 + this.random() * 20, wet: false };
      if (this.flying.length < C.maxFlyingFragments) this.flying.push(f);
      else { this.advanceFragment(f, f.flight + C.fragmentBounceSeconds); this.land(f); }
    });
    for (let i = 0; i < 3; i++) this.hit({ ...death.impact, point: { x: death.x, y: death.y } });
  }

  private move(x: number, y: number, radius: number, dx: number, dy: number) {
    const body = circleCollider(x, y, radius), hit = this.map.castShape(body, { x: dx, y: dy });
    const fraction = hit ? Math.max(0, hit.fraction - 1e-5) : 1;
    return { x: Math.max(radius, Math.min(this.map.width * this.map.tileSize - radius, x + dx * fraction)),
      y: Math.max(radius, Math.min(this.map.height * this.map.tileSize - radius, y + dy * fraction)), blocked: !!hit };
  }

  private advanceFragment(f: Fragment, delta: number): void {
    const dt = Math.min(delta, Math.max(0, f.flight + C.fragmentBounceSeconds - f.age));
    const drag = Math.exp(-C.fragmentDrag * dt), travel = (1 - drag) / C.fragmentDrag;
    const pos = this.move(f.x, f.y, f.radius, f.vx * travel, f.vy * travel);
    f.x = pos.x; f.y = pos.y; f.vx = pos.blocked ? 0 : f.vx * drag; f.vy = pos.blocked ? 0 : f.vy * drag;
    f.angle += f.spin * dt; f.age = Math.min(f.flight + C.fragmentBounceSeconds, f.age + dt);
    this.physicsSteps++;
  }

  private land(f: Fragment): void {
    this.map.getShapeSpeedFactor(circleCollider(f.x, f.y, f.radius), this.water);
    f.wet = this.water.fraction > .15; f.vx = f.vy = f.spin = 0;
    this.settled.add(f);
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.physicsSteps = 0;
    let alive = 0;
    for (const d of this.drops) {
      d.age += delta;
      if (d.age >= d.life) continue;
      const drag = Math.exp(-6 * delta), travel = (1 - drag) / 6;
      const p = this.move(d.x, d.y, 1, d.vx * travel, d.vy * travel);
      d.x = p.x; d.y = p.y; d.vx = p.blocked ? 0 : d.vx * drag; d.vy = p.blocked ? 0 : d.vy * drag;
      this.drops[alive++] = d;
    }
    this.drops.length = alive; alive = 0;
    for (const f of this.flying) {
      this.advanceFragment(f, delta);
      if (f.age + 1e-9 >= f.flight + C.fragmentBounceSeconds) this.land(f);
      else this.flying[alive++] = f;
    }
    this.flying.length = alive;
  }

  private height(f: Fragment): number {
    if (f.age < f.flight) { const t = f.age / f.flight; return 4 * f.lift * t * (1 - t); }
    return f.lift * .16 * Math.max(0, Math.sin(Math.PI * (f.age - f.flight) / C.fragmentBounceSeconds));
  }

  private drawFragment(ctx: CanvasRenderingContext2D, f: Fragment, ox: number, oy: number, visibleAt?: VisibleAt, flashOnly = false): void {
    if (f.x < ox - 64 || f.y < oy - 64 || f.x > ox + ctx.canvas.width + 64 || f.y > oy + ctx.canvas.height + 64 ||
      (visibleAt && !visibleAt(f.x, f.y))) return;
    const flash = hitFlashAlpha(f.age), height = this.height(f);
    if (flashOnly && flash <= 0) return;
    ctx.save();
    if (flashOnly) ctx.globalAlpha *= flash;
    else {
      ctx.globalAlpha *= f.wet ? .62 : 1;
      ctx.fillStyle = 'rgba(8,12,10,.24)'; ctx.beginPath(); ctx.ellipse(f.x - ox, f.y - oy + 3, f.width * .6, f.height * .4, f.angle, 0, Math.PI * 2); ctx.fill();
    }
    const part = { ...f, y: f.y - height, height: f.height * (f.wet ? .65 : 1) };
    ZombieRenderer.drawPart(ctx, part, ox, oy, flash, flashOnly);
    if (!flashOnly && flash < .8) {
      ctx.translate(f.x - ox, f.y - height - oy); ctx.rotate(f.angle);
      ctx.fillStyle = '#6d171c'; ctx.fillRect(-f.width / 2, -part.height / 2, Math.max(2, f.width * .15), part.height);
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, visibleAt?: VisibleAt): void {
    this.drawCandidates = 0;
    for (const f of this.settled.query(ox, oy, ctx.canvas.width, ctx.canvas.height)) { this.drawCandidates++; this.drawFragment(ctx, f, ox, oy, visibleAt); }
    for (const f of this.flying) { this.drawCandidates++; this.drawFragment(ctx, f, ox, oy, visibleAt); }
    ctx.save();
    for (const d of this.drops) {
      if (d.x < ox - 8 || d.y < oy - 8 || d.x > ox + ctx.canvas.width + 8 || d.y > oy + ctx.canvas.height + 8 ||
        (visibleAt && !visibleAt(d.x, d.y))) continue;
      ctx.globalAlpha = 1 - d.age / d.life; ctx.fillStyle = '#b52b2c'; ctx.fillRect(d.x - ox - d.size / 2, d.y - oy - d.size / 2, d.size, d.size);
    }
    ctx.restore();
  }
  drawFlashes(ctx: CanvasRenderingContext2D, ox: number, oy: number, visibleAt?: VisibleAt): void {
    for (const f of this.flying) if (hitFlashAlpha(f.age) > 0) this.drawFragment(ctx, f, ox, oy, visibleAt, true);
  }
  getStats() { return { drops: this.drops.length, flying: this.flying.length, settled: this.settled.size, physicsSteps: this.physicsSteps, drawCandidates: this.drawCandidates }; }
  snapshot() { return { drops: this.drops.map(d => ({ ...d })), flying: this.flying.map(f => ({ ...f })), settled: Array.from(this.settled.values(), f => ({ ...f })) }; }
  clear(): void { this.drops = []; this.flying = []; this.settled.clear(); this.deaths.clear(); this.physicsSteps = this.drawCandidates = 0; }
}
