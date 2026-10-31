import { lightStrengthAt } from "../vision/IlluminationProbe";
import type { PerceptionLight, SightMap } from "../vision/VisionTypes";
import { hasLineOfSight } from "../vision/SightGeometry";
import { DEFAULT_SENSE_RULES, type SenseRules } from "./SenseRules";

const TAU = Math.PI * 2;
/** 目标被视为“被照亮”的照度门槛，与玩家辨识阈值同量级；敌人规则独立，不读 VisionRules。 */
const DEFAULT_ILLUMINATION_THRESHOLD = 0.3;

export interface VisionViewer {
  x: number;
  y: number;
  /** 实体真实朝向（不是 currentRotation，小鸡是 currentRotation - PI）。 */
  facing: number;
}

export interface VisionTarget {
  x: number;
  y: number;
}

export interface VisionSample {
  /** 本帧几何上是否看得见（尚未满足确认时间）。 */
  detected: boolean;
  /** 连续看见超过 confirmSeconds，可以触发警觉。 */
  visible: boolean;
  distance: number;
  illuminated: boolean;
}

const normalizeAngle = (angle: number): number => {
  let value = angle % TAU;
  if (value <= -Math.PI) value += TAU;
  if (value > Math.PI) value -= TAU;
  return value;
};

/** 单点有效照度：只取最强光源，且要求光源到目标本身有视线（墙后开灯照不到人）。 */
function illuminationAt(
  map: SightMap,
  x: number,
  y: number,
  lights: readonly PerceptionLight[]
): number {
  let best = 0;
  for (const light of lights) {
    if (!light.active || !light.revealsDetails) continue;
    const strength = lightStrengthAt(light, x, y);
    if (strength <= best) continue;
    if (!hasLineOfSight(map, light.x, light.y, x, y)) continue;
    best = strength;
  }
  return best;
}

/**
 * 轻量敌人视觉：不做地图探索、地形记忆或剪影渲染，只回答“这一刻看不看得见目标”。
 *
 * 规则：近距全向、远距锥形；黑暗缩短视距；整段检测都要求目标有视线。
 * 连续看见不足 confirmSeconds 不算确认，用于避免掠过视野边缘就惊动。
 */
export class VisionSensor {
  private readonly rules: SenseRules;
  private readonly illuminationThreshold: number;
  private seenSeconds = 0;

  constructor(rules: SenseRules = DEFAULT_SENSE_RULES, illuminationThreshold = DEFAULT_ILLUMINATION_THRESHOLD) {
    this.rules = rules;
    this.illuminationThreshold = illuminationThreshold;
  }

  reset(): void {
    this.seenSeconds = 0;
  }

  sense(
    delta: number,
    map: SightMap | undefined,
    viewer: VisionViewer,
    target: VisionTarget,
    lights: readonly PerceptionLight[] = []
  ): VisionSample {
    const distance = Math.hypot(target.x - viewer.x, target.y - viewer.y);
    const hidden: VisionSample = { detected: false, visible: false, distance, illuminated: false };
    if (!map || !Number.isFinite(distance) || !Number.isFinite(viewer.x) || !Number.isFinite(viewer.y)) {
      this.seenSeconds = 0;
      return hidden;
    }

    const illuminated = illuminationAt(map, target.x, target.y, lights) >= this.illuminationThreshold;
    const range = illuminated ? this.rules.visionRange : this.rules.darkVisionRange;
    if (distance > range) {
      this.seenSeconds = 0;
      return { ...hidden, illuminated };
    }

    if (!hasLineOfSight(map, viewer.x, viewer.y, target.x, target.y)) {
      this.seenSeconds = 0;
      return { ...hidden, illuminated };
    }

    const near = distance <= this.rules.nearSenseRadius;
    let inCone = near;
    if (!inCone) {
      const halfAngle = this.rules.farHalfAngleDeg * (Math.PI / 180);
      const angle = normalizeAngle(Math.atan2(target.y - viewer.y, target.x - viewer.x) - viewer.facing);
      inCone = Math.abs(angle) <= halfAngle;
    }
    if (!inCone) {
      this.seenSeconds = 0;
      return { ...hidden, illuminated };
    }

    this.seenSeconds += Number.isFinite(delta) && delta > 0 ? delta : 0;
    return {
      detected: true,
      visible: this.seenSeconds >= this.rules.confirmSeconds,
      distance,
      illuminated,
    };
  }
}
