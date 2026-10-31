import {
  computeGoldHudRect,
  computeMinimapLayout,
  createMinimapConfig,
  DEFAULT_MINIMAP_PALETTE,
  minimapCellColor,
  worldToMinimap,
  type MinimapConfig,
  type MinimapGoldHudRect,
  type MinimapPalette,
} from "../minimap/MinimapConfig";
import { MinimapMarkerStore, type MarkerSelectionOptions } from "../minimap/MinimapMarkerStore";
import {
  MinimapTerrainCache,
  type MinimapTerrainWindow,
  type MinimapWaterSampler,
} from "../minimap/MinimapTerrainCache";
import type {
  MinimapLayout,
  MinimapMarkerSpec,
  MinimapMarkerType,
  MinimapViewport,
} from "../minimap/MinimapTypes";
import type { ExplorationGrid } from "../vision/ExplorationGrid";
import type { TerrainMemory } from "../vision/TerrainMemory";

/**
 * 圆形战术小地图 HUD。
 *
 * 只做屏幕空间渲染：圆形裁剪、地形缓存贴图、资源标记、玩家箭头、外框。
 * 世界数据、感知授权和资源存活全部由 GameScene / PerceptionSystem / 对象提供，
 * 这里不读取相机，也不修改任何玩法状态。
 *
 * 坐标系：调用方负责把画布变换设置为 DPR 逻辑像素（与其它 HUD 一致），
 * 本类的所有坐标都是 CSS 逻辑像素。
 */

export interface CircularMinimapHudOptions {
  config?: Partial<MinimapConfig>;
  palette?: MinimapPalette;
}

/** 每帧由 GameScene 提交的小地图输入。 */
export interface MinimapHudUpdate {
  dt: number;
  /** 玩家已知地形的权威快照。 */
  memory: TerrainMemory;
  /** 探索格（决定“知不知道”）。 */
  grid: ExplorationGrid;
  /** 最近一次探索扫描中确实可见的格。 */
  observedCells: ReadonlySet<number>;
  observedRevision: number;
  /** 水体几何采样接口（WaterTerrain 结构上满足）。 */
  water?: MinimapWaterSampler;
  playerX: number;
  playerY: number;
  /** 真实视野/瞄准方向（弧度，0 = 右）。 */
  direction: number;
}

export interface MinimapHudStats {
  /** 最近一次地形重绘耗时（毫秒）。 */
  refreshMs: number;
  refreshCount: number;
  /** 缓存画布尺寸（设备像素）。 */
  cacheWidth: number;
  cacheHeight: number;
  /** 上一次绘制实际提交的标记数量。 */
  markerCount: number;
  /** 上一次重扫覆盖的探索格数量。 */
  cellCount: number;
}

/** 每个标记的最小绘制尺寸（CSS 逻辑像素）；资源点刻意比目标点更小更暗。 */
const MARKER_SIZE: Readonly<Record<MinimapMarkerType, number>> = {
  mineral: 2.6,
  gold: 1.7,
  meat: 1.5,
  pickup: 1.8,
  torch: 1.9,
  enemy: 3.1,
  objective: 3.6,
  extraction: 4.2,
  custom: 2.2,
};

const PLAYER_ARROW_LENGTH = 9;
const PLAYER_ARROW_HALF_WIDTH = 6.4;
const PLAYER_ARROW_NOTCH = 3.2;
/** 两次重扫之间的最大位移：必须小于缓存余量，否则边缘会出现未绘制条带。 */
const MAX_WALK_BETWEEN_SCANS_FRACTION = 0.08;

export class CircularMinimapHud {
  private readonly config: MinimapConfig;
  private readonly palette: MinimapPalette;
  private readonly terrainCache = new MinimapTerrainCache();
  private readonly markers = new MinimapMarkerStore();
  private readonly markerOptions: MarkerSelectionOptions;

  private layout: MinimapLayout;
  private viewport: MinimapViewport = { width: 0, height: 0, dpr: 1 };
  private cacheCanvas: HTMLCanvasElement | null = null;
  private cacheContext: CanvasRenderingContext2D | null = null;
  private cacheScale = 0;
  private cacheDirty = true;
  /** 上一次刷到缓存画布上的格子范围，用于补画离开观察窗口、已降级为 remembered 的格子。 */
  private paintedWindow: MinimapTerrainWindow = { startCol: 0, startRow: 0, endCol: -1, endRow: -1 };

