/**
 * 25px 世界格上的“是否曾经看见过”覆盖层。
 * 只记录覆盖，不记录地形内容；半瓦片由这里裁剪，而不是让整块瓦片一起亮相。
 */
export class ExplorationGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  revision = 0;

  private readonly cells: Uint8Array;
  private exploredCells = 0;

  constructor(worldWidth: number, worldHeight: number, cellSize = 25) {
    if (!Number.isFinite(worldWidth) || worldWidth <= 0) throw new Error('探索网格世界宽度必须是正有限数值');
    if (!Number.isFinite(worldHeight) || worldHeight <= 0) throw new Error('探索网格世界高度必须是正有限数值');
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('探索格尺寸必须是正有限数值');
    this.cellSize = cellSize;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.cells = new Uint8Array(this.cols * this.rows);
  }

  get exploredCount(): number { return this.exploredCells; }

  cellIndex(col: number, row: number): number {
    return row * this.cols + col;
  }

  isExploredCell(col: number, row: number): boolean {
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
    return this.cells[this.cellIndex(col, row)] === 1;
  }

  isExplored(worldX: number, worldY: number): boolean {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    return this.isExploredCell(Math.floor(worldX / this.cellSize), Math.floor(worldY / this.cellSize));
  }

  markCell(col: number, row: number): boolean {
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
    const index = this.cellIndex(col, row);
    if (this.cells[index] === 1) return false;
    this.cells[index] = 1;
    this.exploredCells++;
    this.revision++;
    return true;
  }

  markExplored(worldX: number, worldY: number): boolean {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    return this.markCell(Math.floor(worldX / this.cellSize), Math.floor(worldY / this.cellSize));
  }

  clear(): void {
    this.cells.fill(0);
    this.exploredCells = 0;
    this.revision++;
  }
}
