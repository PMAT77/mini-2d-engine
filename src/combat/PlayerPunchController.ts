/** Input rhythm uses mouse timestamps (ms); action playback uses simulation time (seconds). */
export const PUNCH_FAST_MS = 240;
export const PUNCH_CHAIN_MS = 550;
export const PUNCH_RANGE = 64;
export const PUNCH_IMPACT_PROGRESS = .4;

export const PUNCH_MOVES = {
  jab:           { hand: 'left',  damage: 8,  stamina: 3, duration: .24, impulse: 100, halfAngle: 35 * Math.PI / 180 },
  cross:         { hand: 'right', damage: 12, stamina: 4, duration: .24, impulse: 100, halfAngle: 35 * Math.PI / 180 },
  rightHook:     { hand: 'right', damage: 12, stamina: 4, duration: .24, impulse: 100, halfAngle: 55 * Math.PI / 180 },
  leftHook:      { hand: 'left',  damage: 16, stamina: 5, duration: .30, impulse: 180, halfAngle: 55 * Math.PI / 180 },
  uppercut:      { hand: 'left',  damage: 20, stamina: 6, duration: .36, impulse: 220, halfAngle: 35 * Math.PI / 180 },
  heavyStraight: { hand: 'right', damage: 24, stamina: 7, duration: .42, impulse: 280, halfAngle: 35 * Math.PI / 180 },
} as const;
export type PunchMoveId = keyof typeof PUNCH_MOVES;
export interface PunchSnapshot { readonly moveId: PunchMoveId; readonly progress: number; }
export interface PunchImpact { readonly sequence: number; readonly moveId: PunchMoveId; }
interface Action { moveId: PunchMoveId; elapsed: number; hit: boolean; sequence: number; }
const finisher = (id: PunchMoveId) => id === 'leftHook' || id === 'uppercut' || id === 'heavyStraight';

/** One active punch and at most two queued punches; rendering never advances this clock. */
export class PlayerPunchController {
  private current: Action | null = null;
  private queued: PunchMoveId[] = [];
  private impacts: PunchImpact[] = [];
  private sequence = 0;
  private stage = 0;
  private firstFast = true;
  private lastPress = -Infinity;

  update(delta: number, pressTimes: readonly number[], spend: (cost: number) => boolean): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    for (const time of pressTimes) {
      if (!Number.isFinite(time) || time < this.lastPress || this.stage === 3 || this.queued.length >= 2) continue;
      const gap = time - this.lastPress;
      if (gap > PUNCH_CHAIN_MS) this.stage = 0;
      const fast = gap <= PUNCH_FAST_MS;
      let moveId: PunchMoveId;
      if (this.stage === 0 || (this.stage === 2 && !this.firstFast && !fast)) {
        moveId = 'jab'; this.stage = 1;
      } else if (this.stage === 1) {
        moveId = fast ? 'cross' : 'rightHook'; this.firstFast = fast; this.stage = 2;
      } else {
        moveId = !this.firstFast ? 'uppercut' : fast ? 'leftHook' : 'heavyStraight'; this.stage = 3;
      }
      this.lastPress = time;
      this.queued.push(moveId);
      if (!this.current && !this.startNext(spend)) return;
    }
    let remaining = delta;
    while (this.current) {
      const action = this.current, move = PUNCH_MOVES[action.moveId];
      const step = Math.min(remaining, move.duration - action.elapsed);
      action.elapsed += step; remaining = Math.max(0, remaining - step);
      if (!action.hit && action.elapsed + 1e-9 >= move.duration * PUNCH_IMPACT_PROGRESS) {
        action.hit = true;
        this.impacts.push({ sequence: action.sequence, moveId: action.moveId });
      }
      if (action.elapsed + 1e-9 < move.duration) break;
      this.current = null;
      if (finisher(action.moveId)) { this.stage = 0; this.lastPress = -Infinity; }
      if (!this.startNext(spend) || remaining <= 0) break;
    }
  }

  private startNext(spend: (cost: number) => boolean): boolean {
    const moveId = this.queued.shift();
    if (!moveId) return false;
    if (!spend(PUNCH_MOVES[moveId].stamina)) {
      this.current = null; this.queued = []; this.stage = 0; this.lastPress = -Infinity;
      return false;
    }
    this.current = { moveId, elapsed: 0, hit: false, sequence: ++this.sequence };
    return true;
  }

  snapshot(): PunchSnapshot | null {
    return this.current ? { moveId: this.current.moveId,
      progress: Math.min(1, this.current.elapsed / PUNCH_MOVES[this.current.moveId].duration) } : null;
  }
  consumeImpacts(): readonly PunchImpact[] { const events = this.impacts; this.impacts = []; return events; }
  cancel(): void {
    this.current = null; this.queued = []; this.impacts = [];
    this.stage = 0; this.lastPress = -Infinity;
  }
}
