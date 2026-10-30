import { lightFalloff, projectShadow } from "../core/LightingSystem";
import type { VisibilityConfig } from "../core/GraphicsConfig";
import { SolidTerrain, solidPath } from "../map/SolidTerrain";
import { TILE_TYPES, TileTypeId } from "../map/TileType";
import type { TileMap } from "../map/TileMap";
import type { ExplorationGrid } from "./ExplorationGrid";
import { MEMORY_TILE_ORDER, type TerrainMemory } from "./TerrainMemory";
import { TERRAIN_OUTLINE_RGB, TerrainOutlineCache } from "./TerrainOutlineCache";
import type { PerceptionLight, TerrainSource, VisionDebugLayer, VisionObserver } from "./VisionTypes";
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
  private terrainSolids: SolidTerrain | null = null;
  private terrainSolidRevision = -1;
  private terrainPath: Path2D | null = null;
  private terrainPathKey = "";
  private debugLayer: VisionDebugLayer | null = null;

  private scale: number;
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(map: TileMap, terrain: TerrainSource, rules: VisionRules, config: VisibilityConfig) {
    this.map = map;
    this.terrain = terrain;
    this.rules = rules;
    this.config = { ...config };
    this.scale = Math.max(0.05, config.maskScale);
    this.outline = new TerrainOutlineCache(terrain);
  }

  configure(config: VisibilityConfig): void {
    this.config = { ...config };
    const scale = Math.max(0.05, config.maskScale);
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

    // 临时图层隔离：world 直接跳过遮蔽层，让原始地图与光照可见。
    if (this.debugLayer === "world") return;

    const layer = this.debugLayer;
    const overlay = this.overlayCtx;
    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.globalAlpha = 1;
    overlay.globalCompositeOperation = "source-over";
    // 单层诊断时保留透明背景，才能看清该层相对世界画面的真实贡献。
    const wantsOutline = layer === null || layer === "outline" || layer === "grid";
    const wantsMemory = layer === null || layer === "memory" || layer === "grid";
    const wantsNear = layer === null || layer === "near" || layer === "grid";
    const wantsLight = layer === null || layer === "light" || layer === "grid";
    if (layer === null || layer === "near" || layer === "light" || layer === "grid") {
      overlay.fillStyle = UNKNOWN_COLOR;
      overlay.fillRect(0, 0, this.overlay.width, this.overlay.height);
    }

    // 1. 地形轮廓：未知快照与已观察记忆合成同一条连续几何，画面不出现探索网格边界。
    if (wantsOutline) this.drawOutline(cameraX, cameraY, viewWidth, viewHeight, memory);

    // 2. 已探索但当前未被观察的地面色调（静态记忆，只做低亮度提示）。
    if (wantsMemory) {
      this.drawMemory(cameraX, cameraY, viewWidth, viewHeight, memory);
      overlay.globalAlpha = this.config.memoryBrightness;
      overlay.drawImage(this.memory, 0, 0);
      overlay.globalAlpha = 1;
    }

    // 地面轮廓在一帧内只栅格化一次；每个光源的阴影都复用这张遮罩，
    // 避免多光源时反复对大 Path2D 做 clip（软件栅格下这是主要开销）。
    if (wantsNear || wantsLight) this.prepareGroundMask(cameraX, cameraY, viewWidth, viewHeight);

    // 3. 近身感知孔洞：硬墙遮挡，按 nearRevealAlpha 压暗而非完全去掉。
    if (wantsNear) this.punchNear(observer, cameraX, cameraY);

    // 4. 照明孔洞：光到达、且观察者能看见的区域完全露出。
    if (wantsLight) for (const light of lights) this.punchLight(observer, light, cameraX, cameraY);

    if (layer === "grid") this.drawExplorationGrid(explored, cameraX, cameraY);

    // 5. 覆盖到世界画布。
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.overlay, 0, 0, viewWidth, viewHeight);
    ctx.restore();
  }

  /** 仅供诊断：切换 25px 探索网格等图层隔离视图。传 null 恢复正常合成。 */
  setDebugLayer(layer: VisionDebugLayer | null): void {
    this.debugLayer = layer;
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
  }

  /**
   * 地形轮廓只画一条统一路径：已观察过的瓦片以 TerrainMemory 为准，其余以建图快照为准。
   *
   * 探索历史仍然保存在离散网格和瓦片记忆里，但画面上的墙顶几何与明暗完全连续，
   * 不会出现与 25px 探索单元对齐的方块。记忆中的阻挡瓦片也经由这条路径绘制，
   * 因此远处被破坏的墙在重新观察前保持记忆里的旧轮廓，不会提前泄露变化。
   */
  private drawOutline(cameraX: number, cameraY: number, viewWidth: number,
    viewHeight: number, memory: TerrainMemory): void {
    const overlay = this.overlayCtx;
    if (!overlay) return;
    const alpha = Math.min(0.5, Math.max(0.02, this.config.outlineContrast * 4));
    const path = this.getTerrainPath(cameraX, cameraY, viewWidth, viewHeight, memory);
    if (!path) return;
    overlay.save();
    overlay.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    overlay.fillStyle = `rgba(${TERRAIN_OUTLINE_RGB}, ${alpha})`;
    overlay.fill(path);
    overlay.restore();
  }

  /**
   * 已捕获的非阻挡地面/水面只叠一层低亮度色调；边界由瓦片几何决定，
   * 不再用 25px 探索纹理裁剪，避免记忆层出现硬方块。
   */
  private drawMemory(cameraX: number, cameraY: number, viewWidth: number,
    viewHeight: number, memory: TerrainMemory): void {
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
  }

  /**
   * 统一地形路径：记忆优先、建图快照兜底。
   *
   * SolidTerrain 只在记忆 revision 变化时重建；路径再按瓦片对齐的视口缓存，
   * 与旧的“未知轮廓”缓存策略保持一致，不随玩家每一帧移动重建。
   */
  private getTerrainPath(cameraX: number, cameraY: number, viewWidth: number,
    viewHeight: number, memory: TerrainMemory): Path2D | null {
    if (!this.terrainSolids || this.terrainSolidRevision !== memory.revision) {
      this.terrainSolids = new SolidTerrain((col, row) => this.isBlockingTile(col, row, memory));
      this.terrainSolidRevision = memory.revision;
      this.terrainPath = null;
      this.terrainPathKey = "";
    }

    const size = this.terrain.tileSize;
    const margin = size * 2;
    const startCol = Math.max(0, Math.floor((cameraX - margin) / size));
    const startRow = Math.max(0, Math.floor((cameraY - margin) / size));
    const endCol = Math.min(this.terrain.width, Math.ceil((cameraX + viewWidth + margin) / size));
    const endRow = Math.min(this.terrain.height, Math.ceil((cameraY + viewHeight + margin) / size));
    if (endCol <= startCol || endRow <= startRow) return null;

    const key = `${memory.revision}:${startCol},${startRow},${endCol},${endRow}`;
    if (this.terrainPath && this.terrainPathKey === key) return this.terrainPath;

    const polygons = this.terrainSolids.query({
      x: startCol * size,
      y: startRow * size,
      width: (endCol - startCol) * size,
      height: (endRow - startRow) * size,
    }, size, this.terrain.width, this.terrain.height).map(patch => patch.polygon);
    if (polygons.length === 0) {
      this.terrainPath = null;
      this.terrainPathKey = key;
      return null;
    }
    const path = new Path2D();
    solidPath(path, polygons, 0, 0);
    this.terrainPath = path;
    this.terrainPathKey = key;
    return path;
  }

  /** 已观察过的瓦片以记忆为准（可反映破坏），否则退回建图快照。 */
  private isBlockingTile(col: number, row: number, memory: TerrainMemory): boolean {
    const cell = memory.get(col, row);
    if (cell) {
      const type = MEMORY_TILE_ORDER[cell.typeIndex];
      return !!type && !!TILE_TYPES[type]?.blocksLight;
    }
    return this.outline.blocksLight(col, row);
  }

  /** 诊断用：把 25px 探索单元边界画在覆盖层上，用于确认色块是否与网格对齐。 */
  private drawExplorationGrid(explored: ExplorationGrid, cameraX: number, cameraY: number): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const size = explored.cellSize;
    const startCol = Math.max(0, Math.floor(cameraX / size));
    const startRow = Math.max(0, Math.floor(cameraY / size));
    const endCol = Math.min(explored.cols, Math.ceil((cameraX + this.viewWidth) / size));
    const endRow = Math.min(explored.rows, Math.ceil((cameraY + this.viewHeight) / size));
    if (endCol <= startCol || endRow <= startRow) return;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale,
      -cameraX * this.scale, -cameraY * this.scale);
    ctx.strokeStyle = "rgba(255, 96, 96, 0.35)";
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let col = startCol; col <= endCol; col++) {
      const x = col * size;
      ctx.moveTo(x, startRow * size);
      ctx.lineTo(x, endRow * size);
    }
    for (let row = startRow; row <= endRow; row++) {
      const y = row * size;
      ctx.moveTo(startCol * size, y);
      ctx.lineTo(endCol * size, y);
    }
    ctx.stroke();
    ctx.restore();
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

