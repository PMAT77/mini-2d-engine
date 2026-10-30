import { CircleShape, parseColliderShape } from "../physics/Collider";

/** Skins and weapons never supply the player's physical outline. */
export function parsePlayerCollider(value: unknown): CircleShape {
  const shape = parseColliderShape(value);
  if (shape.type !== "circle" || shape.center!.some(value => value !== 0)) throw new Error("玩家碰撞主体必须是居中的圆形，外观不参与碰撞");
  return shape;
}

/** 每秒扣除的发射速度比例，0 表示该水深不产生阻力。 */
export interface BulletWaterDrag { shallow: number; water: number; deep: number; ultraDeep: number; }
export const DEFAULT_BULLET_WATER_DRAG: BulletWaterDrag = { shallow: 0.4, water: 0.8, deep: 1.6, ultraDeep: 3.2 };

export const DEFAULT_BALLISTICS = {
  maxRange: 1000,
  spreadHorizontal: 0.6, spreadVertical: 0.4,
  maxSpreadHorizontal: 3, maxSpreadVertical: 2,
  recoilPerShot: 0.18, recoilRecoveryDelay: 0.25, recoilRecoveryDuration: 0.8,
};

/** 单把枪的火力参数；主武器共享 `shooting` 里的弹道与散布设置。 */
export interface WeaponShootingConfig {
  damage?: number; fireRate?: number; bulletSpeed?: number;
  /** 弹匣容量（不含膛内那一发），必须是正整数。 */
  magazineSize?: number;
  /** 换弹时长（秒）。 */
  reloadDuration?: number;
}

export interface PlayerConfig {
  bulletWaterDrag?: Partial<BulletWaterDrag>;
  collider?: CircleShape;
  base?: {
    size?: number; maxHealth?: number; maxSpeed?: number; accel?: number; decel?: number;
    nonlinearFactor?: number; rotationSpeed?: number;
    rotationStrategy?: "cw" | "ccw" | "auto";
  };
  movement?: { startSpeedRatio?: number; startupDuration?: number; turnDamping?: number; stopDuration?: number };
  sprint?: {
    speedMultiplier?: number; rampDuration?: number; maxStamina?: number; drainPerSecond?: number;
    regenPerSecond?: number; regenDelay?: number; restartThreshold?: number;
  };
  roll?: Partial<RollConfig>;
  animation?: {
    breathingAmplitude?: number; breathingSpeed?: number;
    /** 跑步摇摆幅度，占 size 的百分比；0 关闭。 */
    runSwayAmplitude?: number;
    /** 基础移速下的摇摆角速度（弧度/秒）；0 冻结相位。 */
    runSwaySpeed?: number;
  };
  shooting?: Partial<typeof DEFAULT_BALLISTICS> & WeaponShootingConfig & {
    /** @deprecated Accepted for old files; mouse aiming is immediate. */
    aimTurnDuration?: number;
    /** @deprecated Accepted for old files; mouse aiming never times out. */
    aimContinuityWindow?: number;
  };
  /** 主武器（冲锋枪）的火力参数，缺省时沿用内置默认值。 */
  primaryShooting?: WeaponShootingConfig;
  ui?: { fadeSpeed?: number };
}

export const DEFAULT_MOVEMENT = { startSpeedRatio: 0, startupDuration: 0.08, turnDamping: 0.012, stopDuration: 0.2 };
export const DEFAULT_SPRINT = {
  speedMultiplier: 1.6, rampDuration: 0.16, maxStamina: 100, drainPerSecond: 25,
  regenPerSecond: 35, regenDelay: 0.6, restartThreshold: 0.15,
};

/** 空格翻滚：方向锁定的短冲刺，消耗体力；速度按 1−t² 衰减，总位移约为满速 × duration × 2/3。 */
export interface RollConfig {
  /** 翻滚动作时长（秒），期间方向锁定。 */
  duration: number;
  /** 相对基础移速的峰值倍率，必须大于 1。 */
  speedMultiplier: number;
  /** 动作结束后的冷却时间（秒）。 */
  cooldown: number;
  /** 每次翻滚消耗的体力；0 表示不消耗。 */
  staminaCost: number;
}
export const DEFAULT_ROLL: RollConfig = { duration: 0.3, speedMultiplier: 3, cooldown: 0.4, staminaCost: 20 };

