/**
 * 小地图的纯数据类型。
 *
 * 这里不接触 Canvas、DOM 或任何游戏对象：GameScene 负责把真实世界状态翻译成
 * 这些结构，渲染层只消费它们。这样数据层可以在 Node 里直接单测。
 */

/**
 * 标记类别。
 *
 * enemy / objective / extraction 本次只保留注册接口：游戏里还没有可授权的
 * 敌人、任务目标或撤离点，先定好类型，避免以后改数据结构。
 */
export type MinimapMarkerType =
  | "mineral"
  | "gold"
  | "meat"
  | "pickup"
  | "torch"
  | "enemy"
  | "objective"
  | "extraction"
  | "custom";

/** 标记的附加状态，只影响外观，不改变“是否允许显示”。 */
export type MinimapMarkerState = "default" | "lit" | "dark" | "damaged";

/**
 * 一个已经通过授权、可以参与绘制的小地图标记。
 *
 * `visible` 必须来自玩法 / 感知系统的判断，而不是“对象还存在”。
 * 位置是世界坐标，绘制时再按玩家中心换算。
 */
export interface MinimapMarker {
  readonly id: string;
  readonly type: MinimapMarkerType;
  x: number;
  y: number;
  /** 数值越大越先绘制，也越不容易被聚合省略。 */
  priority: number;
  visible: boolean;
  state: MinimapMarkerState;
}

/** 每帧提交给 MarkerStore 的输入规格；优先级与默认状态由类型推导。 */
export interface MinimapMarkerSpec {
  /** 稳定 ID：同一对象在整局游戏里必须保持不变。 */
  id: string;
  type: MinimapMarkerType;
  x: number;
  y: number;
  visible: boolean;
  state?: MinimapMarkerState;
  /** 覆盖该类型的默认优先级；任务目标等需要压过普通物资时才传。 */
  priority?: number;
}

/** 地形认知状态，直接对应感知系统的 unknown / remembered / observed。 */
export type MinimapCellState = "unknown" | "remembered" | "observed";

/** 小地图使用的地形简化类别；不复制主场景的材质与瓦片配色。 */
export type MinimapTerrainClass =
  | "ground"
  | "wall"
  | "mineral"
  | "shallowWater"
  | "water"
  | "deepWater"
  | "ultraDeepWater";

/** 由配置与视口算出的屏幕布局（CSS 逻辑像素）。 */
export interface MinimapLayout {
  left: number;
  top: number;
  diameter: number;
  radius: number;
  centerX: number;
  centerY: number;
  /** 圆形范围覆盖的世界半径。 */
  worldRadius: number;
  /** 世界像素 → CSS 逻辑像素。 */
  scale: number;
  /** 黄金计数所在行的 y（小地图下方）。 */
  goldRow: number;
}

export interface MinimapViewport {
  /** CSS 逻辑像素。 */
  width: number;
  height: number;
  dpr: number;
}

/** 小地图当前覆盖的世界矩形（世界像素）。 */
export interface MinimapWorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 一帧的绘制输入：玩家中心、真实朝向、已经过滤好的标记。 */
export interface MinimapFrame {
  centerX: number;
  centerY: number;
  direction: number;
  markers: readonly MinimapMarker[];
}
