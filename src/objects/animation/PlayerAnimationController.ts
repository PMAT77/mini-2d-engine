/**
 * 翻滚相位与事件：只描述“现在处于哪一段”，不推进任何时钟。
 * 进度来自玩法（`Player.rollTimeLeft`），所以 mix/事件都不会与物理不同步。
 */

import { AnimationEventQueue2D } from "../../animation2d/clip/AnimationEventQueue2D";
import { clamp01 } from "../../animation2d/math/angles";
import {
  PLAYER_PUNCH_CLIP_ID,
  PLAYER_PUNCH_DURATION,
  PLAYER_PUNCH_MARKERS,
} from "./PlayerPunchClip";
import { PLAYER_ROLL_CLIP } from "./PlayerRollClip";

export type PlayerAnimationPhase = "idle" | "rollEnter" | "rollLoop" | "rollExit";

export function resolvePlayerAnimationPhase(rolling: boolean, progress: number): PlayerAnimationPhase {
  if (!rolling || progress <= 0) return "idle";
  if (progress < .12) return "rollEnter";
  if (progress >= .84) return "rollExit";
  return "rollLoop";
}

export class PlayerAnimationController {
  readonly events = new AnimationEventQueue2D();
  /** 拳击是纯视觉动作，独立队列，不与翻滚事件混在一起。 */
  readonly punchEvents = new AnimationEventQueue2D();
  private currentPhase: PlayerAnimationPhase = "idle";
  private currentProgress = 0;
  private punchTime = 0;

  get phase(): PlayerAnimationPhase {
    return this.currentPhase;
  }

  get progress(): number {
    return this.currentProgress;
  }

  get punchActive(): boolean {
    return this.punchTime > 0;
  }

  get punchProgress(): number {
    if (this.punchTime <= 0) return 0;
    return clamp01(1 - this.punchTime / PLAYER_PUNCH_DURATION);
  }

  /**
   * 请求一次视觉拳击。正在出拳时忽略重复请求，避免动画被连续点击重开。
   * 只由显式调用驱动，不接游戏输入；不产生伤害、位移或子弹。
   */
  playPunch(): boolean {
    if (this.punchTime > 0) return false;
    this.punchTime = PLAYER_PUNCH_DURATION;
    this.punchEvents.reset();
    return true;
  }

  /** 每帧至多一次；非翻滚时清空事件起点，避免下一段从旧进度补发。 */
  update(progress: number, rolling: boolean, delta = 0): void {
    if (!Number.isFinite(progress)) return;
    const clamped = clamp01(progress);
    this.currentPhase = resolvePlayerAnimationPhase(rolling, clamped);
    this.currentProgress = rolling ? clamped : 0;
    this.advancePunch(Number.isFinite(delta) && delta > 0 ? delta : 0);
    if (!rolling) {
      this.events.reset();
      return;
    }
    this.events.update(clamped, PLAYER_ROLL_CLIP.markers, PLAYER_ROLL_CLIP.id);
  }

  private advancePunch(delta: number): void {
    if (this.punchTime <= 0 || delta <= 0) return;
    this.punchTime = Math.max(0, this.punchTime - delta);
    const progress = this.punchTime > 0 ? clamp01(1 - this.punchTime / PLAYER_PUNCH_DURATION) : 1;
    this.punchEvents.update(progress, PLAYER_PUNCH_MARKERS, PLAYER_PUNCH_CLIP_ID);
    if (this.punchTime < 1e-9) this.punchTime = 0;
  }

  reset(): void {
    this.currentPhase = "idle";
    this.currentProgress = 0;
    this.punchTime = 0;
    this.events.reset();
    this.punchEvents.reset();
  }
}
