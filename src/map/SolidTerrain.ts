import { Bounds, Collider, Point, Polygon, boundsOf, overlapsBounds, rectangleCollider } from '../physics/Collider';

export interface SolidPatch { col: number; row: number; polygon: Polygon; collider: Collider; }
interface LocalPatch { vertices: Point[]; col: number; row: number; }
const RADIUS = 0.3, STEPS = 8;
const templates = new Map<number, LocalPatch[]>();
const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
const axes = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const snap = (n: number) => Math.round(n * 1e12) / 1e12;
function inside(vertices: Point[], x: number, y: number): boolean {
  let result = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function template(mask: number): LocalPatch[] {
  const cached = templates.get(mask);
  if (cached) return cached;
  const occupied = (x: number, y: number) => !!(mask & (1 << ((y + 1) * 3 + x + 1)));
  const patches: LocalPatch[] = [], outline: Point[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const [cx, cy] = corners[corner], [ux, uy] = axes[corner], vx = -uy, vy = ux;
    const point = (u: number, v: number) => ({ x: snap(cx + ux * u + vx * v), y: snap(cy + uy * u + vy * v) });
    const a = occupied(-ux, -uy), b = occupied(-vx, -vy);
    if (occupied(0, 0)) {
      if (!a && !b) for (let i = 0; i <= STEPS; i++) {
        const angle = Math.PI + i * Math.PI / (2 * STEPS);
        outline.push(point(RADIUS * (1 + Math.cos(angle)), RADIUS * (1 + Math.sin(angle))));
      } else outline.push(point(0, RADIUS), point(0, 0), point(RADIUS, 0));
    } else if (a && b && occupied(-ux - vx, -uy - vy)) {
      // Disjoint triangles fill the concave corner; the bisector preserves material ownership.
      const arc = Array.from({ length: STEPS + 1 }, (_, i) => {
        const angle = -Math.PI / 2 - i * Math.PI / (2 * STEPS);
        return point(RADIUS * (1 + Math.cos(angle)), RADIUS * (1 + Math.sin(angle)));
      });
      for (let i = 0; i < STEPS; i++) patches.push({ vertices: [point(0, 0), arc[i], arc[i + 1]],
        col: i < STEPS / 2 ? -vx : -ux, row: i < STEPS / 2 ? -vy : -uy });
    }
  }
  if (outline.length) patches.push({ vertices: outline, col: 0, row: 0 });
  templates.set(mask, patches);
  return patches;
}

/** Local topology only: public tile-array edits are observed without a full-map dirty scan. */
export class SolidTerrain {
  private cells = new Map<number, { mask: number; size: number; patches: SolidPatch[] }>();
  constructor(private occupied: (col: number, row: number) => boolean) {}
  private mask(col: number, row: number): number {
    let mask = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++)
      if (this.occupied(col + x, row + y)) mask |= 1 << ((y + 1) * 3 + x + 1);
    return mask;
  }
  contains(x: number, y: number, size: number): boolean {
    const col = Math.floor(x / size), row = Math.floor(y / size);
    return template(this.mask(col, row)).some(p => inside(p.vertices, x / size - col, y / size - row));
  }
  getCell(col: number, row: number, size: number): SolidPatch[] {
    const mask = this.mask(col, row), key = col * 0x10000 + row, cached = this.cells.get(key);
    if (cached?.mask === mask && cached.size === size) return cached.patches;
    const patches = template(mask).map(local => {
      const vertices = local.vertices.map(p => ({ x: (col + p.x) * size, y: (row + p.y) * size }));
      const edges = vertices.map((a, i) => {
        const b = vertices[(i + 1) % vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y);
        const epsilon = size * 1e-7;
        return !this.contains((a.x + b.x) / 2 + (b.y - a.y) / length * epsilon,
          (a.y + b.y) / 2 - (b.x - a.x) / length * epsilon, size);
      });
      const polygon: Polygon = { type: 'polygon', vertices, edges, terrain: true };
      if (vertices.length === 12 && [1, 4, 7, 10].every(i => edges[i] === edges[(i + 1) % 12] && edges[i] === edges[(i + 2) % 12])) {
        const collider = rectangleCollider(col * size, row * size, size, size, [edges[1], edges[4], edges[7], edges[10]]);
        return { col, row, polygon: collider.parts[0] as Polygon, collider };
      }
      // All patches are convex. Keep collinear border vertices to mark partially hidden sides.
      const collider = rectangleCollider(col * size, row * size, size, size);
      collider.parts = collider.pieces = [polygon];
      collider.bounds = boundsOf([polygon]);
      collider.area = Math.abs(vertices.reduce((sum, a, i) => {
        const b = vertices[(i + 1) % vertices.length]; return sum + a.x * b.y - a.y * b.x;
      }, 0)) / 2;
      const localPolygon = { ...polygon, vertices: vertices.map(p => ({ x: p.x - collider.pose.x, y: p.y - collider.pose.y })) };
      collider.compiled = { shape: { type: 'polygon', vertices: localPolygon.vertices.map(p => [p.x, p.y]) },
        parts: [localPolygon], pieces: [localPolygon], radius: collider.radius, area: collider.area };
      return { col: col + local.col, row: row + local.row, polygon, collider };
    });
    this.cells.set(key, { mask, size, patches });
    return patches;
  }
  query(bounds: Bounds, size: number, width: number, height: number): SolidPatch[] {
    if (bounds.width < 0 || bounds.height < 0) return [];
    const patches: SolidPatch[] = [];
    for (let row = Math.max(0, Math.floor(bounds.y / size) - 1); row <= Math.min(height - 1, Math.floor((bounds.y + bounds.height) / size) + 1); row++) {
      for (let col = Math.max(0, Math.floor(bounds.x / size) - 1); col <= Math.min(width - 1, Math.floor((bounds.x + bounds.width) / size) + 1); col++) {
        if (overlapsBounds(bounds, { x: col * size, y: row * size, width: size, height: size })) {
          for (const patch of this.getCell(col, row, size)) patches.push(patch);
        }
      }
    }
    return patches;
  }
}

/** One path/fill for a union; separate antialiased fills would expose internal seams. */
export function solidPath(ctx: CanvasPath, polygons: Polygon[], cameraX: number, cameraY: number): void {
  for (const { vertices } of polygons) {
    vertices.forEach((p, i) => i ? ctx.lineTo(p.x - cameraX, p.y - cameraY) : ctx.moveTo(p.x - cameraX, p.y - cameraY));
    ctx.closePath();
  }
}
