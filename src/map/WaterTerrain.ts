import { Bounds, Collider, Point, Polygon, compileShape, rectangleCollider, transformCollider } from '../physics/Collider';
import { TILE_TYPES, TileTypeId } from './TileType';

export const WATER_TYPES = [TileTypeId.SHALLOW_WATER, TileTypeId.WATER, TileTypeId.DEEP_WATER, TileTypeId.ULTRA_DEEP_WATER];
const THRESHOLDS = [0, 0.25, 0.5, 0.75];
type Vertex = Point & { depth: number };
interface WaterTile {
  samples: number[];
  type?: TileTypeId;
  cumulative: Vertex[][][];
}
export interface WaterCell {
  type?: TileTypeId;
  cumulative: Polygon[][];
  full: boolean[];
  obstacles: Collider[];
}
export interface Lake {
  bounds: Bounds;
  center: Point;
  cells: number[];
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const level = (depth: number) => depth <= 0 ? -1 : Math.min(3, Math.floor(depth * 4));

/** All triangles have the same winding. Shared intersections use the same endpoint ordering. */
function clip(triangle: Vertex[], threshold: number): Vertex[] {
  const result: Vertex[] = [];
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % triangle.length];
    if (a.depth >= threshold) result.push(a);
    if ((a.depth >= threshold) !== (b.depth >= threshold)) {
      const [lo, hi] = a.depth < b.depth ? [a, b] : [b, a];
      const t = (threshold - lo.depth) / (hi.depth - lo.depth);
      result.push({ x: lo.x + (hi.x - lo.x) * t, y: lo.y + (hi.y - lo.y) * t, depth: threshold });
    }
  }
  const unique = result.filter((p, i) => {
    const previous = result[(i + result.length - 1) % result.length];
    return Math.hypot(p.x - previous.x, p.y - previous.y) > 1e-9;
  });
  const area = unique.reduce((sum, p, i) => {
    const q = unique[(i + 1) % unique.length];
    return sum + p.x * q.y - p.y * q.x;
  }, 0);
  return area > 1e-10 ? unique : [];
}

/** Cancel triangle seams once, before any movement query or rasterization. */
function mergePolygons(polygons: Vertex[][]): Vertex[][] {
  const key = (p: Point) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
  const edges = new Map<string, [Vertex, Vertex]>();
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], forward = `${key(a)}:${key(b)}`, reverse = `${key(b)}:${key(a)}`;
    if (edges.has(reverse)) edges.delete(reverse); else edges.set(forward, [a, b]);
  }
  const outgoing = new Map<string, Vertex[]>();
  for (const [a, b] of edges.values()) {
    const next = outgoing.get(key(a));
    if (next) next.push(b); else outgoing.set(key(a), [b]);
  }
  const result: Vertex[][] = [];
  while (outgoing.size) {
    const start = outgoing.keys().next().value!, vertices: Vertex[] = [];
    let current = start;
    do {
      const next = outgoing.get(current);
      if (!next) throw new Error('水域轮廓未闭合');
      const vertex = next.pop()!;
      if (!next.length) outgoing.delete(current);
      vertices.push(vertex);
      current = key(vertex);
    } while (current !== start);
    // Collinear grid points carry no boundary information.
    result.push(vertices.filter((p, i) => {
      const a = vertices[(i + vertices.length - 1) % vertices.length], b = vertices[(i + 1) % vertices.length];
      return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-12;
    }));
  }
  return result;
}

/** Static water in tile coordinates; only the requested cells are scaled for physics. */
export class WaterTerrain {
  readonly lakes: Lake[] = [];
  private tiles = new Map<number, WaterTile>();
  private scaled = new Map<number, WaterCell>();
  private images = new Map<Lake, HTMLCanvasElement>();
  private scale = 0;

