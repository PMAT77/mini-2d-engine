/** 声音提示的颜色：淡白偏蓝，和金色高亮、红色受击反馈区分开。 */
export const SOUND_RIPPLE_COLOR = "#e6eefc";
/** 涟漪寿命（秒）：声音提示是瞬时的，不能像 HUD 那样常驻。 */
export const SOUND_RIPPLE_MIN_LIFE = 0.7;
export const SOUND_RIPPLE_MAX_LIFE = 0.9;
/** 同屏声音提示软上限。 */
export const SOUND_RIPPLE_MAX_COUNT = 24;
export const SOUND_RIPPLE_LINE_WIDTH = 1.4;
/** 每条涟漪最多画 3 段断续圆弧，避免读成命中标记。 */
export const SOUND_RIPPLE_SEGMENTS = 3;

/** 一次可听见的世界声音事件。 */
export interface SoundRippleCue {
  /** 世界坐标（真实声源位置；提示偏移由 resolveRippleCue 单独计算）。 */
  readonly x: number;
  readonly y: number;
  /** 听觉强度 0–1：决定透明度、弧线数量与最大半径。 */
  readonly strength: number;
  /** 监听者到声源的距离，用于决定位置模糊范围。 */
  readonly distance: number;
  /** 声源与监听者是否被墙挡住。 */
  readonly occluded: boolean;
  /** 世界噪声事件 id：同一事件只生成一条提示。 */
  readonly eventId: number;
}

export interface SoundRippleView {
  x: number;
  y: number;
  strength: number;
  distance: number;
  eventId: number;
  age: number;
  life: number;
  maxRadius: number;
  segments: number;
}

interface SoundRipple {
  x: number;
  y: number;
  strength: number;
  distance: number;
  eventId: number;
  age: number;
  life: number;
  maxRadius: number;
  segments: number;
  rotation: number;
}

/**
 * 听觉位置提示：把“听到了但没看见”的声音画成短暂、断续的淡白扩散弧。
 *
 * 只消费世界声音事件，不播放音频，也不反向影响世界感知。
 * 位置允许轻微模糊：玩家能判断大致方向，但不能靠弧心精确点射暗处的目标。
 */
export class SoundRippleSystem {
  private ripples: SoundRipple[] = [];
  /** eventId → 生成时间：同一事件不会反复生成提示。 */
  private readonly seen = new Map<number, number>();
  private clock = 0;

  /**
   * 给声音提示加一点确定性偏移：同一事件每次生成的位置一致（不是每帧抖动）。
   * 近处 0–8 像素，远处或隔墙 12–30 像素。
   */
  static resolveCue(x: number, y: number, distance: number, occluded: boolean,
    eventId: number): { x: number; y: number } {
    const spread = occluded
      ? Math.min(30, Math.max(12, 12 + distance * 0.06))
      : Math.min(8, Math.max(0, distance * 0.02));
    if (spread <= 0) return { x, y };
    const hash = SoundRippleSystem.hash(eventId);
    const angle = ((hash % 6283) / 1000);
    const magnitude = spread * (0.35 + (((hash >>> 8) % 1000) / 1000) * 0.65);
    return { x: x + Math.cos(angle) * magnitude, y: y + Math.sin(angle) * magnitude };
  }

  private static hash(value: number): number {
    return (Math.imul(value | 0, 2654435761) >>> 0);
  }

  spawn(cue: SoundRippleCue): boolean {
    if (!Number.isFinite(cue.x) || !Number.isFinite(cue.y)
      || !Number.isFinite(cue.strength) || !Number.isFinite(cue.distance)
      || !Number.isFinite(cue.eventId)) return false;
    if (this.seen.has(cue.eventId)) return false;

    this.seen.set(cue.eventId, this.clock);
    const strength = Math.max(0, Math.min(1, cue.strength));
    const hash = SoundRippleSystem.hash(cue.eventId);
    if (this.ripples.length >= SOUND_RIPPLE_MAX_COUNT) this.ripples.shift();
    this.ripples.push({
      x: cue.x,
      y: cue.y,
      strength,
      distance: cue.distance,
      eventId: cue.eventId,
      age: 0,
      life: SOUND_RIPPLE_MIN_LIFE
        + ((hash >>> 12) % 1000) / 1000 * (SOUND_RIPPLE_MAX_LIFE - SOUND_RIPPLE_MIN_LIFE),
      // 响度越高，涟漪铺得越大；但上限保持克制，不变成高亮圆环。
      maxRadius: 34 + 120 * strength,
      segments: strength >= 0.45 ? 3 : 2,
      rotation: ((hash >>> 4) % 6283) / 1000,
    });
    return true;
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.clock += delta;
    this.ripples = this.ripples.filter(ripple => (ripple.age += delta) < ripple.life);
    // 事件本身在 NoiseSystem 里最多活 8 秒，去重表留 12 秒足够，且不会无界增长。
    for (const [eventId, spawnedAt] of this.seen) {
      if (this.clock - spawnedAt > 12) this.seen.delete(eventId);
    }
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    if (!this.ripples.length) return;
    ctx.save();
    ctx.strokeStyle = SOUND_RIPPLE_COLOR;
    ctx.lineWidth = SOUND_RIPPLE_LINE_WIDTH;
    for (const ripple of this.ripples) {
      const progress = Math.min(1, ripple.age / ripple.life);
      const x = ripple.x - cameraX;
      const y = ripple.y - cameraY;
      const padding = ripple.maxRadius + 8;
      if (x + padding < 0 || y + padding < 0 || x - padding > viewWidth || y - padding > viewHeight) continue;

      const fade = 1 - progress;
      const baseAlpha = (0.10 + 0.30 * ripple.strength) * fade * fade;
      if (baseAlpha <= 0.004) continue;
      const gap = 0.42;
      const span = (Math.PI * 2) / ripple.segments - gap;
      for (let segment = 0; segment < ripple.segments; segment++) {
        const radius = ripple.maxRadius * Math.min(1, progress * 1.55 - segment * 0.18);
        if (radius <= 1) continue;
        const start = ripple.rotation + segment * (Math.PI * 2 / ripple.segments) + gap * 0.5;
        ctx.globalAlpha = baseAlpha * (1 - segment * 0.28);
        ctx.beginPath();
        ctx.arc(x, y, radius, start, start + span);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  getActiveCount(): number {
    return this.ripples.length;
  }

  getRipples(): SoundRippleView[] {
    return this.ripples.map(ripple => ({
      x: ripple.x,
      y: ripple.y,
      strength: ripple.strength,
      distance: ripple.distance,
      eventId: ripple.eventId,
      age: ripple.age,
      life: ripple.life,
      maxRadius: ripple.maxRadius,
      segments: ripple.segments,
    }));
  }

  /** 场景退出或重置时一并丢弃去重表，重进场景不继承上一局的提示。 */
  clear(): void {
    this.ripples = [];
    this.seen.clear();
    this.clock = 0;
  }
}