  private playerX = 0;
  private playerY = 0;
  private direction = 0;
  private hasData = false;

  private sinceRefresh = Number.POSITIVE_INFINITY;
  private lastScanX = Number.NaN;
  private lastScanY = Number.NaN;
  private lastObservedRevision = -1;
  private refreshMs = 0;
  private refreshCount = 0;
  private markerCount = 0;

  constructor(options: CircularMinimapHudOptions = {}) {
    this.config = createMinimapConfig(options.config);
    this.palette = options.palette ?? DEFAULT_MINIMAP_PALETTE;
    this.layout = computeMinimapLayout(this.config, 1280, 720);
    this.markerOptions = {
      padding: this.config.markerPadding,
      clusterDistance: this.config.markerClusterDistance,
    };
  }

  getLayout(): Readonly<MinimapLayout> {
    return this.layout;
  }

  /** 黄金计数的锚点由小地图布局决定，保证两者永远对齐。 */
  getGoldRect(): MinimapGoldHudRect {
    return computeGoldHudRect(this.layout, this.config);
  }

  getStats(): MinimapHudStats {
    return {
      refreshMs: this.refreshMs,
      refreshCount: this.refreshCount,
      cacheWidth: this.cacheCanvas?.width ?? 0,
      cacheHeight: this.cacheCanvas?.height ?? 0,
      markerCount: this.markerCount,
      cellCount: this.terrainCache.getWindowCellCount(),
    };
  }

  /** 视口 / DPR 变化时重算布局，并让地形缓存纹理按新分辨率重建。 */
  resize(width: number, height: number, dpr: number): void {
    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    this.viewport = { width: Math.max(0, width), height: Math.max(0, height), dpr: safeDpr };
    this.layout = computeMinimapLayout(this.config, this.viewport.width, this.viewport.height);
    const worldWidth = this.terrainCache.getWorldWidth();
    const worldHeight = this.terrainCache.getWorldHeight();
    if (worldWidth > 0 && worldHeight > 0) this.ensureCacheCanvas(worldWidth, worldHeight);
    this.cacheDirty = true;
  }

  /** 每帧由 GameScene 提交最新授权结果；同 id 复用对象，不会闪烁。 */
  setMarkers(specs: readonly MinimapMarkerSpec[]): void {
    this.markers.replace(specs);
  }

  /**
   * 推进一帧：按节流重扫地形数据，必要时重绘缓存纹理。
   *
   * 两帧之间如果探索 / 记忆 / 观察结果都没有变化、玩家也没走出余量，就只更新
   * 位置与朝向；绘制阶段仅贴一次缓存图。
   */
  update(input: MinimapHudUpdate): void {
    this.playerX = input.playerX;
    this.playerY = input.playerY;
    this.direction = input.direction;
    this.hasData = true;

    const step = Number.isFinite(input.dt) && input.dt > 0 ? input.dt : 0;
    this.sinceRefresh += step;

    const worldWidth = input.memory.cols * input.memory.tileSize;
    const worldHeight = input.memory.rows * input.memory.tileSize;
    const worldChanged =
      this.terrainCache.getWorldWidth() !== worldWidth ||
      this.terrainCache.getWorldHeight() !== worldHeight;
    const observedChanged = input.observedRevision !== this.lastObservedRevision;
    const traveled = Number.isFinite(this.lastScanX)
      ? Math.hypot(input.playerX - this.lastScanX, input.playerY - this.lastScanY)
      : Number.POSITIVE_INFINITY;
    const interval = this.config.refreshInterval;
    const slack = this.layout.worldRadius * MAX_WALK_BETWEEN_SCANS_FRACTION;

    const due =
      worldChanged ||
      this.cacheCanvas === null ||
      this.sinceRefresh >= interval * 5 ||
      (this.sinceRefresh >= interval && (observedChanged || traveled > slack));

    if (!due) {
      this.ensureCacheCanvas(worldWidth, worldHeight);
      return;
    }

    this.refreshTerrain(input, worldWidth, worldHeight);
  }

  /** 绘制一帧小地图；调用方已把画布变换设置为 DPR 逻辑像素。 */
  draw(ctx: CanvasRenderingContext2D): void {
    const layout = this.layout;
    const content = layout.contentRadius;

    // 外圈与内圈之间的暗色底盘：两圈描边之间留出可见间隙，而不是贴在一起。
    ctx.save();
    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, Math.max(1, layout.radius - this.config.borderWidth), 0, Math.PI * 2);
    ctx.fillStyle = this.palette.ringBackground;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, content, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = this.palette.unknown;
    ctx.fillRect(layout.centerX - content, layout.centerY - content, content * 2, content * 2);

