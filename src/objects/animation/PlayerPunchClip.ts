/**
 * 拳击视觉层：只覆盖上半身，不产生伤害、位移或子弹。
 *
 * 阶段四没有近战玩法，因此这个 clip 只由 PlayerAnimationController.playPunch()
 * 显式驱动，供测试与后续近战实现使用；游戏输入不会自动触发它。
 */

import type { AnimationMarker } from "../../animation2d/clip/AnimationClip2D";
import { clamp01, smoothstep } from "../../animation2d/math/angles";
import type { PoseOffsets } from "../../animation2d/pose/PoseLayers";

export const PLAYER_PUNCH_CLIP_ID = "playerPunch";
export const PLAYER_PUNCH_DURATION = 0.24;

/** 命中瞬间的归一化时间。 */
export const PLAYER_PUNCH_IMPACT = 0.45;

export const PLAYER_PUNCH_MARKERS: readonly AnimationMarker[] = [
  { time: PLAYER_PUNCH_IMPACT, kind: "punchImpactVisual" },
];

/** 0 → 1 → 0 的权重包络：快速出拳、短暂停顿、收拳。 */
export function punchAmount(progress: number): number {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return 0;
  return smoothstep(0, 0.18, p) * (1 - smoothstep(0.55, 0.95, p));
}

/**
 * 上半身偏移：右肩前旋带动手肘/手，躯干轻微前压。
 * 偏移量按身位归一化；渲染端仍由 FK 拼出两段手臂，因此不会出现“瞬移手”。
 */
export function buildPunchOffsets(amount: number): PoseOffsets {
  const w = clamp01(amount);
  if (w <= 0) return {};
  return {
    shoulderR: { rotation: -1.32 * w },
    elbowR: { rotation: 0.22 * w },
    handR: { rotation: -0.08 * w },
    torso: { x: 0.018 * w, rotation: -0.025 * w },
  };
}
