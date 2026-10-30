import { lightFalloff } from '../core/LightingSystem';
import type { PerceptionLight, PerceptionTarget, SightMap, VisionObserver } from './VisionTypes';
import type { VisionRules } from './VisionRules';
import { hasLineOfSight } from './SightGeometry';

const TAU = Math.PI * 2;
const DEFAULT_INNER_FADE = 14;

export interface IlluminationHit {
  light: PerceptionLight;
  strength: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const normalizeAngle = (angle: number): number => {
  let value = angle % TAU;
  if (value <= -Math.PI) value += TAU;
  if (value > Math.PI) value -= TAU;
  return value;
};

/**
 * 光源在世界点 (x, y) 的有效强度。
 * 与 LightingSystem/ConeLight 保持同一衰减、锥边和内圈语义；不读取 Canvas。
 */
export function lightStrengthAt(light: PerceptionLight, x: number, y: number): number {
  if (!light.active) return 0;
  if (!Number.isFinite(light.x) || !Number.isFinite(light.y)) return 0;
  if (!Number.isFinite(light.radius) || light.radius <= 0) return 0;
  const intensity = Math.min(2, Math.max(0, Number.isFinite(light.intensity) ? light.intensity : 0));
  if (intensity <= 0) return 0;

  const dx = x - light.x;
  const dy = y - light.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance >= light.radius) return 0;

  let factor = lightFalloff(distance, light.radius);

  const innerRadius = light.innerRadius ?? 0;
  if (innerRadius > 0) {
    const innerFade = light.innerFade ?? DEFAULT_INNER_FADE;
    if (!(innerFade > 0)) {
      if (distance < innerRadius) return 0;
    } else {
      const t = (distance - innerRadius) / innerFade;
      if (t <= 0) return 0;
      if (t < 1) factor *= smoothstep(t);
    }
  }

  if (light.angle !== undefined) {
    const angle = Number.isFinite(light.angle) ? Math.min(TAU, Math.max(0, light.angle)) : 0;
    if (angle <= 0) return 0;
    const half = angle / 2;
    const direction = light.direction ?? 0;
    const delta = Math.abs(normalizeAngle(Math.atan2(dy, dx) - direction));
    if (delta > half) return 0;
    const softness = Math.min(0.5, Math.max(0, light.softness ?? 0));
    const feather = Math.min(half, angle * softness);
    if (feather > 0 && delta > half - feather) factor *= smoothstep((half - delta) / feather);
  }

  return intensity * factor;
}

/**
 * 找出该点有效的最强辨识光源。只比较 revealsDetails 光源；
 * 环境光/玩家微光不在这里被当作“看清物体”的光。
 */
export function bestLightAt(
  map: SightMap,
  x: number,
  y: number,
  lights: readonly PerceptionLight[],
  rules: VisionRules
): IlluminationHit | null {
  const threshold = rules.identifyLightThreshold;
  const candidates: IlluminationHit[] = [];
  for (const light of lights) {
    if (!light.active || !light.revealsDetails) continue;
    const strength = lightStrengthAt(light, x, y);
    if (strength <= 0 || strength < threshold) continue;
    candidates.push({ light, strength });
  }
  candidates.sort((a, b) => b.strength - a.strength);
  for (const candidate of candidates) {
    if (hasLineOfSight(map, candidate.light.x, candidate.light.y, x, y)) return candidate;
  }
  return null;
}

export function bestLightForTarget(
  map: SightMap,
  target: PerceptionTarget,
  lights: readonly PerceptionLight[],
  rules: VisionRules
): IlluminationHit | null {
  return bestLightAt(map, target.x, target.y, lights, rules);
}

/** 单点照明强度：默认取最强单光源，不把多个弱光累加成“看清”。 */
export function illuminationStrengthAt(
  map: SightMap,
  x: number,
  y: number,
  lights: readonly PerceptionLight[],
  rules: VisionRules
): number {
  if (rules.strongestLightOnly) return bestLightAt(map, x, y, lights, rules)?.strength ?? 0;
  let total = 0;
  for (const light of lights) {
    if (!light.active || !light.revealsDetails) continue;
    const strength = lightStrengthAt(light, x, y);
    if (strength <= 0) continue;
    if (hasLineOfSight(map, light.x, light.y, x, y)) total += strength;
  }
  return total;
}

/** 单点是否达到辨识条件；观察者 LOS 与范围由这里一起检查。 */
export function canIdentifyPoint(
  map: SightMap,
  observer: VisionObserver,
  x: number,
  y: number,
  lights: readonly PerceptionLight[],
  rules: VisionRules
): boolean {
  const distance = Math.hypot(x - observer.x, y - observer.y);
  if (!Number.isFinite(distance) || distance > observer.maxObservationRange) return false;
  if (!hasLineOfSight(map, observer.x, observer.y, x, y)) return false;
  if (rules.ambientIdentifies) return true;
  return illuminationStrengthAt(map, x, y, lights, rules) >= rules.identifyLightThreshold;
}

/** 目标是否可被完整辨识：必须观察者 LOS + 范围 + 有效照明（含光源到目标 LOS）。 */
export function canIdentifyTarget(
  map: SightMap,
  observer: VisionObserver,
  target: PerceptionTarget,
  lights: readonly PerceptionLight[],
  rules: VisionRules
): boolean {
  return canIdentifyPoint(map, observer, target.x, target.y, lights, rules);
}
