import type { TileMap } from "../map/TileMap";
import { WATER_TYPES } from "../map/WaterTerrain";
import { circleCollider } from "../physics/Collider";

/** 血迹完整显示的时长（秒）。 */
export const BLOOD_HOLD_SECONDS = 4;
/** 血迹淡出的时长（秒）。 */
export const BLOOD_FADE_SECONDS = 1.6;
/**
 * 每摊血迹的最小、最大半径（世界像素）。
 * 最小直径也要宽过掉落的肉块（16 像素），肉块落在血泊正中时才不会把血迹整个盖住。
 */
export const BLOOD_MIN_RADIUS = 11;
export const BLOOD_MAX_RADIUS = 18;
/** 同屏血迹软上限，避免长时间刷鸡后无界增长。 */
const BLOOD_MAX_COUNT = 48;
/** 每摊血迹的斑块数量范围：主体几块，再加几滴溅点。 */
const BLOOD_MIN_BLOBS = 4;
const BLOOD_MAX_BLOBS = 7;
const TAU = Math.PI * 2;

/** 供测试和调试读取的血迹快照。 */
export interface BloodStainView {
  x: number;
  y: number;
  radius: number;
  /** 这摊血迹由几个斑块组成。 */
  blobs: number;
  alpha: number;
}

interface BloodBlob {
  /** 相对血迹中心的偏移。 */
  x: number;
  y: number;
  radius: number;
  /** 不规则轮廓的单位顶点，绘制时乘以半径。 */
  vertices: { x: number; y: number }[];
}

interface BloodStain {
  x: number;
  y: number;
  radius: number;
  blobs: BloodBlob[];
  age: number;
  /** 肉块还没被捡走时一直保留，不进入淡出计时。 */
  sustained: boolean;
}

/**
 * 地面血迹装饰：小鸡死亡收尾时在尸体位置留下几块不规则暗红斑块，完整保留后淡出。
 * 纯视觉层，不参与碰撞、拾取、挡光或子弹阻挡。
 */
export class BloodStainSystem {
  private stains: BloodStain[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * 尝试在尸体位置留下血迹；贴墙或贴岸线时自动缩小，缩到最小仍放不下就不留。
   * @returns 是否成功放置
   */
  spawn(x: number, y: number, map: TileMap): boolean {
    return this.place(x, y, map, false) !== null;
  }

  /**
   * 血泊与肉块绑定：只要肉块还留在地上，血迹就一直停在完整显示状态；
   * 返回的函数用于在肉块被捡走后恢复正常的保留与淡出计时。
   * @returns 放置失败时返回 null
   */
  spawnSustained(x: number, y: number, map: TileMap): (() => void) | null {
    const stain = this.place(x, y, map, true);
    if (!stain) return null;
    return () => {
      stain.sustained = false;
      stain.age = 0;
    };
  }

  private place(x: number, y: number, map: TileMap, sustained: boolean): BloodStain | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const target = BLOOD_MIN_RADIUS + (BLOOD_MAX_RADIUS - BLOOD_MIN_RADIUS) * this.random();
    if (!Number.isFinite(target) || target <= 0) return null;
    // 斑块轮廓最远到 1.07 倍半径，仍小于 r+2 的余量，保证血迹不会压到墙顶或水面。
    // 按 0.8 缩小不一定正好落在最小半径上，所以最后单独试一次最小值。
    let radius = target;
    while (radius > BLOOD_MIN_RADIUS && !this.isDryGround(map, x, y, radius + 2)) radius *= 0.8;
    radius = Math.max(radius, BLOOD_MIN_RADIUS);
    if (!this.isDryGround(map, x, y, radius + 2)) return null;
    // 到上限时优先淘汰没压着肉块的旧血迹，别把还在等拾取的痕迹挤掉。
    if (this.stains.length >= BLOOD_MAX_COUNT) {
      const expired = this.stains.findIndex(stain => !stain.sustained);
      this.stains.splice(expired >= 0 ? expired : 0, 1);
    }
    const stain = this.createStain(x, y, radius, sustained);
    this.stains.push(stain);
    return stain;
  }

  /** 整摊血迹必须位于干燥、可通行且非水域的地形内。 */
  private isDryGround(map: TileMap, x: number, y: number, radius: number): boolean {
    let covered = 0;
    for (const patch of map.getTerrainCoverage(circleCollider(x, y, radius))) {
      const terrain = map.terrainMap.get(patch.type);
      if (!terrain?.walkable || WATER_TYPES.includes(patch.type)) return false;
      covered += patch.fraction;
    }
    return covered >= 1 - 1e-6;
  }

