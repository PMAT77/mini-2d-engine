import { Player } from '../objects/Player';

/**
 * 属性修改器类型定义
 */
export interface Modifier {
  id: string;            // 修改器唯一ID
  stat: string;          // 影响的属性名
  value: number;         // 修改值
  duration: number;      // 持续时间（秒，0表示永久）
  isMultiplier: boolean; // 是否为乘数
  description: string;   // 描述信息，用于UI显示
  startTime?: number;    // 开始时间戳，用于精确计算剩余时间
}

/**
 * 属性修改器管理器
 * 负责管理玩家的所有临时属性修改
 */
export class ModifierManager {
  private player: Player;
  // 当前激活的修改器
  private activeModifiers: Map<string, Modifier> = new Map();
  // 用于生成唯一ID的计数器
  private static idCounter: number = 0;

  constructor(player: Player) {
    if (!player) {
      throw new Error('ModifierManager: Player instance is required');
    }
    this.player = player;
  }

  /**
   * 添加一个修改器
   * @param modifier 不包含ID的修改器对象
   * @param id 可选的自定义ID
   * @returns 修改器的唯一ID
   */
  addModifier(modifier: Omit<Modifier, 'id'>, id?: string): string {
    // 参数验证
    if (!modifier.stat || typeof modifier.value !== 'number') {
      throw new Error('ModifierManager: Invalid modifier parameters');
    }

    // 生成唯一ID，优先使用自定义ID
    const modifierId = id || `mod_${Date.now()}_${ModifierManager.idCounter++}`;

    // 创建完整的修改器对象并记录开始时间
    const fullModifier: Modifier = {
      ...modifier,
      id: modifierId,
      startTime: Date.now()
    };

    // 存储修改器并应用到玩家
    this.activeModifiers.set(modifierId, fullModifier);
    this.player.addModifier(modifier.stat, modifier.value, modifier.duration, modifier.isMultiplier);

    console.debug(`ModifierManager: Added modifier ${modifierId} for stat ${modifier.stat}`);
    return modifierId;
  }

  /**
   * 移除一个修改器
   * @param id 修改器ID
   * @returns 是否成功移除
   */
  removeModifier(id: string): boolean {
    const modifier = this.activeModifiers.get(id);
    if (modifier) {
      this.activeModifiers.delete(id);
      this.player.removeModifier(modifier.stat);
      console.debug(`ModifierManager: Removed modifier ${id} for stat ${modifier.stat}`);
      return true;
    }
    console.warn(`ModifierManager: Attempted to remove non-existent modifier ${id}`);
    return false;
  }

  /**
   * 清除所有修改器
   */
  clearAllModifiers(): void {
    // 移除所有修改器对玩家的影响
    this.activeModifiers.forEach(modifier => {
      this.player.removeModifier(modifier.stat);
    });

    // 清空修改器集合
    const count = this.activeModifiers.size;
    this.activeModifiers.clear();

    console.debug(`ModifierManager: Cleared all ${count} modifiers`);
  }

  /**
   * 获取所有激活的修改器
   * @returns 激活修改器数组
   */
  getActiveModifiers(): Modifier[] {
    return Array.from(this.activeModifiers.values());
  }

  /**
   * 根据属性名称获取修改器
   * @param stat 属性名称
   * @returns 该属性的所有修改器
   */
  getModifiersByStat(stat: string): Modifier[] {
    return Array.from(this.activeModifiers.values()).filter(mod => mod.stat === stat);
  }

  /**
   * 检查是否存在特定ID的修改器
   * @param id 修改器ID
   * @returns 是否存在
   */
  hasModifier(id: string): boolean {
    return this.activeModifiers.has(id);
  }

  /**
   * 获取当前激活的修改器数量
   * @returns 修改器数量
   */
  getModifierCount(): number {
    return this.activeModifiers.size;
  }

  /**
   * 更新修改器状态
   * 这个方法应该在游戏主循环中被调用
   * @param delta 时间增量（秒）
   */
  update(delta: number): void {
    // 验证时间增量
    if (typeof delta !== 'number' || delta <= 0) {
      return;
    }

    // 记录需要移除的过期修改器
    const expiredModifiers: string[] = [];

    // 遍历所有修改器，更新持续时间并检查是否过期
    this.activeModifiers.forEach((modifier, id) => {
      // 只处理有持续时间限制的修改器
      if (modifier.duration > 0) {
        modifier.duration -= delta;

        // 检查是否过期
        if (modifier.duration <= 0) {
          expiredModifiers.push(id);
        }
      }
    });

    // 移除所有过期的修改器
    for (const id of expiredModifiers) {
      this.removeModifier(id);
    }
  }
}