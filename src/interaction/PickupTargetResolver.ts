/**
 * 交互目标筛选：把“哪些掉落物可以交互”变成纯数据，便于单测与复用。
 *
 * 本轮只有肉块走交互，但后续武器、装备、容器都可以提供同样的候选数据。
 */

import type { PickupConfig } from "./PickupTypes";

/** 单个可交互候选；`target` 指回场景里的具体掉落物。 */
export interface PickupCandidate<T> {
  target: T;
  /** 稳定 id：距离相同时用它保证选择结果确定。 */
  id: string;
  /** 交互锚点（世界坐标）。 */
  x: number;
  y: number;
  /** 玩家碰撞体中心到锚点的世界距离。 */
  distance: number;
  /** 重叠时的优先级，数值大的优先。 */
  priority: number;
  /** 交互持续时间（秒），来自该物品的 PickupConfig。 */
  duration: number;
}

/** 新目标至少比当前目标近这么多像素才切换，避免两个相邻肉块之间闪烁。 */
export const TARGET_SWITCH_HYSTERESIS = 12;

/** 玩家交互锚点：碰撞体中心。 */
export function getPlayerAnchor(getCollider: () => {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  const body = getCollider();
  return { x: body.x + body.width / 2, y: body.y + body.height / 2 };
}

/** 世界距离。 */
export function getInteractionDistance(
  player: { x: number; y: number },
  anchor: { x: number; y: number },
): number {
  return Math.hypot(anchor.x - player.x, anchor.y - player.y);
}

/** 候选排序：距离 → 优先级 → 稳定 id。 */
export function comparePickupCandidates<T>(
  a: PickupCandidate<T>,
  b: PickupCandidate<T>,
): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 在候选中确定当前目标。
 *
 * - 没有已锁定目标时直接取最优候选；
 * - 已有目标仍有效时，只有新目标近出 `hysteresis` 像素才切换；
 * - 当前目标不在候选里（消失/离开距离）时按新目标处理。
 */
export function selectPickupTarget<T>(
  candidates: readonly PickupCandidate<T>[],
  currentId: string | null,
  hysteresis: number = TARGET_SWITCH_HYSTERESIS,
): PickupCandidate<T> | null {
  let best: PickupCandidate<T> | null = null;
  for (const candidate of candidates) {
    if (!best || comparePickupCandidates(candidate, best) < 0) best = candidate;
  }
  if (!best) return null;
  if (currentId === null) return best;

  const current = candidates.find((candidate) => candidate.id === currentId);
  if (!current) return best;
  if (best === current) return current;

  return best.distance + Math.max(0, hysteresis) < current.distance ? best : current;
}

/** 从配置生成候选的公共字段，避免各掉落物重复计算。 */
export function createPickupCandidate<T>(
  target: T,
  id: string,
  anchor: { x: number; y: number },
  player: { x: number; y: number },
  config: PickupConfig,
): PickupCandidate<T> {
  return {
    target,
    id,
    x: anchor.x,
    y: anchor.y,
    distance: getInteractionDistance(player, anchor),
    priority: config.priority,
    duration: config.duration,
  };
}