  private createStain(x: number, y: number, radius: number, sustained: boolean): BloodStain {
    const count = BLOOD_MIN_BLOBS + Math.min(BLOOD_MAX_BLOBS - BLOOD_MIN_BLOBS,
      Math.floor(this.random() * (BLOOD_MAX_BLOBS - BLOOD_MIN_BLOBS + 1)));
    const blobs: BloodBlob[] = [];
    for (let i = 0; i < count; i++) {
      // 第一块是压在尸体下方、基本填满半径的血泊主体，之后是边缘血块，
      // 最后两块是更小、更靠外的溅点：有主有次才像一滩血，而不是几颗圆点。
      const splatter = i >= count - 2;
      const angle = this.random() * TAU;
      let distance: number;
      let blobRadius: number;
      if (i === 0) {
        distance = 0;
        blobRadius = radius * (0.55 + this.random() * 0.15);
      } else if (splatter) {
        distance = radius * (0.78 + this.random() * 0.17);
        blobRadius = radius * (0.09 + this.random() * 0.06);
      } else {
        distance = radius * (0.42 + this.random() * 0.2);
        blobRadius = radius * (0.3 + this.random() * 0.15);
      }
      blobs.push({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        radius: blobRadius,
        vertices: this.createVertices(8 + Math.floor(this.random() * 5)),
      });
    }
    return { x, y, radius, blobs, age: 0, sustained };
  }

  /** 半径系数在 0.65–1 之间抖动的不规则轮廓：血斑边缘不能像圆规画的。 */
  private createVertices(count: number): { x: number; y: number }[] {
    const vertices: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const angle = i / count * TAU;
      const factor = 0.65 + this.random() * 0.35;
      vertices.push({ x: Math.cos(angle) * factor, y: Math.sin(angle) * factor });
    }
    return vertices;
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const total = BLOOD_HOLD_SECONDS + BLOOD_FADE_SECONDS;
    // 压着肉块的血迹不累计时间：肉块一直没捡，血迹就一直留在原地。
    this.stains = this.stains.filter(stain => stain.sustained || (stain.age += delta) < total);
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    for (const stain of this.stains) {
      const alpha = stain.sustained ? 1 : BloodStainSystem.getAlpha(stain.age);
      if (alpha <= 0) continue;
      const x = stain.x - cameraX, y = stain.y - cameraY;
      const padding = stain.radius + 12;
      if (x + padding < 0 || y + padding < 0 || x - padding > viewWidth || y - padding > viewHeight) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      for (const blob of stain.blobs) {
        const bx = x + blob.x, by = y + blob.y;
        const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, blob.radius);
        // 中心近于干涸的暗红；靠边仍留一点不透明度，肉块压住中间时四周的血边才看得见。
        gradient.addColorStop(0, "rgba(146, 22, 18, 0.9)");
        gradient.addColorStop(0.55, "rgba(112, 14, 12, 0.78)");
        gradient.addColorStop(0.85, "rgba(86, 9, 8, 0.42)");
        gradient.addColorStop(1, "rgba(70, 7, 6, 0)");
        this.tracePath(ctx, blob, bx, by);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private tracePath(ctx: CanvasRenderingContext2D, blob: BloodBlob, x: number, y: number): void {
    ctx.beginPath();
    blob.vertices.forEach((point, index) => {
      const px = x + point.x * blob.radius, py = y + point.y * blob.radius;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  getActiveCount(): number {
    return this.stains.length;
  }

  getStains(): BloodStainView[] {
    return this.stains.map(stain => ({
      x: stain.x, y: stain.y, radius: stain.radius,
      blobs: stain.blobs.length,
      alpha: stain.sustained ? 1 : BloodStainSystem.getAlpha(stain.age),
    }));
  }

  clear(): void {
    this.stains = [];
  }

  private static getAlpha(age: number): number {
    if (age <= BLOOD_HOLD_SECONDS) return 1;
    const progress = (age - BLOOD_HOLD_SECONDS) / BLOOD_FADE_SECONDS;
    if (progress >= 1) return 0;
    return 1 - progress * progress * (3 - 2 * progress);
  }
}
