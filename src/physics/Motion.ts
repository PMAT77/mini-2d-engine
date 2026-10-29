import { Bounds, Collider, ColliderPose, Contact, CONTACT_TOLERANCE, Point, Polygon, collide, isAxisAlignedRectangle, isRotationInvariant, overlapsBounds, primitiveSeparation, transformCollider } from "./Collider";

export interface CollisionObstacle { collider: Collider; col: number; row: number; }
export interface CollisionWorld { getCollisionObstacles(bounds: Bounds): CollisionObstacle[]; }
export interface MotionResult { collider: Collider; contacts: Contact[]; rotationBlocked: boolean; exhausted: boolean; }
export interface ShapeCastHit { fraction: number; obstacle: CollisionObstacle; normal: Point; }
const TINY = 1e-9;
const MAX_STEPS = 4096;

function motionBounds(body: Collider, move: Point): Bounds {
  const r = body.radius + CONTACT_TOLERANCE;
  return { x: Math.min(body.pose.x, body.pose.x + move.x) - r, y: Math.min(body.pose.y, body.pose.y + move.y) - r,
    width: Math.abs(move.x) + 2 * r, height: Math.abs(move.y) + 2 * r };
}
export function queryContacts(world: CollisionWorld, body: Collider): Contact[] {
  const contacts: Contact[] = [];
  for (const o of world.getCollisionObstacles(body.bounds)) contacts.push(...collide(body, o.collider));
  return contacts;
}

/** Analytic circle cast against the rounded Minkowski rectangle, including true corner arcs. */
function castCircle(body: Collider, move: Point, obstacle: Collider): { fraction: number; normal: Point } | null {
  const circle = body.parts[0];
  if (circle.type !== "circle") return null;
  const box = obstacle.bounds, cx = circle.center.x, cy = circle.center.y, r = circle.radius;
  // A stationary/retreating supporting plane is safe even at a hidden tile corner.
  if ((cx - r >= box.x + box.width - CONTACT_TOLERANCE && move.x >= 0) ||
      (cx + r <= box.x + CONTACT_TOLERANCE && move.x <= 0) ||
      (cy - r >= box.y + box.height - CONTACT_TOLERANCE && move.y >= 0) ||
      (cy + r <= box.y + CONTACT_TOLERANCE && move.y <= 0)) return null;
  const nearestX = Math.max(box.x, Math.min(box.x + box.width, cx)), nearestY = Math.max(box.y, Math.min(box.y + box.height, cy));
  if (Math.hypot(cx - nearestX, cy - nearestY) < r - TINY) {
    const contact = collide(body, obstacle)[0];
    if (contact && contact.depth <= CONTACT_TOLERANCE && move.x * contact.normal.x + move.y * contact.normal.y >= -TINY) return null;
    return { fraction: 0, normal: contact?.normal ?? { x: 1, y: 0 } };
  }
  let best: { fraction: number; normal: Point } | null = null;
  const accept = (t: number, normal: Point) => {
    if (t >= -TINY && t <= 1 + TINY && move.x * normal.x + move.y * normal.y < -TINY && (!best || t < best.fraction)) best = { fraction: Math.max(0, Math.min(1, t)), normal };
  };
  if (move.x !== 0) for (const [x, nx] of [[box.x - r, -1], [box.x + box.width + r, 1]]) {
    const t = (x - cx) / move.x, y = cy + move.y * t;
    if (y >= box.y - TINY && y <= box.y + box.height + TINY) accept(t, { x: nx, y: 0 });
  }
  if (move.y !== 0) for (const [y, ny] of [[box.y - r, -1], [box.y + box.height + r, 1]]) {
    const t = (y - cy) / move.y, x = cx + move.x * t;
    if (x >= box.x - TINY && x <= box.x + box.width + TINY) accept(t, { x: 0, y: ny });
  }
  const a = move.x ** 2 + move.y ** 2;
  if (a > 0) for (const [x, sx] of [[box.x, -1], [box.x + box.width, 1]]) for (const [y, sy] of [[box.y, -1], [box.y + box.height, 1]]) {
    const dx = cx - x, dy = cy - y, b = 2 * (dx * move.x + dy * move.y), c = dx * dx + dy * dy - r * r, discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    // The stable root formulation also handles very fast projectiles near a wall.
    const q = -0.5 * (b + (b < 0 ? -root : root));
    for (const t of q === 0 ? [0] : [q / a, c / q]) {
      const px = cx + move.x * t, py = cy + move.y * t;
      if ((px - x) * sx >= -TINY && (py - y) * sy >= -TINY) accept(t, { x: (px - x) / r, y: (py - y) / r });
    }
  }
  return best;
}

