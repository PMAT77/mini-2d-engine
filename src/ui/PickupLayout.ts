/**
 * 拾取提示的纯布局几何：标记点位置、密集标记聚合、提示停靠位置与圆角矩形路径。
 *
 * 这里不接触 Canvas，也不读取游戏状态，方便单测；渲染器只消费计算结果。
 * 所有尺寸单位都是屏幕 CSS 逻辑像素。
 */

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PromptSide = "right" | "left" | "above" | "below";

/** 标记点与物品可见顶部的间距。 */
export const MARKER_GAP = 8;
/** 标记点的柔光半径，用于避免提示框压住光点。 */
export const MARKER_HALO_RADIUS = 8;
/** 两个标记点在屏幕空间内小于该距离时视为同一簇，次要标记会弱化。 */
export const MARKER_CLUSTER_DISTANCE = 12;
/** 横向提示与物品可见边缘的间距。 */
export const PROMPT_ITEM_GAP = 10;
/** 提示框与屏幕边缘的最小留白。 */
export const PROMPT_SCREEN_MARGIN = 8;

/** 高亮点在物品上方的位置：以可见顶部加固定间距为准，不用碰撞体顶点。 */
export function markerDotPosition(
  anchorX: number,
  anchorY: number,
  halfHeight: number,
): LayoutPoint {
  return { x: anchorX, y: anchorY - halfHeight - MARKER_GAP };
}

/**
 * 标记点密集时只保留主要光点，返回应当弱化的标记下标。
 * 当前交互目标优先作为主要光点；其余按屏幕坐标近似重合程度判定。
 */
export function secondaryMarkerIndices(
  positions: readonly LayoutPoint[],
  targetIndex = -1,
  threshold = MARKER_CLUSTER_DISTANCE,
): Set<number> {
  const order = positions.map((_, index) => index);
  if (targetIndex >= 0 && targetIndex < positions.length) {
    order.splice(order.indexOf(targetIndex), 1);
    order.unshift(targetIndex);
  }

  const kept: LayoutPoint[] = [];
  const secondary = new Set<number>();
  for (const index of order) {
    const point = positions[index];
    const close = kept.some(other => Math.hypot(point.x - other.x, point.y - other.y) < threshold);
    if (close) secondary.add(index);
    else kept.push(point);
  }
  return secondary;
}

export interface PromptPlacementInput {
  /** 物品中心（屏幕 CSS）。 */
  anchorX: number;
  anchorY: number;
  /** 物品可见范围的半宽/半高（屏幕 CSS）。 */
  halfWidth: number;
  halfHeight: number;
  /** E 键内容尺寸；V1 只有键帽，没有文字。 */
  contentWidth: number;
  contentHeight: number;
  /** 玩家位于物品右侧时提示放到物品上方，其余情况统一放右侧。 */
  preferAbove?: boolean;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}

export interface PromptPlacement {
  side: PromptSide;
  box: LayoutBox;
}

/**
 * 只有两种停靠位置：默认在物品右侧；玩家从物品右侧靠近时改到物品上方，
 * 避免提示夹在玩家与掉落物之间。无论哪种都夹回屏幕安全区。
 */
export function placePickupPrompt(input: PromptPlacementInput): PromptPlacement {
  const margin = input.margin ?? PROMPT_SCREEN_MARGIN;
  const { anchorX, anchorY, halfWidth, halfHeight } = input;
  const width = input.contentWidth;
  const height = input.contentHeight;
  const dotY = anchorY - halfHeight - MARKER_GAP;

  const box: LayoutBox = input.preferAbove
    ? {
      x: anchorX - width / 2,
      y: dotY - MARKER_HALO_RADIUS - 4 - height,
      width,
      height,
    }
    : {
      x: anchorX + halfWidth + PROMPT_ITEM_GAP,
      y: anchorY - height / 2,
      width,
      height,
    };

  return {
    side: input.preferAbove ? "above" : "right",
    box: clampBox(box, input.viewportWidth, input.viewportHeight, margin),
  };
}

function clampBox(box: LayoutBox, viewportWidth: number, viewportHeight: number, margin: number): LayoutBox {
  const maxX = Math.max(margin, viewportWidth - margin - box.width);
  const maxY = Math.max(margin, viewportHeight - margin - box.height);
  return {
    x: Math.min(Math.max(box.x, margin), maxX),
    y: Math.min(Math.max(box.y, margin), maxY),
    width: box.width,
    height: box.height,
  };
}

export interface OutlinePoint extends LayoutPoint {
  /** 从顶部中点起笔、顺时针累计的弧长。 */
  distance: number;
}

export interface RoundedRectOutline {
  points: readonly OutlinePoint[];
  length: number;
}

const outlineCache = new Map<string, RoundedRectOutline>();

/**
 * 圆角矩形外轮廓：从顶部中点起笔，顺时针经过四条直边与四个圆角。
 * 以约 1px 的等距采样缓存静态几何，进度描边只需要按弧长取点。
 */
export function roundedRectOutline(width: number, height: number, radius: number, step = 1): RoundedRectOutline {
  const w = Math.max(2, width);
  const h = Math.max(2, height);
  const r = Math.min(Math.max(0, radius), w / 2, h / 2);
  const key = `${w.toFixed(2)}x${h.toFixed(2)}r${r.toFixed(2)}s${step}`;
  const cached = outlineCache.get(key);
  if (cached) return cached;

  const halfW = w / 2;
  const halfH = h / 2;
  const segments: Segment[] = [
    line(0, -halfH, halfW - r, -halfH),
    arc(halfW - r, -halfH + r, r, -Math.PI / 2, 0),
    line(halfW, -halfH + r, halfW, halfH - r),
    arc(halfW - r, halfH - r, r, 0, Math.PI / 2),
    line(halfW - r, halfH, -halfW + r, halfH),
    arc(-halfW + r, halfH - r, r, Math.PI / 2, Math.PI),
    line(-halfW, halfH - r, -halfW, -halfH + r),
    arc(-halfW + r, -halfH + r, r, Math.PI, (Math.PI * 3) / 2),
    line(-halfW + r, -halfH, 0, -halfH),
  ];

  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  const count = Math.max(8, Math.ceil(length / step));
  const points: OutlinePoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const distance = (length * i) / count;
    points.push({ ...pointAt(segments, distance), distance });
  }

  const outline = { points, length };
  outlineCache.set(key, outline);
  return outline;
}

interface Segment {
  length: number;
  point(t: number): LayoutPoint;
}

function line(x1: number, y1: number, x2: number, y2: number): Segment {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return {
    length: Math.hypot(dx, dy),
    point: t => ({ x: x1 + dx * t, y: y1 + dy * t }),
  };
}

function arc(cx: number, cy: number, radius: number, start: number, end: number): Segment {
  return {
    length: Math.abs(end - start) * radius,
    point: t => {
      const angle = start + (end - start) * t;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    },
  };
}

function pointAt(segments: readonly Segment[], distance: number): LayoutPoint {
  let remaining = Math.max(0, distance);
  for (const segment of segments) {
    if (remaining <= segment.length || segment === segments[segments.length - 1]) {
      const t = segment.length <= 0 ? 0 : Math.min(1, remaining / segment.length);
      return segment.point(t);
    }
    remaining -= segment.length;
  }
  return { x: 0, y: 0 };
}
