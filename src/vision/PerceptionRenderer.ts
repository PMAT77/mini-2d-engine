import { lightFalloff, projectShadow } from "../core/LightingSystem";
import type { VisibilityConfig } from "../core/GraphicsConfig";
import { TILE_TYPES, TileTypeId } from "../map/TileType";
import type { TileMap } from "../map/TileMap";
import type { ExplorationGrid } from "./ExplorationGrid";
import { MEMORY_TILE_ORDER, type TerrainMemory } from "./TerrainMemory";
import { TerrainOutlineCache } from "./TerrainOutlineCache";
import type { PerceptionLight, TerrainSource, VisionObserver } from "./VisionTypes";
import type { VisionRules } from "./VisionRules";

const UNKNOWN_COLOR = "#05070a";
const WATER_TYPES = new Set<TileTypeId>([
  TileTypeId.WATER,
  TileTypeId.SHALLOW_WATER,
  TileTypeId.DEEP_WATER,
  TileTypeId.ULTRA_DEEP_WATER,
]);

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function memoryColor(type: TileTypeId): string {
  if (WATER_TYPES.has(type)) return "#0d1824";
  // 矿种/墙体统一障碍色：记忆层不暴露具体矿种。
  if (TILE_TYPES[type]?.blocksLight) return "#2b3644";
  return "#101820";
}

/**
 * 三层视野的遮蔽合成。只生成低分辨率覆盖层，不重绘世界。
 *
 * 这里只负责“画面能看见多少”；对象是否绘制由 VisibilityPolicy 决定。
 * 即使遮蔽边缘有少量像素溢出，隐藏实体也不会被画出来。
 */
export class PerceptionRenderer {
  readonly map: TileMap;
  readonly terrain: TerrainSource;
  readonly rules: VisionRules;
  private config: VisibilityConfig;
  private readonly outline: TerrainOutlineCache;

  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private memory: HTMLCanvasElement | null = null;
  private memoryCtx: CanvasRenderingContext2D | null = null;
  private scratch: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private exploredTexture: HTMLCanvasElement | null = null;
  private exploredRevision = -1;

  private scale: number;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(map: TileMap, terrain: TerrainSource, rules: VisionRules, config: VisibilityConfig) {
    this.map = map;
    this.terrain = terrain;
    this.rules = rules;
    this.config = { ...config };
    this.scale = Math.max(0.05, config.maskScale);
    this.outline = new TerrainOutlineCache(terrain, this.scale, config.outlineContrast);
  }

  configure(config: VisibilityConfig): void {
    this.config = { ...config };
    const scale = Math.max(0.05, config.maskScale);
    this.outline.configure(scale, config.outlineContrast);
    if (scale !== this.scale) {
      this.scale = scale;
      this.allocate(this.viewWidth, this.viewHeight);
    }
  }

  resize(viewWidth: number, viewHeight: number, config: VisibilityConfig): void {
    this.configure(config);
    if (viewWidth !== this.viewWidth || viewHeight !== this.viewHeight) {
      this.allocate(viewWidth, viewHeight);
    }
  }

