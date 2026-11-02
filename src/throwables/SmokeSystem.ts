import type { SightMap } from '../vision/VisionTypes';
import { hasLineOfSight } from '../vision/SightGeometry';
import { THROWABLE_CONFIG as C } from './ThrowableConfig';
import type { ThrowableBody } from './ThrowablePhysics';
const CELL = 20;
interface SmokeField { puffs: ReturnType<typeof puffs>; key: string; cells: Map<string, number>; body: ThrowableBody; }
function puffs(body: ThrowableBody) {
  const radius = C.smokeRadius * Math.min(1, body.smokeAge / C.smokeGrow);
  return Array.from({ length: 12 }, (_, i) => {
    const seed = Math.imul(body.id + i * 73, 2654435761) >>> 0;
    const phase = (seed % 6283) / 1000, angle = i * 2.39996 + phase;
    const spread = radius * (i === 0 ? 0 : .25 + (seed % 260) / 1000);
    return { x: body.x + Math.cos(angle) * spread + Math.sin(body.smokeAge * .31 + phase) * radius * .035,
      y: body.y + Math.sin(angle) * spread + Math.cos(body.smokeAge * .23 + phase) * radius * .035,
      r: Math.max(.1, radius * (.32 + ((seed >>> 12) % 160) / 1000)), alpha: i === 0 ? 1 : .65 };
  });
}
/** Local connected fields, not a fluid solver. AI and rendering share their density. */
export class SmokeSystem {
  private fields: SmokeField[] = [];
  constructor(private readonly map: SightMap & { getNavigationRevision?(): number }) {}
  sync(bodies: readonly ThrowableBody[]): void {
    const old = new Map(this.fields.map(f => [f.body.id, f]));
    this.fields = bodies.filter(b => b.kind === 'smokeGrenade' && b.smokeAge >= 0 && !b.dead).map(body => {
      const col = Math.floor(body.x / CELL), row = Math.floor(body.y / CELL);
      const key = `${col},${row}:${this.map.getNavigationRevision?.() ?? 0}`;
      const cached = old.get(body.id);
      if (cached?.key === key) { cached.body = body; cached.puffs = puffs(body); return cached; }
      const cells = new Map<string, number>(), queue: [number, number, number][] = [[col, row, 0]];
      cells.set(`${col},${row}`, 0);
      for (let i = 0; i < queue.length; i++) {
        const [x, y, distance] = queue[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = x + dx, ny = y + dy, next = distance + CELL * Math.hypot(dx, dy), id = `${nx},${ny}`;
          if (next > C.smokeRadius || (cells.get(id) ?? Infinity) <= next) continue;
          const px = (nx + .5) * CELL, py = (ny + .5) * CELL;
          if (this.map.blocksLightAt(px, py) || !hasLineOfSight(this.map, (x + .5) * CELL, (y + .5) * CELL, px, py)) continue;
          cells.set(id, next); queue.push([nx, ny, next]);
        }
      }
      return { key, cells, body, puffs: puffs(body) };
    });
  }
  private strength(field: SmokeField, distance: number): number {
    const age = field.body.smokeAge, radius = C.smokeRadius * Math.min(1, age / C.smokeGrow);
    const fade = Math.min(1, (C.smokeGrow + C.smokeHold + C.smokeFade - age) / C.smokeFade);
    return Math.max(0, Math.min(1, (radius - distance) / 35)) * Math.max(0, fade);
  }
  density(x: number, y: number): number {
    const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    let density = 0;
    for (const f of this.fields) {
      const d = f.cells.get(key); if (d === undefined) continue;
      let cloud = 0;
      for (const puff of f.puffs) cloud += Math.max(0, 1 - Math.hypot(x - puff.x, y - puff.y) / puff.r) * puff.alpha * 1.8;
      density += Math.min(1, cloud) * this.strength(f, d);
    }
    return Math.min(1, density);
  }
  readonly opacity = (x0: number, y0: number, x1: number, y1: number): number => {
    if (!this.fields.length) return 0;
    if (!this.fields.some(f => Math.max(x0, x1) >= f.body.x - C.smokeRadius && Math.min(x0, x1) <= f.body.x + C.smokeRadius
      && Math.max(y0, y1) >= f.body.y - C.smokeRadius && Math.min(y0, y1) <= f.body.y + C.smokeRadius)) return 0;
    const distance = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(distance / 10));
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; sum += this.density(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) * distance / (steps + 1) / 65;
      if (sum >= 1) return 1;
    }
    return Math.min(1, Math.max(sum, this.density(x1, y1) * .8, this.density(x0, y0) * .5));
  };
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, visible: (x: number, y: number) => boolean): void {
    for (const f of this.fields) {
      ctx.save(); ctx.beginPath();
      for (const [key, distance] of f.cells) {
        if (this.strength(f, distance) <= .01) continue;
        const [x, y] = key.split(',').map(Number);
        if (visible((x + .5) * CELL, (y + .5) * CELL)) ctx.rect(x * CELL - ox, y * CELL - oy, CELL, CELL);
      }
      ctx.clip();
      const fade = Math.min(1, Math.max(0, (C.smokeGrow + C.smokeHold + C.smokeFade - f.body.smokeAge) / C.smokeFade));
      for (const puff of f.puffs) {
        const x = puff.x - ox, y = puff.y - oy, r = puff.r;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(125,137,133,${.5 * fade * puff.alpha})`);
        gradient.addColorStop(.55, `rgba(116,130,124,${.22 * fade * puff.alpha})`);
        gradient.addColorStop(1, 'rgba(91,106,102,0)');
        ctx.fillStyle = gradient; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }
  clear(): void { this.fields = []; }
}
