/**
 * 交互控制器：管理“锁定目标 → 按住累计 → 完成一次结算”的状态。
 *
 * 不依赖 DOM、Canvas 或定时器，所有时间都来自调用方传入的游戏 delta，
 * 因此 30/60/144 FPS 下模拟时间一致，也便于纯逻辑单测。
 */

import {
  clampProgress,
  type InteractionState,
} from "./PickupTypes";
import {
  selectPickupTarget,
  TARGET_SWITCH_HYSTERESIS,
  type PickupCandidate,
} from "./PickupTargetResolver";

/** 浮点累计容差：60FPS 下 30 帧的 1/60 之和略小于 0.5。 */
const COMPLETION_EPSILON = 1e-6;

export interface InteractionFrame<T> {
  /** 本帧游戏时间（秒）。 */
  delta: number;
  /** 交互键当前是否按住。 */
  pressed: boolean;
  /** 输入被 UI/模态窗口接管或场景已退出：立即取消，且不累计进度。 */
  blocked?: boolean;
  /** 翻滚、开火、切枪等主动动作：取消进行中的交互。 */
  interrupted?: boolean;
  /** 本帧通过可见性过滤的候选，按任意顺序传入。 */
  candidates: readonly PickupCandidate<T>[];
  /** 覆盖默认的目标切换滞回（像素）。 */
  hysteresis?: number;
}

export interface InteractionSnapshot<T> {
  state: InteractionState;
  target: T | null;
  targetId: string | null;
  /** 0..1，仅 Holding/Completed 时有意义。 */
  progress: number;
  /** 当前目标的交互时长（秒）。 */
  duration: number;
}

export interface InteractionResult<T> {
  snapshot: InteractionSnapshot<T>;
  /** 本帧刚好完成的目标；同一目标只会返回一次。 */
  completed: T | null;
  /** 本帧是否有进行中的交互被取消。 */
  cancelled: boolean;
}

/** 交互状态机。泛型参数是具体掉落物类型，控制器不关心它的内部实现。 */
export class InteractionController<T> {
  private state: InteractionState = "idle";
  private targetId: string | null = null;
  private target: T | null = null;
  private duration = 0;
  private elapsed = 0;
  private wasPressed = false;
  /** 按住期间被取消/完成：必须先松开，才能开始下一次交互。 */
  private suppressUntilRelease = false;

  /** 当前快照（不推进时间，供渲染/调试读取）。 */
  getSnapshot(): InteractionSnapshot<T> {
    return this.makeSnapshot();
  }

  /** 场景退出、切场景或调试面板接管时调用。 */
  reset(): void {
    this.state = "idle";
    this.targetId = null;
    this.target = null;
    this.duration = 0;
    this.elapsed = 0;
    this.wasPressed = false;
    this.suppressUntilRelease = false;
  }

  update(frame: InteractionFrame<T>): InteractionResult<T> {
    const delta =
      Number.isFinite(frame.delta) && frame.delta > 0 ? frame.delta : 0;
    const pressed = frame.pressed === true;
    const pressedEdge = pressed && !this.wasPressed;
    const hysteresis = frame.hysteresis ?? TARGET_SWITCH_HYSTERESIS;
    let completed: T | null = null;
    let cancelled = false;

    this.wasPressed = pressed;

    if (frame.blocked) {
      cancelled = this.state === "holding";
      this.clearInteraction();
      this.suppressUntilRelease = pressed;
      return this.makeResult(null, cancelled);
    }

    if (!pressed) this.suppressUntilRelease = false;

    if (frame.interrupted && this.state === "holding") {
      cancelled = true;
      this.clearInteraction();
      this.suppressUntilRelease = pressed;
    }

    if (this.state === "idle" || this.state === "focused") {
      if (this.suppressUntilRelease) {
        this.clearInteraction();
      } else {
        this.refreshFocus(frame.candidates, hysteresis);
      }
    }

    if (pressedEdge && !this.suppressUntilRelease && this.state === "focused") {
      this.state = "holding";
      this.elapsed = 0;
    }

    if (this.state === "holding") {
      if (!pressed) {
        // 提前松开：立即取消，下次从 0 开始；本帧即可重新显示提示。
        cancelled = true;
        this.clearInteraction();
        this.suppressUntilRelease = false;
      } else {
        const current = findCandidate(frame.candidates, this.targetId);
        if (!current) {
          // 目标消失或离开有效距离：取消，而不是自动换目标。
          cancelled = true;
          this.clearInteraction();
          this.suppressUntilRelease = true;
        } else {
          this.duration = Math.max(0, current.duration);
          this.elapsed += delta;
          if (this.elapsed + COMPLETION_EPSILON >= this.duration) {
            this.elapsed = this.duration;
            this.state = "completed";
            completed = this.target;
            // 一次按住只完成一次拾取；必须松开再按。
            this.suppressUntilRelease = true;
          }
        }
      }
    }

    // 松开导致的取消发生在上面的 holding 分支里；同一帧恢复焦点提示，
    // 避免松开瞬间提示闪烁一帧。按住时被取消（suppress）则等松开后再恢复。
    if (this.state === "idle" && !this.suppressUntilRelease) {
      this.refreshFocus(frame.candidates, hysteresis);
    }

    const result = this.makeResult(completed, cancelled);
    if (completed !== null || this.state === "completed") {
      // Completed 只对外暴露一帧，内部立即回到 Idle。
      this.state = "idle";
      this.targetId = null;
      this.target = null;
      this.duration = 0;
      this.elapsed = 0;
    }
    return result;
  }

  private refreshFocus(
    candidates: readonly PickupCandidate<T>[],
    hysteresis: number,
  ): void {
    const next = selectPickupTarget(candidates, this.targetId, hysteresis);
    if (!next) {
      this.clearInteraction();
      return;
    }

    if (next.id !== this.targetId) {
      this.elapsed = 0;
    }
    this.targetId = next.id;
    this.target = next.target;
    this.duration = Math.max(0, next.duration);
    this.state = "focused";
  }

  private clearInteraction(): void {
    this.state = "idle";
    this.targetId = null;
    this.target = null;
    this.duration = 0;
    this.elapsed = 0;
  }

  private makeSnapshot(): InteractionSnapshot<T> {
    let progress = 0;
    if (this.state === "holding") {
      progress = clampProgress(this.elapsed, this.duration);
    } else if (this.state === "completed") {
      progress = 1;
    }
    return {
      state: this.state,
      target: this.target,
      targetId: this.targetId,
      progress,
      duration: this.duration,
    };
  }

  private makeResult(
    completed: T | null,
    cancelled: boolean,
  ): InteractionResult<T> {
    return {
      snapshot: this.makeSnapshot(),
      completed,
      cancelled,
    };
  }
}

function findCandidate<T>(
  candidates: readonly PickupCandidate<T>[],
  id: string | null,
): PickupCandidate<T> | null {
  if (id === null) return null;
  return candidates.find((candidate) => candidate.id === id) ?? null;
}
