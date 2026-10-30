/** Shapes are in sprite-local coordinates; one unit equals the entity's size. */
export type Point = { x: number; y: number };
export type CircleShape = { type: "circle"; radius: number; center?: [number, number] };
export type PolygonShape = { type: "polygon"; vertices: [number, number][] };
export type ColliderShape = CircleShape | PolygonShape | { type: "compound"; parts: (CircleShape | PolygonShape)[] };
export interface ColliderPose { x: number; y: number; size: number; rotation: number; }
export interface Bounds { x: number; y: number; width: number; height: number; }
export interface Contact { normal: Point; depth: number; point: Point; internal?: boolean; }
type Circle = { type: "circle"; center: Point; radius: number };
export type Polygon = { type: "polygon"; vertices: Point[]; edges: boolean[]; faces?: boolean[]; terrain?: boolean };
export type Primitive = Circle | Polygon;
export interface CompiledShape { shape: ColliderShape; parts: Primitive[]; pieces: Primitive[]; radius: number; area: number; }
export interface Collider { compiled: CompiledShape; pose: ColliderPose; parts: Primitive[]; pieces: Primitive[]; bounds: Bounds; radius: number; area: number; }
export const CONTACT_TOLERANCE = 0.01;
export function isRotationInvariant(body: Collider): boolean {
  return body.compiled.parts.every(p => p.type === "circle" && p.center.x === 0 && p.center.y === 0);
}
const EPS = 1e-10;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const signedArea = (v: Point[]) => v.reduce((s, a, i) => { const b = v[(i + 1) % v.length]; return s + a.x * b.y - a.y * b.x; }, 0) / 2;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Returns an owned, canonical copy; callers cannot mutate a compiled collider through JSON. */
export function parseColliderShape(value: unknown): ColliderShape {
  if (!object(value)) throw new Error("碰撞体必须是对象");
  const allowed = value.type === "circle" ? ["type", "radius", "center"] : value.type === "polygon" ? ["type", "vertices"] : value.type === "compound" ? ["type", "parts"] : [];
  if (!allowed.length || Object.keys(value).some(k => !allowed.includes(k))) throw new Error("无效碰撞体类型或字段");
  if (value.type === "circle") {
    if (!finite(value.radius) || value.radius <= 0) throw new Error("碰撞圆半径必须是正有限数值");
    const center = value.center ?? [0, 0];
    if (!Array.isArray(center) || center.length !== 2 || !center.every(finite)) throw new Error("碰撞圆中心必须是两个有限坐标");
    return { type: "circle", radius: value.radius, center: [center[0], center[1]] };
  }
  if (value.type === "compound") {
    if (!Array.isArray(value.parts) || !value.parts.length) throw new Error("复合碰撞体至少需要一个部件");
    const parts = value.parts.map(parseColliderShape);
    if (parts.some(p => p.type === "compound")) throw new Error("复合碰撞体部件只能是圆或多边形");
    return { type: "compound", parts: parts as (CircleShape | PolygonShape)[] };
  }
  if (!Array.isArray(value.vertices) || value.vertices.length < 3 || value.vertices.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(finite))) throw new Error("多边形至少需要三个有限坐标顶点");
  let vertices: Point[] = value.vertices.map(([x, y]) => ({ x, y }));
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (distance(a, b) < EPS) throw new Error("多边形存在重复相邻顶点");
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      if (segmentsIntersect(a, b, vertices[j], vertices[(j + 1) % vertices.length])) throw new Error("多边形不能自相交");
    }
  }
  if (Math.abs(signedArea(vertices)) < EPS) throw new Error("多边形面积不能为零");
  // Collinear points carry no geometry, but make ear clipping ambiguous.
  let changed = true;
  while (changed && vertices.length > 3) {
    changed = false;
    for (let i = 0; i < vertices.length; i++) if (onSegment(vertices[(i + vertices.length - 1) % vertices.length], vertices[(i + 1) % vertices.length], vertices[i])) {
      vertices.splice(i, 1); changed = true; break;
    }
  }
  if (signedArea(vertices) < 0) vertices.reverse();
  return { type: "polygon", vertices: vertices.map(p => [p.x, p.y]) };
}

