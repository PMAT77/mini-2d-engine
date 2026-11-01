import { createSenseRules } from '../ai/SenseRules';
import type { SenseRules } from '../ai/SenseRules';
import { createKnockbackProfile, validateKnockbackProfile } from '../combat/KnockbackProfiles';
import type { KnockbackProfile } from '../combat/CombatTypes';

export type ZombieKind = 'shambler' | 'runner';
export interface ZombieConfig {
  kind: ZombieKind; size: number; maxHealth: number;
  wanderSpeed: number; chaseSpeed: number; acceleration: number; wanderAcceleration: number; turnSpeed: number;
  damage: number; attackRadius: number; attackHalfAngle: number; windup: number; recovery: number;
  swingSeconds: number; followThroughSeconds: number;
  infectionChance: number; searchDuration: number; stunCooldown: number;
  visualMemory: number; hearingMemory: number; arrivalRadius: number; wanderRadius: number; searchRadius: number; wanderPause: number;
  senses: SenseRules; knockback: KnockbackProfile;
}
export function validateZombieConfig(c: ZombieConfig): Readonly<ZombieConfig> {
  if (!c || !['shambler', 'runner'].includes(c.kind)) throw new Error('无效丧尸类型');
  for (const key of Object.keys(c) as (keyof ZombieConfig)[]) {
    const v = c[key]; if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new Error(`无效丧尸参数 ${key}`);
  }
  if (!(c.size > 0 && c.maxHealth > 0 && c.attackRadius > 0 && c.chaseSpeed > 0 && c.windup > 0 && c.recovery > 0) ||
    !(c.swingSeconds > 0 && c.swingSeconds < c.windup && c.followThroughSeconds > 0 && c.followThroughSeconds < c.recovery) ||
    c.infectionChance > 1 || c.attackHalfAngle > Math.PI || c.stunCooldown < c.knockback.hitStunSeconds || c.senses.nearSenseRadius > c.senses.darkVisionRange) throw new Error('丧尸参数关系无效');
  return Object.freeze({ ...c, senses: Object.freeze(createSenseRules(c.senses)), knockback: validateKnockbackProfile(c.knockback) });
}
const common = {
  attackRadius: 60, attackHalfAngle: Math.PI / 4, stunCooldown: .45,
  visualMemory: 3, hearingMemory: 8, arrivalRadius: 25, wanderRadius: 150, searchRadius: 100, wanderPause: 1,
};
export const ZOMBIE_CONFIG: Readonly<Record<ZombieKind, Readonly<ZombieConfig>>> = Object.freeze({
  shambler: validateZombieConfig({ ...common, kind: 'shambler', size: 46, maxHealth: 55, wanderSpeed: 26, chaseSpeed: 68,
    acceleration: 380, wanderAcceleration: 160, turnSpeed: 4, damage: 12, windup: .38, recovery: .72, swingSeconds: .06, followThroughSeconds: .08, infectionChance: .12, searchDuration: 5,
    senses: createSenseRules({ nearSenseRadius: 75, visionRange: 300, darkVisionRange: 140, farHalfAngleDeg: 60, confirmSeconds: .30 }),
    knockback: createKnockbackProfile({ mass: 1.6, resistance: .20, maxSpeed: 260, hitStunSeconds: .14, minDeathSeconds: .20, maxDeathSeconds: .65 }),
  }),
  runner: validateZombieConfig({ ...common, kind: 'runner', size: 44, maxHealth: 40, wanderSpeed: 32, chaseSpeed: 205,
    acceleration: 1100, wanderAcceleration: 240, turnSpeed: 7, damage: 9, windup: .22, recovery: .55, swingSeconds: .05, followThroughSeconds: .06, infectionChance: .18, searchDuration: 7,
    senses: createSenseRules({ nearSenseRadius: 75, visionRange: 350, darkVisionRange: 170, farHalfAngleDeg: 60, confirmSeconds: .20 }),
    knockback: createKnockbackProfile({ mass: .9, resistance: .05, maxSpeed: 400, hitStunSeconds: .10, minDeathSeconds: .16, maxDeathSeconds: .55 }),
  }),
});
