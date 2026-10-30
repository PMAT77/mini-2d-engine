import { TILE_TYPES, TileTypeId } from "../map/TileType";
import type { TerrainSource } from "./VisionTypes";

const CHUNK_TILES = 16;
/** 未知区轮廓只用一种冷灰色，不暴露矿种、道路或资源位置。 */
const OUTLINE_RGB = "126, 142, 158";

/**
 * 未知区域的初始地形轮廓。
 *
 * 只烘焙一次“建图时”的地形，不随后续破坏更新：这是刻意的信息设计，避免玩家从远处
 * 的轮廓变化推断世界状态。所有 blocksLight 瓦片使用同一障碍色，矿种/图标不参与。
 */
export class TerrainOutlineCache {
  private readonly terrain: TerrainSource;
  private readonly tiles: ReadonlyArray<ReadonlyArray<TileTypeId>>;
  private readonly chunkTiles = CHUNK_TILES;
  private readonly chunks = new Map<string, HTMLCanvasElement>();
  private scale: number;
  private contrast: number;
  private chunkWorldSize: number;
  private chunkPixelSize: number;

  constructor(terrain: TerrainSource, scale: number, contrast: number) {
    this.terrain = terrain;
    this.tiles = terrain.tiles.map(row => row.slice());
    this.scale = Math.max(0.05, scale);
    this.contrast = Math.max(0, contrast);
    this.chunkWorldSize = CHUNK_TILES * terrain.tileSize;
    this.chunkPixelSize = Math.max(1, Math.ceil(this.chunkWorldSize * this.scale));
  }

  configure(scale: number, contrast: number): void {
    const nextScale = Math.max(0.05, scale);
    const nextContrast = Math.max(0, contrast);
    if (nextScale !== this.scale) {
      this.scale = nextScale;
      this.chunkPixelSize = Math.max(1, Math.ceil(this.chunkWorldSize * this.scale));
      this.chunks.clear();
    }
    if (nextContrast !== this.contrast) {
      this.contrast = nextContrast;
      this.chunks.clear();
    }
  }

  /**
   * 在已经设置为“半分辨率 + 相机偏移”的上下文里按世界坐标绘制。
   * 只取视口覆盖到的块，块本身只包含静态初始地形。
   */
  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    if (this.contrast <= 0) return;
    const chunkCols = Math.ceil(this.terrain.width / CHUNK_TILES);
    const chunkRows = Math.ceil(this.terrain.height / CHUNK_TILES);
    const startCol = Math.max(0, Math.floor(cameraX / this.chunkWorldSize));
    const startRow = Math.max(0, Math.floor(cameraY / this.chunkWorldSize));
    const endCol = Math.min(chunkCols - 1, Math.floor((cameraX + viewWidth) / this.chunkWorldSize));
    const endRow = Math.min(chunkRows - 1, Math.floor((cameraY + viewHeight) / this.chunkWorldSize));

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const chunk = this.getChunk(col, row);
        ctx.drawImage(chunk, col * this.chunkWorldSize, row * this.chunkWorldSize,
          this.chunkWorldSize, this.chunkWorldSize);
      }
    }
  }

  private getChunk(col: number, row: number): HTMLCanvasElement {
    const key = `${col},${row}`;
    const cached = this.chunks.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = this.chunkPixelSize;
    canvas.height = this.chunkPixelSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    const alpha = Math.min(0.5, Math.max(0.02, this.contrast * 4));
    ctx.fillStyle = `rgba(${OUTLINE_RGB}, ${alpha})`;
    const tileSize = this.terrain.tileSize;
    const pixelTile = tileSize * this.scale;
    const startCol = col * CHUNK_TILES;
    const startRow = row * CHUNK_TILES;
    const endCol = Math.min(this.terrain.width, startCol + CHUNK_TILES);
    const endRow = Math.min(this.terrain.height, startRow + CHUNK_TILES);

    for (let tileRow = startRow; tileRow < endRow; tileRow++) {
      const tiles = this.tiles[tileRow];
      if (!tiles) continue;
      for (let tileCol = startCol; tileCol < endCol; tileCol++) {
        const type = tiles[tileCol];
        if (!type || !TILE_TYPES[type]?.blocksLight) continue;
        ctx.fillRect((tileCol - startCol) * pixelTile, (tileRow - startRow) * pixelTile,
          pixelTile, pixelTile);
      }
    }

    this.chunks.set(key, canvas);
    return canvas;
  }
}
