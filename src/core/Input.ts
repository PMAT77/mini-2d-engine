export interface AimChange { x: number; y: number; time: number }

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
  private aimChanges: AimChange[] = [];
  private aimX = 0;
  private aimY = 0;
  private aimReset = false;
  private blocked = false;

  /** UI focus owns the keyboard until the game surface is selected again. */
  public setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.clearKeys();
  }

  private recordAim(): void {
    const x = Number(this.keys.has("ArrowRight")) - Number(this.keys.has("ArrowLeft"));
    const y = Number(this.keys.has("ArrowDown")) - Number(this.keys.has("ArrowUp"));
    if (x === this.aimX && y === this.aimY) return;
    this.aimX = x; this.aimY = y;
    if (this.aimChanges.length === 32) this.aimReset = true;
    // After overflow only the latest direction matters; never replay a backlog.
    if (this.aimReset) this.aimChanges = [];
    this.aimChanges.push({ x, y, time: performance.now() / 1000 });
  }

  private clearKeys(): void {
    this.keys.clear();
    this.recordAim();
    this.aimReset = true;
  }

  /** Consume once per player frame, outside movement substeps. Times are monotonic seconds. */
  public consumeAimChanges(): { changes: AimChange[]; now: number; reset: boolean } {
    const result = { changes: this.aimChanges, now: performance.now() / 1000, reset: this.aimReset };
    this.aimChanges = [];
    this.aimReset = false;
    return result;
  }

  private keyCode(key: string): string {
    if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    return key === " " ? "Space" : key;
  }

  /**
   * 构造函数
   * 初始化事件监听器以跟踪键盘输入
   */
  constructor() {
    // 添加键盘按下事件监听器
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.blocked || e.defaultPrevented) return;
      this.keys.add(e.code || this.keyCode(e.key));
      this.recordAim();
      if (e.code?.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });

    // 添加键盘释放事件监听器
    window.addEventListener("keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.code || this.keyCode(e.key));
      this.recordAim();
    });
    window.addEventListener("blur", () => this.clearKeys());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearKeys();
    });
  }

  /**
   * 检查指定的键是否当前处于按下状态
   * @param key 键盘按键标识符（如"ArrowUp"、"w"等）
   * @returns boolean 键是否按下
   */
  public isKeyDown(key: string): boolean {
    if (key === "Shift") return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.keys.has("Shift");
    if (key === "Enter") return this.keys.has("Enter") || this.keys.has("NumpadEnter");
    return this.keys.has(this.keyCode(key));
  }

  /**
   * 检查指定的键是否当前处于释放状态
   * @param key 键盘按键标识符
   * @returns boolean 键是否释放
   */
  public isKeyUp(key: string): boolean {
    return !this.isKeyDown(key);
  }
}