  constructor(private width: number, height: number, random: () => number) {
    const area = width * height;
    if (Math.min(width, height) < 12) return;
    const count = Math.max(1, Math.min(6, Math.round(area / 2000) + Math.floor(random() * 3) - 1));
    const radius = Math.min(10, Math.sqrt(area * 0.1 / (count * Math.PI)), (Math.min(width, height) - 4) / (2.4 * Math.sqrt(1.25)));
    for (let attempt = 0; this.lakes.length < count && attempt < 1000; attempt++) {
      const aspect = 0.8 + random() * 0.45;
      const rx = radius * Math.sqrt(aspect), ry = radius / Math.sqrt(aspect);
      const halfX = rx * 1.2, halfY = ry * 1.2;
      if (2 * halfX + 4 > width || 2 * halfY + 4 > height) continue;
      const cx = 2 + halfX + random() * (width - 4 - 2 * halfX);
      const cy = 2 + halfY + random() * (height - 4 - 2 * halfY);
      const bounds = { x: Math.floor(cx - halfX), y: Math.floor(cy - halfY),
        width: Math.ceil(cx + halfX) - Math.floor(cx - halfX), height: Math.ceil(cy + halfY) - Math.floor(cy - halfY) };
      if (this.lakes.some(l => bounds.x < l.bounds.x + l.bounds.width + 2 && bounds.x + bounds.width + 2 > l.bounds.x &&
        bounds.y < l.bounds.y + l.bounds.height + 2 && bounds.y + bounds.height + 2 > l.bounds.y)) continue;
      const phases = [random(), random(), random()].map(v => v * Math.PI * 2);
      const field = (x: number, y: number) => {
        const nx = (x - cx) / rx, ny = (y - cy) / ry;
        const perturbation = 0.12 * Math.sin(nx * 3 + phases[0]) * Math.cos(ny * 2 + phases[1]) + 0.06 * Math.sin(ny * 4 + phases[2]);
        return 1 - Math.hypot(nx, ny) / (1 + perturbation);
      };
      const lake: Lake = { bounds, center: { x: cx, y: cy }, cells: [] };
      for (let row = bounds.y; row < bounds.y + bounds.height; row++) for (let col = bounds.x; col < bounds.x + bounds.width; col++) {
        const samples: number[] = [];
        for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) samples.push(field(col + x / 4, row + y / 4));
        const levels = samples.map(level), deepest = Math.max(...levels);
        if (deepest < 0) continue;
        const key = row * width + col;
        const tile: WaterTile = { samples, cumulative: THRESHOLDS.map(() => []) };
        if (levels.every(d => d === deepest)) tile.type = WATER_TYPES[deepest];
        else for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const v = (dx: number, dy: number): Vertex => ({ x: col + (x + dx) / 4, y: row + (y + dy) / 4, depth: samples[(y + dy) * 5 + x + dx] });
          for (const triangle of [[v(0, 0), v(1, 0), v(1, 1)], [v(0, 0), v(1, 1), v(0, 1)]]) {
            THRESHOLDS.forEach((threshold, index) => {
              const polygon = clip(triangle, threshold);
              if (polygon.length) tile.cumulative[index].push(polygon);
            });
          }
        }
        tile.cumulative = tile.cumulative.map(mergePolygons);
        this.tiles.set(key, tile);
        lake.cells.push(key);
      }
      this.lakes.push(lake);
    }
  }

  /** Generated lakes replace base obstacles before any entities are spawned. */
  clearBase(tiles: TileTypeId[][], hp: number[][]): void {
    for (const key of this.tiles.keys()) {
      const row = Math.floor(key / this.width), col = key % this.width;
      tiles[row][col] = TileTypeId.DEFAULT;
      hp[row][col] = 0;
    }
  }

  private ensureScale(size: number): void {
    if (size === this.scale) return;
    this.scale = size;
    this.scaled.clear();
    this.images.clear();
  }

  getCell(col: number, row: number, size: number): WaterCell | undefined {
    this.ensureScale(size);
    const key = row * this.width + col, tile = this.tiles.get(key);
    if (!tile) return;
    let cell = this.scaled.get(key);
    if (cell) return cell;
    const scalePolygon = (vertices: Vertex[], threshold: number): Polygon => ({ type: 'polygon',
      vertices: vertices.map(p => ({ x: p.x * size, y: p.y * size })),
      edges: vertices.map((p, i) => p.depth === threshold && vertices[(i + 1) % vertices.length].depth === threshold) });
    const cumulative = tile.cumulative.map((polygons, i) => polygons.map(vertices => scalePolygon(vertices, THRESHOLDS[i])));
    // Compile the merged region, rather than treating its mesh corners as bank contacts.
    const obstacles = tile.type === TileTypeId.ULTRA_DEEP_WATER ? [rectangleCollider(col * size, row * size, size, size)] : cumulative[3].map(p => {
      const compiled = compileShape({ type: 'polygon', vertices: p.vertices.map(v => [v.x, v.y]) });
      return transformCollider(compiled, { x: 0, y: 0, size: 1, rotation: 0 });
    });
    cell = { type: tile.type, cumulative, full: THRESHOLDS.map(t => tile.samples.every(d => d >= t)), obstacles };
    this.scaled.set(key, cell);
    return cell;
  }

  getTypeAt(x: number, y: number, size: number): TileTypeId | undefined {
    const tx = x / size, ty = y / size, col = Math.floor(tx), row = Math.floor(ty);
    const tile = this.tiles.get(row * this.width + col);
    if (!tile) return;
    if (tile.type) return tile.type;
    const gx = (tx - col) * 4, gy = (ty - row) * 4, ix = Math.min(3, Math.floor(gx)), iy = Math.min(3, Math.floor(gy));
    const fx = gx - ix, fy = gy - iy, d = tile.samples, a = d[iy * 5 + ix], c = d[(iy + 1) * 5 + ix + 1];
    const depth = fy <= fx ? a * (1 - fx) + d[iy * 5 + ix + 1] * (fx - fy) + c * fy :
      a * (1 - fy) + c * fx + d[(iy + 1) * 5 + ix] * (fy - fx);
    return WATER_TYPES[level(depth)];
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, width: number, height: number, size: number): void {
    this.ensureScale(size);
    for (const lake of this.lakes) {
      const b = lake.bounds, x = b.x * size - 4, y = b.y * size - 4, w = Math.ceil(b.width * size) + 8, h = Math.ceil(b.height * size) + 8;
      if (x > cameraX + width || y > cameraY + height || x + w < cameraX || y + h < cameraY) continue;
      let image = this.images.get(lake);
      if (!image) {
        const raw = document.createElement('canvas'); raw.width = w; raw.height = h;
        const raster = raw.getContext('2d')!;
        for (let depth = 0; depth < 4; depth++) {
          raster.beginPath();
          for (const key of lake.cells) {
            const tile = this.tiles.get(key)!, col = key % this.width, row = Math.floor(key / this.width);
            if (tile.type) {
              if (WATER_TYPES.indexOf(tile.type) >= depth) raster.rect(col * size - x, row * size - y, size, size);
            } else for (const vertices of tile.cumulative[depth]) {
              vertices.forEach((p, i) => i ? raster.lineTo(p.x * size - x, p.y * size - y) : raster.moveTo(p.x * size - x, p.y * size - y));
              raster.closePath();
            }
          }
          raster.fillStyle = TILE_TYPES[WATER_TYPES[depth]].color;
          raster.fill();
        }
        image = document.createElement('canvas'); image.width = w; image.height = h;
        const softened = image.getContext('2d')!;
        // A one-pixel Gaussian gives a ~4px transition; physics uses its centerline.
        softened.filter = 'blur(1px)'; softened.drawImage(raw, 0, 0);
        this.images.set(lake, image);
      }
      const left = Math.max(x, cameraX), top = Math.max(y, cameraY);
      const clippedWidth = Math.min(x + w, cameraX + width) - left, clippedHeight = Math.min(y + h, cameraY + height) - top;
      if (clippedWidth > 0 && clippedHeight > 0) ctx.drawImage(image, left - x, top - y, clippedWidth, clippedHeight,
        left - cameraX, top - cameraY, clippedWidth, clippedHeight);
    }
  }
}
