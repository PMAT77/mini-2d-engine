import type { HitRegion } from './CombatTypes';
import type { ZombieKind } from '../enemies/ZombieConfig';

export const COMBO_WINDOW_SECONDS = 4;
const BASE_POINTS: Readonly<Record<ZombieKind, number>> = { shambler: 100, runner: 150 };
export type KillQuality = 'silver' | 'gold';
export interface KillFeedback {
  readonly quality: KillQuality;
  readonly points: number;
  readonly chainCount: number;
  readonly multiplier: number;
}
export interface CombatScoreSnapshot {
  readonly score: number;
  readonly kills: number;
  readonly goldKills: number;
  readonly bestChain: number;
  readonly chainCount: number;
  readonly chainRemaining: number;
  readonly multiplier: number;
}

/** 仅场景的玩家子弹致死路径调用 recordKill；UI 只读取快照。 */
export class CombatScoreSystem {
  private score = 0;
  private kills = 0;
  private goldKills = 0;
  private bestChain = 0;
  private chainCount = 0;
  private chainAge = Infinity;

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0 || !this.chainCount) return;
    this.chainAge += delta;
    if (this.chainAge > COMBO_WINDOW_SECONDS + 1e-9) this.endChain();
  }
  recordKill(kind: ZombieKind, region?: HitRegion): Readonly<KillFeedback> {
    const quality: KillQuality = region === 'head' ? 'gold' : 'silver';
    this.chainCount++;
    this.chainAge = 0;
    const multiplier = this.multiplier();
    const points = Math.round(BASE_POINTS[kind] * (quality === 'gold' ? 2 : 1) * multiplier);
    this.score += points; this.kills++;
    if (quality === 'gold') this.goldKills++;
    this.bestChain = Math.max(this.bestChain, this.chainCount);
    return Object.freeze({ quality, points, chainCount: this.chainCount, multiplier });
  }
  private multiplier(): number { return 1 + Math.min(4, Math.max(0, this.chainCount - 1)) * .25; }
  endChain(): void { this.chainCount = 0; this.chainAge = Infinity; }
  reset(): void { this.score = this.kills = this.goldKills = this.bestChain = 0; this.endChain(); }
  snapshot(): Readonly<CombatScoreSnapshot> {
    return Object.freeze({ score: this.score, kills: this.kills, goldKills: this.goldKills, bestChain: this.bestChain,
      chainCount: this.chainCount, chainRemaining: Math.max(0, COMBO_WINDOW_SECONDS - this.chainAge), multiplier: this.multiplier() });
  }
}