function triangulate(polygon: Polygon): Polygon[] {
  const v = polygon.vertices;
  if (v.every((p, i) => cross(v[(i + v.length - 1) % v.length], p, v[(i + 1) % v.length]) >= -EPS)) return [polygon];
  const indices = v.map((_, i) => i), pieces: Polygon[] = [];
  const triangle = (ids: number[]) => ({ type: "polygon" as const, vertices: ids.map(i => v[i]), edges: ids.map((i, j) => (i + 1) % v.length === ids[(j + 1) % 3]) });
  while (indices.length > 3) {
    let found = false;
    for (let i = 0; i < indices.length; i++) {
      const ids = [indices[(i + indices.length - 1) % indices.length], indices[i], indices[(i + 1) % indices.length]];
      const [a, b, c] = ids.map(id => v[id]);
      if (cross(a, b, c) <= EPS || indices.some(id => !ids.includes(id) && cross(a, b, v[id]) >= -EPS && cross(b, c, v[id]) >= -EPS && cross(c, a, v[id]) >= -EPS)) continue;
      pieces.push(triangle(ids)); indices.splice(i, 1); found = true; break;
    }
    if (!found) throw new Error("多边形无法分解");
  }
  pieces.push(triangle(indices));
  return pieces;
}

export const DEFAULT_SHAPE: PolygonShape = { type: "polygon", vertices: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] };
export function compileShape(value: ColliderShape): CompiledShape {
  const shape = parseColliderShape(value);
  const shapes = shape.type === "compound" ? shape.parts : [shape];
  const parts: Primitive[] = shapes.map(p => p.type === "circle" ? { type: "circle", center: { x: p.center![0], y: p.center![1] }, radius: p.radius } : { type: "polygon", vertices: p.vertices.map(([x, y]) => ({ x, y })), edges: p.vertices.map(() => true) });
  const pieces: Primitive[] = [];
  for (const p of parts) pieces.push(...(p.type === "circle" ? [p] : triangulate(p)));
  const radius = Math.max(...parts.map(p => p.type === "circle" ? Math.hypot(p.center.x, p.center.y) + p.radius : Math.max(...p.vertices.map(v => Math.hypot(v.x, v.y)))));
  const area = parts.length === 1 ? parts[0].type === "circle" ? Math.PI * parts[0].radius ** 2 : Math.abs(signedArea(parts[0].vertices)) : unionArea(parts);
  if (!Number.isFinite(radius) || !Number.isFinite(area) || area <= EPS) throw new Error("碰撞体尺寸或面积无效");
  return { shape, parts, pieces, radius, area };
}

