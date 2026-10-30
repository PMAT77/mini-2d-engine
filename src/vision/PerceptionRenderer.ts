import { lightFalloff, projectShadow } from "../core/LightingSystem";
import type { VisibilityConfig } from "../core/GraphicsConfig";
import { SolidTerrain, solidPath } from "../map/SolidTerrain";
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
  private groundMask: HTMLCanvasElement | null = null;
  private groundMaskCtx: CanvasRenderingContext2D | null = null;
  private shadow: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private exploredTexture: HTMLCanvasElement | null = null;
  private exploredRevision = -1;
  private memorySolids: SolidTerrain | null = null;
  private memorySolidRevision = -1;
  private memoryPath: Path2D | null = null;
  private memoryPathKey = "";

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
    // 先画到 scratch，再按 25px 探索覆盖层擦掉已探索部分，避免初始墙体在探索后残留成幽灵。
    this.drawOutline(cameraX, cameraY, viewWidth, viewHeight, explored);

    // 2. 已探索但当前未被观察的地形记忆。
    this.drawMemory(cameraX, cameraY, viewWidth, viewHeight, explored, memory);
    overlay.globalAlpha = this.config.memoryBrightness;
    overlay.drawImage(this.memory, 0, 0);
    overlay.globalAlpha = 1;

    // 地面轮廓在一帧内只栅格化一次；每个光源的阴影都复用这张遮罩，
    // 避免多光源时反复对大 Path2D 做 clip（软件栅格下这是主要开销）。
    this.prepareGroundMask(cameraX, cameraY, viewWidth, viewHeight);

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
    this.groundMask = createCanvas(width, height);
    this.groundMaskCtx = this.groundMask.getContext("2d");
    this.shadow = createCanvas(width, height);
    this.shadowCtx = this.shadow.getContext("2d");
    this.exploredTexture = null;
    this.exploredRevision = -1;
  }

  /**
   * 未知轮廓先独立烘焙到 scratch，再擦掉已探索覆盖。
   * 这样已探索区域不会残留“建图时存在、现在已被破坏”的初始墙体。
   */
  private drawOutline(cameraX: number, cameraY: number, viewWidth: number,
    viewHeight: number, explored: ExplorationGrid): void {
    const ctx = this.scratchCtx;
    if (!ctx || !this.scratch) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.scratch.width, this.scratch.height);
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    this.outline.draw(ctx, cameraX, cameraY, viewWidth, viewHeight);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.eraseExplored(ctx, explored, cameraX, cameraY);
    const overlay = this.overlayCtx;
    if (!overlay) return;
    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.drawImage(this.scratch, 0, 0);
  }

  private eraseExplored(ctx: CanvasRenderingContext2D, explored: ExplorationGrid,
    cameraX: number, cameraY: number): void {
    const texture = this.getExploredTexture(explored);
    if (!texture) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    ctx.drawImage(texture, 0, 0, explored.cols * explored.cellSize,
      explored.rows * explored.cellSize);
    ctx.restore();
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
        if (!type || TILE_TYPES[type]?.blocksLight) continue;
        ctx.fillStyle = memoryColor(type);
        ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
      }
    }

    // 记忆中的墙体/矿石也复用 SolidTerrain 的圆角拓扑；未观察过的邻居视为空，
    // 因此探索边界会自然收成圆角，而不是把整块初始墙体画出来。
    const solids = this.getMemoryPath(memory, cameraX, cameraY, viewWidth, viewHeight);
    if (solids) {
      ctx.fillStyle = "#2b3644";
      ctx.fill(solids);
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

  private getMemoryPath(memory: TerrainMemory, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): Path2D | null {
    if (!this.memorySolids || this.memorySolidRevision !== memory.revision) {
      this.memorySolids = new SolidTerrain((col, row) => {
        const cell = memory.get(col, row);
        if (!cell) return false;
        const type = MEMORY_TILE_ORDER[cell.typeIndex];
        return !!type && !!TILE_TYPES[type]?.blocksLight;
      });
      this.memorySolidRevision = memory.revision;
      this.memoryPath = null;
      this.memoryPathKey = "";
    }

    const size = this.terrain.tileSize;
    const margin = size * 2;
    const startCol = Math.max(0, Math.floor((cameraX - margin) / size));
    const startRow = Math.max(0, Math.floor((cameraY - margin) / size));
    const endCol = Math.min(this.terrain.width, Math.ceil((cameraX + viewWidth + margin) / size));
    const endRow = Math.min(this.terrain.height, Math.ceil((cameraY + viewHeight + margin) / size));
    if (endCol <= startCol || endRow <= startRow) return null;

    const key = `${memory.revision}:${startCol},${startRow},${endCol},${endRow}`;
    if (this.memoryPath && this.memoryPathKey === key) return this.memoryPath;

    const polygons = this.memorySolids.query({
      x: startCol * size,
      y: startRow * size,
      width: (endCol - startCol) * size,
      height: (endRow - startRow) * size,
    }, size, this.terrain.width, this.terrain.height).map(patch => patch.polygon);
    if (polygons.length === 0) {
      this.memoryPath = null;
      this.memoryPathKey = key;
      return null;
    }
    const path = new Path2D();
    solidPath(path, polygons, 0, 0);
    this.memoryPath = path;
    this.memoryPathKey = key;
    return path;
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

  private prepareGroundMask(cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    const ctx = this.groundMaskCtx;
    if (!ctx || !this.groundMask) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.groundMask.width, this.groundMask.height);
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    ctx.fillStyle = "#fff";
    ctx.fill(this.map.getGroundContour(cameraX, cameraY, viewWidth, viewHeight), "evenodd");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    this.carveGroundShadowQuads(ctx, this.shadowQuads(observer.x, observer.y, radius + feather),
      cameraX, cameraY);
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
    // 先减去光源自身阴影，再减去观察者阴影；两者都只裁地面，墙顶不参与地面阴影多边形。
    const shadows = [
      ...this.shadowQuads(light.x, light.y, light.radius),
      ...this.shadowQuads(observer.x, observer.y,
        observer.maxObservationRange + this.config.edgeFeather),
    ];
    this.carveGroundShadowQuads(ctx, shadows, cameraX, cameraY);

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
    const fullCircle = Math.PI * 2;
    const hasCone = angle !== undefined && angle > 0 && angle < fullCircle - 1e-6;

    // 径向衰减直接使用 LightingSystem 的 lightFalloff，保证画面和辨识逻辑同一个数值模型。
    const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
    const inner = light.innerRadius ?? 0;
    const innerFade = Math.max(1, light.innerFade ?? 14);
    for (let i = 0; i <= 16; i++) {
      const distance = radius * i / 16;
      let alpha = lightFalloff(distance, radius) * intensity;
      if (inner > 0) {
        if (distance <= inner) alpha = 0;
        else if (distance < inner + innerFade) {
          const t = (distance - inner) / innerFade;
          alpha *= t * t * (3 - 2 * t);
        }
      }
      gradient.addColorStop(i / 16, `rgba(255,255,255,${Math.max(0, Math.min(1, alpha))})`);
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(light.x, light.y, radius, 0, fullCircle);
    ctx.fill();

    if (!hasCone) return;
    const half = angle! / 2;
    const direction = light.direction ?? 0;
    const softness = Math.max(0, Math.min(0.5, light.softness ?? 0));
    const feather = Math.min(half, angle! * softness);

    // 角向柔边用 conic gradient 做一次 alpha 乘法，避免整屏模糊。
    // 强度与 ConeLight/IlluminationProbe 一致：softness 决定边缘 feather，内圈仍是硬半径。
    if (feather > 1e-6) {
      const conic = ctx.createConicGradient(direction - half, light.x, light.y);
      const edge = feather / fullCircle;
      const inside = (angle! - feather) / fullCircle;
      conic.addColorStop(0, "rgba(255,255,255,0)");
      conic.addColorStop(edge, "rgba(255,255,255,1)");
      conic.addColorStop(inside, "rgba(255,255,255,1)");
      conic.addColorStop(angle! / fullCircle, "rgba(255,255,255,0)");
      conic.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = conic;
      ctx.beginPath();
      ctx.arc(light.x, light.y, radius, 0, fullCircle);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      return;
    }

    // 无 softness 时退化为硬边锥形，不引入额外模糊。
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(light.x, light.y);
    ctx.arc(light.x, light.y, radius, direction - half, direction + half);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
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

  /**
   * 地面阴影只裁到地面轮廓内：墙/矿顶面不参与阴影多边形，
   * 避免手电或近身光在墙顶画出深色三角。隐藏实体仍由 VisibilityPolicy 负责，不靠这里。
   */
  private carveGroundShadowQuads(ctx: CanvasRenderingContext2D,
    quads: readonly number[][], cameraX: number, cameraY: number): void {
    if (quads.length === 0) return;
    const shadowCtx = this.shadowCtx;
    const mask = this.groundMask;
    if (!shadowCtx || !this.shadow || !mask) return;

    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.globalCompositeOperation = "source-over";
    shadowCtx.globalAlpha = 1;
    shadowCtx.clearRect(0, 0, this.shadow.width, this.shadow.height);
    shadowCtx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    shadowCtx.fillStyle = "#000";
    for (const quad of quads) {
      shadowCtx.beginPath();
      shadowCtx.moveTo(quad[0], quad[1]);
      shadowCtx.lineTo(quad[2], quad[3]);
      shadowCtx.lineTo(quad[4], quad[5]);
      shadowCtx.lineTo(quad[6], quad[7]);
      shadowCtx.closePath();
      shadowCtx.fill();
    }
    // 只保留地面上的阴影：墙/矿顶面不参与，避免墙顶出现深色三角。
    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.globalCompositeOperation = "destination-in";
    shadowCtx.drawImage(mask, 0, 0);
    shadowCtx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.shadow, 0, 0);
    ctx.restore();
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

