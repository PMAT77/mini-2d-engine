import type { TileMap } from "../map/TileMap";
import { WATER_TYPES } from "../map/WaterTerrain";
import { circleCollider } from "../physics/Collider";

/** 玩家交给脚印系统的候选步点；显隐与落地由接收方决定。 */
export interface FootstepEvent {
  x: number;
  y: number;
  /** 行进方向（弧度）。 */
  angle: number;
  /** 0 干燥，1 刚从最深处出水。 */
  wetness: number;
  /** 当前这一步是否踩在水里（涉水声与出水后的湿地声靠它区分）。 */
  inWater: boolean;
}

/** 供测试和调试读取的脚印快照。 */
export interface FootprintView {
  x: number;
  y: number;
  angle: number;
  wetness: number;
  length: number;
  width: number;
  alpha: number;
  maxLife: number;
}

interface Footprint {
  x: number;
  y: number;
  angle: number;
  wetness: number;
  length: number;
  width: number;
  alpha: number;
  maxLife: number;
  age: number;
}

/** 干燥脚印完整保留后淡出的总寿命（秒）。 */
export const FOOTPRINT_DRY_SECONDS = 2.4;
/** 满湿度脚印的总寿命（秒）。 */
export const FOOTPRINT_WET_SECONDS = 6;
export const FOOTPRINT_DRY_ALPHA = 0.55;
export const FOOTPRINT_WET_ALPHA = 0.95;
/** 干燥脚印的长轴与短轴（世界像素）；湿脚印最多放大 15%。 */
export const FOOTPRINT_LENGTH = 9;
export const FOOTPRINT_WIDTH = 5;
/** 左右脚相对行进路径的横向偏移（世界像素）。 */
export const FOOTPRINT_SIDE_OFFSET = 7;
/** 同屏脚印软上限，避免长时间移动后无界增长。 */
export const FOOTPRINT_MAX_COUNT = 160;
/** 寿命前段保持清晰，之后平滑淡出。 */
const FADE_START = 0.35;
const TAU = Math.PI * 2;

/** 步点在行进方向左右一侧的落点。 */
export interface FootstepPoint {
  x: number;
  y: number;
  angle: number;
}

/**
 * 把候选步点横向偏移到身体一侧，并轻微抖动朝向；脚印与涟漪共用同一套落点。
 * 每次调用固定消耗两次随机数，顺序不能变，否则干地脚印会与旧版本错位。
 */
export function footstepPoint(step: FootstepEvent, random: () => number, side: number): FootstepPoint {
  const angle = step.angle + (random() - 0.5) * 0.12;
  const perpendicular = angle + Math.PI / 2;
  const offset = FOOTPRINT_SIDE_OFFSET + (random() - 0.5) * 1.2;
  return {
    x: step.x + Math.cos(perpendicular) * side * offset,
    y: step.y + Math.sin(perpendicular) * side * offset,
    angle,
  };
}

/**
 * 地面脚印装饰：沿玩家实际移动路径左右交替生成白色脚印，逐渐淡出。
 * 纯视觉层，不参与碰撞、拾取、挡光或子弹阻挡；离水后的湿脚印更深、更持久。
 */
export class FootprintSystem {
  private footprints: Footprint[] = [];
  private nextSide = 1;

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * 尝试在候选步点附近放下下一只脚印。
   * @returns 是否成功放置（水、墙、矿石和地图边缘返回 false）
   */
  spawn(step: FootstepEvent, map: TileMap): boolean {
    if (!step || !Number.isFinite(step.x) || !Number.isFinite(step.y)
      || !Number.isFinite(step.angle) || !Number.isFinite(step.wetness)) return false;

    const wetness = Math.max(0, Math.min(1, step.wetness));
    const side = this.nextSide;
    const { x, y, angle } = footstepPoint(step, this.random, side);
    const scale = 1 + 0.15 * wetness;
    const length = FOOTPRINT_LENGTH * scale;

    if (!this.isDryGround(map, x, y, length / 2 + 2)) return false;
    if (this.footprints.length >= FOOTPRINT_MAX_COUNT) this.footprints.shift();

    this.footprints.push({
      x, y, angle, wetness, length, width: FOOTPRINT_WIDTH * scale,
      alpha: FOOTPRINT_DRY_ALPHA + (FOOTPRINT_WET_ALPHA - FOOTPRINT_DRY_ALPHA) * wetness,
      maxLife: FOOTPRINT_DRY_SECONDS + (FOOTPRINT_WET_SECONDS - FOOTPRINT_DRY_SECONDS) * wetness,
      age: 0,
    });
    // 只有真正放下的脚印才换脚，避免岸边跳过一枚后同侧连续出现两只。
    this.nextSide = -side;
    return true;
  }

  /** 整个脚印必须位于干燥、可通行且非水域的地形内。 */
  private isDryGround(map: TileMap, x: number, y: number, radius: number): boolean {
    let covered = 0;
    for (const patch of map.getTerrainCoverage(circleCollider(x, y, radius))) {
      const terrain = map.terrainMap.get(patch.type);
      if (!terrain?.walkable || WATER_TYPES.includes(patch.type)) return false;
      covered += patch.fraction;
    }
    return covered >= 1 - 1e-6;
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.footprints = this.footprints.filter(footprint => (footprint.age += delta) < footprint.maxLife);
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    ctx.save();
    for (const footprint of this.footprints) {
      const alpha = FootprintSystem.getAlpha(footprint);
      if (alpha <= 0) continue;
      const x = footprint.x - cameraX, y = footprint.y - cameraY;
      const padding = footprint.length + 8;
      if (x + padding < 0 || y + padding < 0 || x - padding > viewWidth || y - padding > viewHeight) continue;

      const halfLength = footprint.length / 2, halfWidth = footprint.width / 2;
      const heelX = x - Math.cos(footprint.angle) * halfLength * 0.75;
      const heelY = y - Math.sin(footprint.angle) * halfLength * 0.75;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = footprint.wetness > 0 ? "#e6f7ff" : "#ffffff";
      ctx.beginPath();
      // 前掌与脚跟共用一次填充；旋转交给 ellipse，避免额外的变换状态。
      ctx.ellipse(x, y, halfLength, halfWidth, footprint.angle, 0, TAU);
      ctx.ellipse(heelX, heelY, halfWidth * 0.85, halfWidth * 0.7, footprint.angle, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  getActiveCount(): number {
    return this.footprints.length;
  }

  getFootprints(): FootprintView[] {
    return this.footprints.map(footprint => ({
      x: footprint.x, y: footprint.y, angle: footprint.angle, wetness: footprint.wetness,
      length: footprint.length, width: footprint.width,
      alpha: FootprintSystem.getAlpha(footprint), maxLife: footprint.maxLife,
    }));
  }

  clear(): void {
    this.footprints = [];
  }

  private static getAlpha(footprint: Footprint): number {
    const progress = footprint.age / footprint.maxLife;
    if (progress <= FADE_START) return footprint.alpha;
    const fade = (progress - FADE_START) / (1 - FADE_START);
    if (fade >= 1) return 0;
    return footprint.alpha * (1 - fade * fade * (3 - 2 * fade));
  }
}
