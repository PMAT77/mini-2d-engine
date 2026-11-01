import { Entities } from '../objects/Entities';
import { Vector2 } from '../math/Vector2';
import type { Input } from '../core/Input';
import type { TileMap } from '../map/TileMap';
import type { Point } from '../physics/Collider';
import { circleCollider } from '../physics/Collider';
import { castCollider } from '../physics/Motion';
import type { BulletImpact, DeathFinished, HitResult, LifeState } from '../combat/CombatTypes';
import { KnockbackMotion } from '../combat/KnockbackMotion';
import type { KnockbackWorld } from '../combat/KnockbackMotion';
import type { ZombieConfig } from './ZombieConfig';
import { ZombieRenderer } from './ZombieRenderer';
import type { ZombiePose } from './ZombieRenderer';

export class Zombie extends Entities {
  private health: number;
  private life: LifeState = 'alive';
  private direction = new Vector2();
  private phase = 0;
  private hitAge = 10;
  private deathAge = 0;
  private deathDeadline = 0;
  private deathFinished: DeathFinished | null = null;
  private knockback?: KnockbackMotion;
  constructor(readonly id: string, x: number, y: number, readonly config: Readonly<ZombieConfig>, facing = 0) {
    super(x, y); this.health = config.maxHealth; this.size = config.size; this.rotationSpeed = config.turnSpeed;
    this.currentRotation = facing + Math.PI; this.setCollider({ type: 'circle', radius: .5 });
    this.maxSpeed = config.wanderSpeed; this.accel = config.wanderAcceleration; this.decel = 1000;
  }
  isAlive(): boolean { return this.life === 'alive'; }
  isDamageable(): boolean { return this.isAlive(); }
  isRenderable(): boolean { return this.life !== 'removed'; }
  isPerceptionTarget(): boolean { return this.isRenderable(); }
  getLifeState(): LifeState { return this.life; }
  getHealth(): number { return this.health; }
  getFacingDirection(): number { return this.currentRotation - Math.PI; }
  getCenter(): Point { return { x: this.x + this.size / 2, y: this.y + this.size / 2 }; }
  setMovement(direction: Point, chasing: boolean): void {
    this.direction.set(direction.x, direction.y); if (this.direction.length() > 1) this.direction.normalize();
    this.maxSpeed = chasing ? this.config.chaseSpeed : this.config.wanderSpeed;
    this.accel = chasing ? this.config.acceleration : this.config.wanderAcceleration;
  }
  stopMovement(): void { this.direction.set(0, 0); this.velocity.set(0, 0); }
  protected getMoveDirection(): Vector2 { return this.direction.clone(); }
  protected getLookDirection(): Vector2 { return this.direction.clone(); }
  receiveHit(impact: BulletImpact, world?: KnockbackWorld): HitResult {
    if (!this.isAlive() || !Number.isFinite(impact?.damage) || impact.damage <= 0) return 'ignored';
    this.health = Math.max(0, this.health - impact.damage); this.hitAge = 0;
    const lethal = this.health === 0;
    if (world && !this.knockback) this.knockback = new KnockbackMotion(this, world, this.config.knockback,
      body => world.getShapeSpeedFactor(body) > 0);
    const speed = this.knockback?.addImpact(impact, lethal) ?? 0;
    if (lethal) {
      this.life = 'dying'; this.stopMovement(); this.deathAge = 0;
      const p = this.config.knockback;
      this.deathDeadline = Math.max(p.minDeathSeconds, Math.min(p.maxDeathSeconds, speed > 0 ? Math.log(speed / Math.max(p.stopSpeed, p.damping * p.deathSettleDistance)) / p.damping : 0));
    }
    return lethal ? 'killed' : 'damaged';
  }
  hitTestSegment(x0: number, y0: number, x1: number, y1: number, radius: number): number | null {
    if (!this.isAlive()) return null;
    const center = this.getCenter(), body = circleCollider(x0, y0, Math.max(.001, radius));
    if (Math.hypot(x0 - center.x, y0 - center.y) <= this.size / 2 + radius) return 0;
    return castCollider({ getCollisionObstacles: () => [{ collider: this.getCollider(), col: -1, row: -1 }] }, body, { x: x1 - x0, y: y1 - y0 })?.fraction ?? null;
  }
  update(delta: number, input: Input, map?: TileMap): void {
    if (!Number.isFinite(delta) || delta < 0 || this.life === 'removed') return;
    this.hitAge += delta;
    if (this.life === 'dying') {
      this.knockback?.update(Math.min(delta, Math.max(0, this.deathDeadline - this.deathAge)));
      this.deathAge += delta;
      if (this.deathAge + 1e-9 >= this.deathDeadline) {
        this.life = 'removed'; this.knockback?.stop(); this.deathFinished = { ...this.getCenter(), elapsedSeconds: this.deathDeadline };
      }
      return;
    }
    const x = this.x, y = this.y;
    super.update(delta, input, map); this.knockback?.update(delta);
    this.phase += Math.hypot(this.x - x, this.y - y) * .18;
  }
  consumeDeathFinished(): DeathFinished | null { const event = this.deathFinished; this.deathFinished = null; return event; }
  getPose(): ZombiePose { return { x: this.x, y: this.y, size: this.size, facing: this.getFacingDirection(), kind: this.config.kind,
    phase: this.phase, speed: this.velocity.length(), hit: Math.exp(-this.hitAge * 12) * .8, attack: 0, life: this.life }; }
  getRenderBounds() { return ZombieRenderer.bounds(this.getPose()); }
  draw(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { ZombieRenderer.draw(ctx, this.getPose(), ox, oy); }
  drawSilhouette(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { ZombieRenderer.draw(ctx, this.getPose(), ox, oy, true); }
  drawShadow(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { ZombieRenderer.shadow(ctx, this.getPose(), ox, oy); }
}