export function boundsOf(parts: Primitive[]): Bounds {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of parts) {
    if (p.type === "circle") { left = Math.min(left, p.center.x - p.radius); right = Math.max(right, p.center.x + p.radius); top = Math.min(top, p.center.y - p.radius); bottom = Math.max(bottom, p.center.y + p.radius); }
    else for (const v of p.vertices) { left = Math.min(left, v.x); right = Math.max(right, v.x); top = Math.min(top, v.y); bottom = Math.max(bottom, v.y); }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function overlapsBounds(a: Bounds, b: Bounds, margin = 0): boolean {
  return a.x + a.width + margin >= b.x && b.x + b.width + margin >= a.x && a.y + a.height + margin >= b.y && b.y + b.height + margin >= a.y;
}
export function transformCollider(compiled: CompiledShape, pose: ColliderPose): Collider {
  const c = Math.cos(pose.rotation), s = Math.sin(pose.rotation);
  const cos = Math.abs(c) < 1e-14 ? 0 : c, sin = Math.abs(s) < 1e-14 ? 0 : s;
  const point = (p: Point) => ({ x: pose.x + pose.size * (p.x * cos - p.y * sin), y: pose.y + pose.size * (p.x * sin + p.y * cos) });
  const transform = (p: Primitive): Primitive => p.type === "circle" ? { type: "circle", center: point(p.center), radius: p.radius * pose.size } : { type: "polygon", vertices: p.vertices.map(point), edges: p.edges, faces: p.faces, ...(p.terrain ? { terrain: true } : {}) };
  const parts = compiled.parts.map(transform);
  return { compiled, pose: { ...pose }, parts, pieces: compiled.pieces.map(transform), bounds: boundsOf(parts), radius: compiled.radius * pose.size, area: compiled.area * pose.size ** 2 };
}
const circleShape = compileShape({ type: "circle", radius: 1 });
export function circleCollider(x: number, y: number, radius: number): Collider {
  return transformCollider(circleShape, { x, y, size: radius, rotation: 0 });
}
export function rectangleCollider(x: number, y: number, width: number, height: number, edges = [true, true, true, true]): Collider {
  const polygon: Polygon = { type: "polygon", vertices: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], edges, faces: edges };
  const local: Polygon = { type: "polygon", vertices: [{x:-width/2,y:-height/2},{x:width/2,y:-height/2},{x:width/2,y:height/2},{x:-width/2,y:height/2}], edges, faces: edges };
  const radius = Math.hypot(width, height) / 2, area = width * height;
  const compiled: CompiledShape = { shape: { type: "polygon", vertices: local.vertices.map(p => [p.x,p.y]) }, parts: [local], pieces: [local], radius, area };
  return { compiled, pose: { x: x + width / 2, y: y + height / 2, size: 1, rotation: 0 }, parts: [polygon], pieces: [polygon], bounds: { x, y, width, height }, radius, area };
}

function projection(p: Primitive, axis: Point): [number, number] {
  if (p.type === "circle") { const c = dot(p.center, axis); return [c - p.radius, c + p.radius]; }
  const values = p.vertices.map(v => dot(v, axis)); return [Math.min(...values), Math.max(...values)];
}
function axes(a: Primitive, b: Primitive): { axis: Point; exposed: boolean }[] {
  const result: { axis: Point; exposed: boolean }[] = [];
  for (const p of [a, b]) if (p.type === "polygon") for (let i = 0; i < p.vertices.length; i++) {
    const u = p.vertices[i], v = p.vertices[(i + 1) % p.vertices.length], len = distance(u, v);
    result.push({ axis: { x: (u.y - v.y) / len, y: (v.x - u.x) / len }, exposed: p.edges[i] });
  }
  const circle = a.type === "circle" ? a : b.type === "circle" ? b : undefined;
  const polygon = a.type === "polygon" ? a : b.type === "polygon" ? b : undefined;
  if (circle && polygon) {
    let index = 0;
    for (let i = 1; i < polygon.vertices.length; i++) if (distance(circle.center, polygon.vertices[i]) < distance(circle.center, polygon.vertices[index])) index = i;
    const v = polygon.vertices[index], len = distance(circle.center, v);
    if (len > EPS) result.push({ axis: { x: (circle.center.x - v.x) / len, y: (circle.center.y - v.y) / len }, exposed: polygon.edges[index] && polygon.edges[(index + polygon.edges.length - 1) % polygon.edges.length] });
  }
  return result;
}
function support(p: Primitive, normal: Point): Point {
  if (p.type === "circle") return { x: p.center.x + normal.x * p.radius, y: p.center.y + normal.y * p.radius };
  return p.vertices.reduce((best, v) => dot(v, normal) > dot(best, normal) ? v : best);
}

