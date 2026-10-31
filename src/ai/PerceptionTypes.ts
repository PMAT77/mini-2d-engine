import type { NoiseKind } from '../core/NoiseSystem';

/** 敌人能收到的两类世界刺激。 */
export type SenseKind = 'sight' | 'sound';

/** 统一的刺激结果：位置 + 强度，行为层不关心它是看来的还是听来的。 */
export interface Stimulus {
  readonly kind: SenseKind;
  readonly x: number;
  readonly y: number;
  /** 归一化到 0–1 的刺激强度，用于比较“哪件事更值得反应”。 */
  readonly strength: number;
  readonly sourceId?: string;
}

/** 听见的声音：保留事件 id 与响度拆分，便于去重、调试与涟漪共用。 */
export interface SoundStimulus extends Stimulus {
  readonly kind: 'sound';
  readonly eventId: number;
  readonly noiseKind: NoiseKind;
  /** 监听者到声源的真实距离。 */
  readonly distance: number;
  /** 经过距离与墙体衰减后的增益（0–1），不含原始响度。 */
  readonly gain: number;
  /** 声源与监听者之间是否被墙挡住：玩家提示据此放大位置不确定性。 */
  readonly occluded: boolean;
  /** 事件已存在的时间（秒）。 */
  readonly age: number;
}
