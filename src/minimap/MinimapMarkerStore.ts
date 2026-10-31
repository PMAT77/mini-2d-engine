import { isInsideMinimap, worldToMinimap } from "./MinimapConfig";
import type { MinimapLayout } from "./MinimapTypes";
import type {
  MinimapMarker,
  MinimapMarkerSpec,
  MinimapMarkerState,
  MinimapMarkerType,
} from "./MinimapTypes";

/**
 * 小地图标记的身份与筛选。
 *
 * 这里不拥有任何资源状态：真实对象是否存在、是否被拾取、位置是否变化，全部由
 * GameScene 与对象自己决定。本类只负责：
 * - 给标记一个稳定 id（同一实体跨帧不会变成两个标记，避免闪烁）
 * - 保存最新一次授权结果（x / y / visible / state）
 * - 显示范围内按优先级筛选、去重、遮挡处理
 */

/** 标记的默认优先级：任务目标 > 撤离点 > 敌人 > 矿物 > 火把 > 普通物资。 */
export const MINIMAP_MARKER_PRIORITY: Readonly<Record<MinimapMarkerType, number>> = Object.freeze({
  objective: 100,
  extraction: 90,
  enemy: 80,
  custom: 50,
  mineral: 40,
  torch: 30,
  gold: 20,
  pickup: 18,
  meat: 10,
});

/** 不参与“相邻去重”的高优先级类型：它们本身就比周围物资重要。 */
const CLUSTER_EXEMPT: ReadonlySet<MinimapMarkerType> = new Set<MinimapMarkerType>([
  "objective",
  "extraction",
]);

/** 地图上同时画出的标记上限，避免极端掉落场景拖慢 HUD。 */
export const MINIMAP_MAX_VISIBLE_MARKERS = 48;

export function mineralMarkerId(col: number, row: number): string {
  return `mineral:${col}:${row}`;
}

/** 动态对象用「类型:实体 id」保证稳定，实体 id 由 GameScene 的 WeakMap 提供。 */
export function entityMarkerId(type: MinimapMarkerType, entityId: string | number): string {
  return `${type}:${entityId}`;
}

export interface MarkerSelectionOptions {
  /** 标记与圆边的最小间距。 */
  padding?: number;
  /** 两个普通标记在该屏幕距离内只保留优先级更高的一个。 */
  clusterDistance?: number;
  /** 最多返回多少个标记。 */
  limit?: number;
}

/**
 * 纯函数：从标记集合里挑出本次要画的那些。
 *
 * 规则：
 * 1. visible 为假一律丢弃（授权由感知系统给出，不在这里推断）。
 * 2. 圆形范围外丢弃，标记不会溢出圆边。
 * 3. 优先级高的先占位；低优先级若与已选普通标记靠得太近则被遮挡。
 * 4. 任务目标 / 撤离点豁免遮挡，保证关键信息一定可见。
 */
export function selectVisibleMarkers(
  markers: Iterable<MinimapMarker>,
  layout: MinimapLayout,
  playerX: number,
  playerY: number,
  options: MarkerSelectionOptions = {}
): MinimapMarker[] {
  const padding = options.padding ?? 0;
  const clusterDistance = Math.max(0, options.clusterDistance ?? 0);
  const limit = Math.max(0, options.limit ?? MINIMAP_MAX_VISIBLE_MARKERS);

  const candidates: Array<{ marker: MinimapMarker; x: number; y: number }> = [];
  for (const marker of markers) {
    if (!marker.visible) continue;
    if (!isInsideMinimap(layout, playerX, playerY, marker.x, marker.y, padding)) continue;
    const point = worldToMinimap(layout, playerX, playerY, marker.x, marker.y);
    candidates.push({ marker, x: point.x, y: point.y });
  }

  candidates.sort((a, b) => {
    if (b.marker.priority !== a.marker.priority) return b.marker.priority - a.marker.priority;
    return a.marker.id < b.marker.id ? -1 : a.marker.id > b.marker.id ? 1 : 0;
  });

  const selected: Array<{ marker: MinimapMarker; x: number; y: number }> = [];
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (clusterDistance > 0 && !CLUSTER_EXEMPT.has(candidate.marker.type)) {
      const blocked = selected.some(
        (chosen) => Math.hypot(chosen.x - candidate.x, chosen.y - candidate.y) < clusterDistance
      );
      if (blocked) continue;
    }
    selected.push(candidate);
  }

  return selected.map((entry) => entry.marker);
}

export class MinimapMarkerStore {
  private markers = new Map<string, MinimapMarker>();

  get size(): number {
    return this.markers.size;
  }

  get(id: string): MinimapMarker | undefined {
    return this.markers.get(id);
  }

  clear(): void {
    this.markers.clear();
  }

  /**
   * 用最新授权结果整体替换标记集合。
   *
   * 同 id 的标记复用原对象（只更新字段），这样 HUD 不会因为数组重建而闪烁；
   * 本次没有出现的 id 视为实体已消失，立刻移除，不会留下幽灵标记。
   */
  replace(specs: Iterable<MinimapMarkerSpec>): void {
    const next = new Map<string, MinimapMarker>();
    for (const spec of specs) {
      const existing = this.markers.get(spec.id);
      if (existing) {
        existing.x = spec.x;
        existing.y = spec.y;
        existing.visible = spec.visible;
        existing.state = spec.state ?? "default";
        next.set(spec.id, existing);
      } else {
        next.set(spec.id, {
          id: spec.id,
          type: spec.type,
          x: spec.x,
          y: spec.y,
          priority: spec.priority ?? MINIMAP_MARKER_PRIORITY[spec.type],
          visible: spec.visible,
          state: spec.state ?? "default",
        });
      }
    }
    this.markers = next;
  }

  /** 显示范围内、按优先级筛选后的标记；每帧调用，不修改集合本身。 */
  visibleIn(
    layout: MinimapLayout,
    playerX: number,
    playerY: number,
    options: MarkerSelectionOptions = {}
  ): MinimapMarker[] {
    return selectVisibleMarkers(this.markers.values(), layout, playerX, playerY, options);
  }

  /** 调试/测试用：当前登记的全部标记（含不可见）。 */
  values(): readonly MinimapMarker[] {
    return Array.from(this.markers.values());
  }
}

export type { MinimapMarker, MinimapMarkerSpec, MinimapMarkerState };