/** Positive distance is a conservative separation bound; normal points from B to A. */
export function primitiveSeparation(a: Primitive, b: Primitive): { distance: number; normal: Point; contact: Contact | null } {
  if (a.type === "circle" && b.type === "circle") {
    const len = distance(a.center, b.center), normal = len > EPS ? { x: (a.center.x - b.center.x) / len, y: (a.center.y - b.center.y) / len } : { x: 1, y: 0 };
    const gap = len - a.radius - b.radius;
    return { distance: gap, normal, contact: gap < 0 ? { normal, depth: -gap, point: support(b, normal) } : null };
  }
  // Curved banks are convex polygon pieces. Their nearest feature gives the actual circle
  // penetration; choosing only an exposed SAT plane exaggerates tiny overlaps at mesh corners.
  if (a.type === 'circle' && b.type === 'polygon' && !b.faces) {
    let inside = true, nearest = b.vertices[0], distance2 = Infinity, nearestEdge = 0;
    for (let i = 0; i < b.vertices.length; i++) {
      const p = b.vertices[i], q = b.vertices[(i + 1) % b.vertices.length];
      if (cross(p, q, a.center) < -EPS) inside = false;
      const dx = q.x - p.x, dy = q.y - p.y, length2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, dot({ x: a.center.x - p.x, y: a.center.y - p.y }, { x: dx, y: dy }) / length2));
      const point = { x: p.x + t * dx, y: p.y + t * dy };
      const d2 = (a.center.x - point.x) ** 2 + (a.center.y - point.y) ** 2;
      if (d2 < distance2) { distance2 = d2; nearest = point; nearestEdge = i; }
    }
    const d = Math.sqrt(distance2), gap = (inside ? -d : d) - a.radius;
    const p = b.vertices[nearestEdge], q = b.vertices[(nearestEdge + 1) % b.vertices.length];
    const length = distance(p, q), sign = inside ? -1 : 1;
    const normal = d > EPS ? { x: sign * (a.center.x - nearest.x) / d, y: sign * (a.center.y - nearest.y) / d } :
      { x: (q.y - p.y) / length, y: (p.x - q.x) / length };
    const exposed = !b.terrain || b.edges[nearestEdge];
    return { distance: gap, normal, contact: gap < 0 && exposed ? { normal, depth: -gap, point: nearest } : null };
  }
  if (a.type === 'polygon' && !a.faces && b.type === 'circle') {
    const result = primitiveSeparation(b, a), normal = { x: -result.normal.x, y: -result.normal.y };
    return { distance: result.distance, normal, contact: result.contact ? { ...result.contact, normal } : null };
  }
  let gap = -Infinity, separationNormal: Point = { x: 1, y: 0 }, depth = Infinity, normal = separationNormal;
  for (const { axis, exposed } of axes(a, b)) {
    const [al, ar] = projection(a, axis), [bl, br] = projection(b, axis);
    const negative = ar - bl, positive = br - al;
    const d = Math.min(negative, positive), n = negative < positive ? { x: -axis.x, y: -axis.y } : axis;
    if (-d > gap) { gap = -d; separationNormal = n; }
    const faces = b.type === "polygon" ? b.faces : undefined;
    // A diagonal normal requires an exposed corner, not an endpoint hidden in a flat wall.
    const outward = !faces || ((n.x < -EPS ? faces[3] : n.x > EPS ? faces[1] : true) && (n.y < -EPS ? faces[0] : n.y > EPS ? faces[2] : true));
    if (exposed && outward && d < depth) { depth = d; normal = n; }
  }
  const contact = gap < 0 && depth < Infinity ? { normal, depth, point: support(b, normal) } : null;
  return { distance: gap, normal: separationNormal, contact };
}
export function collide(a: Collider, b: Collider): Contact[] {
  if (!overlapsBounds(a.bounds, b.bounds)) return [];
  const contacts: Contact[] = [];
  for (const x of a.pieces) for (const y of b.pieces) {
    const result = primitiveSeparation(x, y);
    if (result.distance < -EPS) {
      // An entirely internal tile/piece still obstructs occupancy queries.
      contacts.push(result.contact ?? { normal: result.normal, depth: -result.distance, point: support(y, result.normal),
        ...(y.type === 'polygon' && y.terrain ? { internal: true } : {}) });
    }
  }
  return contacts;
}

