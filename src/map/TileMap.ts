/**
 * 瓦片地图系统
 * 负责生成、存储和管理游戏中的瓦片地图数据
 */
import { TILE_TYPES, TileTypeId, getTileSpeedFactor, getTileType } from "./TileType";
// 在文件顶部添加导入语句
import { blendColorWithWhite } from '../utils/colorUtils';

/**
 * 简单噪声生成函数（占位实现，可替换为Perlin或Simplex噪声）
 * @param x X坐标
 * @param y Y坐标
 * @returns 0-1之间的随机值
 */
function noise(x: number, y: number): number {
  // 为确保结果严格小于1.0，添加Math.min限制
  return Math.min(Math.random(), 0.9999);
}

/**
 * 地形配置接口
 * 定义每种地形类型的生成参数
 */
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
  tileSize = 50;                    // 瓦片大小（像素）
  width: number;                    // 地图宽度（瓦片数）
  height: number;                   // 地图高度（瓦片数）
  tiles: TileTypeId[][];            // 存储每个瓦片的类型ID
  tileHp: number[][];               // 存储每个瓦片的当前血量
  tileHighlight: number[][];        // 每个瓦片的受攻击高亮时间
  highlightDuration: number = 0.1;  // 高亮持续时间（秒）

  /** 地形配置数组 */
  terrainConfigs: TerrainConfig[] = [
    { type: TileTypeId.DEFAULT, walkable: true, baseProbability: 0.90, inheritProbability: 0.8 },
    { type: TileTypeId.WALL, walkable: false, baseProbability: 0.05, inheritProbability: 0.8 },
    { type: TileTypeId.MINERAL, walkable: false, baseProbability: 0.05, inheritProbability: 0.8, maxHp: 100 },
    // 可以根据需要添加其他地形类型，如WATER
  ];

  /** 地形配置映射表，用于快速查找 */
  terrainMap: Map<TileTypeId, TerrainConfig>;

  /**
   * 构造函数
   * @param width 地图宽度
   * @param height 地图高度
   */
  constructor(width: number, height: number) {
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
        const n = noise(x * 0.08, y * 0.08);
        // 使用安全的方式获取瓦片类型，避免找不到匹配项时的类型错误
        const found = cumulativeProbs.find(t => n < t.threshold);
        let key = found ? found.type : TileTypeId.DEFAULT;

        // 应用邻近继承规则，增强地形连续性
        const neighbors: TileTypeId[] = [];
        if (x > 0) neighbors.push(this.tiles[y][x - 1]);
        if (y > 0) neighbors.push(this.tiles[y - 1][x]);

        if (neighbors.length) {
          const neighborKey = neighbors[Math.floor(Math.random() * neighbors.length)];
          const inheritProb = this.terrainMap.get(neighborKey)?.inheritProbability ?? 0.5;
          // 根据继承概率决定是否继承相邻瓦片的类型
          if (Math.random() < inheritProb) {
            key = neighborKey;
          }
        }

        // 存储瓦片类型和血量
        this.tiles[y][x] = key;
        const terrain = this.terrainMap.get(key);
        this.tileHp[y][x] = terrain?.maxHp ?? 0;
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
  isWalkableArea(x: number, y: number, size: number): boolean {
    const startCol = Math.floor(x / this.tileSize);
    const endCol = Math.floor((x + size - 1) / this.tileSize);
    const startRow = Math.floor(y / this.tileSize);
    const endRow = Math.floor((y + size - 1) / this.tileSize);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (row < 0 || col < 0 || row >= this.height || col >= this.width) return false;
        const terrain = this.terrainMap.get(this.tiles[row][col]);
        if (!terrain?.walkable) return false;
      }
    }
    return true;
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
    // 首先检查是否超出地图边界
    if (x < 0 || y < 0 || x + width > this.width * this.tileSize || y + height > this.height * this.tileSize) {
      return true;
    }

    const leftCol = Math.floor(x / this.tileSize);
    const rightCol = Math.floor((x + width - 1) / this.tileSize);
    const topRow = Math.floor(y / this.tileSize);
    const bottomRow = Math.floor((y + height - 1) / this.tileSize);

    // 检查区域内是否有不可通行的瓦片
    for (let row = topRow; row <= bottomRow; row++) {
      for (let col = leftCol; col <= rightCol; col++) {
        const terrain = this.terrainMap.get(this.tiles[row][col]);
        if (!terrain?.walkable) return true;
      }
    }
    return false;
  }

  /**
   * 攻击瓦片，减少其血量
   * @param col 瓦片列索引
   * @param row 瓦片行索引
   * @param amount 伤害量
   */
  damageTile(col: number, row: number, amount: number) {
    // 检查坐标是否有效
    if (row < 0 || col < 0 || row >= this.height || col >= this.width) return;

    const tileTypeId = this.tiles[row][col];
    const tileType = getTileType(tileTypeId);
    const terrain = this.terrainMap.get(tileTypeId);

    // 只攻击可破坏且有血量的瓦片
    if (!terrain || !tileType.isDestructible || !terrain.maxHp) return;

    // 减少血量并触发高亮效果
    this.tileHp[row][col] -= amount;
    this.tileHighlight[row][col] = this.highlightDuration;

    // 血量为0时将瓦片变为默认类型
    if (this.tileHp[row][col] <= 0) {
      this.tileHp[row][col] = 0;
      this.tiles[row][col] = TileTypeId.DEFAULT;
    }
  }

  /**
   * 渲染地图
   * @param ctx Canvas渲染上下文
   * @param cameraX 相机X坐标
   * @param cameraY 相机Y坐标
   * @param canvasWidth 画布宽度
   * @param canvasHeight 画布高度
   * @param delta 时间增量（秒）
   */
  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, canvasWidth: number, canvasHeight: number, delta: number) {
    // 计算需要渲染的瓦片范围，避免不必要的绘制
    const startCol = Math.max(0, Math.floor(cameraX / this.tileSize));
    const endCol = Math.min(this.width - 1, Math.ceil((cameraX + canvasWidth) / this.tileSize));
    const startRow = Math.max(0, Math.floor(cameraY / this.tileSize));
    const endRow = Math.min(this.height - 1, Math.ceil((cameraY + canvasHeight) / this.tileSize));

    // 渲染可见区域内的所有瓦片
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const tileTypeId = this.tiles[row][col];
        const terrain = this.terrainMap.get(tileTypeId);
        if (!terrain) continue;

        // 获取瓦片颜色
        let fillStyle = TILE_TYPES[tileTypeId]?.color ?? "#ccc";
        // 保存原始瓦片颜色用于高亮
        const originalColor = fillStyle;

        // 根据墙块血量显示不同颜色
        if (!terrain.walkable && terrain.maxHp) {
          const hp = this.tileHp[row][col];
          const ratio = hp / terrain.maxHp;
          // if (ratio > 0.75) fillStyle = TILE_TYPES[tileTypeId]?.color ?? "#ccc";
          // else if (ratio > 0.5) fillStyle = "#0000ff";
          // else if (ratio > 0.25) fillStyle = "#ffa500";
          // else fillStyle = "#ff0000";
        }

        // 应用高亮效果
        const highlight = this.tileHighlight[row][col];
        if (highlight > 0) {
          const alpha = Math.min(highlight / this.highlightDuration, 1);
          // 实现瓦片自身颜色和白色的混合高亮
          fillStyle = blendColorWithWhite(originalColor, alpha);
          this.tileHighlight[row][col] -= delta;
          if (this.tileHighlight[row][col] < 0) this.tileHighlight[row][col] = 0;
        }

        // 绘制瓦片
        ctx.fillStyle = fillStyle;
        ctx.fillRect(col * this.tileSize - cameraX, row * this.tileSize - cameraY, this.tileSize, this.tileSize);

        ctx.fillStyle = fillStyle;
        // 增加1像素的重叠来消除边框线
        ctx.fillRect(col * this.tileSize - cameraX, row * this.tileSize - cameraY, this.tileSize + 1, this.tileSize + 1);
      }
    }
  }

  /**
   * 获取随机可放置坐标
   * @param size 物体大小
   * @returns 随机可行走位置的坐标
   * @throws 如果无法找到可行走位置则抛出错误
   */
  getRandomWalkablePosition(size: number): { x: number; y: number } {
    let attempts = 0;
    // 最多尝试1000次
    while (attempts < 1000) {
      const col = Math.floor(Math.random() * this.width);
      const row = Math.floor(Math.random() * this.height);
      const posX = col * this.tileSize + (this.tileSize - size) / 2;
      const posY = row * this.tileSize + (this.tileSize - size) / 2;
      if (this.isWalkableArea(posX, posY, size)) return { x: posX, y: posY };
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
    return getTileSpeedFactor(this.tiles[row][col]);
  }

  /**
   * 获取指定矩形区域内碰撞的第一个不可通行瓦片
   * @param x 矩形左上角X坐标
   * @param y 矩形左上角Y坐标
   * @param size 矩形大小
   * @returns 碰撞瓦片信息或null（如果没有碰撞）
   */
  getTileAtRect(x: number, y: number, size: number) {
    const startCol = Math.floor(x / this.tileSize);
    const endCol = Math.floor((x + size - 1) / this.tileSize);
    const startRow = Math.floor(y / this.tileSize);
    const endRow = Math.floor((y + size - 1) / this.tileSize);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (row < 0 || col < 0 || row >= this.height || col >= this.width) continue;
        const terrainKey = this.tiles[row][col];
        const terrain = this.terrainMap.get(terrainKey);
        // 检查是否碰撞到不可通行瓦片
        if (!terrain?.walkable) {
          return { terrain, row, col, health: this.tileHp[row][col] };
        }
      }
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
      this.tiles[row][col] = TileTypeId.DEFAULT;
      this.tileHp[row][col] = 0; // 血量清零
    }
  }
}