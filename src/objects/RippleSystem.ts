import type { TileMap } from "../map/TileMap";
import { WATER_TYPES } from "../map/WaterTerrain";
import { circleCollider } from "../physics/Collider";
import { footstepPoint } from "./FootprintSystem";
import type { FootstepEvent } from "./FootprintSystem";

/** 落点校验半径，也是涟漪扩散的起始半径（世界像素）。 */
export const RIPPLE_PROBE_RADIUS = 3;
/** 浅水涟漪最终扩散到的半径；水深每高一档再加 RIPPLE_RADIUS_PER_DEPTH。 */
export const RIPPLE_BASE_RADIUS = 9;
export const RIPPLE_RADIUS_PER_DEPTH = 3.5;
/** 涟漪寿命（秒）：浅水最短，深水略长。 */
export const RIPPLE_BASE_LIFE = 0.5;
export const RIPPLE_LIFE_PER_DEPTH = 0.08;
/** 起始不透明度，以及内环的相对半径与相对不透明度。 */
export const RIPPLE_ALPHA = 0.85;
export const RIPPLE_INNER_RATIO = 0.6;
export const RIPPLE_INNER_ALPHA = 0.55;
/** 只画以行进反方向为中心的这段圆弧：总跨度 216°，缺口 144° 朝向行进方向。 */
export const RIPPLE_ARC_HALF = Math.PI * 0.6;
/** 圆心沿行进反方向漂移的距离与最大半径之比。 */
export const RIPPLE_DRIFT_RATIO = 0.35;
export const RIPPLE_COLOR = "#dff6ff";
export const RIPPLE_LINE_WIDTH = 1.2;
/** 同屏涟漪软上限，避免极端情况下无界增长。 */
export const RIPPLE_MAX_COUNT = 120;

/** 供测试和调试读取的涟漪快照。 */
export interface RippleView {
  /** 步点位置，即涟漪起点。 */
  x: number;
  y: number;
  /** 当前扩散圆心，随寿命沿行进反方向漂移。 */
  centerX: number;
  centerY: number;
  /** 步点行进方向（弧度）。 */
  angle: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  life: number;
  /** 0–3 的加权水深档。 */
  depth: number;
}

interface Ripple {
  x: number;
  y: number;
  angle: number;
  maxRadius: number;
  life: number;
  depth: number;
  age: number;
}

/**
 * 水面涟漪装饰：涉水时替代脚印，从脚落点朝脚步行进的反方向铺开一段弧线。
 * 纯视觉层，不参与碰撞、拾取、挡光或子弹阻挡。
 */
export class RippleSystem {
  private ripples: Ripple[] = [];
  private nextSide = 1;

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * 尝试在涉水步点处放下涟漪。
   * @returns 是否成功（整段涟漪压到陆地、墙、矿石或地图外时返回 false）
   */
  spawn(step: FootstepEvent, map: TileMap): boolean {
    if (!step || !Number.isFinite(step.x) || !Number.isFinite(step.y)
      || !Number.isFinite(step.angle)) return false;

    const side = this.nextSide;
    const point = footstepPoint(step, this.random, side);
    const depth = this.measureDepth(map, point.x, point.y, RIPPLE_PROBE_RADIUS);
    if (depth === undefined) return false;

    // 圆心会沿反方向漂移，校验半径取“最大半径 + 漂移量”的包络，
    // 保证整段涟漪都不会压到岸上；岸边放不下时逐级缩小，直到能整圈入水。
    let maxRadius = RIPPLE_BASE_RADIUS + RIPPLE_RADIUS_PER_DEPTH * depth;
    let envelope = maxRadius * (1 + RIPPLE_DRIFT_RATIO);
    let fits = false;
    while (envelope >= RIPPLE_PROBE_RADIUS) {
      if (this.measureDepth(map, point.x, point.y, envelope) !== undefined) {
        fits = true;
        break;
      }
      maxRadius *= 0.8;
      envelope = maxRadius * (1 + RIPPLE_DRIFT_RATIO);
    }
    if (!fits) return false;

    if (this.ripples.length >= RIPPLE_MAX_COUNT) this.ripples.shift();
    this.ripples.push({
      x: point.x, y: point.y, angle: point.angle, depth, maxRadius,
      life: RIPPLE_BASE_LIFE + RIPPLE_LIFE_PER_DEPTH * depth, age: 0,
    });
    // 与脚印一致：只有真正放下的涟漪才换脚，避免岸边跳过一枚后同侧连续出现。
    this.nextSide = -side;
    return true;
  }

