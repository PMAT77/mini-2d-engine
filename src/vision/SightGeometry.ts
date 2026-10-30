import { segmentsIntersect } from '../physics/Collider';
import type { Point } from '../physics/Collider';
import type { PerceptionTarget, SightMap, VisionObserver } from './VisionTypes';

/** 目标采样点：中心 + 包围盒四条边的内缩点。 */
export function targetSamplePoints(target: PerceptionTarget): Point[] {
  if (target.samplePoints && target.samplePoints.length > 0) return target.samplePoints.map(point => ({ x: point.x, y: point.y }));
  const center: Point = { x: target.x, y: target.y };
  const bounds = target.bounds;
  const points: Point[] = [center];
  if (!bounds || !(bounds.width > 2) || !(bounds.height > 2)) return points;
  const insetX = Math.min(bounds.width / 2, Math.max(1, bounds.width * 0.25));
  const insetY = Math.min(bounds.height / 2, Math.max(1, bounds.height * 0.25));
  const left = bounds.x + insetX;
  const right = bounds.x + bounds.width - insetX;
  const top = bounds.y + insetY;
  const bottom = bounds.y + bounds.height - insetY;
  if (right > left) {
    points.push({ x: left, y: target.y }, { x: right, y: target.y });
  }
  if (bottom > top) {
    points.push({ x: target.x, y: top }, { x: target.x, y: bottom });
  }
  return points;
}

/**
 * 世界坐标线段是否被地形阻挡。
 * 只使用 TileMap 的实心多边形/点查询，不引入第二套“哪些瓦片挡光”的规则。
 */
export function hasLineOfSight(map: SightMap, ax: number, ay: number, bx: number, by: number): boolean {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
  if (map.blocksLightAt(ax, ay) || map.blocksLightAt(bx, by)) return false;
  if (ax === bx && ay === by) return true;

  const minX = Math.min(ax, bx) - 1;
  const minY = Math.min(ay, by) - 1;
  const width = Math.max(2, Math.abs(bx - ax) + 2);
  const height = Math.max(2, Math.abs(by - ay) + 2);
  const polygons = map.getBlockingPolygons(minX, minY, width, height);
  const a: Point = { x: ax, y: ay };
  const b: Point = { x: bx, y: by };

  for (const polygon of polygons) {
    const vertices = polygon.vertices;
    if (!vertices || vertices.length < 3) continue;
    for (let i = 0; i < vertices.length; i++) {
      const c = vertices[i];
      const d = vertices[(i + 1) % vertices.length];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

/** 剪影只需要任一采样点可见；完整辨识由调用方检查中心点。 */
export function anySampleVisible(map: SightMap, observer: VisionObserver, target: PerceptionTarget): boolean {
  const points = targetSamplePoints(target);
  for (const point of points) {
    if (hasLineOfSight(map, observer.x, observer.y, point.x, point.y)) return true;
  }
  return false;
}

export function distanceBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
