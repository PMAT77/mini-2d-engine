import type { ShadowEdge } from '../map/TileMap';
import type { Point } from '../physics/Collider';

export interface DirectionalLight {
  direction: Point; color: string; intensity: number;
  shadowLength: number; shadowOpacity: number; softness: number;
}
/** Clockwise exposed edges cast on their downstream side; projection is identical everywhere. */
export function projectDirectionalShadow(edge: ShadowEdge, direction: Point, length: number): number[] | null {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (![edge.ax, edge.ay, edge.bx, edge.by, magnitude, length].every(Number.isFinite) || magnitude <= 0 || length <= 0) return null;
  const dx = direction.x / magnitude, dy = direction.y / magnitude;
  if (dx * (edge.by - edge.ay) - dy * (edge.bx - edge.ax) <= 1e-8) return null;
  return [edge.ax, edge.ay, edge.bx, edge.by, edge.bx + dx * length, edge.by + dy * length, edge.ax + dx * length, edge.ay + dy * length];
}
export function appendDirectionalShadow(ctx: CanvasRenderingContext2D, edge: ShadowEdge, direction: Point, length: number): void {
  const p = projectDirectionalShadow(edge, direction, length); if (!p) return;
  ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath();
}
/** A tapered, grounded body shadow; contact shadows remain a separate small footprint. */
export function drawBodySunShadow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, light: DirectionalLight, alpha = 1, height = .8): void {
  if (light.intensity <= 0 || light.shadowLength <= 0 || alpha <= 0) return;
  const reach = light.shadowLength * height;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(light.direction.y, light.direction.x));
  ctx.globalAlpha *= alpha * light.shadowOpacity * Math.min(.48, light.intensity * 1.1);
  ctx.fillStyle = '#263544';
  ctx.beginPath(); ctx.ellipse(reach * .45, 0, reach * .55 + size * .26, size * .24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
