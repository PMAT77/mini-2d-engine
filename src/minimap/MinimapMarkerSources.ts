import { getTileType } from "../map/TileType";
import { MEMORY_TILE_ORDER, MEMORY_UNKNOWN_TILE, type TerrainMemory } from "../vision/TerrainMemory";
import { mineralMarkerId } from "./MinimapMarkerStore";
import type { MinimapMarkerSpec } from "./MinimapTypes";

/**
 * 从“玩家已知地形快照”里整理出矿石标记。
 *
 * 关键点：只读 TerrainMemory，不读 TileMap.tiles。矿石被摧毁后，只有在玩家再次
 * 观察到该瓦片、记忆被刷新时标记才会消失；否则地图上保留的是“最后一次看到它”
 * 的位置，符合三层视野对记忆的要求。
 *
 * 复杂度是 O(瓦片数)，所以只在 TerrainMemory.revision 变化时调用，不在每帧调用。
 */
export function collectMineralMarkers(
  memory: TerrainMemory,
  out: MinimapMarkerSpec[] = []
): MinimapMarkerSpec[] {
  out.length = 0;
  const tileSize = memory.tileSize;
  for (let row = 0; row < memory.rows; row++) {
    for (let col = 0; col < memory.cols; col++) {
      const tile = memory.get(col, row);
      if (!tile || tile.typeIndex === MEMORY_UNKNOWN_TILE) continue;
      const typeId = MEMORY_TILE_ORDER[tile.typeIndex];
      if (!typeId) continue;
      const properties = getTileType(typeId);
      // 只有可破坏的阻挡瓦片才是矿石；墙与地面都不是资源点。
      if (!properties.isDestructible) continue;
      out.push({
        id: mineralMarkerId(col, row),
        type: "mineral",
        x: (col + 0.5) * tileSize,
        y: (row + 0.5) * tileSize,
        visible: true,
        state: tile.damageStage > 0 ? "damaged" : "default",
      });
    }
  }
  return out;
}
