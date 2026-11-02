import type { TileMap } from '../map/TileMap';
import { getTileType } from '../map/TileType';
import { circleCollider } from '../physics/Collider';
import { castCollider } from '../physics/Motion';
import { blastDamage, THROWABLE_CONFIG as C } from './ThrowableConfig';

/** Resolve every exposed tile before any mutation: this blast cannot tunnel through its own destruction. */
export function collectBlastTerrain(map: TileMap, x: number, y: number): { col: number; row: number; damage: number }[] {
  const hits: { col: number; row: number; damage: number }[] = [];
  const s = map.tileSize;
  for (let row = Math.max(0, Math.floor((y - C.blastRadius) / s)); row <= Math.min(map.height - 1, Math.floor((y + C.blastRadius) / s)); row++) {
    for (let col = Math.max(0, Math.floor((x - C.blastRadius) / s)); col <= Math.min(map.width - 1, Math.floor((x + C.blastRadius) / s)); col++) {
      if (!getTileType(map.tiles[row][col]).isDestructible) continue;
      const move = { x: (col + .5) * s - x, y: (row + .5) * s - y };
      const hit = castCollider({ getCollisionObstacles: bounds => map.getCollisionObstacles(bounds, 'projectile') }, circleCollider(x, y, .1), move);
      if (!hit || hit.obstacle.col !== col || hit.obstacle.row !== row) continue;
      const damage = blastDamage(Math.hypot(move.x, move.y) * hit.fraction);
      if (damage > 0) hits.push({ col, row, damage });
    }
  }
  return hits;
}
