/**
 * 输入系统类
 * 负责处理和管理用户的键盘输入
 */
export class Input {
  /**
   * 存储当前按下的键的集合
   * @private
   */
  private keys: Set<string> = new Set<string>();

  /**
   * 构造函数
   * 初始化事件监听器以跟踪键盘输入
   */
  constructor() {
    // 添加键盘按下事件监听器
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      this.keys.add(e.key);
    });

    // 添加键盘释放事件监听器
    window.addEventListener("keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.key);
    });
  }

  /**
   * 检查指定的键是否当前处于按下状态
   * @param key 键盘按键标识符（如"ArrowUp"、"w"等）
   * @returns boolean 键是否按下
   */
  public isKeyDown(key: string): boolean {
    return this.keys.has(key);
  }

  /**
   * 检查指定的键是否当前处于释放状态
   * @param key 键盘按键标识符
   * @returns boolean 键是否释放
   */
  public isKeyUp(key: string): boolean {
    return !this.keys.has(key);
  }
}