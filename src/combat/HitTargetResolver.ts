import type { DamageableTarget } from './DamageableTarget';
import type { TargetBulletHit } from './CombatTypes';

export interface HitQuery { startX: number; startY: number; endX: number; endY: number; radius: number; }
export interface DamageableEntry<T extends DamageableTarget = DamageableTarget> { id: string; target: T; }
export interface DamageableHit<T extends DamageableTarget = DamageableTarget> extends TargetBulletHit { entry: DamageableEntry<T>; x: number; y: number; }

/** Pure query; Bullet retains terrain precedence and owns the eventual apply callback. */
export function resolveFirstDamageableHit<T extends DamageableTarget>(q: HitQuery, entries: readonly DamageableEntry<T>[]): DamageableHit<T> | null {
  if (![q.startX, q.startY, q.endX, q.endY, q.radius].every(Number.isFinite) || q.radius < 0) return null;
  let best: DamageableHit<T> | null = null;
  for (const entry of entries) {
    if (!entry.target.isDamageable()) continue;
    const hit = entry.target.queryBulletHit
      ? entry.target.queryBulletHit(q.startX, q.startY, q.endX, q.endY, q.radius)
      : { fraction: entry.target.hitTestSegment(q.startX, q.startY, q.endX, q.endY, q.radius) };
    const fraction = hit?.fraction;
    if (fraction == null || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
    if (!best || fraction < best.fraction) best = { ...hit, entry, fraction,
      x: q.startX + (q.endX - q.startX) * fraction, y: q.startY + (q.endY - q.startY) * fraction };
  }
  return best;
}
