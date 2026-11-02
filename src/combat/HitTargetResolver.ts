import type { DamageableTarget } from './DamageableTarget';
import type { TargetBulletHit } from './CombatTypes';
import type { Collider, Point } from '../physics/Collider';
import { sectorIntersectsCircle } from '../enemies/MeleeAttackController';

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

/** Current melee targets have circular colliders; range includes each target's radius once. */
export function resolveFirstMeleeHit<T extends DamageableTarget & { getCollider(): Collider }>(
  origin: Point, facing: number, range: number, halfAngle: number,
  entries: readonly DamageableEntry<T>[], blocked: (point: Point) => boolean,
): { entry: DamageableEntry<T>; point: Point } | null {
  let best: { entry: DamageableEntry<T>; point: Point } | null = null, distance = Infinity;
  for (const entry of entries) {
    if (!entry.target.isDamageable()) continue;
    const body = entry.target.getCollider();
    const center = { x: body.bounds.x + body.bounds.width / 2, y: body.bounds.y + body.bounds.height / 2 };
    if (!sectorIntersectsCircle(origin, facing, range, halfAngle, center, body.radius)) continue;
    const dx = center.x - origin.x, dy = center.y - origin.y, length = Math.hypot(dx, dy);
    const contact = Math.max(0, length - body.radius);
    if (contact >= distance) continue;
    const point = { x: origin.x + dx * contact / Math.max(1e-9, length), y: origin.y + dy * contact / Math.max(1e-9, length) };
    if (blocked(point)) continue;
    best = { entry, point }; distance = contact;
  }
  return best;
}
