import { getTileType, TileTypeId } from "../map/TileType";
import type { ExplorationGrid } from "../vision/ExplorationGrid";
import { MEMORY_TILE_ORDER, MEMORY_UNKNOWN_TILE, TerrainMemory } from "../vision/TerrainMemory";
import type { MinimapCellState, MinimapTerrainClass } from "./MinimapTypes";

/**
 * 小地图的地形数据缓存。
 *
 * 这是纯数据层：不碰 Canvas、不读鼠标、不改变地形，也不参与碰撞与光照。
 * 它只回答两个问题：某个 25px 探索格“知不知道”，以及知道它是什么地形。
 *
 * 权威来源固定为：
 * - 是否探索过 → ExplorationGrid
 * - 地形是什么 → TerrainMemory 的观察快照（不是 live TileMap.tiles）
 * - 水域 → WaterTerrain.getTypeAt（水体独立于基础瓦片数组）
 * - 当前是否正在观察 → PerceptionSystem 的观察格集合
 */

/** 只暴露小地图需要的那一个水面采样接口。 */
export interface MinimapWaterSampler {
  getTypeAt(x: number, y: number, size: number): TileTypeId | undefined;
}

export interface MinimapTerrainInput {
  readonly memory: TerrainMemory;
  readonly grid: ExplorationGrid;
  /** 最近一次探索扫描确认“当前可见”的格索引（row * grid.cols + col）。 */
  readonly observed: ReadonlySet<number>;
  readonly water?: MinimapWaterSampler;
  readonly centerX: number;
  readonly centerY: number;
  /** 需要覆盖的世界半径，已包含余量。 */
  readonly worldRadius: number;
}

export interface MinimapTerrainWindow {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

/**
 * 地形类别 → Uint8 索引。前三个顺序固定（ground / wall / mineral），
 * tile class 与 cell class 共用同一套编号。
 */
const TERRAIN_CLASSES: readonly MinimapTerrainClass[] = [
  "ground",
  "wall",
  "mineral",
  "shallowWater",
  "water",
  "deepWater",
  "ultraDeepWater",
];

const CLASS_GROUND = 0;
const CLASS_WALL = 1;
const CLASS_MINERAL = 2;
/** 记忆里没有这块瓦片的记录（探索格的边角采样会出现）。 */
const CLASS_NONE = 255;

const STATE_NAMES: readonly MinimapCellState[] = ["unknown", "remembered", "observed"];
const STATE_UNKNOWN = 0;
const STATE_REMEMBERED = 1;
const STATE_OBSERVED = 2;

const EMPTY_WINDOW: MinimapTerrainWindow = { startCol: 0, startRow: 0, endCol: -1, endRow: -1 };

export class MinimapTerrainCache {
  private cellSize = 0;
  private cellCols = 0;
  private cellRows = 0;
  private worldWidth = 0;
  private worldHeight = 0;
  private states = new Uint8Array(0);
  private classes = new Uint8Array(0);
  private window: MinimapTerrainWindow = { ...EMPTY_WINDOW };
  private lastCenterX = Number.NaN;
  private lastCenterY = Number.NaN;
  private lastGrid: ExplorationGrid | null = null;
  private lastMemory: TerrainMemory | null = null;
  private lastGridRevision = -1;
  private lastMemoryRevision = -1;
  private lastObservedRevision = -1;

  getCellSize(): number {
    return this.cellSize;
  }

  getWorldWidth(): number {
    return this.worldWidth;
  }

  getWorldHeight(): number {
    return this.worldHeight;
  }

  getWindow(): Readonly<MinimapTerrainWindow> {
    return this.window;
  }

  /** 已经扫描过、且当前在窗口内的格数；仅用于调试与性能观察。 */
  getWindowCellCount(): number {
    if (this.window.endCol < this.window.startCol) return 0;
    return (this.window.endCol - this.window.startCol + 1) * (this.window.endRow - this.window.startRow + 1);
  }

  stateAt(col: number, row: number): MinimapCellState {
    if (col < 0 || row < 0 || col >= this.cellCols || row >= this.cellRows) return "unknown";
    return STATE_NAMES[this.states[row * this.cellCols + col]] ?? "unknown";
  }

  terrainAt(col: number, row: number): MinimapTerrainClass {
    if (col < 0 || row < 0 || col >= this.cellCols || row >= this.cellRows) return "ground";
    return TERRAIN_CLASSES[this.classes[row * this.cellCols + col]] ?? "ground";
  }