/** Sweep a circle against exposed segments/caps only; mesh seams never become obstacles. */
function castTerrainCircle(body: Collider, move: Point, obstacle: Collider, polygon: Polygon): { fraction: number; normal: Point } | null {
  const circle = body.parts[0];
  if (circle.type !== 'circle') return null;
  const overlaps = collide(body, obstacle), initial = overlaps.find(c => !c.internal);
  const inside = polygon.vertices.every((a, i) => {
    const b = polygon.vertices[(i + 1) % polygon.vertices.length];
    return (b.x - a.x) * (circle.center.y - a.y) - (b.y - a.y) * (circle.center.x - a.x) >= -TINY;
  });
  if (overlaps.length && inside) return { fraction: 0, normal: (initial ?? overlaps[0]).normal };
  if (initial && (initial.depth > CONTACT_TOLERANCE || move.x * initial.normal.x + move.y * initial.normal.y < -TINY))
    return { fraction: 0, normal: initial.normal };
  const { center, radius } = circle, speed2 = move.x * move.x + move.y * move.y;
  let best: { fraction: number; normal: Point } | null = null;
  const accept = (fraction: number, normal: Point) => {
    if (fraction >= -TINY && fraction <= 1 && move.x * normal.x + move.y * normal.y < -TINY && (!best || fraction < best.fraction))
      best = { fraction: Math.max(0, fraction), normal };
  };
  for (let i = 0; i < polygon.vertices.length; i++) if (polygon.edges[i]) {
    const a = polygon.vertices[i], b = polygon.vertices[(i + 1) % polygon.vertices.length];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), normal = { x: dy / length, y: -dx / length };
    const closing = move.x * normal.x + move.y * normal.y;
    if (closing < -TINY) {
      const distance = (center.x - a.x) * normal.x + (center.y - a.y) * normal.y;
      const t = (radius - distance) / closing;
      const along = ((center.x + move.x * t - a.x) * dx + (center.y + move.y * t - a.y) * dy) / (length * length);
      if (along >= -TINY && along <= 1 + TINY) accept(t, normal);
    }
    if (speed2 <= TINY) continue;
    for (const point of [a, b]) {
      const x = center.x - point.x, y = center.y - point.y;
      const projection = x * move.x + y * move.y, discriminant = projection * projection - speed2 * (x * x + y * y - radius * radius);
      if (discriminant <= 0) continue;
      const t = (-projection - Math.sqrt(discriminant)) / speed2;
      accept(t, { x: (x + move.x * t) / radius, y: (y + move.y * t) / radius });
    }
  }
  return best;
}

/** SAT separation bounds and a bound on every point's speed give conservative advancement. */
export function castCollider(world: CollisionWorld, body: Collider, move: Point, rotation = 0, supplied?: CollisionObstacle[]): ShapeCastHit | null {
  if (isRotationInvariant(body)) rotation = 0;
  const obstacles = supplied ?? world.getCollisionObstacles(motionBounds(body, move));
  const bound = Math.hypot(move.x, move.y) + body.radius * Math.abs(rotation);
  let first: ShapeCastHit | null = null;
  for (const obstacle of obstacles) {
    if (!overlapsBounds(motionBounds(body, move), obstacle.collider.bounds)) continue;
    if (body.parts.length === 1 && body.parts[0].type === "circle" && rotation === 0 && isAxisAlignedRectangle(obstacle.collider)) {
      const hit = castCircle(body, move, obstacle.collider);
      if (hit && (!first || hit.fraction < first.fraction)) first = { ...hit, obstacle };
      continue;
    }
    const polygon = obstacle.collider.parts[0];
    if (body.parts.length === 1 && body.parts[0].type === 'circle' && rotation === 0 && polygon?.type === 'polygon' && polygon.terrain) {
      const hit = castTerrainCircle(body, move, obstacle.collider, polygon);
      if (hit && (!first || hit.fraction < first.fraction - 1e-9)) first = { ...hit, obstacle };
      continue;
    }
    if (bound <= TINY) {
      const contact = collide(body, obstacle.collider)[0];
      if (contact && !first) first = { fraction: 0, normal: contact.normal, obstacle };
      continue;
    }
    let t = 0, previous = 0, complete = false;
    for (let iteration = 0; iteration < 512; iteration++) {
      const current = transformCollider(body.compiled, { ...body.pose, x: body.pose.x + move.x * t, y: body.pose.y + move.y * t, rotation: body.pose.rotation + rotation * t });
      let separation = Infinity, normal = { x: 1, y: 0 };
      for (const a of current.pieces) for (const b of obstacle.collider.pieces) {
        const result = primitiveSeparation(a, b);
        if (b.type === 'polygon' && b.terrain && !result.contact && result.distance <= TINY) continue;
        // A fixed separating plane with nonclosing linear motion stays separated.
        if (!rotation && result.distance >= -CONTACT_TOLERANCE && move.x * result.normal.x + move.y * result.normal.y >= -TINY) continue;
        // A resting external face also stays clear across a tile's hidden row/column seams.
        const resting = result.contact;
        if (!rotation && resting && resting.depth <= CONTACT_TOLERANCE && move.x * resting.normal.x + move.y * resting.normal.y >= -TINY) continue;
        if (result.distance < separation) { separation = result.distance; normal = result.normal; }
      }
      const penetrating = separation < -CONTACT_TOLERANCE;
      const linearHit = !rotation && separation <= TINY;
      if (penetrating || linearHit) {
        const fraction = linearHit ? t : previous;
        if (!first || fraction < first.fraction) first = { fraction, normal, obstacle };
        complete = true; break;
      }
      if (t >= 1 || separation === Infinity || (first && t >= first.fraction)) { complete = true; break; }
      previous = t;
      t = Math.min(1, t + Math.max(CONTACT_TOLERANCE * 0.5, separation * 0.8) / bound);
    }
    // Running out of iterations is a stop, never permission to skip unchecked motion.
    if (!complete && (!first || previous < first.fraction)) first = { fraction: previous, normal: { x: 0, y: 0 }, obstacle };
  }
  return first;
}

