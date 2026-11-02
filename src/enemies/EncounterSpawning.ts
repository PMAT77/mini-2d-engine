import type { TileMap } from '../map/TileMap';
import { NavigationGrid } from '../navigation/NavigationGrid';
import { circleCollider } from '../physics/Collider';
import type { Point } from '../physics/Collider';

export interface SpawnReport { kind: string; requested: number; spawned: number; skipped: number; reason?: string; }
/** Load-time connected components, kept separate from the gameplay search budget. */
export class EncounterSpawning {
  private connected = new Map<number, { grid: NavigationGrid; keys: Set<number> }>();
  constructor(private readonly map: TileMap, private readonly origin: Point, private readonly random: () => number) {}
  private region(radius: number) {
    let cached = this.connected.get(radius);
    if (cached?.grid.valid()) return cached;
    const grid = new NavigationGrid(this.map, radius), keys = new Set<number>();
    const queue = grid.connections(this.origin).map(c => c.point);
    for (const p of queue) keys.add(p.key);
    for (let i = 0; i < queue.length; i++) for (const edge of grid.neighbors(queue[i])) {
      if (!keys.has(edge.point.key)) { keys.add(edge.point.key); queue.push(edge.point); }
    }
    cached = { grid, keys }; this.connected.set(radius, cached); return cached;
  }
  find(radius: number, minDistance: number, maxDistance: number, occupied: readonly { center: Point; radius: number }[], attempts = 200, scanFallback = false, clearance = radius): Point | null {
    const region = this.region(radius);
    for (let i = 0; i < attempts; i++) {
      const angle = this.random() * Math.PI * 2, distance = minDistance + this.random() * (maxDistance - minDistance);
      const point = { x: this.origin.x + Math.cos(angle) * distance, y: this.origin.y + Math.sin(angle) * distance };
      const body = circleCollider(point.x, point.y, clearance);
      if (!region.grid.walkable(point) || !this.map.isShapeWalkable(body) || this.map.getShapeSpeedFactor(body) !== 1) continue;
      if (occupied.some(o => Math.hypot(o.center.x - point.x, o.center.y - point.y) < o.radius + radius + 12)) continue;
      if (region.grid.connections(point).some(c => region.keys.has(c.point.key))) return point;
    }
    if (scanFallback) for (const key of region.keys) {
      const point = region.grid.point(key), body = circleCollider(point.x, point.y, clearance);
      if (Math.hypot(point.x - this.origin.x, point.y - this.origin.y) < minDistance || !this.map.isShapeWalkable(body) || this.map.getShapeSpeedFactor(body) !== 1) continue;
      if (!occupied.some(o => Math.hypot(o.center.x - point.x, o.center.y - point.y) < o.radius + radius + 12)) return point;
    }
    return null;
  }
}