/** 每个配置分组允许的字段；调试面板的覆盖检查也读这份清单。 */
export const PLAYER_CONFIG_GROUPS: Record<string, readonly string[]> = {
  base: ["size", "maxHealth", "maxSpeed", "accel", "decel", "nonlinearFactor", "rotationSpeed", "rotationStrategy"],
  movement: Object.keys(DEFAULT_MOVEMENT),
  sprint: Object.keys(DEFAULT_SPRINT),
  roll: Object.keys(DEFAULT_ROLL),
  animation: ["breathingAmplitude", "breathingSpeed", "runSwayAmplitude", "runSwaySpeed"],
  shooting: ["damage", "fireRate", "bulletSpeed", "magazineSize", "reloadDuration",
    "aimContinuityWindow", "aimTurnDuration", ...Object.keys(DEFAULT_BALLISTICS)],
  primaryShooting: ["damage", "fireRate", "bulletSpeed", "magazineSize", "reloadDuration"],
  ui: ["fadeSpeed"],
  bulletWaterDrag: Object.keys(DEFAULT_BULLET_WATER_DRAG),
};

/** Validate the whole JSON before applying any field, so a bad file cannot partially update a player. */
export function parsePlayerConfig(value: unknown): PlayerConfig {
  const groups = PLAYER_CONFIG_GROUPS;
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  if (!object(value)) throw new Error("玩家配置必须是 JSON 对象");
  for (const [group, fields] of Object.entries(value)) {
    if (group === "collider") { parsePlayerCollider(fields); continue; }
    if (!groups[group] || !object(fields)) throw new Error(`无效配置分组: ${group}`);
    for (const [key, field] of Object.entries(fields)) {
      if (!groups[group].includes(key)) throw new Error(`未知配置项: ${group}.${key}`);
      if (key === "rotationStrategy") {
        if (!["cw", "ccw", "auto"].includes(field as string)) throw new Error("rotationStrategy 必须是 cw、ccw 或 auto");
      } else {
        const allowZero = group === "bulletWaterDrag" || ["maxSpeed", "breathingAmplitude", "breathingSpeed", "runSwayAmplitude", "runSwaySpeed", "nonlinearFactor", "startSpeedRatio", "startupDuration", "turnDamping", "stopDuration", "rampDuration", "regenDelay", "aimTurnDuration", "cooldown", "staminaCost", "spreadHorizontal", "spreadVertical", "maxSpreadHorizontal", "maxSpreadVertical", "recoilPerShot", "recoilRecoveryDelay"].includes(key);
        if (typeof field !== "number" || !Number.isFinite(field) || (allowZero ? field < 0 : field <= 0)) {
          throw new Error(`无效配置值: ${group}.${key} 必须是${allowZero ? "非负" : "正"}有限数值`);
        }
        if ((key === "startSpeedRatio" || key === "restartThreshold") && field > 1) throw new Error(`${group}.${key} 不能大于 1`);
        if (key === "speedMultiplier" && field <= 1) throw new Error(`${group}.speedMultiplier 必须大于 1`);
        if ((key.includes('Spread') || key.startsWith('spread')) && field >= 45) throw new Error(`${group}.${key} 必须小于 45 度`);
        if (key === 'recoilPerShot' && field > 1) throw new Error('recoilPerShot 不能大于 1');
        if (key === 'magazineSize' && !Number.isInteger(field)) throw new Error('弹匣容量必须是正整数');
      }
    }
  }
  const shooting = value.shooting as PlayerConfig['shooting'];
  if (shooting) {
    for (const [base, max] of [['spreadHorizontal', 'maxSpreadHorizontal'], ['spreadVertical', 'maxSpreadVertical']] as const) {
      if (shooting[base] !== undefined && shooting[max] !== undefined && shooting[max]! < shooting[base]!) {
        throw new Error(`${max} 不能小于 ${base}`);
      }
    }
  }
  return value as PlayerConfig;}