function contactsAt(body: Collider, obstacles: CollisionObstacle[]): Contact[] {
  const contacts: Contact[] = [];
  for (const o of obstacles) contacts.push(...collide(body, o.collider));
  return contacts.filter(c => c.depth > CONTACT_TOLERANCE * 0.1);
}
function attempt(start: Collider, move: Point, angle: number, world: CollisionWorld): { body: Collider; contacts: Contact[] } | null {
  const pose: ColliderPose = { ...start.pose, x: start.pose.x + move.x, y: start.pose.y + move.y, rotation: start.pose.rotation + angle };
  const contacts: Contact[] = [];
  const maxPush = 2 * (Math.hypot(move.x, move.y) + Math.abs(angle) * start.radius) + CONTACT_TOLERANCE;
  let pushed = 0, body = transformCollider(start.compiled, pose);
  for (let iteration = 0; iteration < 12; iteration++) {
    const hits = contactsAt(body, world.getCollisionObstacles(body.bounds));
    if (!hits.length) {
      const actual = { x: body.pose.x - start.pose.x, y: body.pose.y - start.pose.y };
      // The correction itself must not cross another obstacle or an intermediate rotation.
      const hit = castCollider(world, start, actual, angle);
      if (hit && hit.fraction < 1 - 1e-7) return null;
      return { body, contacts };
    }
    const exposed = hits.filter(hit => !hit.internal);
    if (!exposed.length) return null;
    const deepest = exposed.reduce((a, b) => a.depth > b.depth ? a : b);
    const correction = deepest.depth + 0.0001;
    pushed += correction;
    if (pushed > maxPush) return null;
    pose.x += deepest.normal.x * correction; pose.y += deepest.normal.y * correction;
    contacts.push(deepest);
    body = transformCollider(start.compiled, pose);
  }
  return null;
}

export function resolveMotion(world: CollisionWorld, initial: Collider, move: Point, rotation = 0): MotionResult {
  const invariant = isRotationInvariant(initial);
  const steps = Math.max(1, Math.ceil(Math.hypot(move.x, move.y) + (invariant ? 0 : initial.radius * Math.abs(rotation))), invariant ? 1 : Math.ceil(Math.abs(rotation) / 0.025));
  let body = initial, rotationBlocked = false;
  const contacts: Contact[] = [];
  for (let i = 0; i < Math.min(steps, MAX_STEPS); i++) {
    const step = { x: move.x / steps, y: move.y / steps }, angle = rotationBlocked ? 0 : rotation / steps;
    let accepted = attempt(body, step, angle, world);
    if (!accepted && angle) {
      // Keep valid translation while finding the last locally reachable orientation.
      let lo = 0, hi = 1;
      accepted = attempt(body, step, 0, world);
      if (accepted) for (let j = 0; j < 12; j++) {
        const mid = (lo + hi) / 2, result = attempt(body, step, angle * mid, world);
        if (result) { lo = mid; accepted = result; } else hi = mid;
      }
      rotationBlocked = true;
    }
    if (!accepted) {
      const hit = castCollider(world, body, step, 0);
      if (!hit) return { collider: body, contacts, rotationBlocked, exhausted: true };
      const fraction = Math.max(0, hit.fraction - 0.0001 / Math.max(TINY, Math.hypot(step.x, step.y)));
      const normal = hit.normal;
      contacts.push({ normal, depth: 0, point: { x: body.pose.x + step.x * fraction, y: body.pose.y + step.y * fraction } });
      const partial = transformCollider(body.compiled, { ...body.pose, x: body.pose.x + step.x * fraction, y: body.pose.y + step.y * fraction });
      const remaining = { x: step.x * (1 - fraction), y: step.y * (1 - fraction) };
      const inward = Math.min(0, remaining.x * normal.x + remaining.y * normal.y);
      remaining.x -= normal.x * inward; remaining.y -= normal.y * inward;
      const slide = attempt(partial, remaining, 0, world);
      body = slide?.body ?? partial;
      if (slide) contacts.push(...slide.contacts);
    } else { body = accepted.body; contacts.push(...accepted.contacts); }
  }
  return { collider: body, contacts, rotationBlocked, exhausted: steps > MAX_STEPS };
}
