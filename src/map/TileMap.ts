/**
 * 瓦片地图系统
 * 负责生成、存储和管理游戏中的瓦片地图数据
 */
import { GOLD_FRAGMENT_SIZE, SPECIAL_MINERAL_TYPES, TILE_TYPES, TileTypeId, getTileSpeedFactor, getTileType } from "./TileType";
import { PICKUP_ICONS } from '../objects/PickupItem';
// 在文件顶部添加导入语句
import { blendColorWithWhite } from '../utils/colorUtils';
import { Bounds, Collider, ColliderShape, DEFAULT_SHAPE, Point, Polygon, areaInside, areaInsidePolygons, circlePolygonArea, collide, compileShape, rectangleCollider, transformCollider } from '../physics/Collider';
import { CollisionObstacle, castCollider, queryContacts, resolveMotion } from '../physics/Motion';
import { WATER_TYPES, WaterTerrain, seededRandom } from './WaterTerrain';
import { SolidTerrain, solidPath } from './SolidTerrain';

/** A supplied seed reproduces both base tiles and continuous water geometry. */
export interface TileMapOptions { seed?: number; generateWater?: boolean; }
export type CollisionPurpose = 'movement' | 'projectile';
interface TerrainCoverage { type: TileTypeId; col: number; row: number; area: number; fraction: number; }
/** Reusable output: water fraction of the footprint, and average water-only depth (0=shallow). */
export interface WaterCoverage { fraction: number; depth: number; }
const MINERAL_DAMAGE_COLORS = ["#e5b536", "#b58022", "#80541b", "#4b351b"];
/** Terrain bakes in fixed-size world chunks so a static map costs one blit per chunk per frame. */
const CHUNK_TILES = 16;
const CHUNK_PADDING_TILES = 1;

/** TileTypeId is a string enum, so fold its characters to keep the fingerprint numeric. */
function hashTileType(hash: number, type: TileTypeId): number {
  for (let i = 0; i < type.length; i++) hash = Math.imul(hash ^ type.charCodeAt(i), 16777619);
  return hash;
}

interface TerrainChunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fingerprint: number;
  tileSize: number;
  lastFrame: number;
}

/**
 * 地形配置接口
 * 定义每种地形类型的生成参数
 */
export interface ShadowEdge { ax: number; ay: number; bx: number; by: number; }
export interface TileRect { x: number; y: number; width: number; height: number; }

/** Adjacent tiles share the same device-pixel boundary even while the camera moves. */
export function tileScreenRect(rect: TileRect, cameraX: number, cameraY: number): TileRect {
  const x = Math.round(rect.x - cameraX), y = Math.round(rect.y - cameraY);
  return { x, y, width: Math.round(rect.x + rect.width - cameraX) - x,
    height: Math.round(rect.y + rect.height - cameraY) - y };
}

interface TerrainConfig {
  type: TileTypeId;      // 地形类型ID
  walkable: boolean;     // 是否可通行
  baseProbability: number; // 基础生成概率
  inheritProbability: number; // 从相邻瓦片继承的概率
  maxHp?: number;        // 最大血量（仅适用于可破坏地形）
}

/**
 * 瓦片地图类
 * 管理游戏中的地图数据、碰撞检测、渲染等功能
 */
export class TileMap {
  readonly water?: WaterTerrain;
  tileSize = 50;                    // 瓦片大小（像素）
  width: number;                    // 地图宽度（瓦片数）
  height: number;                   // 地图高度（瓦片数）
  tiles: TileTypeId[][];            // 存储每个瓦片的类型ID
  tileHp: number[][];               // 存储每个瓦片的当前血量
  tileHighlight: number[][];        // 每个瓦片的受攻击高亮时间
  highlightDuration: number = 0.1;  // 高亮持续时间（秒）
  onTileDestroyed?: (col: number, row: number, type: TileTypeId) => void;
  onTileDamaged?: (col: number, row: number, type: TileTypeId, hp: number, maxHp: number) => void;
  private mineralDamage = new Map<number, { x: number; y: number; color: string }[]>();
  private solids = new SolidTerrain((col, row) => this.isBlockingTile(col, row, 'light'));
  private terrainChunks = new Map<number, TerrainChunk>();
  private obstacleColliderSize = 0;
  private readonly obstacleColliders = new Map<number, Collider>();
  private boundaryColliders: Collider[] | null = null;
  private boundaryColliderSize = 0;
  private terrainChunkFrame = 0;

  /** 地形配置数组 */
  terrainConfigs: TerrainConfig[] = [
    { type: TileTypeId.DEFAULT, walkable: true, baseProbability: 0.91, inheritProbability: 0.8 },
    { type: TileTypeId.WALL, walkable: false, baseProbability: 0.05, inheritProbability: 0.8 },
    { type: TileTypeId.MINERAL, walkable: false, baseProbability: 0.04, inheritProbability: 0.8, maxHp: 100 },
    ...SPECIAL_MINERAL_TYPES.map(type => ({ type, walkable: false, baseProbability: 0,
      inheritProbability: 0, maxHp: TILE_TYPES[type].durability })),
    ...WATER_TYPES.map(type => ({ type, walkable: getTileSpeedFactor(type) > 0, baseProbability: 0, inheritProbability: 0 })),
  ];

  /** 地形配置映射表，用于快速查找 */
  terrainMap: Map<TileTypeId, TerrainConfig>;