function sliceIntervals(parts: Primitive[], x: number, clip?: Bounds): [number, number][] {
  const intervals: [number, number][] = [];
  const add = (lo: number, hi: number) => {
    if (clip) { lo = Math.max(lo, clip.y); hi = Math.min(hi, clip.y + clip.height); }
    if (hi > lo) intervals.push([lo, hi]);
  };
  for (const p of parts) {
    if (p.type === "circle") {
      const dx = x - p.center.x;
      if (Math.abs(dx) < p.radius) { const dy = Math.sqrt(Math.max(0, p.radius ** 2 - dx ** 2)); add(p.center.y - dy, p.center.y + dy); }
    } else {
      const ys: number[] = [];
      for (let i = 0; i < p.vertices.length; i++) {
        const a = p.vertices[i], b = p.vertices[(i + 1) % p.vertices.length];
        if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) ys.push(a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x));
      }
      ys.sort((a, b) => a - b);
      for (let i = 0; i + 1 < ys.length; i += 2) add(ys[i], ys[i + 1]);
    }
  }
  return intervals.sort((a, b) => a[0] - b[0]);
}
function integrate(f: (x: number) => number, a: number, b: number, tolerance: number): number {
  const fa = f(a), fb = f(b), m = (a + b) / 2, fm = f(m), whole = (b - a) * (fa + 4 * fm + fb) / 6;
  const recurse = (lo: number, hi: number, left: number, mid: number, right: number, estimate: number, error: number, depth: number): number => {
    const center = (lo + hi) / 2, lmid = f((lo + center) / 2), rmid = f((center + hi) / 2);
    const l = (center - lo) * (left + 4 * lmid + mid) / 6, r = (hi - center) * (mid + 4 * rmid + right) / 6;
    if (!depth || Math.abs(l + r - estimate) <= 15 * error) return l + r + (l + r - estimate) / 15;
    return recurse(lo, center, left, lmid, mid, l, error / 2, depth - 1) + recurse(center, hi, mid, rmid, right, r, error / 2, depth - 1);
  };
  return recurse(a, b, fa, fm, fb, whole, tolerance, 18);
}
/** Merge intervals BEFORE integration, so compound overlaps are counted once. */
export function unionArea(parts: Primitive[], clip?: Bounds, intersection?: Primitive[], exclusion?: Primitive[]): number {
  const bounds = boundsOf(parts), left = Math.max(bounds.x, clip?.x ?? -Infinity), right = Math.min(bounds.x + bounds.width, clip ? clip.x + clip.width : Infinity);
  if (right <= left) return 0;
  const breaks = [left, right];
  for (const p of [...parts, ...(intersection ?? []), ...(exclusion ?? [])]) {
    if (p.type === "circle") {
      breaks.push(p.center.x - p.radius, p.center.x + p.radius);
      if (clip) for (const y of [clip.y, clip.y + clip.height]) {
        const dy = y - p.center.y;
        if (Math.abs(dy) < p.radius) { const dx = Math.sqrt(p.radius ** 2 - dy ** 2); breaks.push(p.center.x - dx, p.center.x + dx); }
      }
    } else {
      for (let i = 0; i < p.vertices.length; i++) {
        const a = p.vertices[i], b = p.vertices[(i + 1) % p.vertices.length]; breaks.push(a.x);
        if (clip && a.y !== b.y) for (const y of [clip.y, clip.y + clip.height]) if (y > Math.min(a.y, b.y) && y < Math.max(a.y, b.y)) breaks.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
      }
    }
  }
  const xs = [...new Set(breaks.filter(x => x >= left && x <= right))].sort((a, b) => a - b);
  const f = (x: number) => {
    const intervals = sliceIntervals(parts, x, clip);
    if (exclusion?.length) {
      const cuts = sliceIntervals(exclusion, x, clip);
      const clipped: [number, number][] = [];
      for (const [lo, hi] of intervals) {
        let start = lo;
        for (const [a, b] of cuts) {
          if (a > start) clipped.push([start, Math.min(a, hi)]);
          start = Math.max(start, b);
          if (start >= hi) break;
        }
        if (start < hi) clipped.push([start, hi]);
      }
      intervals.splice(0, intervals.length, ...clipped.sort((a, b) => a[0] - b[0]));
    }
    if (intersection) {
      const merge = (values: [number, number][]) => {
        const result: [number, number][] = [];
        for (const [lo, hi] of values) {
          const last = result[result.length - 1];
          if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
          else result.push([lo, hi]);
        }
        return result;
      };
      const a = merge(intervals), b = merge(sliceIntervals(intersection, x, clip));
      let area = 0, i = 0, j = 0;
      while (i < a.length && j < b.length) {
        area += Math.max(0, Math.min(a[i][1], b[j][1]) - Math.max(a[i][0], b[j][0]));
        if (a[i][1] < b[j][1]) i++; else j++;
      }
      return area;
    }
    let total = 0, end = -Infinity;
    for (const [lo, hi] of intervals) { total += Math.max(0, hi - Math.max(lo, end)); end = Math.max(end, hi); }
    return total;
  };
  let area = 0;
  const tolerance = Math.max(1e-12, bounds.width * bounds.height * 1e-7 / xs.length);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1], inset = (b - a) * 1e-10;
    if (b > a) area += integrate(x => f(Math.max(a + inset, Math.min(b - inset, x))), a, b, tolerance);
  }
  return Math.max(0, area);
}
export function areaInside(collider: Collider, rect: Bounds): number {
  if (!overlapsBounds(collider.bounds, rect)) return 0;
  const b = collider.bounds;
  if (b.x >= rect.x && b.y >= rect.y && b.x + b.width <= rect.x + rect.width && b.y + b.height <= rect.y + rect.height) return collider.area;
  if (collider.parts.length === 1 && collider.parts[0].type === 'circle') {
    return circlePolygonArea(collider.parts[0], [
      { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }
    ]);
  }
  return Math.min(collider.area, unionArea(collider.parts, rect));
}

