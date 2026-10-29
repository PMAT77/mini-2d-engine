import type { TileMap } from "../map/TileMap";
import { WATER_TYPES } from "../map/WaterTerrain";
import { circleCollider } from "../physics/Collider";

/** 弹坑完整显示的时长（秒）。 */
export const CRATER_HOLD_SECONDS = 3;
/** 弹坑淡出的时长（秒）。 */
export const CRATER_FADE_SECONDS = 0.8;
/** 弹坑最小、最大半径（世界像素）。 */
export const CRATER_MIN_RADIUS = 3;
export const CRATER_MAX_RADIUS = 5;
/** 同屏弹坑软上限，避免极端射速下无界增长。 */
const CRATER_MAX_COUNT = 96;
const TAU = Math.PI * 2;

export type CraterShape = "circle" | "irregular";

/** 供测试和调试读取的弹坑快照。 */
export interface CraterView {
  x: number;
  y: number;
  radius: number;
  depth: number;
  shape: CraterShape;
  alpha: number;
}

interface Crater {
  x: number;
  y: number;
  radius: number;
  depth: number;
  shape: CraterShape;
  age: number;
  /** 不规则轮廓的单位顶点，绘制时乘以半径。 */
  vertices?: { x: number; y: number }[];
}

/**
 * 地面弹坑装饰：只在干燥地面生成，完整保留 3 秒后淡出。
 * 纯视觉层，不参与碰撞、拾取、挡光或子弹阻挡。
 */
export class CraterSystem {
  private craters: Crater[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * 尝试在落点生成弹坑；贴墙或贴岸线时自动缩小。
   * @returns 是否成功放置
   */
  spawn(x: number, y: number, map: TileMap): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const target = CRATER_MIN_RADIUS + (CRATER_MAX_RADIUS - CRATER_MIN_RADIUS) * this.random();
    if (!Number.isFinite(target) || target <= 0) return false;
    // 轮廓最多到半径，再留 3 像素余量，保证不会压到墙顶或水面。
    for (let radius = target; radius >= CRATER_MIN_RADIUS; radius *= 0.8) {
      if (!this.isDryGround(map, x, y, radius + 3)) continue;
      if (this.craters.length >= CRATER_MAX_COUNT) this.craters.shift();
      this.craters.push(this.createCrater(x, y, radius));
      return true;
    }
    return false;
  }

  /** 整个圆形脚印必须位于干燥、可通行且非水域的地形内。 */
  private isDryGround(map: TileMap, x: number, y: number, radius: number): boolean {
    let covered = 0;
    for (const patch of map.getTerrainCoverage(circleCollider(x, y, radius))) {
      const terrain = map.terrainMap.get(patch.type);
      if (!terrain?.walkable || WATER_TYPES.includes(patch.type)) return false;
      covered += patch.fraction;
    }
    return covered >= 1 - 1e-6;
  }

  private createCrater(x: number, y: number, radius: number): Crater {
    const depth = 0.3 + this.random() * 0.7;
    const shape: CraterShape = this.random() < 0.6 ? "irregular" : "circle";
    let vertices: { x: number; y: number }[] | undefined;
    if (shape === "irregular") {
      const count = 12 + Math.floor(this.random() * 7);
      vertices = [];
      for (let i = 0; i < count; i++) {
        const angle = i / count * TAU;
        const factor = 0.65 + this.random() * 0.35;
        vertices.push({ x: Math.cos(angle) * factor, y: Math.sin(angle) * factor });
      }
    }
    return { x, y, radius, depth, shape, age: 0, vertices };
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const total = CRATER_HOLD_SECONDS + CRATER_FADE_SECONDS;
    this.craters = this.craters.filter(crater => (crater.age += delta) < total);
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    for (const crater of this.craters) {
      const alpha = CraterSystem.getAlpha(crater.age);
      if (alpha <= 0) continue;
      const x = crater.x - cameraX, y = crater.y - cameraY;
      const padding = crater.radius + 12;
      if (x + padding < 0 || y + padding < 0 || x - padding > viewWidth || y - padding > viewHeight) continue;

      ctx.save();
      ctx.globalAlpha = alpha;

      const gradient = ctx.createRadialGradient(
        x - crater.radius * 0.18, y - crater.radius * 0.18, crater.radius * 0.05,
        x, y, crater.radius,
      );
      gradient.addColorStop(0, `rgba(0, 0, 1, ${0.7 + crater.depth * 0.2})`);
      gradient.addColorStop(0.55, `rgba(4, 4, 4, ${0.55 + crater.depth * 0.2})`);
      gradient.addColorStop(0.82, "rgba(18, 15, 12, 0.32)");
      gradient.addColorStop(1, "rgba(50, 42, 30, 0)");
      this.tracePath(ctx, crater, x, y);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.restore();
    }
  }

  private tracePath(ctx: CanvasRenderingContext2D, crater: Crater, x: number, y: number): void {
    ctx.beginPath();
    if (crater.shape === "circle" || !crater.vertices) {
      ctx.arc(x, y, crater.radius, 0, TAU);
      return;
    }
    crater.vertices.forEach((point, index) => {
      const px = x + point.x * crater.radius, py = y + point.y * crater.radius;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  getActiveCount(): number {
    return this.craters.length;
  }

  getCraters(): CraterView[] {
    return this.craters.map(crater => ({
      x: crater.x, y: crater.y, radius: crater.radius, depth: crater.depth,
      shape: crater.shape, alpha: CraterSystem.getAlpha(crater.age),
    }));
  }

  clear(): void {
    this.craters = [];
  }

  private static getAlpha(age: number): number {
    if (age <= CRATER_HOLD_SECONDS) return 1;
    const progress = (age - CRATER_HOLD_SECONDS) / CRATER_FADE_SECONDS;
    if (progress >= 1) return 0;
    return 1 - progress * progress * (3 - 2 * progress);
  }
}
