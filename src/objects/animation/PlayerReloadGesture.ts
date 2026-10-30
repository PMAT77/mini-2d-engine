/**
 * 换弹手势：只做视觉层的手臂下沉，不改变换弹计时、弹药或射击间隔。
 *
 * 进度直接使用 HUD 同源的 `getReloadProgress()`；单发装填模式下每次装填
 * 都会从 0 重新开始，手势随之脉动一次，不会跨发累积。
 */

import type { PoseOffsets } from "../../animation2d/pose/PoseLayers";

/** 0–1 的包络：换弹开始与结束时为 0，中段最强。 */
export function reloadGestureAmount(isReloading: boolean, progress: number): number {
  if (!isReloading) return 0;
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.sin(Math.PI * p);
}

/** 持枪手下沉、肘部回收、躯干轻微前倾；没在换弹时返回空对象。 */
export function buildReloadOffsets(amount: number): PoseOffsets {
  const w = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  if (w <= 0) return {};
  return {
    shoulderR: { rotation: .10 * w },
    elbowR: { rotation: .16 * w },
    handR: { rotation: -.06 * w },
    torso: { rotation: .02 * w },
  };
}
