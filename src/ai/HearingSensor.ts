import { computeAudibleGain } from '../core/SoundAttenuation';
import type { NoiseEvent } from '../core/NoiseSystem';
import { hasLineOfSight } from '../vision/SightGeometry';
import type { SightMap } from '../vision/VisionTypes';
import type { SoundStimulus } from './PerceptionTypes';
import { DEFAULT_SENSE_RULES, createSenseRules } from './SenseRules';
import type { SenseRules } from './SenseRules';

/** 一个会听声音的实体：位置 + 可选的门槛覆盖。 */
export interface HearingListener {
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  /** 听觉门槛覆盖；默认取 SenseRules.hearingThreshold。 */
  readonly threshold?: number;
}

/**
 * 声音感知：把世界噪声事件换算成“这个监听者实际听到了什么”。
 *
 * 只做逻辑：不播放音频、不画涟漪。NoiseSystem 只记录事实（半径/响度/位置），
 * 是否听见取决于监听者距离、墙体遮挡与自己的听觉门槛；因此不能拿 query()
 * 的结果直接当听觉结果——那只是距离过滤。
 */
export class HearingSensor {
  private readonly rules: SenseRules;
  /** 已经处理过的最大事件 id：同一个事件不会重复触发听觉。 */
  private lastProcessedId = 0;

  constructor(rules: SenseRules = DEFAULT_SENSE_RULES) {
    this.rules = createSenseRules(rules);
  }

  poll(map: SightMap | undefined, listener: HearingListener, events: readonly NoiseEvent[]): SoundStimulus[] {
    const threshold = listener.threshold ?? this.rules.hearingThreshold;
    const heard: SoundStimulus[] = [];
    let newestId = this.lastProcessedId;

    for (const event of events) {
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) continue;
      if (event.age > this.rules.freshnessSeconds) continue;
      if (event.id <= this.lastProcessedId) continue;

      const distance = Math.hypot(listener.x - event.x, listener.y - event.y);
      let gain = computeAudibleGain(distance, event.radius);
      if (gain <= 0) continue;

      if (map && !hasLineOfSight(map, listener.x, listener.y, event.x, event.y)) {
        gain *= this.rules.wallAttenuation;
      }

      const strength = event.loudness * gain;
      if (strength < threshold) continue;

      heard.push({
        kind: 'sound',
        x: event.x,
        y: event.y,
        strength,
        sourceId: event.sourceId,
        eventId: event.id,
        noiseKind: event.kind,
        distance,
        gain,
        age: event.age,
      });
      // 只有真正可闻的事件才推进水位：后进入听觉范围的事件仍能被消费。
      if (event.id > newestId) newestId = event.id;
    }

    if (newestId > this.lastProcessedId) this.lastProcessedId = newestId;
    heard.sort((a, b) => b.strength - a.strength);
    return heard;
  }

  reset(): void {
    this.lastProcessedId = 0;
  }

  getLastProcessedId(): number {
    return this.lastProcessedId;
  }
}
