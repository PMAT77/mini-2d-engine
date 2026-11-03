import { circleCollider, type Point } from '../physics/Collider';
import { castCollider, type CollisionWorld } from '../physics/Motion';
import { THROWABLE_CONFIG as C, type ThrowableId } from './ThrowableConfig';

export interface ThrowableWorld extends CollisionWorld {
  width: number; height: number; tileSize: number;
  getShapeSpeedFactor?(body: ReturnType<typeof circleCollider>, water: { fraction: number; depth: number }): number;
}
export interface ThrowableBody extends Point {
  id: number; kind: ThrowableId; vx: number; vy: number; z: number; vz: number; rotation: number;
  fuse: number; landed: boolean; resting: boolean; smokeAge: number; dead: boolean;
}
export type ThrowableEvent = { type: 'explode' | 'land' | 'bounce'; body: ThrowableBody };
export function launchThrowable(id: number, kind: ThrowableId, origin: Point, target: Point, fuse: number = C.fuse): ThrowableBody {
  const dx = target.x - origin.x, dy = target.y - origin.y, d = Math.hypot(dx, dy);
  const range = Math.min(d, C.maxDistance), time = .45 + .45 * range / C.maxDistance;
  const scale = d > 0 ? range / d / time : 0;
  return { id, kind, x: origin.x, y: origin.y, vx: dx * scale, vy: dy * scale, z: C.releaseHeight,
    vz: (.5 * C.gravity * time * time - C.releaseHeight) / time, rotation: 0,
    fuse, landed: false, resting: false, smokeAge: -1, dead: false };
}

/** Shared by live simulation and preview. Continuous planar casts avoid tunnelling. */
export function stepThrowable(b: ThrowableBody, dt: number, world: ThrowableWorld, emit: (event: ThrowableEvent) => void = () => {}): void {
  if (b.dead || dt <= 0) return;
  const step = b.kind === 'grenade' ? Math.min(dt, Math.max(0, b.fuse)) : dt;
  if (!b.resting) {
    let remaining = step;
    for (let contacts = 0; remaining > 1e-8 && contacts < 8; contacts++) {
      const move = { x: b.vx * remaining, y: b.vy * remaining };
      let hit = castCollider(world, circleCollider(b.x, b.y, C.radius), move);
      const maxX = world.width * world.tileSize - C.radius, maxY = world.height * world.tileSize - C.radius;
      for (const [pos, velocity, min, max, nx, ny] of [[b.x, move.x, C.radius, maxX, 1, 0], [b.y, move.y, C.radius, maxY, 0, 1]]) {
        const edge = velocity < 0 ? min : max;
        const fraction = velocity ? (edge - pos) / velocity : Infinity;
        if (fraction >= 0 && fraction <= 1 && (!hit || fraction < hit.fraction))
          hit = { fraction, normal: { x: velocity < 0 ? nx : -nx, y: velocity < 0 ? ny : -ny }, obstacle: undefined! };
      }
      if (!hit) { b.x += move.x; b.y += move.y; break; }
      b.x += move.x * Math.max(0, hit.fraction - 1e-6); b.y += move.y * Math.max(0, hit.fraction - 1e-6);
      const n = hit.normal, dot = b.vx * n.x + b.vy * n.y;
      if (Math.hypot(n.x, n.y) < .1) { b.vx = b.vy = 0; break; }
      b.vx -= (1 + C.wallBounce) * Math.min(0, dot) * n.x;
      b.vy -= (1 + C.wallBounce) * Math.min(0, dot) * n.y;
      b.x += n.x * .001; b.y += n.y * .001;
      remaining *= 1 - hit.fraction;
      emit({ type: 'bounce', body: b });
    }
    b.z += b.vz * step - .5 * C.gravity * step * step; b.vz -= C.gravity * step;
    if (b.z <= 0) {
      b.z = 0;
      const water = { fraction: 0, depth: 0 }; world.getShapeSpeedFactor?.(circleCollider(b.x, b.y, C.radius), water);
      if (!b.landed) { b.landed = true; if (b.kind === 'smokeGrenade') b.smokeAge = 0; emit({ type: 'land', body: b }); }
      const rebound = water.fraction > 0 ? 0 : -b.vz * C.groundBounce;
      if (b.vz < -30) { b.vx *= water.fraction > 0 ? .3 : C.groundRetention; b.vy *= water.fraction > 0 ? .3 : C.groundRetention; }
      b.vz = rebound > 30 ? rebound : 0;
      const drag = Math.exp(-(water.fraction > 0 ? C.waterFriction : C.friction) * step);
      b.vx *= drag; b.vy *= drag;
      if (!b.vz && Math.hypot(b.vx, b.vy) < 12) { b.vx = b.vy = 0; b.resting = true; }
    }
    b.rotation += Math.hypot(b.vx, b.vy) * step * .035;
  }
  if (b.kind === 'grenade') {
    b.fuse -= step;
    if (b.fuse < 1e-8) { b.dead = true; emit({ type: 'explode', body: b }); }
  } else if (b.smokeAge >= 0) {
    b.smokeAge += step;
    if (b.smokeAge >= C.smokeGrow + C.smokeHold + C.smokeFade) b.dead = true;
  }
}

export function previewThrow(kind: ThrowableId, origin: Point, target: Point, world: ThrowableWorld, fuse: number = C.fuse) {
  const body = launchThrowable(-1, kind, origin, target, fuse);
  const points: (Point & { z: number })[] = [{ ...origin, z: body.z }];
  let landing: Point | undefined;
  for (let i = 0; i < 720 && !body.dead; i++) {
    stepThrowable(body, C.step, world, e => { if (e.type === 'land') landing = { x: body.x, y: body.y }; });
    if (i % 4 === 0 || body.dead || body.resting) points.push({ x: body.x, y: body.y, z: body.z });
    if (body.resting) break;
  }
  return { points, landing, end: { x: body.x, y: body.y }, fuse };
}
