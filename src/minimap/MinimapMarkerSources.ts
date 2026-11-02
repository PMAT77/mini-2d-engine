import { getTileType } from "../map/TileType";
import { MEMORY_TILE_ORDER, MEMORY_UNKNOWN_TILE, type TerrainMemory } from "../vision/TerrainMemory";
import { mineralMarkerId } from "./MinimapMarkerStore";
import type { MinimapMarkerSpec } from "./MinimapTypes";
import type { Bounds } from "../physics/Collider";

/**
 * 从“玩家已知地形快照”里整理出矿石标记。
 *
 * 关键点：只读 TerrainMemory，不读 TileMap.tiles。矿石被摧毁后，只有在玩家再次
 * 观察到该瓦片、记忆被刷新时标记才会消失；否则地图上保留的是“最后一次看到它”
 * 的位置，符合三层视野对记忆的要求。
 *
 * 可限制到当前小地图的世界范围；省略范围时保留全量收集行为。
 */
export function collectMineralMarkers(
  memory: TerrainMemory,
  out: MinimapMarkerSpec[] = [],
  bounds?: Bounds
): MinimapMarkerSpec[] {
  out.length = 0;
  const tileSize = memory.tileSize;
  const left = bounds ? Math.max(0, Math.floor(bounds.x / tileSize)) : 0;
  const top = bounds ? Math.max(0, Math.floor(bounds.y / tileSize)) : 0;
  const right = bounds ? Math.min(memory.cols, Math.ceil((bounds.x + bounds.width) / tileSize)) : memory.cols;
  const bottom = bounds ? Math.min(memory.rows, Math.ceil((bounds.y + bounds.height) / tileSize)) : memory.rows;
  for (let row = top; row < bottom; row++) {
    for (let col = left; col < right; col++) {
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
