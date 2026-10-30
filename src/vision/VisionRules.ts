export type UnknownTerrainMode = 'outline' | 'black' | 'visible';
export type MemoryShareMode = 'none' | 'explored';

/**
 * 玩法规则，不是客户端画质。mode 也不在这里：
 * legacy/three-layer 由 GameScene/游戏模式决定，避免玩家用画质设置改变信息规则。
 */
export interface VisionRules {
  nearSenseRadius: number;
  maxObservationRange: number;
  identifyLightThreshold: number;
  identifyDwellSeconds: number;
  identifyFadeSeconds: number;
  nearRevealAlpha: number;
  unknownTerrain: UnknownTerrainMode;
  memoryShare: MemoryShareMode;
  ambientIdentifies: boolean;
  strongestLightOnly: boolean;
  explorationCellSize: number;
  explorationInterval: number;
  cullingMargin: number;
}

const UNKNOWN_TERRAIN_MODES: readonly UnknownTerrainMode[] = ['outline', 'black', 'visible'];
const MEMORY_SHARE_MODES: readonly MemoryShareMode[] = ['none', 'explored'];

export const DEFAULT_VISION_RULES: Readonly<VisionRules> = Object.freeze({
  nearSenseRadius: 100,
  maxObservationRange: 450,
  identifyLightThreshold: 0.3,
  identifyDwellSeconds: 0.12,
  identifyFadeSeconds: 0.25,
  nearRevealAlpha: 0.55,
  unknownTerrain: 'outline',
  memoryShare: 'none',
  ambientIdentifies: false,
  strongestLightOnly: true,
  explorationCellSize: 25,
  explorationInterval: 0.25,
  cullingMargin: 64
});

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** 合并并校验规则；非法值直接抛错，避免静默把感知切成不可解释的状态。 */
export function createVisionRules(overrides: Partial<VisionRules> = {}): VisionRules {
  const rules: VisionRules = { ...DEFAULT_VISION_RULES, ...overrides };
  if (!positive(rules.nearSenseRadius)) throw new Error('近身感知半径必须是正有限数值');
  if (!positive(rules.maxObservationRange)) throw new Error('最大观察范围必须是正有限数值');
  if (!Number.isFinite(rules.identifyLightThreshold) || rules.identifyLightThreshold < 0 || rules.identifyLightThreshold > 1) {
    throw new Error('辨识光照阈值必须在 0–1 内');
  }
  if (!nonNegative(rules.identifyDwellSeconds)) throw new Error('辨识确认时间必须是非负有限数值');
  if (!nonNegative(rules.identifyFadeSeconds)) throw new Error('辨识淡出时间必须是非负有限数值');
  if (!Number.isFinite(rules.nearRevealAlpha) || rules.nearRevealAlpha < 0 || rules.nearRevealAlpha > 1) {
    throw new Error('近身揭示强度必须在 0–1 内');
  }
  if (!UNKNOWN_TERRAIN_MODES.includes(rules.unknownTerrain)) throw new Error('未知地形模式无效');
  if (!MEMORY_SHARE_MODES.includes(rules.memoryShare)) throw new Error('记忆共享模式无效');
  if (!positive(rules.explorationCellSize)) throw new Error('探索格尺寸必须是正有限数值');
  if (!positive(rules.explorationInterval)) throw new Error('探索更新间隔必须是正有限数值');
  if (!nonNegative(rules.cullingMargin)) throw new Error('剔除边距必须是非负有限数值');
  return rules;
}
