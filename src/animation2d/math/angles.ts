/**
 * 动画 2D 层的角度与数值工具。
 *
 * 这一层只做纯数学：不引入 DOM、Canvas 或游戏对象，方便 Node 单测直接加载。
 */

export const TAU = Math.PI * 2;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 与 RollPose.smoothstep 相同：edge1<=edge0 时退化成阶跃。 */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 归一化到 (-π, π]。 */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** 从 from 转到 to 的最短弧，结果在 (-π, π]。 */
export function shortestAngleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}
