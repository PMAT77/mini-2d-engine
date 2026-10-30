/**
 * 噪声事件总线：把世界里的声音变成可查询的数据。
 *
 * 这一层不负责播放音频，也不判断谁能听见；它只记录“什么时候、在哪里、
 * 多响、传多远”。后续的敌人听觉、声波可视化和调试面板都从这里查询，
 * 而不是各自去监听音频播放。
 *
 * 时间由调用方用 `update(delta)` 推进，单位秒；不读系统时钟，因此单测可复现。
 */

export type NoiseKind =
  | "footstep"
  | "waterStep"
  | "roll"
  | "gunshot"
  | "cluck"
  | "impact"
  | "mining";

/** 每类噪声的默认传播半径（世界像素）与响度（0–1，供未来做发现权重）。 */
export const NOISE_PROFILES: Record<NoiseKind, { radius: number; loudness: number }> = {
  footstep: { radius: 150, loudness: 0.35 },
  waterStep: { radius: 260, loudness: 0.55 },
  roll: { radius: 210, loudness: 0.5 },
  gunshot: { radius: 560, loudness: 1 },
  cluck: { radius: 240, loudness: 0.45 },
  impact: { radius: 180, loudness: 0.5 },
  mining: { radius: 320, loudness: 0.7 },
};

export interface NoiseEvent {
  /** 单调递增的序号，便于测试和回放。 */
  readonly id: number;
  readonly kind: NoiseKind;
  readonly x: number;
  readonly y: number;
  /** 传播半径（世界像素）。 */
  readonly radius: number;
  readonly loudness: number;
  /** 发出者标识，例如 "player"、"chicken:3"；只用于调试与调试面板。 */
  readonly sourceId?: string;
  /** 事件已存在的时间（秒），由 update 累加。 */
  age: number;
}

export interface NoiseEmitOptions {
  radius?: number;
  loudness?: number;
  sourceId?: string;
}

export interface NoiseQuery {
  x: number;
  y: number;
  /** 查询者自身的最远听力距离；最终取它与事件半径的较小值。 */
  maxRange?: number;
  /** 忽略比这更老的事件；默认使用 totalAge。 */
  maxAge?: number;
  minLoudness?: number;
  kinds?: readonly NoiseKind[];
}

export class NoiseSystem {
  private readonly events: NoiseEvent[] = [];
  private nextId = 1;

  constructor(
    /** 事件保留时长（秒）。 */
    private readonly maxAge = 8,
    /** 最多保留的事件数；超出时丢弃最旧的。 */
    private readonly capacity = 64,
  ) {}

  /** 记录一条噪声；坐标非法时直接忽略，返回 null。 */
  emit(kind: NoiseKind, x: number, y: number, options: NoiseEmitOptions = {}): NoiseEvent | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const profile = NOISE_PROFILES[kind];
    const radius = Math.max(0, options.radius ?? profile.radius);
    const loudness = Math.max(0, Math.min(1, options.loudness ?? profile.loudness));
    const event: NoiseEvent = {
      id: this.nextId++,
      kind,
      x,
      y,
      radius,
      loudness,
      sourceId: options.sourceId,
      age: 0,
    };
    this.events.push(event);
    while (this.events.length > this.capacity) this.events.shift();
    return event;
  }

  /** 推进事件年龄并清除过期事件；非法或负 delta 会被忽略。 */
  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    let write = 0;
    for (const event of this.events) {
      event.age += delta;
      if (event.age <= this.maxAge) this.events[write++] = event;
    }
    this.events.length = write;
  }

  /**
   * 查询某点能听到的噪声。
   * 事件半径与查询者的 maxRange 取较小值作为有效听力距离，不做遮挡判断。
   */
  query(query: NoiseQuery): NoiseEvent[] {
    const maxAge = query.maxAge ?? this.maxAge;
    const maxRange = query.maxRange ?? Number.POSITIVE_INFINITY;
    const kinds = query.kinds;
    const result: NoiseEvent[] = [];
    for (const event of this.events) {
      if (event.age > maxAge) continue;
      if (event.loudness < (query.minLoudness ?? 0)) continue;
      if (kinds && !kinds.includes(event.kind)) continue;
      const range = Math.min(event.radius, maxRange);
      if (Math.hypot(event.x - query.x, event.y - query.y) <= range) result.push(event);
    }
    // 越新越响的排在前面，方便未来敌人只处理最显著的一条。
    result.sort((a, b) => a.age - b.age || b.loudness - a.loudness);
    return result;
  }

  /** 读取当前保留的全部事件（只读视图，按发出顺序）。 */
  getEvents(): readonly NoiseEvent[] {
    return this.events;
  }

  clear(): void {
    this.events.length = 0;
  }
}
