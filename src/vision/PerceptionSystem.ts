import { createVisionRules, type VisionRules } from './VisionRules';
import { ExplorationGrid } from './ExplorationGrid';
import { TerrainMemory } from './TerrainMemory';
import { anySampleVisible, distanceBetween, hasLineOfSight } from './SightGeometry';
import { canIdentifyPoint, canIdentifyTarget } from './IlluminationProbe';
import type {
  PerceptionLight,
  PerceptionTarget,
  PerceptionView,
  SightMap,
  TerrainRecall,
  TerrainSource,
  VisionObserver
} from './VisionTypes';

export interface PerceptionSystemOptions {
  map: SightMap;
  terrain: TerrainSource;
  rules?: VisionRules;
}

interface TrackedView extends PerceptionView {
  timer: number;
}

interface DiscoveryState {
  elapsed: number;
  lastX: number;
  lastY: number;
  initialized: boolean;
}

interface ObserverState {
  observer: VisionObserver;
  views: Map<string, TrackedView>;
  grid: ExplorationGrid;
  memory: TerrainMemory;
  discovery: DiscoveryState;
}

/**
 * 纯逻辑感知入口：每帧更新目标显隐，低频更新探索/记忆，不依赖 Canvas。
 * 多观察者从第一天就是一等公民；这里不假设只有一个玩家。
 */
export class PerceptionSystem {
  readonly rules: VisionRules;

  private readonly map: SightMap;
  private readonly terrain: TerrainSource;
  private readonly worldWidth: number;
  private readonly worldHeight: number;
  private readonly states = new Map<string, ObserverState>();
  private lights: PerceptionLight[] = [];
  private targets = new Map<string, PerceptionTarget>();

  constructor(options: PerceptionSystemOptions) {
    this.map = options.map;
    this.terrain = options.terrain;
    this.rules = options.rules ?? createVisionRules();
    this.worldWidth = this.terrain.width * this.terrain.tileSize;
    this.worldHeight = this.terrain.height * this.terrain.tileSize;
  }

  /** 每帧调用；targets 是当前世界中的候选对象（不是已识别对象）。 */
  update(
    dt: number,
    observers: readonly VisionObserver[],
    lights: readonly PerceptionLight[],
    targets: readonly PerceptionTarget[]
  ): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.lights = lights.slice();
    this.targets = new Map(targets.map(target => [target.id, target] as const));

