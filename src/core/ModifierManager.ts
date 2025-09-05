import { Player } from '../objects/Player';

/**
 * 属性修改器类型定义
 */
export interface Modifier {
  id: string;           // 修改器唯一ID
  stat: string;         // 影响的属性名
  value: number;        // 修改值
  duration: number;     // 持续时间（秒，0表示永久）
  isMultiplier: boolean; // 是否为乘数
  description: string;  // 描述信息，用于UI显示
}

/**
 * 属性修改器管理器
 * 负责管理玩家的所有临时属性修改
 */
export class ModifierManager {
  private player: Player;
  private activeModifiers: Map<string, Modifier> = new Map();

  constructor(player: Player) {
    this.player = player;
  }

  /**
   * 添加一个修改器
   */
  addModifier(modifier: Omit<Modifier, 'id'>, id?: string): string {
    const modifierId = id || `mod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullModifier = { ...modifier, id: modifierId };

    this.activeModifiers.set(modifierId, fullModifier);
    this.player.addModifier(modifier.stat, modifier.value, modifier.duration, modifier.isMultiplier);

    return modifierId;
  }

  /**
   * 移除一个修改器
   */
  removeModifier(id: string): void {
    const modifier = this.activeModifiers.get(id);
    if (modifier) {
      this.activeModifiers.delete(id);
      this.player.removeModifier(modifier.stat);
    }
  }

  /**
   * 清除所有修改器
   */
  clearAllModifiers(): void {
    this.activeModifiers.forEach(modifier => {
      this.player.removeModifier(modifier.stat);
    });
    this.activeModifiers.clear();
  }

  /**
   * 获取所有激活的修改器
   */
  getActiveModifiers(): Modifier[] {
    return Array.from(this.activeModifiers.values());
  }

  /**
   * 更新修改器状态
   * 这个方法应该在游戏主循环中被调用
   */
  update(delta: number): void {
    // 这里不需要特别处理，因为Player类的update方法已经处理了修改器的时间衰减
    // 但我们可以在这里添加额外的逻辑，例如UI更新等
  }
}