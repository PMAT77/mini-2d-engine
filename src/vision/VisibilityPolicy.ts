import type { EntityVisibility, PerceptionView } from './VisionTypes';

/**
 * 对象/交互的显隐策略。它是纯函数，不知道 Canvas，也不知道 GameScene。
 * 掩码只决定“画面有多暗”；这里决定“该不该画”。
 */
export class VisibilityPolicy {
  static entity(view: Readonly<PerceptionView>): EntityVisibility {
    return view.level;
  }

  static lightBody(view: Readonly<PerceptionView>): EntityVisibility {
    return view.level;
  }

  static effect(view: Readonly<PerceptionView>): EntityVisibility {
    return view.level;
  }

  /** 金块光晕会暴露位置，只在完整辨识时绘制。 */
  static goldGlow(view: Readonly<PerceptionView>): EntityVisibility {
    return view.level === 'identified' ? 'identified' : 'hidden';
  }

  /** 伤害/拾取文字是精确信息，隐藏或剪影时都不应显示来源。 */
  static floatingText(view: Readonly<PerceptionView>): EntityVisibility {
    return view.level === 'identified' ? 'identified' : 'hidden';
  }

  static crosshair(view: Readonly<PerceptionView>): boolean {
    return view.level === 'identified';
  }

  static healthBar(view: Readonly<PerceptionView>): boolean {
    return view.level === 'identified';
  }
}
