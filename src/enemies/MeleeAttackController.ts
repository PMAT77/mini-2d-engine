import type { Point } from '../physics/Collider';
import type { ZombieConfig } from './ZombieConfig';
export interface AttackMoment { attackId: string; occurredAt: number; facing: number; }
export interface AttackPose {
  readonly phase: 'idle' | 'anticipation' | 'strike' | 'followThrough' | 'recovery';
  readonly progress: number; readonly hand: -1 | 1;
  readonly coil: number; readonly strike: number; readonly weight: number; readonly trail: number;
}
const IDLE_POSE: AttackPose = Object.freeze({ phase: 'idle', progress: 0, hand: 1, coil: 0, strike: 0, weight: 0, trail: 0 });
const smooth = (t: number): number => t * t * (3 - 2 * t);
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
  /** 同地图读档取消未结算攻击，经过一次既定恢复时间后才能重新起手。 */
  recoverAfterLoad(now: number): void {
    this.now = now;
    this.current = { id: this.actorId + ':resume', start: now, hit: now, end: now + this.config.recovery,
      facing: 0, emitted: true, cancelled: true };
  }
  isValid(id: string): boolean { return this.current?.id === id && !this.current.cancelled; }
  isBusy(now: number): boolean { return !!this.current && now + 1e-9 < this.current.end; }
  getState(): 'idle' | 'windup' | 'recovery' {
    if (!this.current || this.now + 1e-9 >= this.current.end) return 'idle';
    return !this.current.cancelled && this.now < this.current.hit ? 'windup' : 'recovery';
  }
  getPoseSnapshot(): Readonly<AttackPose> {
    const a = this.current;
    if (!a || a.cancelled || this.now >= a.end) return IDLE_POSE;
    const hand = this.sequence % 2 ? -1 : 1;
    const swingStart = a.hit - this.config.swingSeconds, followEnd = a.hit + this.config.followThroughSeconds;
    if (this.now < swingStart) {
      const progress = Math.max(0, (this.now - a.start) / (swingStart - a.start));
      return Object.freeze({ phase: 'anticipation', progress, hand, coil: smooth(progress), strike: 0, weight: 1, trail: 0 });
    }
    if (this.now < a.hit) {
      const progress = (this.now - swingStart) / this.config.swingSeconds;
      return Object.freeze({ phase: 'strike', progress, hand, coil: 1, strike: 1 - (1 - progress) ** 3, weight: 1, trail: progress * .8 });
    }
    if (this.now < followEnd) {
      const progress = (this.now - a.hit) / this.config.followThroughSeconds;
      return Object.freeze({ phase: 'followThrough', progress, hand, coil: 1, strike: 1 + .08 * Math.sin(progress * Math.PI), weight: 1, trail: 1 - progress });
    }
    const progress = Math.min(1, (this.now - followEnd) / (a.end - followEnd));
    return Object.freeze({ phase: 'recovery', progress, hand, coil: 1, strike: 1, weight: 1 - smooth(progress), trail: 0 });
  }
  getRecoveryDeadline(): number { return this.current?.end ?? 0; }
}
