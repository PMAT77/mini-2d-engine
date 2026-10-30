/**
 * 动画事件队列：把“进度跨过某个标记”转成一次性事件。
 *
 * 规则：
 * - 第一次 update 只记录起点，不补发事件；
 * - 进度不变（delta=0 或重复绘制）不产生事件；
 * - 进度回退（新一次翻滚从 0 重新计时）只重建起点，不补发；
 * - 每帧最多 8 条，事件对象复用，不分配。
 */

import type { AnimationEventKind, AnimationMarker } from "./AnimationClip2D";

export interface AnimationEvent {
  kind: AnimationEventKind;
  clipId: string;
  /** 标记在片段里的归一化时间。 */
  normalizedTime: number;
  /** 触发事件时的实际进度。 */
  progress: number;
  /** 全局单调递增序号，方便测试断言“每帧至多一次”。 */
  sequence: number;
}

const MAX_EVENTS_PER_FRAME = 8;

export class AnimationEventQueue2D {
  private readonly events: AnimationEvent[] = [];
  private eventCount = 0;
  private previous = Number.NaN;
  private hasPrevious = false;
  private sequence = 0;

  get count(): number {
    return this.eventCount;
  }

  eventAt(index: number): AnimationEvent | undefined {
    return index >= 0 && index < this.eventCount ? this.events[index] : undefined;
  }

  /** 清空起点；下一次 update 只记录进度。 */
  reset(): void {
    this.previous = Number.NaN;
    this.hasPrevious = false;
    this.eventCount = 0;
  }

  update(progress: number, markers: readonly AnimationMarker[], clipId: string): number {
    this.eventCount = 0;
    if (!Number.isFinite(progress)) return 0;
    if (!this.hasPrevious) {
      this.previous = progress;
      this.hasPrevious = true;
      return 0;
    }
    if (progress === this.previous) return 0;
    if (progress < this.previous) {
      // 新一次翻滚（或状态重置）：只重建起点，本次不补发。
      this.previous = progress;
      return 0;
    }

    const previous = this.previous;
    for (const marker of markers) {
      if (marker.time <= previous || marker.time > progress) continue;
      if (this.eventCount >= MAX_EVENTS_PER_FRAME) break;
      const event = this.events[this.eventCount] ?? (this.events[this.eventCount] = {
        kind: marker.kind,
        clipId,
        normalizedTime: marker.time,
        progress,
        sequence: 0,
      });
      event.kind = marker.kind;
      event.clipId = clipId;
      event.normalizedTime = marker.time;
      event.progress = progress;
      event.sequence = this.sequence++;
      this.eventCount++;
    }
    this.previous = progress;
    return this.eventCount;
  }
}
