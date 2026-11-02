export interface PointerState {
  clientX: number;
  clientY: number;
  active: boolean;
  leftDown: boolean;
  rightDown: boolean;
  leftPressed: boolean;
  /** Real mouseup only; clearing input never manufactures a throw. */
  leftReleased: boolean;
  /** Preserves an aimed press even if right is also released before the next frame. */
  aimedLeftPressed: boolean;
  /** A left press acquired while right was already held; raw left input remains available to UI. */
  aimFireDown: boolean;
  aimFirePressed: boolean;
}

/** Keyboard ownership and canvas-only mouse input. World conversion belongs to the scene. */
export class Input {
  private keys = new Set<string>();
  private blocked = false;
  private resetVersion = 0;
  private pointerEnabled = false;
  private wheelDirection: -1 | 0 | 1 = 0;
  private leftOwned = false;
  private previousCursor = '';
  /** 需要拦截浏览器默认行为、交给游戏处理的键（例如场景里的 Tab）。 */
  private capturedKeys = new Set<string>();
  private pointer: PointerState = { clientX: 0, clientY: 0, active: false, leftDown: false, rightDown: false,
    leftPressed: false, leftReleased: false, aimedLeftPressed: false, aimFireDown: false, aimFirePressed: false };
  /** 指针位置变化时的同步回调：准星等 UI 直接跟随，不必等下一帧渲染。 */
  onPointerMove?: (clientX: number, clientY: number) => void;

