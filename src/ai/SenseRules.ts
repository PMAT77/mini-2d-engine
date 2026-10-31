/**
 * 敌人感知的规则参数。
 *
 * 与 src/vision/VisionRules.ts 分开：那里描述玩家视野（探索、记忆、辨识渲染），
 * 这里只回答敌人“能不能发现/听见”；确认时间的语义也不同，不能共用同一个值。
 */
export interface SenseRules {
  /** 听觉判定门槛：响度 × 增益 × 遮挡衰减后仍高于它才算听见。 */
  hearingThreshold: number;
  /** 隔墙声音的额外衰减系数。 */
  wallAttenuation: number;
  /** 声音事件的新鲜窗口：超过这个年龄不再触发新的感知。 */
  freshnessSeconds: number;
  /** 近身全向感知半径：这个距离内只要有视线就能发现。 */
  nearSenseRadius: number;
  /** 明亮环境下的视觉距离。 */
  visionRange: number;
  /** 黑暗中的视觉距离。 */
  darkVisionRange: number;
  /** 远距离视锥的半角（度）。 */
  farHalfAngleDeg: number;
  /** 近身感知的半角（度），180 表示全向。 */
  nearHalfAngleDeg: number;
  /** 持续发现多久才确认威胁（秒）。 */
  confirmSeconds: number;
  /** 逃跑速度上限（px/s）。 */
  fleeSpeed: number;
  /** 逃跑加速度（px/s²），与漫游加速度分开，保证受惊后立刻动起来。 */
  fleeAcceleration: number;
}

export const DEFAULT_SENSE_RULES: SenseRules = {
  hearingThreshold: 0.08,
  wallAttenuation: 0.4,
  freshnessSeconds: 0.3,
  nearSenseRadius: 75,
  visionRange: 200,
  darkVisionRange: 120,
  farHalfAngleDeg: 120,
  nearHalfAngleDeg: 180,
  confirmSeconds: 0.12,
  fleeSpeed: 130,
  fleeAcceleration: 1000,
};

/** 合并覆盖项并校验；非法值直接抛错，避免把 NaN 带进感知判断。 */
export function createSenseRules(overrides: Partial<SenseRules> = {}): SenseRules {
  const rules: SenseRules = { ...DEFAULT_SENSE_RULES, ...overrides };

  for (const key of Object.keys(DEFAULT_SENSE_RULES) as (keyof SenseRules)[]) {
    const value = rules[key];
    if (!Number.isFinite(value)) throw new Error(`SenseRules.${key} must be a finite number`);
    if (value < 0) throw new Error(`SenseRules.${key} must be >= 0`);
  }

  if (rules.hearingThreshold <= 0) throw new Error('SenseRules.hearingThreshold must be > 0');
  if (rules.wallAttenuation > 1) throw new Error('SenseRules.wallAttenuation must be <= 1');
  if (rules.freshnessSeconds <= 0) throw new Error('SenseRules.freshnessSeconds must be > 0');
  if (rules.nearSenseRadius <= 0) throw new Error('SenseRules.nearSenseRadius must be > 0');
  if (rules.visionRange <= 0) throw new Error('SenseRules.visionRange must be > 0');
  if (rules.darkVisionRange <= 0) throw new Error('SenseRules.darkVisionRange must be > 0');
  if (rules.farHalfAngleDeg > 180) throw new Error('SenseRules.farHalfAngleDeg must be <= 180');
  if (rules.nearHalfAngleDeg > 180) throw new Error('SenseRules.nearHalfAngleDeg must be <= 180');
  if (rules.fleeSpeed <= 0) throw new Error('SenseRules.fleeSpeed must be > 0');

  return rules;
}
