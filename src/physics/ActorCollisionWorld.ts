import type { TileMap } from '../map/TileMap';
import { overlapsBounds } from './Collider';
import type { Bounds, Collider, Point } from './Collider';
import { resolveMotion } from './Motion';
import type { CollisionObstacle, MotionResult } from './Motion';

export interface CollisionActor {
  x: number; y: number;
  getSize(): number;
  getCollider(): Collider;
}
interface Entry { id: string; actor: CollisionActor; body: Collider; cells: string[]; }

/** Static terrain and nearby actors are swept together, including rolls and knockback. */
export class ActorCollisionWorld {
  readonly cellSize = 100;
  private entries = new Map<string, Entry>();
  private cells = new Map<string, Set<string>>();
  constructor(readonly map: TileMap) {}

  register(id: string, actor: CollisionActor): void {
    if (this.entries.has(id)) throw new Error(`重复角色 ID: ${id}`);
    this.entries.set(id, { id, actor, body: actor.getCollider(), cells: [] });
    this.sync(id);
  }
  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.unlink(entry); this.entries.delete(id);
  }
  clear(): void { this.entries.clear(); this.cells.clear(); }
  get size(): number { return this.entries.size; }
  sync(id?: string): void {
    if (id) { const e = this.entries.get(id); if (e) this.place(e, e.actor.getCollider()); }
    else for (const e of this.entries.values()) this.place(e, e.actor.getCollider());
  }
  private keys(b: Bounds): string[] {
    const keys: string[] = [];
    for (let row = Math.floor(b.y / 100); row <= Math.floor((b.y + b.height) / 100); row++)
      for (let col = Math.floor(b.x / 100); col <= Math.floor((b.x + b.width) / 100); col++) keys.push(`${col},${row}`);
    return keys;
  }
  private unlink(e: Entry): void {
    for (const key of e.cells) { const bucket = this.cells.get(key); bucket?.delete(e.id); if (!bucket?.size) this.cells.delete(key); }
  }
  private place(e: Entry, body: Collider): void {
    e.body = body;
    const keys = this.keys(body.bounds);
    if (keys.length === e.cells.length && keys.every((k, i) => k === e.cells[i])) return;
    this.unlink(e); e.cells = keys;
    for (const key of keys) { let bucket = this.cells.get(key); if (!bucket) this.cells.set(key, bucket = new Set()); bucket.add(e.id); }
  }
  nearby(bounds: Bounds, exclude?: string): Entry[] {
    const ids = new Set<string>();
    for (const key of this.keys(bounds)) for (const id of this.cells.get(key) ?? []) if (id !== exclude) ids.add(id);
    return [...ids].sort().map(id => this.entries.get(id)!).filter(e => overlapsBounds(bounds, e.body.bounds));
  }
  resolve(id: string, body: Collider, movement: Point, rotation = 0): MotionResult {
    const result = resolveMotion({ getCollisionObstacles: bounds => {
      const obstacles: CollisionObstacle[] = this.map.getCollisionObstacles(bounds);
      for (const e of this.nearby(bounds, id)) obstacles.push({ collider: e.body, col: -1, row: -1 });
      return obstacles;
    } }, body, movement, rotation);
    const e = this.entries.get(id); if (e) this.place(e, result.collider);
    return result;
  }
  /** At most four conservative passes. Each repair is itself swept against terrain. */
  separate(): void {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const id of [...this.entries.keys()].sort()) {
        const a = this.entries.get(id)!;
        for (const b of this.nearby(a.body.bounds, id)) {
          if (b.id <= id) continue;
          const dx = b.body.pose.x - a.body.pose.x, dy = b.body.pose.y - a.body.pose.y;
          const distance = Math.hypot(dx, dy), depth = a.body.radius + b.body.radius - distance;
          if (depth <= .01) continue;
          const nx = distance > 1e-9 ? dx / distance : 1, ny = distance > 1e-9 ? dy / distance : 0;
          for (const [e, sign] of [[a, -1], [b, 1]] as const) {
            const amount = Math.min(4, depth / 2 + .001);
            const result = this.map.resolveMotion(e.body, { x: nx * sign * amount, y: ny * sign * amount });
            if (result.exhausted || !this.map.isShapeWalkable(result.collider)) continue;
            // Do not fix one pair by introducing another overlap.
            const worsens = this.nearby(result.collider.bounds, e.id).some(other => {
              if (other.id === a.id || other.id === b.id) return false;
              return Math.hypot(result.collider.pose.x - other.body.pose.x, result.collider.pose.y - other.body.pose.y) + .01 <
                Math.min(e.body.radius + other.body.radius, Math.hypot(e.body.pose.x - other.body.pose.x, e.body.pose.y - other.body.pose.y));
            });
            if (worsens) continue;
            moved ||= Math.hypot(result.collider.pose.x - e.body.pose.x, result.collider.pose.y - e.body.pose.y) > .001;
            e.actor.x = result.collider.pose.x - e.actor.getSize() / 2;
            e.actor.y = result.collider.pose.y - e.actor.getSize() / 2;
            this.place(e, e.actor.getCollider());
          }
        }
      }
      if (!moved) break;
    }
  }
}
