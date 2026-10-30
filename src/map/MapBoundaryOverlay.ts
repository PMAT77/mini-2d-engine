export interface OutsideRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** “无法通行”文字水印：界外只留文字，不叠任何底色或描边。 */
export const MAP_BOUNDARY_WATERMARK_TEXT = "无法通行";
export const MAP_BOUNDARY_WATERMARK_CSS_SIZE = 22;
export const MAP_BOUNDARY_WATERMARK_ALPHA = 0.2;
export const MAP_BOUNDARY_WATERMARK_ANGLE = -0.18;
/** 水印网格的行/列间距 = 字号 × 该系数。 */
export const MAP_BOUNDARY_WATERMARK_SPACING = 8;
export const MAP_BOUNDARY_WATERMARK_MAX = 160;

const WATERMARK_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const EPS = 1e-6;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * 视口内所有位于地图之外的矩形（left/right/top/bottom 条带）。
 * 地图完全覆盖视口时返回空数组；地图与视口不相交时返回整块视口。
 */
export function getOutsideViewportRegions(
  mapWidth: number, mapHeight: number,
  cameraX: number, cameraY: number,
  viewWidth: number, viewHeight: number,
): OutsideRegion[] {
  if (![mapWidth, mapHeight, cameraX, cameraY, viewWidth, viewHeight].every(Number.isFinite)
    || mapWidth <= 0 || mapHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return [];

  const mapX = -cameraX, mapY = -cameraY;
  const left = clamp(mapX, 0, viewWidth);
  const right = clamp(mapX + mapWidth, 0, viewWidth);
  const top = clamp(mapY, 0, viewHeight);
  const bottom = clamp(mapY + mapHeight, 0, viewHeight);

  // 地图整块落在视口外：没有“边界”可看，整屏都是界外。
  if (right <= EPS || left >= viewWidth - EPS || bottom <= EPS || top >= viewHeight - EPS) {
    return [{ x: 0, y: 0, width: viewWidth, height: viewHeight }];
  }

  const regions: OutsideRegion[] = [];
  if (left > EPS) regions.push({ x: 0, y: 0, width: left, height: viewHeight });
  if (right < viewWidth - EPS) {
    regions.push({ x: right, y: 0, width: viewWidth - right, height: viewHeight });
  }
  if (top > EPS) regions.push({ x: 0, y: 0, width: viewWidth, height: top });
  if (bottom < viewHeight - EPS) {
    regions.push({ x: 0, y: bottom, width: viewWidth, height: viewHeight - bottom });
  }
  return regions;
}

/**
 * 斜向水印的落点网格：只保留中心位于地图外的点。
 * 间距以世界像素计，由字号推导，缩放时视觉密度保持不变。
 */
export function getWatermarkPlacements(
  viewWidth: number, viewHeight: number,
  mapRect: { x: number; y: number; width: number; height: number },
  spacing: number,
): Array<{ x: number; y: number }> {
  if (![viewWidth, viewHeight, spacing, mapRect.x, mapRect.y, mapRect.width, mapRect.height]
    .every(Number.isFinite) || viewWidth <= 0 || viewHeight <= 0 || spacing <= 0) return [];

  const stepX = spacing;
  const stepY = spacing * 0.72;
  const points: Array<{ x: number; y: number }> = [];
  let row = 0;
  for (let y = stepY * 0.5; y < viewHeight; y += stepY, row++) {
    const startX = row % 2 === 0 ? stepX * 0.5 : 0;
    for (let x = startX; x < viewWidth; x += stepX) {
      if (x > mapRect.x - EPS && x < mapRect.x + mapRect.width + EPS
        && y > mapRect.y - EPS && y < mapRect.y + mapRect.height + EPS) continue;
      points.push({ x, y });
      if (points.length >= MAP_BOUNDARY_WATERMARK_MAX) return points;
    }
  }
  return points;
}

/**
 * 地图边界之外的“无法通行”文字水印。
 * 界外保持与地图相同的深色底，只叠稀疏的倾斜文字；不改碰撞、光照或地形。
 */
export class MapBoundaryOverlay {
  private lastWatermarkCount = 0;

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    mapWidth: number, mapHeight: number, scale: number, dpr: number): void {
    this.lastWatermarkCount = 0;
    const viewWidth = ctx.canvas.width, viewHeight = ctx.canvas.height;
    const regions = getOutsideViewportRegions(mapWidth, mapHeight, cameraX, cameraY,
      viewWidth, viewHeight);
    if (!regions.length) return;

    const mapRect = { x: -cameraX, y: -cameraY, width: mapWidth, height: mapHeight };
    const fontPx = clamp(MAP_BOUNDARY_WATERMARK_CSS_SIZE
      * (Number.isFinite(dpr) ? dpr : 1) / Math.max(scale, 0.01), 8, 200);
    const placements = getWatermarkPlacements(viewWidth, viewHeight, mapRect,
      fontPx * MAP_BOUNDARY_WATERMARK_SPACING);

    ctx.save();
    // 只保留地图之外的像素；圆角/旋转地图沿用矩形语义，与现有碰撞边一致。
    ctx.beginPath();
    ctx.rect(0, 0, viewWidth, viewHeight);
    ctx.rect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);
    ctx.clip("evenodd");

    ctx.font = `700 ${fontPx}px ${WATERMARK_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgb(236, 246, 255)";
    ctx.globalAlpha = MAP_BOUNDARY_WATERMARK_ALPHA;
    for (const point of placements) {
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(MAP_BOUNDARY_WATERMARK_ANGLE);
      ctx.fillText(MAP_BOUNDARY_WATERMARK_TEXT, 0, 0);
      ctx.restore();
    }
    this.lastWatermarkCount = placements.length;
    ctx.restore();
  }

  getLastWatermarkCount(): number {
    return this.lastWatermarkCount;
  }
}
