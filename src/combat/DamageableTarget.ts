import type { BulletImpact, HitResult, TargetBulletHit } from './CombatTypes';
import type { KnockbackWorld } from './KnockbackMotion';

export interface DamageableTarget {
  isDamageable(): boolean;
  hitTestSegment(x0: number, y0: number, x1: number, y1: number, radius: number): number | null;
  queryBulletHit?(x0: number, y0: number, x1: number, y1: number, radius: number): TargetBulletHit | null;
  receiveHit(impact: BulletImpact, world?: KnockbackWorld): HitResult;
}
