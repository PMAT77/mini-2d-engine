import type { BulletImpact, HitResult } from './CombatTypes';
import type { KnockbackWorld } from './KnockbackMotion';

export interface DamageableTarget {
  isDamageable(): boolean;
  hitTestSegment(x0: number, y0: number, x1: number, y1: number, radius: number): number | null;
  receiveHit(impact: BulletImpact, world?: KnockbackWorld): HitResult;
}