  /**
   * @param ctx 世界画布上下文
   * @param cameraX/cameraY 相机左上角世界坐标（已包含震动）
   * @param viewWidth/viewHeight 世界画布尺寸
   */
  render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number, observer: VisionObserver,
    lights: readonly PerceptionLight[], explored: ExplorationGrid,
    memory: TerrainMemory): void {
    if (!this.overlay || !this.overlayCtx || !this.memory || !this.memoryCtx
      || !this.scratch || !this.scratchCtx) {
      this.allocate(viewWidth, viewHeight);
    }
    if (!this.overlay || !this.overlayCtx || !this.memory || !this.memoryCtx
      || !this.scratch || !this.scratchCtx) return;
    if (viewWidth !== this.viewWidth || viewHeight !== this.viewHeight) {
      this.allocate(viewWidth, viewHeight);
    }
    if (!this.overlay || !this.overlayCtx || !this.memory || !this.memoryCtx
      || !this.scratch || !this.scratchCtx) return;

    const overlay = this.overlayCtx;
    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.globalAlpha = 1;
    overlay.globalCompositeOperation = "source-over";
    overlay.fillStyle = UNKNOWN_COLOR;
    overlay.fillRect(0, 0, this.overlay.width, this.overlay.height);

    // 1. 未探索区域的低对比地形轮廓（B 模式）。
    overlay.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    this.outline.draw(overlay, cameraX, cameraY, viewWidth, viewHeight);
    overlay.setTransform(1, 0, 0, 1, 0, 0);

    // 2. 已探索但当前未被观察的地形记忆。
    this.drawMemory(cameraX, cameraY, viewWidth, viewHeight, explored, memory);
    overlay.globalAlpha = this.config.memoryBrightness;
    overlay.drawImage(this.memory, 0, 0);
    overlay.globalAlpha = 1;

    // 3. 近身感知孔洞：硬墙遮挡，按 nearRevealAlpha 压暗而非完全去掉。
    this.punchNear(observer, cameraX, cameraY);

    // 4. 照明孔洞：光到达、且观察者能看见的区域完全露出。
    for (const light of lights) this.punchLight(observer, light, cameraX, cameraY);

    // 5. 覆盖到世界画布。
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.overlay, 0, 0, viewWidth, viewHeight);
    ctx.restore();
  }

  private allocate(viewWidth: number, viewHeight: number): void {
    this.viewWidth = Math.max(1, viewWidth);
    this.viewHeight = Math.max(1, viewHeight);
    const width = Math.max(1, Math.ceil(this.viewWidth * this.scale));
    const height = Math.max(1, Math.ceil(this.viewHeight * this.scale));

    this.overlay = createCanvas(width, height);
    this.overlayCtx = this.overlay.getContext("2d");
    this.memory = createCanvas(width, height);
    this.memoryCtx = this.memory.getContext("2d");
    this.scratch = createCanvas(width, height);
    this.scratchCtx = this.scratch.getContext("2d");
    this.exploredTexture = null;
    this.exploredRevision = -1;
  }

  private drawMemory(cameraX: number, cameraY: number, viewWidth: number,
    viewHeight: number, explored: ExplorationGrid, memory: TerrainMemory): void {
    const ctx = this.memoryCtx;
    if (!ctx || !this.memory) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.memory.width, this.memory.height);
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);

    const tileSize = this.terrain.tileSize;
    const startCol = Math.max(0, Math.floor(cameraX / tileSize));
    const startRow = Math.max(0, Math.floor(cameraY / tileSize));
    const endCol = Math.min(this.terrain.width, Math.ceil((cameraX + viewWidth) / tileSize));
    const endRow = Math.min(this.terrain.height, Math.ceil((cameraY + viewHeight) / tileSize));

    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const cell = memory.get(col, row);
        if (!cell) continue;
        const type = MEMORY_TILE_ORDER[cell.typeIndex];
        if (!type) continue;
        ctx.fillStyle = memoryColor(type);
        ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
      }
    }

    // 用 25px 探索覆盖层裁剪：半块瓦片只显示被观察到的部分。
    const texture = this.getExploredTexture(explored);
    if (texture) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(this.scale, 0, 0, this.scale,
        -cameraX * this.scale, -cameraY * this.scale);
      ctx.drawImage(texture, 0, 0, explored.cols * explored.cellSize,
        explored.rows * explored.cellSize);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  private getExploredTexture(explored: ExplorationGrid): HTMLCanvasElement | null {
    if (this.exploredTexture && this.exploredRevision === explored.revision) {
      return this.exploredTexture;
    }
    const canvas = createCanvas(explored.cols, explored.rows);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    for (let row = 0; row < explored.rows; row++) {
      for (let col = 0; col < explored.cols; col++) {
        if (explored.isExploredCell(col, row)) ctx.fillRect(col, row, 1, 1);
      }
    }
    this.exploredTexture = canvas;
    this.exploredRevision = explored.revision;
    return canvas;
  }

  private punchNear(observer: VisionObserver, cameraX: number, cameraY: number): void {
    const ctx = this.scratchCtx;
    if (!ctx || !this.scratch) return;
    const radius = observer.nearSenseRadius;
    const feather = Math.min(radius * 0.8, Math.max(0, this.config.edgeFeather));
    const inner = Math.max(0, radius - feather);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.scratch.width, this.scratch.height);
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);

    const gradient = ctx.createRadialGradient(observer.x, observer.y, inner,
      observer.x, observer.y, radius);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(observer.x, observer.y, radius, 0, Math.PI * 2);
    ctx.fill();

    this.carveShadowQuads(ctx, this.shadowQuads(observer.x, observer.y, radius + feather));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.punchScratch(this.rules.nearRevealAlpha);
  }

  private punchLight(observer: VisionObserver, light: PerceptionLight,
    cameraX: number, cameraY: number): void {
    if (!light.active || !light.revealsDetails || light.radius <= 0) return;
    const dx = light.x - observer.x;
    const dy = light.y - observer.y;
    if (dx * dx + dy * dy > (observer.maxObservationRange + light.radius + 64) ** 2) return;

    const ctx = this.scratchCtx;
    if (!ctx || !this.scratch) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.scratch.width, this.scratch.height);
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);

    this.fillLight(ctx, light);
    // 先减去光源自身阴影，再减去观察者阴影：拐角后被照亮的地面可以看见，但墙后的光源本体不会露出来。
    this.carveShadowQuads(ctx, this.shadowQuads(light.x, light.y, light.radius));
    this.carveShadowQuads(ctx, this.shadowQuads(observer.x, observer.y,
      observer.maxObservationRange + this.config.edgeFeather));

    // 超过最大观察范围的部分不显示。
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(observer.x, observer.y, observer.maxObservationRange, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.punchScratch(1);
  }

  private fillLight(ctx: CanvasRenderingContext2D, light: PerceptionLight): void {
    const radius = light.radius;
    const intensity = Math.max(0, Math.min(2, light.intensity));
    const angle = light.angle;
    const hasCone = angle !== undefined && angle > 0 && angle < Math.PI * 2 - 1e-6;

    ctx.save();
    if (hasCone) {
      const half = angle! / 2;
      const direction = light.direction ?? 0;
      ctx.beginPath();
      ctx.moveTo(light.x, light.y);
      ctx.arc(light.x, light.y, radius, direction - half, direction + half);
      ctx.closePath();
      ctx.clip();
    }

    const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
    const inner = light.innerRadius ?? 0;
    const innerFade = Math.max(1, light.innerFade ?? 14);
    for (let i = 0; i <= 12; i++) {
      const distance = radius * i / 12;
      let alpha = falloff(distance, radius) * intensity;
      if (inner > 0) {
        if (distance <= inner) alpha = 0;
        else if (distance < inner + innerFade) {
          const t = (distance - inner) / innerFade;
          alpha *= t * t * (3 - 2 * t);
        }
      }
      gradient.addColorStop(i / 12, `rgba(255,255,255,${Math.max(0, Math.min(1, alpha))})`);
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(light.x, light.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private shadowQuads(x: number, y: number, radius: number): number[][] {
    if (radius <= 0) return [];
    const edges = this.map.getShadowEdges(x, y, radius);
    const quads: number[][] = [];
    for (const edge of edges) {
      const quad = projectShadow(edge, x, y, radius, 2400);
      if (quad) quads.push(quad);
    }
    return quads;
  }

  private carveShadowQuads(ctx: CanvasRenderingContext2D, quads: readonly number[][]): void {
    if (quads.length === 0) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (const quad of quads) {
      ctx.beginPath();
      ctx.moveTo(quad[0], quad[1]);
      ctx.lineTo(quad[2], quad[3]);
      ctx.lineTo(quad[4], quad[5]);
      ctx.lineTo(quad[6], quad[7]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private punchScratch(alpha: number): void {
    const ctx = this.overlayCtx;
    if (!ctx || !this.scratch) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(this.scratch, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

/** 与 LightingSystem 的 lightFalloff 相同，避免渲染器依赖模块内部私有实现。 */
function falloff(distance: number, radius: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0 || distance >= radius) return 0;
  const t = Math.max(0, distance) / radius;
  const edge = Math.max(0, (t - 0.75) / 0.25);
  return (1 - edge * edge * (3 - 2 * edge)) / (1 + (t / 0.6) ** 2);
}