  /**
   * 构造函数
   * @param width 地图宽度
   * @param height 地图高度
   */
  constructor(width: number, height: number, options: TileMapOptions = {}) {
    const random = seededRandom(options.seed ?? Math.floor(Math.random() * 4294967296));
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.tileHp = [];
    this.terrainMap = new Map(this.terrainConfigs.map(t => [t.type, t]));
    this.tileHighlight = [];

    // 初始化高亮数组
    for (let y = 0; y < height; y++) {
      this.tileHighlight[y] = [];
      for (let x = 0; x < width; x++) {
        this.tileHighlight[y][x] = 0;
      }
    }

    // 创建累积概率表用于随机地形生成
    const cumulativeProbs: { type: TileTypeId; threshold: number }[] = [];
    let sum = 0;
    for (const cfg of this.terrainConfigs) {
      sum += cfg.baseProbability;
      cumulativeProbs.push({ type: cfg.type, threshold: sum });
    }

    // 生成地图数据
    for (let y = 0; y < height; y++) {
      this.tiles[y] = [];
      this.tileHp[y] = [];
      for (let x = 0; x < width; x++) {
        // 根据噪声值和累积概率确定基础瓦片类型
        const n = random();
        // 使用安全的方式获取瓦片类型，避免找不到匹配项时的类型错误
        const found = cumulativeProbs.find(t => n < t.threshold);
        let key = found ? found.type : TileTypeId.DEFAULT;

        // 应用邻近继承规则，增强地形连续性
        const neighbors: TileTypeId[] = [];
        if (x > 0) neighbors.push(this.tiles[y][x - 1]);
        if (y > 0) neighbors.push(this.tiles[y - 1][x]);

        if (neighbors.length) {
          const neighborKey = neighbors[Math.floor(random() * neighbors.length)];
          const inheritProb = this.terrainMap.get(neighborKey)?.inheritProbability ?? 0.5;
          // 根据继承概率决定是否继承相邻瓦片的类型
          if (random() < inheritProb) {
            key = neighborKey;
          }
        }

        // 存储瓦片类型和血量
        this.tiles[y][x] = key;
        const terrain = this.terrainMap.get(key);
        this.tileHp[y][x] = terrain?.maxHp ?? 0;
      }
    }
    if (options.generateWater !== false) {
      this.water = new WaterTerrain(width, height, random);
      this.water.clearBase(this.tiles, this.tileHp);
    }
    // 最后独立替换矿种，不改变基础地形、水域随机序列，也不让特殊矿相邻继承。
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      if (this.tiles[row][col] === TileTypeId.MINERAL && random() < 0.05) {
        this.tiles[row][col] = SPECIAL_MINERAL_TYPES[Math.floor(random() * SPECIAL_MINERAL_TYPES.length)];
      }
    }
  }

  /**
   * 判断矩形区域是否完全可通行
   * @param x 区域左上角X坐标
   * @param y 区域左上角Y坐标
   * @param size 区域大小（像素）
   * @returns 是否可通行
   */
  /** A light sample is a point, independent of the entity collision shape/solver. */
  blocksLightAt(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= this.width * this.tileSize || y >= this.height * this.tileSize) return true;
    return this.solids.contains(x, y, this.tileSize);
  }

  /** Clockwise exposed edges in world coordinates; internal edges do not cast shadows. */
  getShadowEdges(lightX: number, lightY: number, radius: number): ShadowEdge[] {
    if (!Number.isFinite(radius) || radius <= 0) return [];
    const edges: ShadowEdge[] = [];
    for (const { vertices, edges: exposed } of this.getBlockingPolygons(lightX - radius, lightY - radius, radius * 2, radius * 2)) {
      for (let i = 0; i < vertices.length; i++) if (exposed[i]) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((lightX - a.x) * dx + (lightY - a.y) * dy) / (dx * dx + dy * dy)));
        if (Math.hypot(a.x + t * dx - lightX, a.y + t * dy - lightY) <= radius)
          edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }
    return edges;
  }

  /** Disjoint convex tops, including fillets owned by adjacent source tiles. */
  getBlockingPolygons(x: number, y: number, width: number, height: number): Polygon[] {
    if (width <= 0 || height <= 0) return [];
    return this.solids.query({ x, y, width, height }, this.tileSize, this.width, this.height).map(p => p.polygon);
  }

  private isBlockingTile(col: number, row: number, purpose: CollisionPurpose | 'light' = 'movement'): boolean {
    if (row < 0 || col < 0 || row >= this.height || col >= this.width) return false;
    const type = this.tiles[row][col];
    if (purpose === 'light') return !!getTileType(type).blocksLight;
    if (purpose === 'projectile') return !!getTileType(type).blocksProjectiles;
    return !this.terrainMap.get(type)?.walkable;
  }

  private groundContour: { x: number; y: number; width: number; height: number; hash: number; path: Path2D } | null = null;

  /**
   * 世界坐标系里的实心地形轮廓。查询范围向四周扩两格瓦片并对齐到瓦片网格，因此相机移动后
   * 可以复用同一份路径，不必每帧重新查询多边形；调用方在相机空间使用时先 translate(-cameraX, -cameraY)。
   * 瓦片数组可能被直接改写（挖矿/测试），所以路径只在区域内瓦片类型完全不变时复用。
   */
  getGroundContour(cameraX: number, cameraY: number, width: number, height: number): Path2D {
    const size = this.tileSize, margin = size * 2;
    const x = Math.floor((cameraX - margin) / size) * size;
    const y = Math.floor((cameraY - margin) / size) * size;
    const right = Math.ceil((cameraX + width + margin) / size) * size;
    const bottom = Math.ceil((cameraY + height + margin) / size) * size;
    const endCol = Math.min(this.width, Math.ceil(right / size)), endRow = Math.min(this.height, Math.ceil(bottom / size));
    let hash = 2166136261;
    for (let row = Math.max(0, Math.floor(y / size)); row < endRow; row++) {
      const tiles = this.tiles[row];
      for (let col = Math.max(0, Math.floor(x / size)); col < endCol; col++) hash = hashTileType(hash, tiles[col]);
    }
    const cached = this.groundContour;
    if (cached && cached.x === x && cached.y === y && cached.width === right - x && cached.height === bottom - y
      && cached.hash === hash) return cached.path;
    const path = new Path2D();
    path.rect(x, y, right - x, bottom - y);
    solidPath(path, this.getBlockingPolygons(x, y, right - x, bottom - y), 0, 0);
    this.groundContour = { x, y, width: right - x, height: bottom - y, hash, path };
    return path;
  }

  /** Coarse grid rectangles for compatibility; use getBlockingPolygons for exact tops. */
  getBlockingRects(x: number, y: number, width: number, height: number): TileRect[] {
    if (width <= 0 || height <= 0) return [];
    const size = this.tileSize, rects: TileRect[] = [];
    const left = Math.max(0, Math.floor(x / size));
    const right = Math.min(this.width - 1, Math.floor((x + width) / size));
    const top = Math.max(0, Math.floor(y / size));
    const bottom = Math.min(this.height - 1, Math.floor((y + height) / size));
    for (let row = top; row <= bottom; row++) {
      let col = left;
      while (col <= right) {
        if (!this.isBlockingTile(col, row, 'light')) { col++; continue; }
        const start = col++;
        while (col <= right && this.isBlockingTile(col, row, 'light')) col++;
        rects.push({ x: start * size, y: row * size, width: (col - start) * size, height: size });
      }
    }
    return rects;
  }

  isWalkableArea(x: number, y: number, size: number): boolean {
    return !this.isCollidingRect(x, y, size, size);
  }

  /**
   * 判断矩形区域是否与不可通行地形碰撞
   * @param x 区域左上角X坐标
   * @param y 区域左上角Y坐标
   * @param width 区域宽度
   * @param height 区域高度
   * @returns 是否发生碰撞
   */
  isCollidingRect(x: number, y: number, width: number, height: number): boolean {
    return this.queryShape(rectangleCollider(x, y, width, height)).length > 0;
  }

  /** Grid broad phase. Only exposed tile faces may push an entity. */
  getCollisionObstacles(bounds: Bounds, purpose: CollisionPurpose = 'movement'): CollisionObstacle[] {
    const s = this.tileSize;
    const obstacles: CollisionObstacle[] = this.solids.query(bounds, s, this.width, this.height)
      .map(({ col, row, collider }) => ({ col, row, collider }));
    const left = Math.max(0, Math.floor(bounds.x / s)), right = Math.min(this.width - 1, Math.floor((bounds.x + bounds.width) / s));
    const top = Math.max(0, Math.floor(bounds.y / s)), bottom = Math.min(this.height - 1, Math.floor((bounds.y + bounds.height) / s));
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      if (this.isBlockingTile(col, row, 'light')) continue;
      if (this.isBlockingTile(col, row, purpose)) {
        const edges = [!this.isBlockingTile(col, row - 1, purpose), !this.isBlockingTile(col + 1, row, purpose), !this.isBlockingTile(col, row + 1, purpose), !this.isBlockingTile(col - 1, row, purpose)];
        // 瓦片几何只随瓦片类型或尺寸变化，复用 collider 可以省掉每次物理迭代里的多边形构造。
        if (this.obstacleColliderSize !== s) { this.obstacleColliders.clear(); this.obstacleColliderSize = s; }
        let mask = 0;
        for (const value of edges) mask = (mask << 1) | (value ? 1 : 0);
        const key = (row * this.width + col) * 16 + mask;
        let collider = this.obstacleColliders.get(key);
        if (!collider) {
          collider = rectangleCollider(col * s, row * s, s, s, edges);
          this.obstacleColliders.set(key, collider);
        }
        obstacles.push({ col, row, collider });
      } else if (purpose === 'movement') {
        for (const collider of this.water?.getCell(col, row, s)?.obstacles ?? []) obstacles.push({ col: -1, row: -1, collider });
      }
    }
    const w = this.width * s, h = this.height * s;
    if (bounds.x <= 0) obstacles.push({ col: -1, row: -1, collider: this.getBoundaryCollider(0) });
    if (bounds.x + bounds.width >= w) obstacles.push({ col: -1, row: -1, collider: this.getBoundaryCollider(1) });
    if (bounds.y <= 0) obstacles.push({ col: -1, row: -1, collider: this.getBoundaryCollider(2) });
    if (bounds.y + bounds.height >= h) obstacles.push({ col: -1, row: -1, collider: this.getBoundaryCollider(3) });
    return obstacles.sort((a, b) => a.row - b.row || a.col - b.col);
  }

  /** 地图四边的巨型挡板。固定尺寸的 slab，碰撞结果与随查询范围扩大的旧实现一致。 */
  private getBoundaryCollider(index: 0 | 1 | 2 | 3): Collider {
    const s = this.tileSize;
    const w = this.width * s, h = this.height * s;
    let list = this.boundaryColliders;
    if (list === null || this.boundaryColliderSize !== s) {
      const pad = Math.max(w, h) + 2 * s;
      list = [
        rectangleCollider(-pad, -pad, pad, h + 2 * pad, [false, true, false, false]),
        rectangleCollider(w, -pad, pad, h + 2 * pad, [false, false, false, true]),
        rectangleCollider(-pad, -pad, w + 2 * pad, pad, [false, false, true, false]),
        rectangleCollider(-pad, h, w + 2 * pad, pad, [true, false, false, false]),
      ];
      this.boundaryColliders = list;
      this.boundaryColliderSize = s;
    }
    return list[index];
  }

  queryShape(collider: Collider) { return queryContacts(this, collider); }
  isShapeWalkable(collider: Collider): boolean { return this.queryShape(collider).length === 0; }
  resolveMotion(collider: Collider, movement: Point, rotation = 0) { return resolveMotion(this, collider, movement, rotation); }
  castShape(collider: Collider, movement: Point, purpose: CollisionPurpose = 'movement') {
    return castCollider(purpose === 'movement' ? this : { getCollisionObstacles: bounds => this.getCollisionObstacles(bounds, purpose) }, collider, movement);
  }

  getTerrainCoverage(collider: Collider) {
    const result: TerrainCoverage[] = [];
    this.measureTerrain(collider, result);
    return result;
  }

  private measureTerrain(collider: Collider, details?: TerrainCoverage[], waterCoverage?: WaterCoverage): number {
    const b = collider.bounds, s = this.tileSize;
    const circle = collider.parts.length === 1 && collider.parts[0].type === 'circle' ? collider.parts[0] : undefined;
    let factor = 1;
    for (let row = Math.max(0, Math.floor(b.y / s)); row <= Math.min(this.height - 1, Math.floor((b.y + b.height) / s)); row++) {
      for (let col = Math.max(0, Math.floor(b.x / s)); col <= Math.min(this.width - 1, Math.floor((b.x + b.width) / s)); col++) {
        const base = this.tiles[row][col];
        const type = this.isBlockingTile(col, row, 'light') ? TileTypeId.DEFAULT : base;
        if (!this.terrainMap.get(type)?.walkable && type !== TileTypeId.ULTRA_DEEP_WATER) continue;
        const rect = { x: col * s, y: row * s, width: s, height: s };
        const area = areaInside(collider, rect);
        if (area <= 0) continue;
        const water = this.water?.getCell(col, row, s);
        const add = (type: TileTypeId, amount: number) => {
          if (amount <= 1e-8) return;
          const fraction = amount / collider.area;
          factor += (getTileSpeedFactor(type) - 1) * fraction;
          if (waterCoverage) {
            const depth = WATER_TYPES.indexOf(type);
            if (depth >= 0) { waterCoverage.fraction += fraction; waterCoverage.depth += depth * fraction; }
          }
          details?.push({ type, col, row, area: amount, fraction });
        };
        const patches = this.solids.getCell(col, row, s);
        let solidArea = 0;
        for (const patch of patches) {
          const covered = circle ? circlePolygonArea(circle, patch.polygon.vertices) : areaInsidePolygons(collider, [patch.polygon], rect);
          solidArea += covered;
          add(this.tiles[patch.row][patch.col], covered);
        }
        const groundArea = Math.max(0, area - solidArea);
        if (!water) add(type, groundArea);
        else if (water.type) add(water.type, groundArea);
        else {
          let previousArea = groundArea, previousType = type;
          for (let i = 0; i < 4; i++) {
            const polygons = water.cumulative[i];
            // Merged water polygons are disjoint. A single circle needs no numerical integration.
            const covered = water.full[i] ? groundArea : Math.min(previousArea, solidArea > 1e-8 ?
              areaInsidePolygons(collider, polygons, rect, patches.map(p => p.polygon)) : circle ?
              polygons.reduce((sum, p) => sum + circlePolygonArea(circle, p.vertices), 0) : areaInsidePolygons(collider, polygons, rect));
            add(previousType, Math.max(0, previousArea - covered));
            previousArea = covered;
            previousType = WATER_TYPES[i];
          }
          add(previousType, previousArea);
        }
      }
    }
    if (waterCoverage && waterCoverage.fraction > 0) waterCoverage.depth /= waterCoverage.fraction;
    return Math.max(0, factor);
  }

  getShapeSpeedFactor(collider: Collider, waterCoverage?: WaterCoverage): number {
    if (waterCoverage) { waterCoverage.fraction = 0; waterCoverage.depth = 0; }
    const b = collider.bounds, s = this.tileSize;
    // Uniform regions, including dry land, require no footprint intersection at all.
    if (b.x >= 0 && b.y >= 0 && b.x + b.width <= this.width * s && b.y + b.height <= this.height * s) {
      let uniform: number | undefined, mixed = false, waterDepth = -1;
      for (let row = Math.floor(b.y / s); row <= Math.min(this.height - 1, Math.floor((b.y + b.height) / s)) && !mixed; row++) {
        for (let col = Math.floor(b.x / s); col <= Math.min(this.width - 1, Math.floor((b.x + b.width) / s)); col++) {
          if (this.solids.getCell(col, row, s).some(p => collide(collider, p.collider).some(c => c.depth > 1e-8))) { mixed = true; break; }
          const type = this.tiles[row][col];
          const visible = this.isBlockingTile(col, row, 'light') || this.terrainMap.get(type)?.walkable || type === TileTypeId.ULTRA_DEEP_WATER;
          const water = visible ? this.water?.getCell(col, row, s) : undefined;
          const speed = !visible ? 1 : water ? (water.type ? getTileSpeedFactor(water.type) : undefined) : this.isBlockingTile(col, row, 'light') ? 1 : getTileSpeedFactor(type);
          if (speed === undefined || (uniform !== undefined && uniform !== speed)) { mixed = true; break; }
          uniform = speed;
          waterDepth = visible ? WATER_TYPES.indexOf(water?.type ?? type) : -1;
        }
      }
      if (!mixed) {
        if (waterCoverage && waterDepth >= 0) { waterCoverage.fraction = 1; waterCoverage.depth = waterDepth; }
        return uniform ?? 1;
      }
    }
    return this.measureTerrain(collider, undefined, waterCoverage);
  }

  /**
   * 攻击瓦片，减少其血量
   * @param col 瓦片列索引
   * @param row 瓦片行索引
   * @param amount 伤害量
   */
  damageTile(col: number, row: number, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    // 检查坐标是否有效
    if (row < 0 || col < 0 || row >= this.height || col >= this.width) return;

    const tileTypeId = this.tiles[row][col];
    const tileType = getTileType(tileTypeId);
    const terrain = this.terrainMap.get(tileTypeId);

    // 只攻击可破坏且有血量的瓦片
    if (!terrain || !tileType.isDestructible || !terrain.maxHp) return;

    // 减少血量并触发高亮效果
    this.tileHp[row][col] = Math.max(0, this.tileHp[row][col] - amount);
    this.tileHighlight[row][col] = this.highlightDuration;

    // 血量为0时将瓦片变为默认类型
    if (this.tileHp[row][col] <= 0) {
      this.breakTile(col, row);
    } else {
      const key = row * this.width + col;
      if (!this.mineralDamage.has(key)) {
        const colors = tileTypeId === TileTypeId.MINERAL ? MINERAL_DAMAGE_COLORS :
          [0.8, 0.6, 0.4, 0.2].map(factor => {
            const rgb = [1, 3, 5].map(start => Math.round(parseInt(tileType.color.slice(start, start + 2), 16) * factor));
            return `rgb(${rgb.join(',')})`;
          });
        const columns = Math.floor(this.tileSize / GOLD_FRAGMENT_SIZE);
        const padding = (this.tileSize - columns * GOLD_FRAGMENT_SIZE) / 2;
        const cells = Array.from({ length: columns * columns }, (_, i) => i);
        for (let i = cells.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [cells[i], cells[j]] = [cells[j], cells[i]];
        }
        const shadeOffset = Math.floor(Math.random() * colors.length);
        // 位置只随机一次，四色交替分配，让首次普通命中的三格已有深浅差异。
        this.mineralDamage.set(key, cells.slice(0, 24).map((cell, i) => ({
          x: padding + cell % columns * GOLD_FRAGMENT_SIZE,
          y: padding + Math.floor(cell / columns) * GOLD_FRAGMENT_SIZE,
          color: colors[(i + shadeOffset) % colors.length]
        })));
      }
      this.onTileDamaged?.(col, row, tileTypeId, this.tileHp[row][col], terrain.maxHp);
    }
  }

  /**
   * 渲染地图：静态地形按世界分块烘焙后整块合成，动态细节（受击高亮/矿破损/矿种图标）逐帧叠加。
   * 烘焙保持 1 世界像素 = 1 画布像素，只在合成时做亚像素平滑，避免相机小数偏移下的瓦片硬跳。
   */
  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, canvasWidth: number, canvasHeight: number, delta: number) {
    const startCol = Math.max(0, Math.floor(cameraX / this.tileSize));
    const endCol = Math.min(this.width - 1, Math.ceil((cameraX + canvasWidth) / this.tileSize));
    const startRow = Math.max(0, Math.floor(cameraY / this.tileSize));
    const endRow = Math.min(this.height - 1, Math.ceil((cameraY + canvasHeight) / this.tileSize));
    if (!this.drawTerrainChunks(ctx, cameraX, cameraY, canvasWidth, canvasHeight)) {
      this.drawDirect(ctx, cameraX, cameraY, canvasWidth, canvasHeight, delta, startCol, endCol, startRow, endRow);
      return;
    }
    this.drawTerrainDetails(ctx, cameraX, cameraY, startCol, endCol, startRow, endRow, delta);
  }

  /** Drop baked terrain chunks (resize/debug/tests); they rebuild on the next draw. */
  clearTerrainCache(): void {
    this.terrainChunks.clear();
  }

  /**
   * Terrain chunks are baked once and blitted 1:1 at integer screen positions, matching the
   * existing per-tile pixel snapping while removing every per-tile fillStyle/fillRect.
   * The cache limit tracks the visible chunk count so a camera pan never thrashes it.
   */
  private drawTerrainChunks(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, canvasWidth: number, canvasHeight: number): boolean {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
    const s = this.tileSize;
    if (!(s > 0) || !Number.isFinite(s)) return false;
    const span = CHUNK_TILES + CHUNK_PADDING_TILES * 2;
    const chunkWorld = CHUNK_TILES * s;
    const coreStart = Math.round(CHUNK_PADDING_TILES * s);
    const coreEnd = Math.round((CHUNK_PADDING_TILES + CHUNK_TILES) * s);
    const coreSize = coreEnd - coreStart;
    if (!(coreSize > 0)) return false;
    const lastChunkCol = Math.max(0, Math.ceil(this.width / CHUNK_TILES) - 1);
    const lastChunkRow = Math.max(0, Math.ceil(this.height / CHUNK_TILES) - 1);
    const firstChunkCol = Math.max(0, Math.floor(cameraX / chunkWorld));
    const finalChunkCol = Math.min(lastChunkCol, Math.floor((cameraX + canvasWidth) / chunkWorld));
    const firstChunkRow = Math.max(0, Math.floor(cameraY / chunkWorld));
    const finalChunkRow = Math.min(lastChunkRow, Math.floor((cameraY + canvasHeight) / chunkWorld));
    this.terrainChunkFrame++;
    let visibleChunks = 0;
    for (let chunkRow = firstChunkRow; chunkRow <= finalChunkRow; chunkRow++) {
      for (let chunkCol = firstChunkCol; chunkCol <= finalChunkCol; chunkCol++) {
        const startCol = chunkCol * CHUNK_TILES - CHUNK_PADDING_TILES;
        const startRow = chunkRow * CHUNK_TILES - CHUNK_PADDING_TILES;
        const worldX = startCol * s;
        const worldY = startRow * s;
        const key = chunkCol * 0x10000 + chunkRow;
        let chunk = this.terrainChunks.get(key);
        if (!chunk) {
          const canvas = document.createElement("canvas");
          const chunkCtx = canvas.getContext("2d");
          if (!chunkCtx) return false;
          chunk = { canvas, ctx: chunkCtx, fingerprint: 0, tileSize: 0, lastFrame: 0 };
          this.terrainChunks.set(key, chunk);
        }
        const fingerprint = this.chunkFingerprint(startCol, startRow, s);
        if (chunk.fingerprint !== fingerprint || chunk.tileSize !== s || chunk.canvas.width !== Math.round(span * s)) {
          this.bakeTerrainChunk(chunk, startCol, startRow, worldX, worldY, s, fingerprint);
        } else {
          chunk.lastFrame = this.terrainChunkFrame;
        }
        ctx.drawImage(chunk.canvas, coreStart, coreStart, coreSize, coreSize,
          Math.round(chunkCol * chunkWorld - cameraX), Math.round(chunkRow * chunkWorld - cameraY), coreSize, coreSize);
        visibleChunks++;
      }
    }
    // Keep only a small ring of off-screen chunks: each baked chunk holds a full-resolution
    // world image, so the cache size drives the largest memory spike at high DPR.
    const limit = Math.max(6, visibleChunks + 2);
    while (this.terrainChunks.size > limit) {
      let oldestKey = -1;
      let oldestFrame = Infinity;
      for (const [key, chunk] of this.terrainChunks) {
        if (chunk.lastFrame < oldestFrame) { oldestFrame = chunk.lastFrame; oldestKey = key; }
      }
      if (oldestKey < 0) break;
      this.terrainChunks.delete(oldestKey);
    }
    return true;
  }

  /** Cheap per-frame fingerprint over the chunk's core+padding tiles so direct array edits rebuild it. */
  private chunkFingerprint(startCol: number, startRow: number, tileSize: number): number {
    let hash = Math.imul(tileSize * 73856093, 16777619) ^ 0x811c9dc5;
    const span = CHUNK_TILES + CHUNK_PADDING_TILES * 2;
    for (let r = 0; r < span; r++) {
      const row = startRow + r;
      if (row < 0 || row >= this.height) { hash = Math.imul(hash ^ 0x9e3779b9, 16777619); continue; }
      const tiles = this.tiles[row];
      for (let c = 0; c < span; c++) {
        const col = startCol + c;
        if (col < 0 || col >= this.width) { hash = Math.imul(hash ^ 0x85ebca6b, 16777619); continue; }
        hash = hashTileType(hash, tiles[col]);
      }
    }
    return hash | 0;
  }

  /** Bake ground, water, wall tops and non-wall material tops for one padded chunk. */
  private bakeTerrainChunk(chunk: TerrainChunk, startCol: number, startRow: number, worldX: number, worldY: number, tileSize: number, fingerprint: number): void {
    const span = CHUNK_TILES + CHUNK_PADDING_TILES * 2;
    const pixels = Math.max(1, Math.round(span * tileSize));
    if (chunk.canvas.width !== pixels || chunk.canvas.height !== pixels) {
      chunk.canvas.width = pixels;
      chunk.canvas.height = pixels;
    }
    const ctx = chunk.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, pixels, pixels);
    for (let r = 0; r < span; r++) {
      const row = startRow + r;
      if (row < 0 || row >= this.height) continue;
      const localY = Math.round(row * tileSize - worldY);
      const localH = Math.round((row + 1) * tileSize - worldY) - localY;
      for (let c = 0; c < span; c++) {
        const col = startCol + c;
        if (col < 0 || col >= this.width) continue;
        const localX = Math.round(col * tileSize - worldX);
        const localW = Math.round((col + 1) * tileSize - worldX) - localX;
        ctx.fillStyle = TILE_TYPES[this.isBlockingTile(col, row, 'light') ? TileTypeId.DEFAULT : this.tiles[row][col]].color;
        ctx.fillRect(localX, localY, localW, localH);
      }
    }
    this.water?.draw(ctx, worldX, worldY, pixels, pixels, tileSize);
    const patches = this.solids.query({ x: worldX, y: worldY, width: pixels, height: pixels }, tileSize, this.width, this.height);
    if (!patches.length) {
      chunk.fingerprint = fingerprint;
      chunk.tileSize = tileSize;
      chunk.lastFrame = this.terrainChunkFrame;
      return;
    }
    ctx.beginPath(); solidPath(ctx, patches.map(p => p.polygon), worldX, worldY);
    ctx.fillStyle = TILE_TYPES[TileTypeId.WALL].color; ctx.fill();
    const owners = new Map<number, Polygon[]>();
    for (const patch of patches) {
      const key = patch.row * this.width + patch.col;
      const list = owners.get(key);
      if (list) list.push(patch.polygon); else owners.set(key, [patch.polygon]);
    }
    // Same-color tops share one fill, exactly like the direct path.
    const materials = new Map<string, Polygon[]>();
    for (const [key, polygons] of owners) {
      const col = key % this.width, row = Math.floor(key / this.width);
      const color = TILE_TYPES[this.tiles[row][col]].color;
      const list = materials.get(color);
      if (list) { for (const polygon of polygons) list.push(polygon); } else materials.set(color, polygons.slice());
    }
    for (const [color, polygons] of materials) {
      if (color === TILE_TYPES[TileTypeId.WALL].color) continue;
      ctx.beginPath(); solidPath(ctx, polygons, worldX, worldY); ctx.fillStyle = color; ctx.fill();
    }
    chunk.fingerprint = fingerprint;
    chunk.tileSize = tileSize;
    chunk.lastFrame = this.terrainChunkFrame;
  }

  /** Polygons of one specific tile, used by the small dynamic overlay pass. */
  private tilePolygons(col: number, row: number): Polygon[] {
    const s = this.tileSize;
    const patches = this.solids.query({ x: col * s, y: row * s, width: s, height: s }, s, this.width, this.height);
    const polygons: Polygon[] = [];
    for (const patch of patches) if (patch.col === col && patch.row === row) polygons.push(patch.polygon);
    return polygons;
  }

  /** Dynamic details that must not be baked: hit highlight, mineral damage chips, mineral icons. */
  private drawTerrainDetails(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, startCol: number, endCol: number, startRow: number, endRow: number, delta: number): void {
    const s = this.tileSize;
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const type = this.tiles[row][col];
        const tileType = TILE_TYPES[type];
        const terrain = this.terrainMap.get(type);
        const pickupType = tileType.pickupType;
        const highlight = this.tileHighlight[row][col];
        const damage = tileType.isDestructible ? this.mineralDamage.get(row * this.width + col) : undefined;
        if (highlight <= 0 && !damage && pickupType === undefined) continue;
        const polygons = this.tilePolygons(col, row);
        if (highlight > 0) {
          this.tileHighlight[row][col] = Math.max(0, highlight - delta);
          if (polygons.length) {
            ctx.beginPath(); solidPath(ctx, polygons, cameraX, cameraY);
            ctx.fillStyle = blendColorWithWhite(TILE_TYPES[type].color, Math.min(highlight / this.highlightDuration, 1));
            ctx.fill();
          }
        }
        if (!polygons.length || (!damage && pickupType === undefined)) continue;
        const rect = tileScreenRect({ x: col * s, y: row * s, width: s, height: s }, cameraX, cameraY);
        ctx.beginPath(); solidPath(ctx, polygons, cameraX, cameraY);
        ctx.save(); ctx.clip();
        if (damage && terrain?.maxHp) {
          const count = Math.min(damage.length, Math.ceil(Math.max(0, 1 - this.tileHp[row][col] / terrain.maxHp) * damage.length));
          for (let i = 0; i < count; i++) {
            const mark = damage[i];
            const chip = tileScreenRect({ x: col * s + mark.x, y: row * s + mark.y, width: GOLD_FRAGMENT_SIZE, height: GOLD_FRAGMENT_SIZE }, cameraX, cameraY);
            ctx.fillStyle = mark.color;
            ctx.fillRect(chip.x, chip.y, chip.width, chip.height);
          }
        }
        if (pickupType !== undefined) {
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(PICKUP_ICONS[pickupType], rect.x + rect.width / 2, rect.y + rect.height / 2);
          ctx.restore();
        }
        ctx.restore();
      }
    }
  }

  /**
   * 直接逐格渲染路径（无 Canvas 环境或不支持分块时使用）
   * @param ctx Canvas渲染上下文
   * @param cameraX 相机X坐标
   * @param cameraY 相机Y坐标
   * @param canvasWidth 画布宽度
   * @param canvasHeight 画布高度
   * @param delta 时间增量（秒）
   */
  private drawDirect(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, canvasWidth: number, canvasHeight: number, delta: number,
    startCol: number, endCol: number, startRow: number, endRow: number) {
    // 可见瓦片范围由 draw() 计算并传入

    // Ground and water are below the complete solid union, including concave fillets.
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const rect = tileScreenRect({ x: col * this.tileSize, y: row * this.tileSize, width: this.tileSize, height: this.tileSize }, cameraX, cameraY);
        ctx.fillStyle = TILE_TYPES[this.isBlockingTile(col, row, 'light') ? TileTypeId.DEFAULT : this.tiles[row][col]].color;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    }
    this.water?.draw(ctx, cameraX, cameraY, canvasWidth, canvasHeight, this.tileSize);
    const patches = this.solids.query({ x: cameraX, y: cameraY, width: canvasWidth, height: canvasHeight }, this.tileSize, this.width, this.height);
    if (!patches.length) return;
    ctx.beginPath(); solidPath(ctx, patches.map(p => p.polygon), cameraX, cameraY);
    ctx.fillStyle = TILE_TYPES[TileTypeId.WALL].color; ctx.fill();
    const owners = new Map<number, Polygon[]>();
    for (const patch of patches) {
      const key = patch.row * this.width + patch.col;
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key)!.push(patch.polygon);
    }
    // Same-color tops share one fill, so fractional camera positions cannot reveal a grid.
    const materials = new Map<string, Polygon[]>();
    for (const [key, polygons] of owners) {
      const col = key % this.width, row = Math.floor(key / this.width);
      let color = TILE_TYPES[this.tiles[row][col]].color;
      const highlight = this.tileHighlight[row][col];
      if (highlight > 0) {
        color = blendColorWithWhite(color, Math.min(highlight / this.highlightDuration, 1));
        this.tileHighlight[row][col] = Math.max(0, highlight - delta);
      }
      if (!materials.has(color)) materials.set(color, []);
      materials.get(color)!.push(...polygons);
    }
    for (const [color, polygons] of materials) {
      if (color === TILE_TYPES[TileTypeId.WALL].color) continue;
      ctx.beginPath(); solidPath(ctx, polygons, cameraX, cameraY); ctx.fillStyle = color; ctx.fill();
    }
    for (const [key, polygons] of owners) {
        const col = key % this.width, row = Math.floor(key / this.width);
        const tileTypeId = this.tiles[row][col], terrain = this.terrainMap.get(tileTypeId)!;
        const damage = TILE_TYPES[tileTypeId].isDestructible ? this.mineralDamage.get(key) : undefined;
        const pickupType = TILE_TYPES[tileTypeId].pickupType;
        if (!damage && pickupType === undefined) continue;
        const rect = tileScreenRect({ x: col * this.tileSize, y: row * this.tileSize, width: this.tileSize, height: this.tileSize }, cameraX, cameraY);
        ctx.beginPath(); solidPath(ctx, polygons, cameraX, cameraY);
        ctx.save(); ctx.clip();

        if (damage && terrain.maxHp) {
          const count = Math.min(damage.length, Math.ceil(Math.max(0, 1 - this.tileHp[row][col] / terrain.maxHp) * damage.length));
          for (let i = 0; i < count; i++) {
            const mark = damage[i];
            const chip = tileScreenRect({ x: col * this.tileSize + mark.x, y: row * this.tileSize + mark.y,
              width: GOLD_FRAGMENT_SIZE, height: GOLD_FRAGMENT_SIZE }, cameraX, cameraY);
            ctx.fillStyle = mark.color;
            ctx.fillRect(chip.x, chip.y, chip.width, chip.height);
          }
        }

        if (pickupType !== undefined) {
          // 图标最后绘制，避免高亮或累积破损遮住矿种标记。
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(PICKUP_ICONS[pickupType], rect.x + rect.width / 2, rect.y + rect.height / 2);
          ctx.restore();
        }

        ctx.restore();
    }
  }

  /** Transparent, world-aligned water only; safe to composite atop a small character buffer. */
  drawWaterLayer(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, height);
    solidPath(ctx, this.getBlockingPolygons(cameraX, cameraY, width, height), cameraX, cameraY);
    ctx.clip('evenodd');
    const s = this.tileSize;
    for (let row = Math.max(0, Math.floor(cameraY / s)); row <= Math.min(this.height - 1, Math.floor((cameraY + height) / s)); row++) {
      for (let col = Math.max(0, Math.floor(cameraX / s)); col <= Math.min(this.width - 1, Math.floor((cameraX + width) / s)); col++) {
        const type = this.tiles[row][col];
        if (!WATER_TYPES.includes(type)) continue;
        ctx.fillStyle = TILE_TYPES[type].color;
        ctx.fillRect(col * s - cameraX, row * s - cameraY, s, s);
      }
    }
    this.water?.draw(ctx, cameraX, cameraY, width, height, s);
    ctx.restore();
  }

  /**
   * 获取随机可放置坐标
   * @param size 物体大小
   * @returns 随机可行走位置的坐标
   * @throws 如果无法找到可行走位置则抛出错误
   */
  getRandomWalkablePosition(size: number, shape: ColliderShape = DEFAULT_SHAPE, rotation = 0): { x: number; y: number } {
    const compiled = compileShape(shape);
    let attempts = 0;
    // 最多尝试1000次
    while (attempts < 1000) {
      const col = Math.floor(Math.random() * this.width);
      const row = Math.floor(Math.random() * this.height);
      const posX = col * this.tileSize + (this.tileSize - size) / 2;
      const posY = row * this.tileSize + (this.tileSize - size) / 2;
      if (this.isShapeWalkable(transformCollider(compiled, { x: posX + size / 2, y: posY + size / 2, size, rotation }))) return { x: posX, y: posY };
      attempts++;
    }
    throw new Error("无法生成可行走位置");
  }

  /**
   * 获取指定位置的地形速度修正因子
   * @param x X坐标
   * @param y Y坐标
   * @returns 速度修正因子
   */
  getSpeedFactor(x: number, y: number): number {
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);

    // 超出地图范围返回默认速度因子
    if (row < 0 || col < 0 || row >= this.height || col >= this.width) {
      return 1.0;
    }

    // 使用辅助函数获取速度因子
    if (this.solids.contains(x, y, this.tileSize)) return 0;
    return getTileSpeedFactor(this.water?.getTypeAt(x, y, this.tileSize) ??
      (this.isBlockingTile(col, row, 'light') ? TileTypeId.DEFAULT : this.tiles[row][col]));
  }

  /**
   * 获取指定矩形区域内碰撞的第一个不可通行瓦片
   * @param x 矩形左上角X坐标
   * @param y 矩形左上角Y坐标
   * @param size 矩形大小
   * @returns 碰撞瓦片信息或null（如果没有碰撞）
   */
  getTileAtRect(x: number, y: number, size: number) {
    const body = rectangleCollider(x, y, size, size);
    for (const { collider, col, row } of this.getCollisionObstacles(body.bounds)) if (col >= 0 && collide(body, collider).length) {
      return { terrain: this.terrainMap.get(this.tiles[row][col]), row, col, health: this.tileHp[row][col] };
    }
    return null;
  }

  /**
   * 直接破坏指定位置的瓦片
   * @param col 瓦片列索引
   * @param row 瓦片行索引
   */
  breakTile(col: number, row: number) {
    if (row >= 0 && col >= 0 && row < this.height && col < this.width) {
      const type = this.tiles[row][col];
      this.tiles[row][col] = TileTypeId.DEFAULT;
      this.tileHp[row][col] = 0; // 血量清零
      this.tileHighlight[row][col] = 0;
      this.mineralDamage.delete(row * this.width + col);
      if (getTileType(type).isDestructible) this.onTileDestroyed?.(col, row, type);
    }
  }
}
