import type { Bounds, Point, Polygon } from '../physics/Collider';
import type { TileTypeId } from '../map/TileType';

/** 一个对象对某个观察者的显示等级。 */
export type EntityVisibility = 'hidden' | 'silhouette' | 'identified';

/** 地形对某个观察者的记忆状态。 */
export type TerrainRecall = 'unknown' | 'remembered' | 'observed';

/** legacy 保留旧圆形迷雾；three-layer 走感知合成。 */
export type VisionMode = 'legacy' | 'three-layer';

export type PerceptionTargetCategory = 'player' | 'enemy' | 'loot' | 'light' | 'effect';

export type PerceptionLightKind = 'playerGlow' | 'flashlight' | 'torch' | 'facility' | 'teammate';

/**
 * 观察者只描述“谁在看”。它不持有 Canvas，也不依赖 GameScene。
 * 位置为世界坐标，facing 为世界弧度。
 */
export interface VisionObserver {
  id: string;
  x: number;
  y: number;
  facing: number;
  nearSenseRadius: number;
  maxObservationRange: number;
}

/**
 * 可供辨识使用的光源。它描述“哪里有光”，不是“谁看见了什么”。
 * direction/angle/softness/innerRadius/innerFade 未提供时按点光处理。
 */
export interface PerceptionLight {
  id: string;
  x: number;
  y: number;
  radius: number;
  direction?: number;
  angle?: number;
  softness?: number;
  innerRadius?: number;
  innerFade?: number;
  intensity: number;
  active: boolean;
  /** 环境补光可以照亮地面，但不应自动揭示物品身份。 */
  revealsDetails: boolean;
  kind: PerceptionLightKind;
}

/** 感知目标只包含纯数据；绘制回调由渲染层提供，逻辑层不依赖 Canvas。 */
export interface PerceptionTarget {
  id: string;
  category: PerceptionTargetCategory;
  x: number;
  y: number;
  bounds: Bounds;
  samplePoints?: readonly Point[];
}

export interface PerceptionView {
  level: EntityVisibility;
  /** 1 表示完全显示；光照丢失时用于 identified 的淡出。 */
  alpha: number;
}

/** TileMap 提供给纯逻辑 LOS 的最小只读接口，避免逻辑层 import 整个地图/DOM。 */
export interface SightMap {
  getBlockingPolygons(x: number, y: number, width: number, height: number): Polygon[];
  blocksLightAt(x: number, y: number): boolean;
}

/** 地形记忆需要的只读数据；TileMap 结构上满足。 */
export interface TerrainSource {
  readonly tileSize: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<ReadonlyArray<TileTypeId>>;
  readonly tileHp?: ReadonlyArray<ReadonlyArray<number>>;
}
