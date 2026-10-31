import type {
  MinimapCellState,
  MinimapLayout,
  MinimapMarkerType,
  MinimapTerrainClass,
} from "./MinimapTypes";

/**
 * 小地图的全部可调参数与配色。
 *
 * 尺寸、半径、世界范围只在这里定义一次；HUD、黄金计数布局和单测都从这里取值，
 * 不允许在绘制代码里散落魔数。
 */
export interface MinimapConfig {
  /** 左上角外边距（CSS 逻辑像素）。 */
  left: number;
  top: number;
  /** 桌面端的标准直径；小屏幕上会按 maxViewportFraction 收缩。 */
  diameter: number;
  /** 圆形范围覆盖的世界半径。 */
  worldRadius: number;
  /** 缓存纹理相对小地图设备像素的超采样倍率。 */
  cacheSuperSample: number;
  /** 地形数据的刷新节拍（秒）。 */
  refreshInterval: number;
  /** 收缩下限，低于它就不再缩小，保持可读。 */
  minDiameter: number;
  /** 小地图直径最多占用视口短边的比例。 */
  maxViewportFraction: number;
  /** 黄金计数与小地图下缘的间距。 */
  goldGap: number;
  /** 黄金图标边长。 */
  goldIconSize: number;
  /** 黄金计数文字字体。 */
  goldFont: string;
  /** 圆形外边框宽度。 */
  borderWidth: number;
  /** 地形缓存窗口比显示半径多扫的世界像素，覆盖两次刷新之间的位移。 */
  windowMargin: number;
  /** 标记与圆边的最小间距（CSS 逻辑像素）。 */
  markerPadding: number;
  /** 两个标记在该屏幕距离内视为同一簇，只留优先级更高的一个。 */
  markerClusterDistance: number;
  /** 缓存画布单边最大像素，限制高 DPI 下的显存占用。 */
  maxCacheSize: number;
}

/** 地形两档认知状态的配色；unknown 统一使用背景色。 */
export type MinimapTerrainColors = Readonly<
  Record<MinimapTerrainClass, { observed: string; remembered: string }>
>;

export interface MinimapPalette {
  /** 未探索背景与圆外底色。 */
  unknown: string;
  terrain: MinimapTerrainColors;
  player: string;
  playerEdge: string;
  border: string;
  borderInset: string;
  marker: Readonly<Record<MinimapMarkerType, string>>;
  /** 熄灭的火把：比点燃时更暗、更低饱和。 */
  markerTorchDark: string;
  goldIcon: string;
  goldText: string;
}

export const DEFAULT_MINIMAP_CONFIG: Readonly<MinimapConfig> = Object.freeze({
  left: 20,
  top: 20,
  diameter: 160,
  worldRadius: 1200,
  cacheSuperSample: 2,
  refreshInterval: 0.1,
  minDiameter: 96,
  maxViewportFraction: 0.28,
  goldGap: 14,
  goldIconSize: 12,
  goldFont: "18px sans-serif",
  borderWidth: 1,
  windowMargin: 120,
  markerPadding: 5,
  markerClusterDistance: 9,
  maxCacheSize: 2048,
});

/**
 * Dark Tactical Survival 配色。
 *
 * 原则：深色、低饱和、冷色地形 + 暖色资源。remembered 比 observed 再暗一档，
 * 但两者都明显亮于 unknown，保证“探索过的轮廓”能被读出来。
 */
export const DEFAULT_MINIMAP_PALETTE: Readonly<MinimapPalette> = Object.freeze({
  unknown: "#080D12",
  terrain: {
    ground: { observed: "#1A232B", remembered: "#131A21" },
    wall: { observed: "#3B4954", remembered: "#2B3641" },
    mineral: { observed: "#8A7240", remembered: "#54452A" },
    shallowWater: { observed: "#2F5C68", remembered: "#1E4149" },
    water: { observed: "#2A5361", remembered: "#193540" },
    deepWater: { observed: "#1B3850", remembered: "#122C38" },
    ultraDeepWater: { observed: "#142834", remembered: "#0E2029" },
  },
  player: "#E7F2FF",
  playerEdge: "#0A1118",
  border: "#65727C",
  borderInset: "#2A343C",
  marker: {
    mineral: "#E8BB62",
    gold: "#E0A94F",
    meat: "#A85A50",
    pickup: "#8FBFA5",
    torch: "#D98B4F",
    enemy: "#C97965",
    objective: "#D8C27A",
    extraction: "#7FC8A9",
    custom: "#9AA7B4",
  },
  markerTorchDark: "#6E6255",
  goldIcon: "#FFD700",
  goldText: "#FFD700",
});

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`小地图参数 ${name} 必须是有限数字。`);
  return value;
}