/** Exact circle/polygon intersection: split each edge at the circle, then sum triangles/sectors. */
export function circlePolygonArea(circle: Circle, vertices: Point[]): number {
  const { center, radius } = circle, r2 = radius * radius;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    const ax = p.x - center.x, ay = p.y - center.y, bx = q.x - center.x, by = q.y - center.y;
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    if (length2 < EPS * EPS) continue;
    const contribution = (lo: number, hi: number) => {
      const x = ax + dx * lo, y = ay + dy * lo, u = ax + dx * hi, v = ay + dy * hi;
      const mx = (x + u) / 2, my = (y + v) / 2;
      return mx * mx + my * my < r2 ? (x * v - y * u) / 2 : r2 * Math.atan2(x * v - y * u, x * u + y * v) / 2;
    };
    const projection = -(ax * dx + ay * dy) / length2;
    const nearestX = ax + projection * dx, nearestY = ay + projection * dy;
    const offset2 = (r2 - nearestX * nearestX - nearestY * nearestY) / length2;
    let previous = 0;
    if (offset2 > 0) {
      const offset = Math.sqrt(offset2), enter = projection - offset, exit = projection + offset;
      if (enter > 0 && enter < 1) { area += contribution(0, enter); previous = enter; }
      if (exit > 0 && exit < 1) { area += contribution(previous, exit); previous = exit; }
    }
    area += contribution(previous, 1);
  }
  return Math.min(Math.PI * r2, Math.max(0, Math.abs(area)));
}

/** Intersect unions, so concave/compound footprints never count overlapping parts twice. */
export function areaInsidePolygons(collider: Collider, polygons: Polygon[], rect: Bounds, exclusion?: Polygon[]): number {
  if (!polygons.length || !overlapsBounds(collider.bounds, rect)) return 0;
  return Math.min(collider.area, unionArea(collider.parts, rect, polygons, exclusion));
}

export function isAxisAlignedRectangle(collider: Collider): boolean {
  if (collider.parts.length !== 1 || collider.parts[0].type !== 'polygon') return false;
  const vertices = collider.parts[0].vertices;
  return vertices.length === 4 && vertices.every((a, i) => {
    const b = vertices[(i + 1) % 4];
    return Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
  });
}