    for (const observer of observers) {
      const state = this.ensureObserver(observer);
      state.observer = { ...observer };

      for (const target of targets) {
        const previous = state.views.get(target.id);
        const view = this.evaluateTarget(state, target, step, previous);
        state.views.set(target.id, view);
      }

      for (const id of state.views.keys()) {
        if (!this.targets.has(id)) state.views.delete(id);
      }

      this.maybeExplore(state, step);
    }
  }

  getView(observerId: string, targetId: string): PerceptionView {
    const view = this.states.get(observerId)?.views.get(targetId);
    if (!view) return { level: 'hidden', alpha: 0 };
    return { level: view.level, alpha: view.alpha };
  }

  /** 点查询：给准星/将来交互用；目标查询优先用 getView。 */
  canIdentify(observerId: string, x: number, y: number): boolean {
    const state = this.states.get(observerId);
    if (!state) return false;
    return canIdentifyPoint(this.map, state.observer, x, y, this.lights, this.rules);
  }

  getTerrainRecall(observerId: string, x: number, y: number): TerrainRecall {
    const state = this.states.get(observerId);
    if (!state) return 'unknown';
    if (this.isPointCurrentlyObserved(state, x, y)) return 'observed';
    if (state.grid.isExplored(x, y)) return 'remembered';
    return 'unknown';
  }

  getCullingRadius(observerId: string): number {
    const state = this.states.get(observerId);
    if (!state) return this.rules.maxObservationRange + this.rules.cullingMargin;
    let radius = Math.max(state.observer.nearSenseRadius, state.observer.maxObservationRange);
    for (const light of this.lights) {
      if (!light.active || !Number.isFinite(light.radius)) continue;
      if (light.radius > radius) radius = light.radius;
    }
    return radius + this.rules.cullingMargin;
  }

  getExplorationGrid(observerId: string): ExplorationGrid | null {
    return this.states.get(observerId)?.grid ?? null;
  }

  getTerrainMemory(observerId: string): TerrainMemory | null {
    return this.states.get(observerId)?.memory ?? null;
  }

  getObserver(observerId: string): VisionObserver | null {
    return this.states.get(observerId)?.observer ?? null;
  }

  prune(activeTargetIds: ReadonlySet<string>): void {
    for (const id of this.targets.keys()) {
      if (!activeTargetIds.has(id)) this.targets.delete(id);
    }
    for (const state of this.states.values()) {
      for (const id of state.views.keys()) {
        if (!activeTargetIds.has(id)) state.views.delete(id);
      }
    }
  }

  removeObserver(observerId: string): void {
    this.states.delete(observerId);
  }

  private ensureObserver(observer: VisionObserver): ObserverState {
    let state = this.states.get(observer.id);
    if (!state) {
      state = {
        observer: { ...observer },
        views: new Map(),
        grid: new ExplorationGrid(this.worldWidth, this.worldHeight, this.rules.explorationCellSize),
        memory: new TerrainMemory(this.terrain),
        discovery: { elapsed: 0, lastX: observer.x, lastY: observer.y, initialized: false }
      };
      this.states.set(observer.id, state);
    }
    return state;
  }

  private evaluateTarget(
    state: ObserverState,
    target: PerceptionTarget,
    dt: number,
    previous: TrackedView | undefined
  ): TrackedView {
    const observer = state.observer;
    const distance = distanceBetween(observer.x, observer.y, target.x, target.y);
    const inRange = distance <= observer.maxObservationRange;
    const near = distance <= observer.nearSenseRadius && anySampleVisible(this.map, observer, target);
    const centerLos = hasLineOfSight(this.map, observer.x, observer.y, target.x, target.y);
    const illuminated = inRange && centerLos && canIdentifyTarget(this.map, observer, target, this.lights, this.rules);

    if (illuminated) {
      if (previous?.level === 'identified') return { level: 'identified', alpha: 1, timer: 0 };
      const timer = (previous?.level === 'silhouette' ? previous.timer : 0) + dt;
      if (timer >= this.rules.identifyDwellSeconds) return { level: 'identified', alpha: 1, timer: 0 };
      return { level: 'silhouette', alpha: 1, timer };
    }

    // 硬遮挡/离开范围：立即失去；只有“仍在 LOS 内但光照丢失”才淡出。
    if (previous?.level === 'identified' && centerLos && inRange) {
      if (this.rules.identifyFadeSeconds > 0) {
        const alpha = Math.max(0, previous.alpha - dt / this.rules.identifyFadeSeconds);
        if (alpha > 0) return { level: 'identified', alpha, timer: 0 };
      }
    }

    if (near) return { level: 'silhouette', alpha: 1, timer: 0 };
    return { level: 'hidden', alpha: 0, timer: 0 };
  }

  private isPointCurrentlyObserved(state: ObserverState, x: number, y: number): boolean {
    const observer = state.observer;
    const distance = distanceBetween(observer.x, observer.y, x, y);
    if (!Number.isFinite(distance) || distance > observer.maxObservationRange) return false;
    if (!hasLineOfSight(this.map, observer.x, observer.y, x, y)) return false;
    if (distance <= observer.nearSenseRadius) return true;
    return canIdentifyPoint(this.map, observer, x, y, this.lights, this.rules);
  }

  private maybeExplore(state: ObserverState, dt: number): void {
    const discovery = state.discovery;
    discovery.elapsed += dt;
    const moved = Math.hypot(state.observer.x - discovery.lastX, state.observer.y - discovery.lastY);
    if (
      discovery.initialized &&
      discovery.elapsed < this.rules.explorationInterval &&
      moved < this.rules.explorationCellSize / 2
    ) {
      return;
    }
    discovery.elapsed = 0;
    discovery.lastX = state.observer.x;
    discovery.lastY = state.observer.y;
    discovery.initialized = true;
    this.markVisibleCells(state);
  }

  /**
   * 只标记当前确实能感知到的 25px 格：近身或有效照明 + 观察者 LOS。
   * 一次只扫近身矩形 + 各光源影响矩形，再用 Set 去重；探索完成后成本自然下降。
   */
  private markVisibleCells(state: ObserverState): void {
    const observer = state.observer;
    const grid = state.grid;
    const cell = grid.cellSize;
    const candidates = new Set<number>();

    const collect = (minX: number, minY: number, maxX: number, maxY: number): void => {
      const startCol = Math.max(0, Math.floor(minX / cell));
      const endCol = Math.min(grid.cols - 1, Math.floor(maxX / cell));
      const startRow = Math.max(0, Math.floor(minY / cell));
      const endRow = Math.min(grid.rows - 1, Math.floor(maxY / cell));
      if (startCol > endCol || startRow > endRow) return;
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) candidates.add(row * grid.cols + col);
      }
    };

    collect(
      observer.x - observer.nearSenseRadius,
      observer.y - observer.nearSenseRadius,
      observer.x + observer.nearSenseRadius,
      observer.y + observer.nearSenseRadius
    );
    if (this.rules.ambientIdentifies) {
      collect(
        observer.x - observer.maxObservationRange,
        observer.y - observer.maxObservationRange,
        observer.x + observer.maxObservationRange,
        observer.y + observer.maxObservationRange
      );
    }
    for (const light of this.lights) {
      if (!light.active || !light.revealsDetails || !Number.isFinite(light.radius) || light.radius <= 0) continue;
      collect(light.x - light.radius, light.y - light.radius, light.x + light.radius, light.y + light.radius);
    }

    const maxDistance = Math.max(observer.nearSenseRadius, observer.maxObservationRange);
    for (const index of candidates) {
      const col = index % grid.cols;
      const row = Math.floor(index / grid.cols);
      const cx = (col + 0.5) * cell;
      const cy = (row + 0.5) * cell;
      if (cx > this.worldWidth || cy > this.worldHeight) continue;
      const distance = distanceBetween(observer.x, observer.y, cx, cy);
      if (distance > maxDistance) continue;

      const near =
        distance <= observer.nearSenseRadius &&
        hasLineOfSight(this.map, observer.x, observer.y, cx, cy);
      const lit = !near && canIdentifyPoint(this.map, observer, cx, cy, this.lights, this.rules);
      if (!near && !lit) continue;

      if (!grid.isExploredCell(col, row)) grid.markCell(col, row);
      state.memory.captureWorld(cx, cy);
    }
  }
}
