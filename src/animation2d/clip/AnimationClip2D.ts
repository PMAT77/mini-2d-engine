/**
 * 通用动画片段：按归一化时间采样标量轨道，并带一组离散事件标记。
 *
 * 轨道使用与 `RollPose.getRollPose` 相同的单调三次 Hermite（Fritsch–Carlson），
 * 所以把同一份关键帧搬过来时，采样结果与旧程序化姿态逐位一致。
 * 这一层是纯数学，不依赖 RollPose、Canvas 或游戏对象。
 */

/** 动画事件种类；阶段二只用到翻滚相关标记，后续阶段可扩展。 */
export type AnimationEventKind =
  | "rollContact"
  | "rollRelease"
  | "rollDust"
  | "footPlant"
  | "punchImpactVisual"
  | "reloadGestureVisual"
  | "animationComplete";

/** 归一化时间上的一个离散事件；time 取 0–1。 */
export interface AnimationMarker {
  readonly time: number;
  readonly kind: AnimationEventKind;
}

/**
 * 一条标量轨道：关键时间点 + 值 + 由单调 Hermite 预计算的切线。
 * 采样时只做段查找与三次多项式求值，不分配对象。
 */
export interface ScalarTrack {
  readonly stops: Float64Array;
  readonly values: Float64Array;
  readonly tangents: Float64Array;
}

export interface AnimationClip2D {
  readonly id: string;
  /** 片段设计时长（秒）；阶段二只用于元数据，真实推进仍以玩法状态为准。 */
  readonly duration: number;
  readonly tracks: Readonly<Record<string, ScalarTrack>>;
  readonly markers: readonly AnimationMarker[];
}

/**
 * 单调三次 Hermite 的切线（Fritsch–Carlson），与 `RollPose.monotoneTangents` 相同：
 * 段内不过冲，极值处切线归零。
 */
function monotoneTangents(xs: readonly number[], ys: readonly number[]): Float64Array {
  const n = xs.length;
  const slopes = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) slopes[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  const tangents = new Float64Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const h0 = xs[i] - xs[i - 1];
      const h1 = xs[i + 1] - xs[i];
      const w0 = 2 * h1 + h0;
      const w1 = h1 + 2 * h0;
      tangents[i] = (w0 + w1) / (w0 / slopes[i - 1] + w1 / slopes[i]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i];
    if (Math.abs(slope) < 1e-12) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slope;
    const b = tangents[i + 1] / slope;
    const sum = a * a + b * b;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }
  return tangents;
}

/** 由关键时间点与值构建轨道；时间必须严格递增，至少 2 个点。 */
export function createScalarTrack(stops: readonly number[], values: readonly number[]): ScalarTrack {
  if (stops.length !== values.length || stops.length < 2) {
    throw new Error("createScalarTrack: stops 与 values 必须等长且至少两个点");
  }
  for (let i = 1; i < stops.length; i++) {
    if (!(stops[i] > stops[i - 1])) throw new Error("createScalarTrack: stops 必须严格递增");
  }
  return {
    stops: Float64Array.from(stops),
    values: Float64Array.from(values),
    tangents: monotoneTangents(stops, values),
  };
}

/** 在归一化时间上采样；超出两端时夹到首/末关键帧。 */
export function sampleScalarTrack(track: ScalarTrack, progress: number): number {
  const stops = track.stops;
  const count = stops.length;
  if (!Number.isFinite(progress) || progress <= stops[0]) return track.values[0];
  if (progress >= stops[count - 1]) return track.values[count - 1];

  let index = 0;
  while (index < count - 2 && progress > stops[index + 1]) index++;
  const x0 = stops[index];
  const x1 = stops[index + 1];
  const t = (progress - x0) / (x1 - x0);
  const t2 = t * t;
  const t3 = t2 * t;
  const h = x1 - x0;
  return (2 * t3 - 3 * t2 + 1) * track.values[index]
    + (t3 - 2 * t2 + t) * h * track.tangents[index]
    + (-2 * t3 + 3 * t2) * track.values[index + 1]
    + (t3 - t2) * h * track.tangents[index + 1];
}

/** 采样整条轨道集合，结果写入调用方提供的对象（复用，不分配）。 */
export function sampleTracksInto<T extends Record<string, number>>(
  clip: AnimationClip2D,
  progress: number,
  out: T,
): T {
  for (const key in clip.tracks) {
    out[key as keyof T] = sampleScalarTrack(clip.tracks[key], progress) as T[keyof T];
  }
  return out;
}
