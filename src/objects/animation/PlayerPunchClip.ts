/**
 * 拳击视觉层：只覆盖上半身，不产生伤害、位移或子弹。
 *
 * 旧 playPunch() 保留为独立视觉动作；空手玩法由 PlayerPunchController 推进，
 * 本模块只采样抱架、出拳和躯干旋转，不结算伤害或自行计时。
 */

import type { AnimationMarker } from "../../animation2d/clip/AnimationClip2D";
import { clamp01, smoothstep } from "../../animation2d/math/angles";
import type { PoseOffsets } from "../../animation2d/pose/PoseLayers";
import type { RollPose } from '../RollPose';
import { PUNCH_MOVES, type PunchMoveId, type PunchSnapshot } from '../../combat/PlayerPunchController';

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

/** Hands are sampled in player-local space; the collision body and legs never move. */
const BOXING_TARGETS: Record<PunchMoveId, { wind: [number, number]; hit: [number, number]; elbow: [number, number] }> = {
  jab: { wind: [.35, -.29], hit: [1.20, -.14], elbow: [.56, -.33] },
  cross: { wind: [.16, .38], hit: [1.23, .05], elbow: [.55, .30] },
  rightHook: { wind: [.12, .67], hit: [.99, -.18], elbow: [.58, .48] },
  leftHook: { wind: [.10, -.67], hit: [.99, .18], elbow: [.58, -.48] },
  uppercut: { wind: [.15, -.58], hit: [1.12, -.03], elbow: [.55, -.36] },
  heavyStraight: { wind: [-.10, .43], hit: [1.30, -.02], elbow: [.59, .25] },
};

export function sampleBoxingPose(base: RollPose, action: PunchSnapshot | null, guard: number): RollPose {
  const pose = { ...base }, weight = clamp01(guard);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  pose.leftHandX = mix(base.leftHandX, .48, weight);
  pose.leftHandY = mix(base.leftHandY, -.28, weight);
  pose.rightHandX = mix(base.rightHandX, .37, weight);
  pose.rightHandY = mix(base.rightHandY, .30, weight);
  pose.leftElbowX = mix(base.leftElbowX, .02, weight);
  pose.leftElbowY = mix(base.leftElbowY, -.48, weight);
  pose.rightElbowX = mix(base.rightElbowX, -.06, weight);
  pose.rightElbowY = mix(base.rightElbowY, .48, weight);
  if (!action) return pose;
  const target = BOXING_TARGETS[action.moveId], left = PUNCH_MOVES[action.moveId].hand === 'left';
  const hx = left ? pose.leftHandX : pose.rightHandX, hy = left ? pose.leftHandY : pose.rightHandY;
  const ex = left ? pose.leftElbowX : pose.rightElbowX, ey = left ? pose.leftElbowY : pose.rightElbowY;
  const p = clamp01(action.progress);
  let handX: number, handY: number;
  if (p < .16) {
    const t = smoothstep(0, .16, p); handX = mix(hx, target.wind[0], t); handY = mix(hy, target.wind[1], t);
  } else if (p < .4) {
    const t = smoothstep(.16, .4, p); handX = mix(target.wind[0], target.hit[0], t); handY = mix(target.wind[1], target.hit[1], t);
    // 摆拳走外侧弧线，不与直拳共用一条直线轨迹。
    if (action.moveId === 'leftHook' || action.moveId === 'rightHook') handY += (left ? -.25 : .25) * Math.sin(t * Math.PI);
  } else {
    const t = smoothstep(.52, 1, p); handX = mix(target.hit[0], hx, t); handY = mix(target.hit[1], hy, t);
  }
  const reach = smoothstep(.16, .4, p) * (1 - smoothstep(.52, 1, p));
  if (left) {
    pose.leftHandX = handX; pose.leftHandY = handY;
    pose.leftElbowX = mix(ex, target.elbow[0], reach); pose.leftElbowY = mix(ey, target.elbow[1], reach);
  } else {
    pose.rightHandX = handX; pose.rightHandY = handY;
    pose.rightElbowX = mix(ex, target.elbow[0], reach); pose.rightElbowY = mix(ey, target.elbow[1], reach);
  }
  return pose;
}

export function boxingTorsoOffsets(action: PunchSnapshot): PoseOffsets {
  const amount = smoothstep(0, .4, action.progress) * (1 - smoothstep(.52, 1, action.progress));
  const left = PUNCH_MOVES[action.moveId].hand === 'left';
  const turn = action.moveId.includes('Hook') ? .15 : action.moveId === 'heavyStraight' ? .12 : .065;
  return { torso: { x: .018 * amount, rotation: (left ? 1 : -1) * turn * amount } };
}
