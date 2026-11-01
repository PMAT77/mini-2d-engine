import type { Point } from '../physics/Collider';
import type { ZombieConfig } from './ZombieConfig';
export interface AttackMoment { attackId: string; occurredAt: number; facing: number; }
interface Attack { id: string; start: number; hit: number; end: number; facing: number; emitted: boolean; cancelled: boolean; }
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Circle/sector intersection; range is measured from the attacker's center exactly once. */
export function sectorIntersectsCircle(origin: Point, facing: number, range: number, halfAngle: number, target: Point, radius: number): boolean {
  const dx = target.x - origin.x, dy = target.y - origin.y, distance = Math.hypot(dx, dy);
  if (![dx, dy, facing, range, halfAngle, radius].every(Number.isFinite) || range < 0 || radius < 0 || halfAngle < 0) return false;
  const angle = wrap(Math.atan2(dy, dx) - facing);
  if (Math.abs(angle) <= halfAngle && distance <= range + radius) return true;
  for (const sign of [-1, 1]) {
    const direction = facing + sign * halfAngle, x = Math.cos(direction), y = Math.sin(direction);
    const t = Math.max(0, Math.min(range, dx * x + dy * y));
    if (Math.hypot(dx - x * t, dy - y * t) <= radius + 1e-9) return true;
  }
  return false;
}

export class MeleeAttackController {
  private sequence = 0;
  private current: Attack | null = null;
  private now = 0;
  constructor(private readonly actorId: string, private readonly config: Readonly<ZombieConfig>) {}
  canStart(now: number): boolean { return !this.current || now + 1e-9 >= this.current.end; }
  start(now: number, facing: number): boolean {
    if (!this.canStart(now)) return false;
    this.now = now;
    this.current = { id: `${this.actorId}:${++this.sequence}`, start: now, hit: now + this.config.windup,
      end: now + this.config.windup + this.config.recovery, facing, emitted: false, cancelled: false };
    return true;
  }
  advance(now: number): AttackMoment | null {
    this.now = now;
    const a = this.current;
    if (!a || a.cancelled || a.emitted || now + 1e-9 < a.hit) return null;
    a.emitted = true;
    return { attackId: a.id, occurredAt: a.hit, facing: a.facing };
  }
  cancel(): void { if (this.current) this.current.cancelled = true; }
  isValid(id: string): boolean { return this.current?.id === id && !this.current.cancelled; }
  isBusy(now: number): boolean { return !!this.current && now + 1e-9 < this.current.end; }
  getState(): 'idle' | 'windup' | 'recovery' {
    if (!this.current || this.now + 1e-9 >= this.current.end) return 'idle';
    return !this.current.cancelled && this.now < this.current.hit ? 'windup' : 'recovery';
  }
  getPoseAmount(): number {
    const a = this.current;
    if (!a || a.cancelled || this.now >= a.end) return 0;
    return this.now < a.hit ? Math.min(1, (this.now - a.start) / this.config.windup) : Math.max(0, 1 - (this.now - a.hit) / this.config.recovery);
  }
  getRecoveryDeadline(): number { return this.current?.end ?? 0; }
}