  constructor(private canvas?: HTMLCanvasElement) {
    this.previousCursor = canvas?.style.cursor ?? '';
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (this.blocked || event.defaultPrevented) return;
      const code = event.code || this.keyCode(event.key);
      // A held key cannot reacquire gameplay ownership after pause/blur/menu handoff.
      if (event.repeat && !this.keys.has(code)) return;
      this.keys.add(code);
      // 只拦截游戏实际使用的特殊键，不无条件吞掉整页的键盘默认行为。
      if (code === 'Space' || this.capturedKeys.has(code)) event.preventDefault();
    });
    window.addEventListener('keyup', (event: KeyboardEvent) => this.keys.delete(event.code || this.keyCode(event.key)));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    canvas?.addEventListener('pointermove', event => {
      if (!this.pointerEnabled || this.blocked || event.pointerType !== 'mouse') return;
      this.pointer.clientX = event.clientX; this.pointer.clientY = event.clientY;
      this.pointer.active = true;
      // Never acquire a held button on re-entry after leaving the canvas.
      this.pointer.leftDown &&= !!(event.buttons & 1);
      this.pointer.rightDown &&= !!(event.buttons & 2);
      this.pointer.aimFireDown &&= this.pointer.leftDown && this.pointer.rightDown;
      if (!this.pointer.rightDown) this.pointer.aimFirePressed = false;
      this.updateCursor();
      this.onPointerMove?.(this.pointer.clientX, this.pointer.clientY);
    });
    canvas?.addEventListener('pointerdown', event => {
      if (!this.pointerEnabled || this.blocked || event.pointerType !== 'mouse' || event.defaultPrevented) return;
      this.pointer.clientX = event.clientX; this.pointer.clientY = event.clientY;
      this.pointer.active = true;
      this.updateCursor();
      this.onPointerMove?.(this.pointer.clientX, this.pointer.clientY);
    });
    // Mouse down/up fire for every button in a chord; pointer down/up only fire for its first/last button.
    canvas?.addEventListener('mousedown', event => {
      if (!this.pointerEnabled || this.blocked || event.defaultPrevented) return;
      // Pointer events retain subpixel coordinates; MouseEvent coordinates can be rounded by the browser.
      if (!this.pointer.active) { this.pointer.clientX = event.clientX; this.pointer.clientY = event.clientY; }
      this.pointer.active = true;
      if (event.button === 0) {
        this.leftOwned = true;
        this.pointer.aimedLeftPressed ||= this.pointer.rightDown;
        this.pointer.leftDown = true; this.pointer.leftPressed = true;
        this.pointer.aimFireDown = this.pointer.rightDown;
        this.pointer.aimFirePressed ||= this.pointer.rightDown;
      }
      if (event.button === 2) this.pointer.rightDown = true;
      this.updateCursor();
      this.onPointerMove?.(this.pointer.clientX, this.pointer.clientY);
    });
    window.addEventListener('mouseup', (event: MouseEvent) => {
      if (event.button === 0) { this.pointer.leftReleased ||= this.leftOwned; this.leftOwned = false; this.pointer.leftDown = false; this.pointer.aimFireDown = false; }
      if (event.button === 2) {
        this.pointer.rightDown = false;
        this.pointer.aimFireDown = false; this.pointer.aimFirePressed = false;
      }
      this.updateCursor();
    });
    window.addEventListener('pointercancel', () => this.clear());
    canvas?.addEventListener('pointerleave', () => this.clearPointer());
    canvas?.addEventListener('contextmenu', event => {
      if (this.pointerEnabled && !this.blocked) event.preventDefault();
    });
    canvas?.addEventListener('wheel', event => {
      if (!this.pointerEnabled || this.blocked || event.defaultPrevented || event.ctrlKey || event.metaKey
        || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      event.preventDefault();
      // 同一帧的滚动事件合并一次，避免快速滚动在两把枪之间来回抵消。
      this.wheelDirection = event.deltaY > 0 ? 1 : -1;
    }, { passive: false });
  }

  setPointerEnabled(enabled: boolean): void {
    if (this.pointerEnabled === enabled) return;
    if (enabled && this.canvas) this.previousCursor = this.canvas.style.cursor;
    this.pointerEnabled = enabled;
    this.clearPointer();
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.clear();
  }

  /** 仅对游戏真正使用的浏览器特殊键（如 Tab）执行 preventDefault；退出场景时清空。 */
  setCapturedKeys(keys: Iterable<string>): void {
    this.capturedKeys = new Set(keys);
  }

  isBlocked(): boolean { return this.blocked; }
  /** One immutable-in-practice sample per world step; does not install event listeners. */
  captureFrame(): Input {
    const frame = Object.create(Input.prototype) as Input;
    frame.keys = new Set(this.keys); frame.blocked = this.blocked;
    frame.pointer = this.consumePointerState(); frame.pointerEnabled = this.pointerEnabled;
    frame.wheelDirection = this.consumeWheelDirection();
    frame.capturedKeys = this.capturedKeys; frame.previousCursor = ''; frame.resetVersion = this.resetVersion;
    return frame;
  }

  clear(): void { this.resetVersion++; this.keys.clear(); this.clearPointer(); }
  getResetVersion(): number { return this.resetVersion; }

  private clearPointer(): void {
    this.leftOwned = false; this.pointer.aimedLeftPressed = false;
    this.pointer.active = false; this.pointer.leftDown = false;
    this.pointer.rightDown = false; this.pointer.leftPressed = false;
    this.pointer.leftReleased = false;
    this.wheelDirection = 0;
    this.pointer.aimFireDown = false; this.pointer.aimFirePressed = false;
    this.updateCursor();
  }

  private updateCursor(): void {
    if (this.canvas) this.canvas.style.cursor = this.pointerEnabled && !this.blocked && this.pointer.active && this.pointer.rightDown ? 'none' : this.previousCursor;
  }

  getPointerState(): Readonly<PointerState> { return { ...this.pointer }; }

  consumePointerState(): PointerState {
    const sample = { ...this.pointer };
    this.pointer.leftPressed = false;
    this.pointer.leftReleased = false;
    this.pointer.aimFirePressed = false;
    this.pointer.aimedLeftPressed = false;
    return sample;
  }

  consumeWheelDirection(): -1 | 0 | 1 {
    const direction = this.wheelDirection; this.wheelDirection = 0; return direction;
  }

  private keyCode(key: string): string {
    if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
    if (/^[0-9]$/.test(key)) return 'Digit' + key;
    return key === ' ' ? 'Space' : key;
  }

  isKeyDown(key: string): boolean {
    if (key === 'Shift') return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Shift');
    if (key === 'Enter') return this.keys.has('Enter') || this.keys.has('NumpadEnter');
    return this.keys.has(this.keyCode(key));
  }

  isKeyUp(key: string): boolean { return !this.isKeyDown(key); }
}
