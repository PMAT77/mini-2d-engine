/**
 * 玩家翻滚片段：把 `RollPose` 的 12 个关键帧转成 41 条标量轨道。
 *
 * 为什么轨道建在“RollPose 参数空间”而不是逐骨变换空间：
 * 骨架里的旋转由端点 atan2 派生，逐骨 Hermite 与旧 `getRollPose` 不可能逐位一致，
 * 而阶段二的验收门槛是翻滚逐帧 ≤1e-6。因此这里采样参数，再交给适配器映射到骨架。
 */

import { clamp01, clamp } from "../../animation2d/math/angles";
import {
  createScalarTrack,
  sampleScalarTrack,
  type AnimationClip2D,
  type AnimationMarker,
  type ScalarTrack,
} from "../../animation2d/clip/AnimationClip2D";
import { ROLL_POSE_STOP_POSES, ROLL_POSE_STOPS, ROLL_REST_POSE, type RollPose } from "../RollPose";

export const PLAYER_ROLL_CLIP_ID = "playerRoll";

/** 与 RollPose 的关键帧一一对应；时间取归一化进度。 */
export const PLAYER_ROLL_MARKERS: readonly AnimationMarker[] = [
  { time: .34, kind: "rollContact" },
  { time: .5, kind: "rollDust" },
  { time: .58, kind: "rollRelease" },
];

const POSE_KEYS = Object.keys(ROLL_REST_POSE) as (keyof RollPose)[];

function buildTracks(): Record<string, ScalarTrack> {
  const tracks: Record<string, ScalarTrack> = {};
  for (const key of POSE_KEYS) {
    const values = ROLL_POSE_STOP_POSES.map(pose => pose[key]);
    tracks[key] = createScalarTrack(ROLL_POSE_STOPS, values);
  }
  return tracks;
}

export const PLAYER_ROLL_CLIP: AnimationClip2D = {
  id: PLAYER_ROLL_CLIP_ID,
  duration: .42,
  tracks: buildTracks(),
  markers: PLAYER_ROLL_MARKERS,
};

/**
 * 采样共享 scratch，字段与 `getRollPose(progress)` 完全同序同值。
 * 调用方若需要跨帧保留，必须自己拷贝。
 */
const scratch = {} as RollPose;

export function sampleRollPose(progress: number): RollPose {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) {
    Object.assign(scratch, ROLL_REST_POSE);
    return scratch;
  }
  for (const key of POSE_KEYS) {
    scratch[key] = sampleScalarTrack(PLAYER_ROLL_CLIP.tracks[key], p);
  }
  scratch.headAlpha = clamp(scratch.headAlpha, 0, 1);
  scratch.legAlpha = clamp(scratch.legAlpha, 0, 1);
  scratch.shellAlpha = clamp(scratch.shellAlpha, 0, 1);
  scratch.headR = Math.max(0, scratch.headR);
  scratch.bodyRx = Math.max(0, scratch.bodyRx);
  scratch.bodyRy = Math.max(0, scratch.bodyRy);
  scratch.backR = Math.max(0, scratch.backR);
  scratch.plateR = Math.max(0, scratch.plateR);
  scratch.shellRx = Math.max(0, scratch.shellRx);
  scratch.shellRy = Math.max(0, scratch.shellRy);
  return scratch;
}
