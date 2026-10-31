import { createVisionRules, type VisionRules } from './VisionRules';
import { ExplorationGrid } from './ExplorationGrid';
import { TerrainMemory } from './TerrainMemory';
import { anySampleVisible, distanceBetween, hasLineOfSight } from './SightGeometry';
import { canIdentifyPoint, illuminationStrengthAt } from './IlluminationProbe';
import type {
  EntityVisibility,
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
  /** 上一帧是否满足辨识照明，用于滞回阈值。 */
  lit: boolean;
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
  /**
   * 最近一次探索扫描确认“此刻可见/可辨识”的格索引（row * grid.cols + col）。
   * 只作为只读观察日志供 HUD 区分 observed / remembered，不参与任何玩法判定。
   */
  observed: Set<number>;
  observedRevision: number;
}

const EMPTY_CELLS: ReadonlySet<number> = new Set<number>();

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
    if (!view) return { level: 'hidden', alpha: 0, silhouette: 0 };
    return { level: view.level, alpha: view.alpha, silhouette: view.silhouette };
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

  /**
   * 最近一次探索扫描的可见格集合（整体被 replace，不要长期持有）。
   *
   * 这是一份只读观察日志：用真实 LOS 与光照算出的结果，供小地图分档，
   * 不改变感知、探索或玩法语义。
   */
  getObservedCells(observerId: string): ReadonlySet<number> {
    return this.states.get(observerId)?.observed ?? EMPTY_CELLS;
  }

  /** 观察格集合的版本号，每次探索扫描结束 +1。 */
  getObservedRevision(observerId: string): number {
    return this.states.get(observerId)?.observedRevision ?? 0;
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
        discovery: { elapsed: 0, lastX: observer.x, lastY: observer.y, initialized: false },
        observed: new Set<number>(),
        observedRevision: 0
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
    // 硬遮挡（完全被墙挡住）立即清零，视觉权重不允许穿墙。
    if (!anySampleVisible(this.map, observer, target)) {
      return { level: 'hidden', alpha: 0, silhouette: 0, lit: false };
    }

    const distance = distanceBetween(observer.x, observer.y, target.x, target.y);
    const inRange = distance <= observer.maxObservationRange;
    const centerLos = hasLineOfSight(this.map, observer.x, observer.y, target.x, target.y);
    const near = distance <= observer.nearSenseRadius;

    // 滞回：已经点亮时使用更低的退出阈值，手电柔边附近不会在阈值上下反复翻转。
    const wasLit = previous?.lit ?? false;
    const threshold = this.rules.identifyLightThreshold *
      (wasLit ? this.rules.identifyLightHysteresis : 1);
    const strength = illuminationStrengthAt(this.map, target.x, target.y, this.lights, this.rules);
    const lit = inRange && centerLos &&
      (this.rules.ambientIdentifies || strength >= threshold);

    return this.blendView(previous, near, lit, dt);
  }

  /**
   * 双权重交叉淡化：alpha 是完整形象权重（detail），silhouette 是近身剪影权重。
   * 两者都由 dt 驱动，不同帧率下过渡时长一致，不再出现“先消失、再跳出灰色剪影”。
   */
  private blendView(
    previous: TrackedView | undefined,
    near: boolean,
    lit: boolean,
    dt: number
  ): TrackedView {
    const dwell = this.rules.identifyDwellSeconds;
    const fade = this.rules.identifyFadeSeconds;
    const detailStep = lit ? (dwell > 0 ? dt / dwell : 1) : (fade > 0 ? dt / fade : 1);
    const silhouetteStep = fade > 0 ? dt / fade : 1;

    let detail = previous?.alpha ?? 0;
    detail = lit ? Math.min(1, detail + detailStep) : Math.max(0, detail - detailStep);

    let silhouette = previous?.silhouette ?? 0;
    // 只有近身、且没有被有效照明时才需要剪影；否则与彩色形象交叉淡出。
    if (near && !lit) silhouette = Math.min(1, silhouette + silhouetteStep);
    else silhouette = Math.max(0, silhouette - silhouetteStep);

    const fullyIdentified = detail >= 1 - 1e-6;
    const wasIdentified = previous?.level === 'identified' && detail > 0.002;
    const level: EntityVisibility = fullyIdentified || wasIdentified
      ? 'identified'
      : (silhouette > 0.002 || detail > 0.002 ? 'silhouette' : 'hidden');
    return { level, alpha: detail, silhouette, lit };
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
   *
   * 阻挡瓦片不使用“相邻即已观察”的启发式：中心点位于实心多边形内部，对中心做
   * LOS 永远会被墙挡住，所以这里只收集与可视格相邻的阻挡瓦片，交给
   * captureObservedWalls() 对瓦片外露面做采样验证。
   */
  private markVisibleCells(state: ObserverState): void {
    const observer = state.observer;
    const grid = state.grid;
    const cell = grid.cellSize;
    const tileSize = this.terrain.tileSize;
    const tileWidth = this.terrain.width;
    const tileHeight = this.terrain.height;
    const candidates = new Set<number>();
    const wallTiles = new Set<number>();
    const observedCells = state.observed;
    observedCells.clear();

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
      observedCells.add(index);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ncol = col + dx;
          const nrow = row + dy;
          if (ncol < 0 || nrow < 0 || ncol >= grid.cols || nrow >= grid.rows) continue;
          const nx = (ncol + 0.5) * cell;
          const ny = (nrow + 0.5) * cell;
          if (!this.map.blocksLightAt(nx, ny)) continue;
          const tileCol = Math.floor(nx / tileSize);
          const tileRow = Math.floor(ny / tileSize);
          if (tileCol < 0 || tileRow < 0 || tileCol >= tileWidth || tileRow >= tileHeight) continue;
          wallTiles.add(tileRow * tileWidth + tileCol);
        }
      }
    }

    if (wallTiles.size > 0) this.captureObservedWalls(state, wallTiles);
    state.observedRevision += 1;
  }

  /**
   * 阻挡瓦片只有在“外露表面确实被看见”时才写入记忆。
   *
   * 每条外露边向外偏移 2px 取三个采样点（25%/50%/75%），要求观察者 LOS，
   * 并满足近身感知或有效照明。这样：
   * - 墙体记忆来自真实可见的墙面，而不是“有相邻可视格”这一几何近似；
   * - 被另一堵墙挡住的内侧面不会被提前记录；
   * - 探索格只在采样点所在单元打点，25px 网格不会支配实时渲染画面。
   */
  private captureObservedWalls(state: ObserverState, tiles: ReadonlySet<number>): void {
    const observer = state.observer;
    const grid = state.grid;
    const memory = state.memory;
    const size = this.terrain.tileSize;
    const width = this.terrain.width;
    const height = this.terrain.height;
    const maxDistance = Math.max(observer.nearSenseRadius, observer.maxObservationRange);
    const offset = 2;
    const fractions = [0.25, 0.5, 0.75] as const;

    const blockingNeighbour = (col: number, row: number): boolean => {
      if (col < 0 || row < 0 || col >= width || row >= height) return false;
      return this.map.blocksLightAt((col + 0.5) * size, (row + 0.5) * size);
    };

    for (const index of tiles) {
      const col = index % width;
      const row = Math.floor(index / width);
      const minX = col * size;
      const minY = row * size;
      const faces: Array<readonly [number, number, number, number]> = [];
      if (!blockingNeighbour(col, row - 1)) faces.push([minX + size / 2, minY, 0, -1]);
      if (!blockingNeighbour(col, row + 1)) faces.push([minX + size / 2, minY + size, 0, 1]);
      if (!blockingNeighbour(col - 1, row)) faces.push([minX, minY + size / 2, -1, 0]);
      if (!blockingNeighbour(col + 1, row)) faces.push([minX + size, minY + size / 2, 1, 0]);
      if (faces.length === 0) continue;

      let captured = false;
      for (const [faceX, faceY, outX, outY] of faces) {
        // 沿墙面切线方向取点；法线方向向外偏移 2px，避开实心多边形边缘。
        const alongX = outY === 0 ? 1 : 0;
        const alongY = outX === 0 ? 1 : 0;
        for (const fraction of fractions) {
          const sampleX = faceX + alongX * (fraction - 0.5) * size + outX * offset;
          const sampleY = faceY + alongY * (fraction - 0.5) * size + outY * offset;
          const distance = distanceBetween(observer.x, observer.y, sampleX, sampleY);
          if (distance > maxDistance) continue;
          if (!hasLineOfSight(this.map, observer.x, observer.y, sampleX, sampleY)) continue;
          const near = distance <= observer.nearSenseRadius;
          if (!near && !canIdentifyPoint(this.map, observer, sampleX, sampleY, this.lights, this.rules)) {
            continue;
          }
          captured = true;
          const sampleCol = Math.floor(sampleX / grid.cellSize);
          const sampleRow = Math.floor(sampleY / grid.cellSize);
          grid.markCell(sampleCol, sampleRow);
          if (sampleCol >= 0 && sampleRow >= 0 && sampleCol < grid.cols && sampleRow < grid.rows) {
            state.observed.add(sampleRow * grid.cols + sampleCol);
          }
        }
      }
      if (captured) memory.capture(col, row);
    }
  }
}