    const cache = this.cacheCanvas;
    if (cache && this.cacheScale > 0 && layout.scale > 0) {
      const halfWorld = content / layout.scale;
      const sourceSize = halfWorld * 2 * this.cacheScale;
      const sourceX = (this.playerX - halfWorld) * this.cacheScale;
      const sourceY = (this.playerY - halfWorld) * this.cacheScale;
      if (sourceSize > 0.5) {
        ctx.drawImage(
          cache,
          sourceX,
          sourceY,
          sourceSize,
          sourceSize,
          layout.centerX - content,
          layout.centerY - content,
          content * 2,
          content * 2
        );
      }
    }

    if (this.hasData) {
      this.drawMarkers(ctx);
      this.drawPlayer(ctx);
    }
    ctx.restore();

    this.drawBorder(ctx);
  }

  dispose(): void {
    this.cacheCanvas = null;
    this.cacheContext = null;
    this.cacheScale = 0;
    this.cacheDirty = true;
    this.paintedWindow = { startCol: 0, startRow: 0, endCol: -1, endRow: -1 };
    this.hasData = false;
    this.markers.clear();
  }

  private refreshTerrain(input: MinimapHudUpdate, worldWidth: number, worldHeight: number): void {
    const started = now();
    this.terrainCache.refresh(
      {
        memory: input.memory,
        grid: input.grid,
        observed: input.observedCells,
        water: input.water,
        centerX: input.playerX,
        centerY: input.playerY,
        worldRadius: this.layout.worldRadius + this.config.windowMargin,
      },
      input.observedRevision
    );
    this.lastObservedRevision = input.observedRevision;
    this.lastScanX = input.playerX;
    this.lastScanY = input.playerY;
    this.sinceRefresh = 0;
    this.ensureCacheCanvas(worldWidth, worldHeight);
    this.paintTerrain();
    this.refreshMs = now() - started;
    this.refreshCount += 1;
  }

  /** 把缓存窗口内的探索格刷到离屏画布上；格与格边界共用取整坐标，不会留缝。 */
  private paintTerrain(): void {
    const ctx = this.cacheContext;
    if (!ctx) return;
    this.cacheDirty = false;
    const window = this.terrainCache.getWindow();
    if (window.endCol < window.startCol || window.endRow < window.startRow) return;
    // 旧窗口里已经离开的格子先在缓存里被降级为 remembered，这里补画它们，
    // 否则玩家走过的地方会一直留着“当前观察”的亮色。
    this.paintCells(this.paintedWindow, window);
    this.paintCells(window, null);
    this.paintedWindow = { ...window };
  }

  private paintCells(range: MinimapTerrainWindow, skip: MinimapTerrainWindow | null): void {
    const ctx = this.cacheContext;
    if (!ctx) return;
    if (range.endCol < range.startCol || range.endRow < range.startRow) return;
    const cellSize = this.terrainCache.getCellSize();
    const scale = this.cacheScale;
    let currentColor = "";
    for (let row = range.startRow; row <= range.endRow; row++) {
      const y0 = Math.round(row * cellSize * scale);
      const y1 = Math.round((row + 1) * cellSize * scale);
      const height = Math.max(1, y1 - y0);
      for (let col = range.startCol; col <= range.endCol; col++) {
        if (
          skip &&
          row >= skip.startRow &&
          row <= skip.endRow &&
          col >= skip.startCol &&
          col <= skip.endCol
        ) {
          continue;
        }
        const color = minimapCellColor(
          this.palette,
          this.terrainCache.terrainAt(col, row),
          this.terrainCache.stateAt(col, row)
        );
        if (color !== currentColor) {
          ctx.fillStyle = color;
          currentColor = color;
        }
        const x0 = Math.round(col * cellSize * scale);
        const x1 = Math.round((col + 1) * cellSize * scale);
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), height);
      }
    }
  }

  /** 缓存纹理：覆盖整个世界，分辨率 = 小地图设备像素 × 超采样。 */
  private ensureCacheCanvas(worldWidth: number, worldHeight: number): void {
    if (worldWidth <= 0 || worldHeight <= 0) return;
    // 单测在 Node 里跑游戏循环，没有 canvas；数据层照常工作，渲染层直接跳过。
    if (typeof document === "undefined") return;
    const dpr = this.viewport.dpr;
    const cap = this.config.maxCacheSize;
    let scale = this.layout.scale * dpr * this.config.cacheSuperSample;
    let width = Math.ceil(worldWidth * scale);
    let height = Math.ceil(worldHeight * scale);
    if (width > cap || height > cap) {
      const ratio = Math.min(cap / Math.max(1, width), cap / Math.max(1, height));
      scale *= ratio;
      width = Math.max(1, Math.ceil(worldWidth * scale));
      height = Math.max(1, Math.ceil(worldHeight * scale));
    }
    if (!Number.isFinite(scale) || scale <= 0) return;

    if (
      this.cacheCanvas &&
      this.cacheContext &&
      this.cacheScale === scale &&
      this.cacheCanvas.width === width &&
      this.cacheCanvas.height === height
    ) {
      if (this.cacheDirty) this.paintTerrain();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    // 缓存坐标与设备像素一一对应，绘制的格子保持锐利。
    this.cacheCanvas = canvas;
    this.cacheContext = context;
    this.cacheScale = scale;
    this.cacheDirty = true;
    this.paintTerrain();
  }

  private drawMarkers(ctx: CanvasRenderingContext2D): void {
    const visible = this.markers.visibleIn(this.layout, this.playerX, this.playerY, this.markerOptions);
    this.markerCount = visible.length;
    for (const marker of visible) {
      const point = worldToMinimap(this.layout, this.playerX, this.playerY, marker.x, marker.y);
      const size = MARKER_SIZE[marker.type] ?? 2;
      let color: string = this.palette.marker[marker.type] ?? this.palette.marker.custom;
      if (marker.type === "torch" && marker.state === "dark") color = this.palette.markerTorchDark;

      if (marker.type === "mineral") {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - size);
        ctx.lineTo(point.x + size, point.y);
        ctx.lineTo(point.x, point.y + size);
        ctx.lineTo(point.x - size, point.y);
        ctx.closePath();
        ctx.fill();
      } else if (marker.type === "objective" || marker.type === "extraction") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
        ctx.stroke();
        if (marker.type === "extraction") {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, size * 0.34, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (marker.type === "enemy") {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - size);
        ctx.lineTo(point.x + size, point.y + size * 0.8);
        ctx.lineTo(point.x - size, point.y + size * 0.8);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 白色箭头固定在圆心，指向真实视野方向；不受相机震动与翻滚动画影响。 */
  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const { centerX, centerY } = this.layout;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(this.direction + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -PLAYER_ARROW_LENGTH);
    ctx.lineTo(PLAYER_ARROW_HALF_WIDTH, PLAYER_ARROW_LENGTH * 0.72);
    ctx.lineTo(0, PLAYER_ARROW_NOTCH);
    ctx.lineTo(-PLAYER_ARROW_HALF_WIDTH, PLAYER_ARROW_LENGTH * 0.72);
    ctx.closePath();
    ctx.fillStyle = this.palette.player;
    ctx.fill();
    ctx.strokeStyle = this.palette.playerEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  private drawBorder(ctx: CanvasRenderingContext2D): void {
    const { centerX, centerY, radius, contentRadius } = this.layout;
    const outerWidth = this.config.borderWidth;
    const innerWidth = this.config.innerBorderWidth;
    ctx.save();

    // 外圈描边：贴着圆盘最外缘。
    ctx.strokeStyle = this.palette.border;
    ctx.lineWidth = outerWidth;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - outerWidth / 2, 0, Math.PI * 2);
    ctx.stroke();

    // 内圈描边：紧贴内容圆外沿，与外圈之间由 ringGap 留出空隙。
    ctx.strokeStyle = this.palette.borderInset;
    ctx.lineWidth = innerWidth;
    ctx.beginPath();
    ctx.arc(centerX, centerY, contentRadius + innerWidth / 2, 0, Math.PI * 2);
    ctx.stroke();

    // 北向刻度：穿过两圈之间的间隙，只做一条 1px 细线，不抢地形。
    const tickOuter = radius - outerWidth - 0.6;
    const tickInner = contentRadius + innerWidth + 0.6;
    if (tickOuter > tickInner) {
      ctx.strokeStyle = this.palette.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - tickOuter);
      ctx.lineTo(centerX, centerY - tickInner);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