function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`小地图参数 ${name} 必须大于 0。`);
  return value;
}

/** 校验并合并配置；非法值直接抛中文错误，和视觉规则的校验风格一致。 */
export function createMinimapConfig(overrides: Partial<MinimapConfig> = {}): MinimapConfig {
  const merged: MinimapConfig = { ...DEFAULT_MINIMAP_CONFIG, ...overrides };
  requireFinite(merged.left, "left");
  requireFinite(merged.top, "top");
  requirePositive(merged.diameter, "diameter");
  requirePositive(merged.worldRadius, "worldRadius");
  requirePositive(merged.cacheSuperSample, "cacheSuperSample");
  requirePositive(merged.refreshInterval, "refreshInterval");
  requirePositive(merged.minDiameter, "minDiameter");
  requirePositive(merged.maxViewportFraction, "maxViewportFraction");
  requireFinite(merged.goldGap, "goldGap");
  requirePositive(merged.goldIconSize, "goldIconSize");
  requirePositive(merged.borderWidth, "borderWidth");
  requireFinite(merged.windowMargin, "windowMargin");
  requireFinite(merged.markerPadding, "markerPadding");
  requireFinite(merged.markerClusterDistance, "markerClusterDistance");
  requirePositive(merged.maxCacheSize, "maxCacheSize");
  return merged;
}

/**
 * 根据视口计算小地图布局。
 *
 * 小屏幕上按 maxViewportFraction 收缩，但不会小于 minDiameter；这样窄窗口里
 * HUD 不会挡住半个屏幕，也不会缩到看不清地形。
 */
export function computeMinimapLayout(
  config: MinimapConfig,
  viewportWidth: number,
  viewportHeight: number
): MinimapLayout {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const limit = Math.floor(Math.min(width, height) * config.maxViewportFraction);
  const diameter = Math.max(24, Math.min(config.diameter, Math.max(config.minDiameter, limit)));
  const radius = diameter / 2;
  return {
    left: config.left,
    top: config.top,
    diameter,
    radius,
    centerX: config.left + radius,
    centerY: config.top + radius,
    worldRadius: config.worldRadius,
    scale: radius / config.worldRadius,
    goldRow: config.top + diameter + config.goldGap,
  };
}

/**
 * 世界坐标 → 小地图屏幕坐标。玩家永远在圆心，地图不随朝向旋转。
 *
 * 该函数不读取相机：小地图与主摄像机的位移、缩放和震动完全解耦。
 */
export function worldToMinimap(
  layout: MinimapLayout,
  playerX: number,
  playerY: number,
  worldX: number,
  worldY: number
): { x: number; y: number } {
  return {
    x: layout.centerX + (worldX - playerX) * layout.scale,
    y: layout.centerY + (worldY - playerY) * layout.scale,
  };
}

/** 目标是否落在圆形范围内（padding 用于给标记留出边距）。 */
export function isInsideMinimap(
  layout: MinimapLayout,
  playerX: number,
  playerY: number,
  worldX: number,
  worldY: number,
  padding = 0
): boolean {
  const point = worldToMinimap(layout, playerX, playerY, worldX, worldY);
  const limit = Math.max(0, layout.radius - padding);
  return Math.hypot(point.x - layout.centerX, point.y - layout.centerY) <= limit;
}

/** 黄金计数的锚点：紧贴小地图下缘，与图标、文字共用一套坐标。 */
export interface MinimapGoldHudRect {
  iconX: number;
  iconY: number;
  iconSize: number;
  textX: number;
  textY: number;
  font: string;
}

export function computeGoldHudRect(layout: MinimapLayout, config: MinimapConfig): MinimapGoldHudRect {
  const iconSize = config.goldIconSize;
  return {
    iconX: layout.left,
    iconY: layout.goldRow,
    iconSize,
    textX: layout.left + iconSize + 10,
    textY: layout.goldRow + iconSize / 2,
    font: config.goldFont,
  };
}

/** 地形 + 认知状态 → 缓存画布上使用的颜色。unknown 不泄露任何地形。 */
export function minimapCellColor(
  palette: MinimapPalette,
  terrain: MinimapTerrainClass,
  state: MinimapCellState
): string {
  if (state === "unknown") return palette.unknown;
  const colors = palette.terrain[terrain];
  return state === "observed" ? colors.observed : colors.remembered;
}
