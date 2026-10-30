import { TILE_TYPES, TileTypeId } from '../map/TileType';
import type { TerrainSource } from './VisionTypes';

/** 稳定的字符串枚举索引；不能把 TileTypeId 直接当 Uint8Array 的下标。 */
export const MEMORY_TILE_ORDER: readonly TileTypeId[] = [
  TileTypeId.DEFAULT,
  TileTypeId.WATER,
  TileTypeId.SHALLOW_WATER,
  TileTypeId.DEEP_WATER,
  TileTypeId.ULTRA_DEEP_WATER,
  TileTypeId.WALL,
  TileTypeId.MINERAL,
  TileTypeId.HEALTH_MINERAL,
  TileTypeId.SPEED_MINERAL,
  TileTypeId.FIRE_RATE_MINERAL,
  TileTypeId.BULLET_SPEED_MINERAL,
  TileTypeId.DAMAGE_MINERAL
];

const TILE_INDEX = new Map<TileTypeId, number>(MEMORY_TILE_ORDER.map((type, index) => [type, index]));
export const MEMORY_UNKNOWN_TILE = 255;

export interface MemoryTile {
  typeIndex: number;
  damageStage: number;
}

/**
 * 观察时冻结的地形快照。它不读取 live TileMap 来刷新记忆；
 * 只有玩家当前确实看见该瓦片时才 capture。
 */
export class TerrainMemory {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  revision = 0;

  private readonly types: Uint8Array;
  private readonly damage: Uint8Array;
  private readonly captured: Uint8Array;

  constructor(private readonly terrain: TerrainSource) {
    if (!Number.isFinite(terrain.tileSize) || terrain.tileSize <= 0) throw new Error('地形记忆瓦片尺寸必须是正有限数值');
    if (!Number.isInteger(terrain.width) || terrain.width <= 0) throw new Error('地形记忆宽度必须是正整数');
    if (!Number.isInteger(terrain.height) || terrain.height <= 0) throw new Error('地形记忆高度必须是正整数');
    this.cols = terrain.width;
    this.rows = terrain.height;
    this.tileSize = terrain.tileSize;
    const size = this.cols * this.rows;
    this.types = new Uint8Array(size).fill(MEMORY_UNKNOWN_TILE);
    this.damage = new Uint8Array(size);
    this.captured = new Uint8Array(size);
  }

  isCaptured(col: number, row: number): boolean {
    return this.inBounds(col, row) && this.captured[row * this.cols + col] === 1;
  }

  get(col: number, row: number): MemoryTile | null {
    if (!this.inBounds(col, row)) return null;
    const index = row * this.cols + col;
    if (this.captured[index] !== 1) return null;
    return { typeIndex: this.types[index], damageStage: this.damage[index] };
  }

  /** 记录/刷新一个瓦片；返回是否发生变化。 */
  capture(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    const type = this.terrain.tiles[row]?.[col];
    if (!type) return false;
    const typeIndex = TILE_INDEX.get(type) ?? MEMORY_UNKNOWN_TILE;
    const damageStage = this.damageStage(type, row, col);
    const index = row * this.cols + col;
    const changed = this.captured[index] !== 1 || this.types[index] !== typeIndex || this.damage[index] !== damageStage;
    this.types[index] = typeIndex;
    this.damage[index] = damageStage;
    this.captured[index] = 1;
    if (changed) this.revision++;
    return changed;
  }

  /** 25px 探索格中心所在的瓦片。半瓦片裁剪由探索 mask 负责。 */
  captureWorld(worldX: number, worldY: number): boolean {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    return this.capture(Math.floor(worldX / this.tileSize), Math.floor(worldY / this.tileSize));
  }

  private inBounds(col: number, row: number): boolean {
    return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  private damageStage(type: TileTypeId, row: number, col: number): number {
    if (type === TileTypeId.DEFAULT) return 0;
    const hp = this.terrain.tileHp?.[row]?.[col];
    if (!Number.isFinite(hp)) return 0;
    if ((hp as number) <= 0) return 3;
    const durability = TILE_TYPES[type]?.durability ?? 100;
    if (!(durability > 0)) return 0;
    const ratio = (hp as number) / durability;
    if (ratio > 0.75) return 0;
    if (ratio > 0.5) return 1;
    if (ratio > 0.25) return 2;
    return 3;
  }
}
