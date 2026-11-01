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
import { MeleeAttackController } from './MeleeAttackController';
import { hitFlashAlpha } from '../combat/CombatFeedbackConfig';
import { snapshotBulletImpact } from '../combat/CombatTypes';

export interface ZombieDeathEvent extends DeathFinished {
  readonly id: string;
  readonly kind: ZombieConfig['kind'];
  readonly pose: Readonly<ZombiePose>;
  readonly impact: Readonly<BulletImpact>;
}

export class Zombie extends Entities {
  readonly attack: MeleeAttackController;
  private stunLeft = 0;
  private stunCooldownLeft = 0;
  private health: number;
  private life: LifeState = 'alive';
  private direction = new Vector2();
  private phase = 0;
  private hitAge = 10;
  private deathFinished: ZombieDeathEvent | null = null;
  private knockback?: KnockbackMotion;
  constructor(readonly id: string, x: number, y: number, readonly config: Readonly<ZombieConfig>, facing = 0) {
    super(x, y); this.health = config.maxHealth; this.size = config.size; this.rotationSpeed = config.turnSpeed;
    this.attack = new MeleeAttackController(id, config);
    this.currentRotation = facing + Math.PI; this.setCollider({ type: 'circle', radius: .5 });
    this.maxSpeed = config.wanderSpeed; this.accel = config.wanderAcceleration; this.decel = 1000;
  }
  isAlive(): boolean { return this.life === 'alive'; }
  isDamageable(): boolean { return this.isAlive(); }
  isRenderable(): boolean { return this.life !== 'removed'; }
  isPerceptionTarget(): boolean { return this.isRenderable(); }
  getLifeState(): LifeState { return this.life; }
  getHealth(): number { return this.health; }
  isStunned(): boolean { return this.stunLeft > 1e-9; }
  getActionState(): string { return !this.isAlive() ? this.life : this.isStunned() ? 'stunned' : this.attack.getState(); }
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
    if (lethal) {
      const pose = Object.freeze(this.getPose());
      this.attack.cancel(); this.stopMovement(); this.knockback?.stop(); this.life = 'removed';
      this.deathFinished = Object.freeze({ ...this.getCenter(), elapsedSeconds: 0, id: this.id, kind: this.config.kind,
        pose, impact: snapshotBulletImpact(impact) });
      return 'killed';
    }
    if (this.stunCooldownLeft <= 1e-9) {
      this.stunLeft = this.config.knockback.hitStunSeconds; this.stunCooldownLeft = this.config.stunCooldown;
      this.attack.cancel(); this.stopMovement();
    }
    if (world && !this.knockback) this.knockback = new KnockbackMotion(this, world, this.config.knockback,
      body => world.getShapeSpeedFactor(body) > 0);
    this.knockback?.addImpact(impact);
    return 'damaged';
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
    this.stunLeft = Math.max(0, this.stunLeft - delta); this.stunCooldownLeft = Math.max(0, this.stunCooldownLeft - delta);
    const x = this.x, y = this.y;
    if (!this.isStunned() && this.direction.length() > 0) super.update(delta, input, map);
    else this.velocity.set(0, 0);
    this.knockback?.update(delta);
    this.phase += Math.hypot(this.x - x, this.y - y) * .18;
  }
  consumeDeathFinished(): ZombieDeathEvent | null { const event = this.deathFinished; this.deathFinished = null; return event; }
  getPose(): ZombiePose { return { x: this.x, y: this.y, size: this.size, facing: this.getFacingDirection(), kind: this.config.kind,
    phase: this.phase, speed: this.velocity.length(), hit: Math.exp(-this.hitAge * 12) * .8, flash: hitFlashAlpha(this.hitAge), attack: this.attack.getPoseSnapshot(), life: this.life }; }
  getRenderBounds() { return ZombieRenderer.bounds(this.getPose()); }
  draw(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { ZombieRenderer.draw(ctx, this.getPose(), ox, oy); }
  drawSilhouette(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { ZombieRenderer.draw(ctx, this.getPose(), ox, oy, true); }
  drawShadow(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { ZombieRenderer.shadow(ctx, this.getPose(), ox, oy); }
}
