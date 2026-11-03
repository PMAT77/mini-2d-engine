import type { TileMap } from '../map/TileMap';
import { circleCollider, collide } from '../physics/Collider';
import type { Collider } from '../physics/Collider';
import { castCollider } from '../physics/Motion';
import type { Point } from '../physics/Collider';

export interface NavPoint extends Point { key: number; }
export const NAV_NEIGHBORS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Radius-specific lazy caches are discarded as one unit on a terrain revision. */
export class NavigationGrid {
  private nodes = new Map<number, boolean>();
  private edges = new Map<string, number>();
  readonly revision: number;
  constructor(readonly map: TileMap, readonly radius: number, private readonly proposed: readonly Collider[] = []) {
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('导航半径必须为正有限数');
    this.revision = map.getNavigationRevision();
  }
  valid(): boolean { return this.revision === this.map.getNavigationRevision(); }
  contains(p: Point): boolean {
    return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= this.radius && p.y >= this.radius &&
      p.x <= this.map.width * this.map.tileSize - this.radius && p.y <= this.map.height * this.map.tileSize - this.radius;
  }
  walkable(p: Point): boolean {
    if (!this.contains(p)) return false;
    const body = circleCollider(p.x, p.y, this.radius);
    return this.map.isShapeWalkable(body) && !this.proposed.some(collider => collide(body, collider).some(c => c.depth > 1e-7))
      && this.map.getShapeSpeedFactor(body) > 0;
  }
  point(key: number): NavPoint {
    const tile = this.map.tileSize;
    return { key, x: (key % this.map.width + .5) * tile, y: (Math.floor(key / this.map.width) + .5) * tile };
  }
  node(col: number, row: number): NavPoint | null {
    if (col < 0 || row < 0 || col >= this.map.width || row >= this.map.height) return null;
    const key = row * this.map.width + col;
    let value = this.nodes.get(key);
    if (value === undefined) { value = this.walkable(this.point(key)); this.nodes.set(key, value); }
    return value ? this.point(key) : null;
  }
  /** Infinity means collision/zero terrain factor. Integrates slowdown at <= 1/4 tile spacing. */
  segmentCost(a: Point, b: Point): number {
    if (!this.walkable(a) || !this.walkable(b)) return Infinity;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (this.map.castShape(circleCollider(a.x, a.y, this.radius), { x: dx, y: dy })) return Infinity;
    if (this.proposed.length && castCollider({ getCollisionObstacles: () => this.proposed.map(collider => ({ collider, col: -1, row: -1 })) },
      circleCollider(a.x, a.y, this.radius), { x: dx, y: dy })) return Infinity;
    const length = Math.hypot(dx, dy), count = Math.max(1, Math.ceil(length / (this.map.tileSize / 4)));
    let total = 0;
    for (let i = 0; i <= count; i++) {
      const factor = this.map.getShapeSpeedFactor(circleCollider(a.x + dx * i / count, a.y + dy * i / count, this.radius));
      if (!Number.isFinite(factor) || factor <= 0) return Infinity;
      total += (i === 0 || i === count ? .5 : 1) / factor;
    }
    return length * total / count;
  }
  neighbors(p: NavPoint): { point: NavPoint; cost: number }[] {
    const col = p.key % this.map.width, row = Math.floor(p.key / this.map.width), result = [];
    for (const [dx, dy] of NAV_NEIGHBORS) {
      const next = this.node(col + dx, row + dy);
      if (!next || (dx && dy && (!this.node(col + dx, row) || !this.node(col, row + dy)))) continue;
      const edgeKey = p.key < next.key ? `${p.key}:${next.key}` : `${next.key}:${p.key}`;
      let cost = this.edges.get(edgeKey);
      if (cost === undefined) { cost = this.segmentCost(p, next); this.edges.set(edgeKey, cost); }
      if (Number.isFinite(cost)) result.push({ point: next, cost });
    }
    return result;
  }
  connections(p: Point): { point: NavPoint; cost: number }[] {
    const tile = this.map.tileSize, col = Math.floor(p.x / tile), row = Math.floor(p.y / tile), result = [];
    for (let y = row - 1; y <= row + 1; y++) for (let x = col - 1; x <= col + 1; x++) {
      const point = this.node(x, y); if (!point) continue;
      const cost = this.segmentCost(p, point); if (Number.isFinite(cost)) result.push({ point, cost });
    }
    return result;
  }
  goalCandidates(goal: Point): Point[] {
    if (this.walkable(goal)) return [{ ...goal }];
    const result: Point[] = [];
    const tile = this.map.tileSize, col = Math.floor(goal.x / tile), row = Math.floor(goal.y / tile);
    for (let y = row - 2; y <= row + 2; y++) for (let x = col - 2; x <= col + 2; x++) {
      const node = this.node(x, y);
      if (node && distance(node, goal) <= 100) result.push(node);
    }
    return result.sort((a, b) => distance(a, goal) - distance(b, goal) || a.y - b.y || a.x - b.x);
  }
  smooth(points: readonly Point[]): Point[] {
    if (points.length < 3) return points.map(p => ({ ...p }));
    const result = [{ ...points[0] }];
    for (let i = 0; i < points.length - 1;) {
      let chosen = i + 1, original = 0;
      // Bounded look-ahead keeps path finalization from becoming another unbounded search.
      for (let j = i + 1; j < Math.min(points.length, i + 9); j++) {
        original += this.segmentCost(points[j - 1], points[j]);
        if (this.segmentCost(points[i], points[j]) <= original * 1.05 + 1e-6) chosen = j;
      }
      result.push({ ...points[chosen] }); i = chosen;
    }
    return result;
  }
}