  /** 换地图、换种子、换配置或瞬移时整体作废。 */
  reset(): void {
    this.states.fill(STATE_UNKNOWN);
    this.classes.fill(CLASS_GROUND);
    this.window = { ...EMPTY_WINDOW };
    this.lastCenterX = Number.NaN;
    this.lastCenterY = Number.NaN;
    this.lastGridRevision = -1;
    this.lastMemoryRevision = -1;
    this.lastObservedRevision = -1;
  }

  /**
   * 是否需要重新扫描窗口。
   *
   * 只有“探索 / 记忆 / 当前观察 / 格子尺寸 / 世界尺寸”发生变化，或玩家走出了
   * 上次窗口预留的余量时才为真。两帧之间原地不动时不会重复全量扫描。
   */
  needsRefresh(input: MinimapTerrainInput, observedRevision: number, movementSlack: number): boolean {
    if (this.lastGrid !== input.grid || this.lastMemory !== input.memory) return true;
    if (this.cellSize !== input.grid.cellSize) return true;
    const worldWidth = input.memory.cols * input.memory.tileSize;
    const worldHeight = input.memory.rows * input.memory.tileSize;
    if (this.worldWidth !== worldWidth || this.worldHeight !== worldHeight) return true;
    if (this.states.length !== input.grid.cols * input.grid.rows) return true;
    if (this.window.endCol < this.window.startCol) return true;
    if (this.classes.length === 0) return true;
    if (!Number.isFinite(this.lastCenterX)) return true;
    if (this.lastGridRevision !== input.grid.revision) return true;
    if (this.lastMemoryRevision !== input.memory.revision) return true;
    if (this.lastObservedRevision !== observedRevision) return true;
    if (Math.hypot(input.centerX - this.lastCenterX, input.centerY - this.lastCenterY) > movementSlack) {
      return true;
    }
    return false;
  }

  /**
   * 重新扫描以玩家为中心、半径 worldRadius 的窗口。
   *
   * 只扫当前窗口，开销与地图大小无关；离开窗口的格子在这里降级为 remembered，
   * 所以“刚离开的观察区域”不会一直发亮，同时缓存也不需要保存全区并集。
   */
  refresh(input: MinimapTerrainInput, observedRevision = 0): void {
    if (!this.ensure(input)) this.reset();
    const grid = input.grid;
    const memory = input.memory;
    const cellSize = this.cellSize;
    const tileSize = memory.tileSize;
    const radius = Math.max(0, input.worldRadius);
    const minX = input.centerX - radius;
    const maxX = input.centerX + radius;
    const minY = input.centerY - radius;
    const maxY = input.centerY + radius;

    const startCol = Math.max(0, Math.floor(minX / cellSize));
    const startRow = Math.max(0, Math.floor(minY / cellSize));
    const endCol = Math.min(grid.cols - 1, Math.floor(maxX / cellSize));
    const endRow = Math.min(grid.rows - 1, Math.floor(maxY / cellSize));
    if (startCol > endCol || startRow > endRow) return;
    const nextWindow: MinimapTerrainWindow = { startCol, startRow, endCol, endRow };

    const moved = Number.isFinite(this.lastCenterX)
      ? Math.hypot(input.centerX - this.lastCenterX, input.centerY - this.lastCenterY)
      : Number.POSITIVE_INFINITY;
    if (moved > radius * 2) {
      // 瞬移：旧的“当前观察”亮色不再成立，整片降为 remembered，但保留已探索记忆。
      for (let i = 0; i < this.states.length; i++) {
        if (this.states[i] === STATE_OBSERVED) this.states[i] = STATE_REMEMBERED;
      }
    } else {
      this.downgradeOutside(this.window, nextWindow);
    }

    const tileCols = memory.cols;
    const tileRows = memory.rows;
    const observed = input.observed;
    let cachedTileCol = -1;
    let cachedTileRow = -1;
    let cachedTileClass = CLASS_NONE;

    for (let row = startRow; row <= endRow; row++) {
      const cy = (row + 0.5) * cellSize;
      for (let col = startCol; col <= endCol; col++) {
        const index = row * this.cellCols + col;
        if (!grid.isExploredCell(col, row)) {
          this.states[index] = STATE_UNKNOWN;
          this.classes[index] = CLASS_GROUND;
          continue;
        }

        const cx = (col + 0.5) * cellSize;
        const tileCol = Math.floor(cx / tileSize);
        const tileRow = Math.floor(cy / tileSize);
        if (tileCol !== cachedTileCol || tileRow !== cachedTileRow) {
          cachedTileCol = tileCol;
          cachedTileRow = tileRow;
          cachedTileClass =
            tileCol >= 0 && tileRow >= 0 && tileCol < tileCols && tileRow < tileRows
              ? tileClassOf(memory, tileCol, tileRow)
              : CLASS_NONE;
        }

        this.states[index] = observed.has(index) ? STATE_OBSERVED : STATE_REMEMBERED;

        let classIndex = cachedTileClass;
        if (classIndex === CLASS_NONE) classIndex = CLASS_GROUND;
        if (classIndex === CLASS_GROUND && input.water) {
          const water = waterClass(input.water.getTypeAt(cx, cy, tileSize));
          if (water !== null) classIndex = water;
        }
        this.classes[index] = classIndex;
      }
    }

    this.window = nextWindow;
    this.lastCenterX = input.centerX;
    this.lastCenterY = input.centerY;
    this.lastGridRevision = grid.revision;
    this.lastMemoryRevision = memory.revision;
    this.lastObservedRevision = observedRevision;
  }

