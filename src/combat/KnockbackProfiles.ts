import type { BulletImpact, KnockbackProfile } from "./CombatTypes";

/**
 * 击退参数与冲量换算。
 *
 * 这一层只回答「一次命中应该给目标多少初速度」，不关心世界坐标，也不关心目标
 * 是鸡、玩家还是未来的其它敌人。目标种类之间的差异全部落在 KnockbackProfile 上。
 */

/** V1 关闭距离衰减；保留常量是为了让未来的开关有唯一入口。 */
export const KNOCKBACK_DISTANCE_FACTOR = 1;

/** 通用默认值；与方案参数表一致，鸡与未来的轻量目标直接复用。 */
export const DEFAULT_KNOCKBACK_PROFILE: KnockbackProfile = Object.freeze({
  mass: 1,
  resistance: 0,
  maxSpeed: 360,
  damping: 7,
  stopSpeed: 10,
  hitStunSeconds: 0.14,
  deathImpulseMultiplier: 1,
  minDeathSeconds: 0.14,
  maxDeathSeconds: 0.45,
  // 指数阻尼的尾巴很长：最后 12 像素要走 0.2 秒以上，尸体看起来早就停了。
  // 把这截尾巴直接交给白烟，击杀反馈才不会拖。
  deathSettleDistance: 12,
  immuneToDisplacement: false,
});

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function assertField(condition: boolean, field: string, requirement: string): void {
  if (!condition) throw new Error(`无效击退参数: ${field} ${requirement}`);
}

/**
 * 校验并冻结一份击退参数。
 *
 * 位移公式依赖 mass > 0 与 damping > 0，死亡计时依赖 minDeathSeconds ≤ maxDeathSeconds；
 * 这些约束在构造时一次性检查，运行期不再重复判断。
 */
export function validateKnockbackProfile(profile: KnockbackProfile): KnockbackProfile {
  if (!profile || typeof profile !== "object") throw new Error("击退参数必须是对象");
  assertField(finite(profile.mass) && profile.mass > 0, "mass", "必须是正有限数值");
  assertField(finite(profile.resistance) && profile.resistance >= 0 && profile.resistance <= 1, "resistance", "必须在 0 到 1 之间");
  assertField(finite(profile.maxSpeed) && profile.maxSpeed >= 0, "maxSpeed", "必须是非负有限数值");
  assertField(finite(profile.damping) && profile.damping > 0, "damping", "必须是正有限数值");
  assertField(finite(profile.stopSpeed) && profile.stopSpeed >= 0, "stopSpeed", "必须是非负有限数值");
  assertField(finite(profile.hitStunSeconds) && profile.hitStunSeconds >= 0, "hitStunSeconds", "必须是非负有限数值");
  assertField(finite(profile.deathImpulseMultiplier) && profile.deathImpulseMultiplier >= 0, "deathImpulseMultiplier", "必须是非负有限数值");
  assertField(finite(profile.minDeathSeconds) && profile.minDeathSeconds >= 0, "minDeathSeconds", "必须是非负有限数值");
  assertField(finite(profile.maxDeathSeconds) && profile.maxDeathSeconds >= profile.minDeathSeconds, "maxDeathSeconds", "必须不小于 minDeathSeconds");
  assertField(finite(profile.deathSettleDistance) && profile.deathSettleDistance >= 0, "deathSettleDistance", "必须是非负有限数值");
  assertField(typeof profile.immuneToDisplacement === "boolean", "immuneToDisplacement", "必须是布尔值");
  return Object.freeze({ ...profile });
}

/** 基于默认值构造一份经过校验的击退参数。 */
export function createKnockbackProfile(overrides: Partial<KnockbackProfile> = {}): KnockbackProfile {
  return validateKnockbackProfile({ ...DEFAULT_KNOCKBACK_PROFILE, ...overrides });
}

/** 鸡的击退参数：轻、无抗性、干地滑行。 */
export const CHICKEN_KNOCKBACK_PROFILE: KnockbackProfile = createKnockbackProfile();

/**
 * 把一次真实命中换算成击退初速度。
 *
 * 强度只来自命中快照（武器冲量、命中速度与初始速度之比）和目标配置（质量、抗性、
 * 上限、致命倍率），与准星落在目标身上还是目标后方无关。
 */
export function computeKnockbackSpeed(impact: BulletImpact, profile: KnockbackProfile, lethal = false): number {
  if (profile.immuneToDisplacement) return 0;
  if (!finite(impact.impulse) || impact.impulse <= 0) return 0;
  const initialSpeed = finite(impact.initialSpeed) && impact.initialSpeed > 0 ? impact.initialSpeed : 0;
  const impactSpeed = finite(impact.impactSpeed) ? Math.max(0, impact.impactSpeed) : 0;
  const speedFactor = initialSpeed > 0 ? clamp(impactSpeed / initialSpeed, 0, 1) : 0;
  const fatalFactor = lethal ? Math.max(0, profile.deathImpulseMultiplier) : 1;
  const speed = (impact.impulse * speedFactor * KNOCKBACK_DISTANCE_FACTOR * (1 - profile.resistance) * fatalFactor) / profile.mass;
  if (!finite(speed)) return 0;
  return clamp(speed, 0, profile.maxSpeed);
}

/**
 * 一次命中应播放多强的受击姿态（0–1）。
 *
 * 有位移时以实际击退速度为准；免疫位移或零冲量的目标仍会得到由冲量本身决定的
 * 轻微姿态，保证「免疫击退」不等于「没有受击反馈」。姿态只是绘制输入，
 * 不参与位移与死亡结算。
 */
export function computeHitIntensity(impact: BulletImpact, profile: KnockbackProfile, appliedSpeed: number): number {
  const reference = Math.max(1, profile.maxSpeed);
  const impulse = finite(impact.impulse) ? Math.max(0, impact.impulse) : 0;
  const fromSpeed = finite(appliedSpeed) ? Math.max(0, appliedSpeed) / reference : 0;
  const fromImpulse = impulse / (reference * 1.55);
  return clamp(Math.max(fromSpeed, fromImpulse), 0, 1);
}
