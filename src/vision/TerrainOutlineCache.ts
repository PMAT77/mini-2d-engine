import { SolidTerrain, solidPath } from "../map/SolidTerrain";
import { TILE_TYPES, TileTypeId } from "../map/TileType";
import type { TerrainSource } from "./VisionTypes";

/** 未知区轮廓只用一种冷灰色，不暴露矿种、道路或资源位置。 */
const OUTLINE_RGB = "126, 142, 158";
const CACHE_LIMIT = 12;
const MARGIN_TILES = 2;

/**
 * 未知区域的初始地形轮廓。
 *
 * 只烘焙一次“建图时”的地形，不随后续破坏更新：这是刻意的信息设计，避免玩家从远处
 * 的轮廓变化推断世界状态。几何直接复用 SolidTerrain 的圆角拓扑，和碰撞/光照使用
 * 同一套连续墙面；所有 blocksLight 瓦片使用同一障碍色，矿种/图标不参与。
 */
export class TerrainOutlineCache {
  private readonly terrain: TerrainSource;
  private readonly tiles: ReadonlyArray<ReadonlyArray<TileTypeId>>;
  private readonly solids: SolidTerrain;
  private readonly paths = new Map<string, Path2D>();
  private contrast: number;

  constructor(terrain: TerrainSource, _scale: number, contrast: number) {
    this.terrain = terrain;
    this.tiles = terrain.tiles.map(row => row.slice());
    this.solids = new SolidTerrain((col, row) => this.isBlocking(col, row));
    this.contrast = Math.max(0, contrast);
  }

  configure(_scale: number, contrast: number): void {
    const nextContrast = Math.max(0, contrast);
    if (nextContrast !== this.contrast) this.contrast = nextContrast;
  }

  /**
   * 在已经设置为“半分辨率 + 相机偏移”的上下文里按世界坐标绘制。
   * 路径按瓦片对齐的视口缓存；静态快照不变，所以只需在视口跨瓦片时重建。
   */
  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    if (this.contrast <= 0) return;
    const path = this.getPath(cameraX, cameraY, viewWidth, viewHeight);
    if (!path) return;
    const alpha = Math.min(0.5, Math.max(0.02, this.contrast * 4));
    ctx.fillStyle = `rgba(${OUTLINE_RGB}, ${alpha})`;
    ctx.fill(path);
  }

  private getPath(cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): Path2D | null {
    const size = this.terrain.tileSize;
    const margin = size * MARGIN_TILES;
    const startCol = Math.max(0, Math.floor((cameraX - margin) / size));
    const startRow = Math.max(0, Math.floor((cameraY - margin) / size));
    const endCol = Math.min(this.terrain.width, Math.ceil((cameraX + viewWidth + margin) / size));
    const endRow = Math.min(this.terrain.height, Math.ceil((cameraY + viewHeight + margin) / size));
    if (endCol <= startCol || endRow <= startRow) return null;

    const key = `${startCol},${startRow},${endCol},${endRow}`;
    const cached = this.paths.get(key);
    if (cached) return cached;

    const polygons = this.solids.query({
      x: startCol * size,
      y: startRow * size,
      width: (endCol - startCol) * size,
      height: (endRow - startRow) * size,
    }, size, this.terrain.width, this.terrain.height).map(patch => patch.polygon);
    const path = new Path2D();
    solidPath(path, polygons, 0, 0);
    this.paths.set(key, path);
    if (this.paths.size > CACHE_LIMIT) {
      const oldest = this.paths.keys().next().value;
      if (oldest !== undefined) this.paths.delete(oldest);
    }
    return path;
  }

  /** 只用建图时的瓦片快照；不读 live map，也不随后续破坏更新。 */
  private isBlocking(col: number, row: number): boolean {
    const type = this.tiles[row]?.[col];
    return !!type && !!TILE_TYPES[type]?.blocksLight;
  }
}