  /** 把落在新窗口之外的旧观察格降级为 remembered（四段条带，O(窗口周长)）。 */
  private downgradeOutside(previous: MinimapTerrainWindow, next: MinimapTerrainWindow): void {
    if (previous.endCol < previous.startCol || previous.endRow < previous.startRow) return;
    this.downgradeRange(previous.startCol, previous.startRow, previous.endCol, next.startRow - 1);
    this.downgradeRange(previous.startCol, next.endRow + 1, previous.endCol, previous.endRow);
    const rowStart = Math.max(previous.startRow, next.startRow);
    const rowEnd = Math.min(previous.endRow, next.endRow);
    this.downgradeRange(previous.startCol, rowStart, next.startCol - 1, rowEnd);
    this.downgradeRange(next.endCol + 1, rowStart, previous.endCol, rowEnd);
  }

  private downgradeRange(startCol: number, startRow: number, endCol: number, endRow: number): void {
    const colStart = Math.max(0, startCol);
    const colEnd = Math.min(this.cellCols - 1, endCol);
    const rowStart = Math.max(0, startRow);
    const rowEnd = Math.min(this.cellRows - 1, endRow);
    for (let row = rowStart; row <= rowEnd; row++) {
      const base = row * this.cellCols;
      for (let col = colStart; col <= colEnd; col++) {
        if (this.states[base + col] === STATE_OBSERVED) this.states[base + col] = STATE_REMEMBERED;
      }
    }
  }

  /** 格子尺寸、世界尺寸、权威对象变化时重建数组。 */
  private ensure(input: MinimapTerrainInput): boolean {
    const grid = input.grid;
    const memory = input.memory;
    const worldWidth = memory.cols * memory.tileSize;
    const worldHeight = memory.rows * memory.tileSize;
    if (
      this.lastGrid === grid &&
      this.lastMemory === memory &&
      this.cellSize === grid.cellSize &&
      this.cellCols === grid.cols &&
      this.cellRows === grid.rows &&
      this.worldWidth === worldWidth &&
      this.worldHeight === worldHeight
    ) {
      return true;
    }

    this.cellSize = grid.cellSize;
    this.cellCols = grid.cols;
    this.cellRows = grid.rows;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.lastGrid = grid;
    this.lastMemory = memory;
    this.states = new Uint8Array(this.cellCols * this.cellRows);
    this.classes = new Uint8Array(this.cellCols * this.cellRows);
    this.window = { ...EMPTY_WINDOW };
    this.lastCenterX = Number.NaN;
    this.lastCenterY = Number.NaN;
    this.lastGridRevision = grid.revision;
    this.lastMemoryRevision = memory.revision;
    this.lastObservedRevision = -1;
    return false;
  }
}

/** 记忆快照 → 小地图地形类别；只认记忆，不读 live 瓦片。 */
function tileClassOf(memory: TerrainMemory, col: number, row: number): number {
  const tile = memory.get(col, row);
  if (!tile || tile.typeIndex === MEMORY_UNKNOWN_TILE) return CLASS_NONE;
  const typeId = MEMORY_TILE_ORDER[tile.typeIndex];
  if (!typeId) return CLASS_NONE;
  const properties = getTileType(typeId);
  if (!properties.blocksLight) return CLASS_GROUND;
  return properties.isDestructible ? CLASS_MINERAL : CLASS_WALL;
}

function waterClass(type: TileTypeId | undefined): number | null {
  switch (type) {
    case TileTypeId.SHALLOW_WATER:
      return TERRAIN_CLASSES.indexOf("shallowWater");
    case TileTypeId.WATER:
      return TERRAIN_CLASSES.indexOf("water");
    case TileTypeId.DEEP_WATER:
      return TERRAIN_CLASSES.indexOf("deepWater");
    case TileTypeId.ULTRA_DEEP_WATER:
      return TERRAIN_CLASSES.indexOf("ultraDeepWater");
    default:
      return null;
  }
}
