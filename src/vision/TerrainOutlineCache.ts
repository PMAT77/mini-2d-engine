import { TILE_TYPES, TileTypeId } from "../map/TileType";
import type { TerrainSource } from "./VisionTypes";

/** 未知区轮廓只用一种冷灰色，不暴露矿种、道路或资源位置。 */
export const TERRAIN_OUTLINE_RGB = "126, 142, 158";

/**
 * 未知区域的初始地形快照。
 *
 * 只记录“建图时”的阻挡瓦片，不随后续破坏更新：这是刻意的信息设计，避免玩家从远处
 * 的轮廓变化推断世界状态。几何仍然交给 SolidTerrain 的圆角拓扑，快照只提供
 * “这块瓦片当初是否挡光”这一位信息。
 *
 * 3D 视野的三层合成把它和 TerrainMemory 合并成一条统一的轮廓路径：
 * 已经观察过的瓦片以记忆为准，其余以这份快照为准，因此当场画面不会因为
 * 探索网格的离散边界而出现亮度跳变。
 */
export class TerrainOutlineCache {
  readonly width: number;
  readonly height: number;
  private readonly blocked: Uint8Array;

  constructor(terrain: TerrainSource) {
    this.width = terrain.width;
    this.height = terrain.height;
    this.blocked = new Uint8Array(this.width * this.height);
    for (let row = 0; row < this.height; row++) {
      const tiles = terrain.tiles[row];
      if (!tiles) continue;
      for (let col = 0; col < this.width; col++) {
        const type: TileTypeId | undefined = tiles[col];
        if (type !== undefined && TILE_TYPES[type]?.blocksLight) {
          this.blocked[row * this.width + col] = 1;
        }
      }
    }
  }

  /** 只用建图时的瓦片快照；不读 live map，也不随后续破坏更新。 */
  blocksLight(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return false;
    return this.blocked[row * this.width + col] === 1;
  }
}