  /** 加权平均水深档；只要有任何一块地形不是水、或覆盖不完整（墙、矿石、地图外）就返回 undefined。 */
  private measureDepth(map: TileMap, x: number, y: number, radius: number): number | undefined {
    let area = 0;
    let weighted = 0;
    for (const patch of map.getTerrainCoverage(circleCollider(x, y, radius))) {
      const tier = WATER_TYPES.indexOf(patch.type);
      if (tier < 0) return undefined;
      area += patch.fraction;
      weighted += tier * patch.fraction;
    }
    if (area < 1 - 1e-6) return undefined;
    return Math.max(0, Math.min(WATER_TYPES.length - 1, weighted / area));
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.ripples = this.ripples.filter(ripple => (ripple.age += delta) < ripple.life);
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    ctx.save();
    for (const ripple of this.ripples) {
      const visual = RippleSystem.getVisual(ripple);
      if (visual.alpha <= 0) continue;
      const x = visual.centerX - cameraX, y = visual.centerY - cameraY;
      const padding = ripple.maxRadius * (1 + RIPPLE_DRIFT_RATIO) + 6;
      if (x + padding < 0 || y + padding < 0 || x - padding > viewWidth || y - padding > viewHeight) continue;

      // 只画朝后的弧：缺口朝向行进方向，读作被身体推开的尾迹。
      const back = ripple.angle + Math.PI;
      ctx.globalAlpha = visual.alpha;
      ctx.strokeStyle = RIPPLE_COLOR;
      ctx.lineWidth = RIPPLE_LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(x, y, visual.radius, back - RIPPLE_ARC_HALF, back + RIPPLE_ARC_HALF);
      ctx.stroke();
      ctx.globalAlpha = visual.alpha * RIPPLE_INNER_ALPHA;
      ctx.beginPath();
      ctx.arc(x, y, visual.radius * RIPPLE_INNER_RATIO, back - RIPPLE_ARC_HALF, back + RIPPLE_ARC_HALF);
      ctx.stroke();
    }
    ctx.restore();
  }

  getActiveCount(): number {
    return this.ripples.length;
  }

  getRipples(): RippleView[] {
    return this.ripples.map(ripple => {
      const visual = RippleSystem.getVisual(ripple);
      return {
        x: ripple.x, y: ripple.y, centerX: visual.centerX, centerY: visual.centerY,
        angle: ripple.angle, radius: visual.radius, maxRadius: ripple.maxRadius,
        alpha: visual.alpha, life: ripple.life, depth: ripple.depth,
      };
    });
  }

  clear(): void {
    this.ripples = [];
  }

  /** 半径先快后慢地扩散，透明度平滑衰减，圆心沿行进反方向漂移。 */
  private static getVisual(ripple: Ripple): {
    centerX: number; centerY: number; radius: number; alpha: number;
  } {
    const progress = Math.min(1, ripple.age / ripple.life);
    const ease = 1 - (1 - progress) * (1 - progress);
    const drift = RIPPLE_DRIFT_RATIO * ripple.maxRadius * ease;
    const back = ripple.angle + Math.PI;
    return {
      centerX: ripple.x + Math.cos(back) * drift,
      centerY: ripple.y + Math.sin(back) * drift,
      radius: RIPPLE_PROBE_RADIUS + (ripple.maxRadius - RIPPLE_PROBE_RADIUS) * ease,
      alpha: RIPPLE_ALPHA * (1 - progress * progress * (3 - 2 * progress)),
    };
  }
}
