/**
 * 掉落物拾取分类与配置。
 *
 * 拾取模式只描述“怎么捡”，物品效果（回血、加金、增益）仍由各自原有逻辑负责；
 * 因此这里只有数据接口，没有把肉块、金块和增益道具强行塞进同一套继承结构。
 */

/** 自动拾取走现有碰撞流程；交互拾取需要玩家按住交互键完成持续时间的进度。 */
export type PickupMode = "AUTO" | "INTERACT";

/** 地面发现标记：白点、金点或不额外标记。 */
export type PickupMarkerStyle = "none" | "whiteDot" | "goldDot";

/** 交互状态机状态。 */
export type InteractionState = "idle" | "focused" | "holding" | "completed";

/** 掉落物可配置的拾取字段。 */
export interface PickupConfig {
  /** 拾取方式。 */
  mode: PickupMode;
  /** INTERACT 需要按住的时长（秒）；AUTO 恒为 0。 */
  duration: number;
  /** 玩家碰撞体中心到交互锚点的最大距离（世界像素）；AUTO 由原碰撞体决定，填 0。 */
  interactionRadius: number;
  /** 高亮标记的发现范围（世界像素）。 */
  discoveryRadius: number;
  /** 标记样式。 */
  markerStyle: PickupMarkerStyle;
  /** 物品显示名称。 */
  displayName: string;
  /** 多个掉落物重叠时的提示优先级：距离相同时数值大的优先。 */
  priority: number;
}

/** 一帧内可以绘制的世界坐标发现标记。 */
export interface PickupMarker {
  x: number;
  y: number;
  style: PickupMarkerStyle;
}

/** 交互提示统一的短文案，不展示物品名与稀有度。 */
export const INTERACTION_PROMPT_LABEL = "拾取";

/** 鸡肉块：按住 E 0.5 秒，进入 70 世界像素内才出现提示。 */
export const MEAT_PICKUP_CONFIG: Readonly<PickupConfig> = Object.freeze({
  mode: "INTERACT",
  duration: 0.5,
  interactionRadius: 70,
  discoveryRadius: 160,
  markerStyle: "whiteDot",
  displayName: "鸡肉块",
  priority: 0,
});

/** 黄金碎块：保持碰撞自动拾取，不进入交互状态机。 */
export const GOLD_PICKUP_CONFIG: Readonly<PickupConfig> = Object.freeze({
  mode: "AUTO",
  duration: 0,
  interactionRadius: 0,
  discoveryRadius: 160,
  markerStyle: "goldDot",
  displayName: "黄金碎块",
  priority: 0,
});

/** 特殊增益道具：沿用原有碰撞拾取，不额外显示标记。 */
export const ITEM_PICKUP_CONFIG: Readonly<PickupConfig> = Object.freeze({
  mode: "AUTO",
  duration: 0,
  interactionRadius: 0,
  discoveryRadius: 0,
  markerStyle: "none",
  displayName: "增益道具",
  priority: -1,
});

/** 交互进度：clamp(elapsed / duration, 0, 1)，时长非法时按已完成处理。 */
export function clampProgress(elapsed: number, duration: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  return Math.min(1, elapsed / duration);
}

/** 只有 INTERACT 才进入按键交互控制器；AUTO 继续走碰撞。 */
export function isInteractionPickup(config: PickupConfig): boolean {
  return config.mode === "INTERACT";
}
