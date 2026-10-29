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
  animation?: { breathingAmplitude?: number; breathingSpeed?: number };
  shooting?: Partial<typeof DEFAULT_BALLISTICS> & {
    damage?: number; fireRate?: number; bulletSpeed?: number; maxShootingTime?: number; maxOverheatCooldownTime?: number;
    /** @deprecated Accepted for old files; mouse aiming is immediate. */
    aimTurnDuration?: number;
    /** @deprecated Accepted for old files; mouse aiming never times out. */
    aimContinuityWindow?: number;
  };
  ui?: { fadeSpeed?: number };
}

export const DEFAULT_MOVEMENT = { startSpeedRatio: 0, startupDuration: 0.08, turnDamping: 0.012, stopDuration: 0.2 };
export const DEFAULT_SPRINT = {
  speedMultiplier: 1.6, rampDuration: 0.16, maxStamina: 100, drainPerSecond: 25,
  regenPerSecond: 35, regenDelay: 0.6, restartThreshold: 0.15,
};

/** Validate the whole JSON before applying any field, so a bad file cannot partially update a player. */
export function parsePlayerConfig(value: unknown): PlayerConfig {
  const groups: Record<string, string[]> = {
    base: ["size", "maxHealth", "maxSpeed", "accel", "decel", "nonlinearFactor", "rotationSpeed", "rotationStrategy"],
    movement: Object.keys(DEFAULT_MOVEMENT),
    sprint: Object.keys(DEFAULT_SPRINT),
    animation: ["breathingAmplitude", "breathingSpeed"],
    shooting: ["damage", "fireRate", "bulletSpeed", "maxShootingTime", "maxOverheatCooldownTime", "aimContinuityWindow", "aimTurnDuration", ...Object.keys(DEFAULT_BALLISTICS)],
    ui: ["fadeSpeed"],
    bulletWaterDrag: Object.keys(DEFAULT_BULLET_WATER_DRAG),
  };
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
        const allowZero = group === "bulletWaterDrag" || ["maxSpeed", "breathingAmplitude", "breathingSpeed", "nonlinearFactor", "startSpeedRatio", "startupDuration", "turnDamping", "stopDuration", "rampDuration", "regenDelay", "aimTurnDuration", "spreadHorizontal", "spreadVertical", "maxSpreadHorizontal", "maxSpreadVertical", "recoilPerShot", "recoilRecoveryDelay"].includes(key);
        if (typeof field !== "number" || !Number.isFinite(field) || (allowZero ? field < 0 : field <= 0)) {
          throw new Error(`无效配置值: ${group}.${key} 必须是${allowZero ? "非负" : "正"}有限数值`);
        }
        if ((key === "startSpeedRatio" || key === "restartThreshold") && field > 1) throw new Error(`${group}.${key} 不能大于 1`);
        if (key === "speedMultiplier" && field <= 1) throw new Error("sprint.speedMultiplier 必须大于 1");
        if ((key.includes('Spread') || key.startsWith('spread')) && field >= 45) throw new Error(`${group}.${key} 必须小于 45 度`);
        if (key === 'recoilPerShot' && field > 1) throw new Error('recoilPerShot 不能大于 1');
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
  return value as PlayerConfig;
}
