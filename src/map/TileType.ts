/**
 * 瓦片类型接口定义
 * 定义游戏中所有瓦片的基本属性
 */
export interface TileType {
  /** 瓦片绘制时使用的颜色值 */
  color: string;

  /** 移动速度修正系数（<1 减速，>1 加速，0 表示无法移动） */
  speedFactor: number;

  /** 是否为可破坏瓦片 */
  isDestructible?: boolean;

  /** 瓦片的耐久度，如果可破坏 */
  durability?: number;
}

/**
 * 瓦片类型枚举
 * 使用枚举而不是字符串键可以提供更好的类型安全性和自动补全
 */
export enum TileTypeId {
  DEFAULT = 'default',
  WATER = 'water',
  WALL = 'wall',
  MINERAL = 'mineral'
}

/**
 * 预定义瓦片类型集合
 * 包含游戏中所有可用的瓦片配置
 */
export const TILE_TYPES: Record<TileTypeId, TileType> = {
  [TileTypeId.DEFAULT]: {
    color: '#1a1a1a',
    speedFactor: 1,
    isDestructible: false
  },
  [TileTypeId.WATER]: {
    color: '#4da6ff8a',
    speedFactor: 0.5,
    isDestructible: false
  },
  [TileTypeId.WALL]: {
    color: '#555555',
    speedFactor: 0,
    isDestructible: false,
  },
  [TileTypeId.MINERAL]: {
    color: '#ffd700',
    speedFactor: 0,
    isDestructible: true,
    durability: 100
  }
};

/**
 * 获取瓦片类型配置
 * @param tileTypeId 瓦片类型ID
 * @returns 对应的瓦片类型配置，如果不存在则返回默认配置
 */
export function getTileType(tileTypeId: string | TileTypeId): TileType {
  // 如果找不到对应类型，返回默认类型
  return TILE_TYPES[tileTypeId as TileTypeId] || TILE_TYPES[TileTypeId.DEFAULT];
}

/**
 * 检查瓦片是否可通行
 * @param tileType 瓦片类型或瓦片类型ID
 * @returns 是否可通行（speedFactor > 0 视为可通行）
 */
export function isTilePassable(tileType: TileType | string | TileTypeId): boolean {
  const tileConfig = typeof tileType === 'object' ? tileType : getTileType(tileType);
  return tileConfig.speedFactor > 0;
}

/**
 * 获取瓦片移动速度因子
 * @param tileType 瓦片类型或瓦片类型ID
 * @returns 移动速度因子
 */
export function getTileSpeedFactor(tileType: TileType | string | TileTypeId): number {
  const tileConfig = typeof tileType === 'object' ? tileType : getTileType(tileType);
  return tileConfig.speedFactor;
}

/**
 * 检查瓦片是否可破坏
 * @param tileType 瓦片类型或瓦片类型ID
 * @returns 是否可破坏
 */
export function isTileDestructible(tileType: TileType | string | TileTypeId): boolean {
  const tileConfig = typeof tileType === 'object' ? tileType : getTileType(tileType);
  return !!tileConfig.isDestructible;
}

/**
 * 获取所有可用的瓦片类型ID列表
 * @returns 瓦片类型ID数组
 */
export function getAllTileTypeIds(): TileTypeId[] {
  return Object.values(TileTypeId);
}