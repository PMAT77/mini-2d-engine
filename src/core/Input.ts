export interface PointerState {
  clientX: number;
  clientY: number;
  active: boolean;
  leftDown: boolean;
  rightDown: boolean;
  leftPressed: boolean;
}

/** Keyboard ownership and canvas-only mouse input. World conversion belongs to the scene. */
export class Input {
  private keys = new Set<string>();
  private blocked = false;
  private pointerEnabled = false;
  private previousCursor = '';
  private pointer: PointerState = { clientX: 0, clientY: 0, active: false, leftDown: false, rightDown: false, leftPressed: false };

  constructor(private canvas?: HTMLCanvasElement) {
    this.previousCursor = canvas?.style.cursor ?? '';
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (this.blocked || event.defaultPrevented) return;
      this.keys.add(event.code || this.keyCode(event.key));
      if (event.code === 'Space') event.preventDefault();
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
      this.updateCursor();
    });
    canvas?.addEventListener('pointerdown', event => {
      if (!this.pointerEnabled || this.blocked || event.pointerType !== 'mouse' || event.defaultPrevented) return;
      this.pointer.clientX = event.clientX; this.pointer.clientY = event.clientY;
      this.pointer.active = true;
      this.updateCursor();
    });
    // Mouse down/up fire for every button in a chord; pointer down/up only fire for its first/last button.
    canvas?.addEventListener('mousedown', event => {
      if (!this.pointerEnabled || this.blocked || event.defaultPrevented) return;
      // Pointer events retain subpixel coordinates; MouseEvent coordinates can be rounded by the browser.
      if (!this.pointer.active) { this.pointer.clientX = event.clientX; this.pointer.clientY = event.clientY; }
      this.pointer.active = true;
      if (event.button === 0) { this.pointer.leftDown = true; this.pointer.leftPressed = true; }
      if (event.button === 2) this.pointer.rightDown = true;
      this.updateCursor();
    });
    window.addEventListener('mouseup', (event: MouseEvent) => {
      if (event.button === 0) this.pointer.leftDown = false;
      if (event.button === 2) this.pointer.rightDown = false;
    });
    window.addEventListener('pointercancel', () => this.clear());
    canvas?.addEventListener('pointerleave', () => this.clearPointer());
    canvas?.addEventListener('contextmenu', event => {
      if (this.pointerEnabled && !this.blocked) event.preventDefault();
    });
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

  clear(): void { this.keys.clear(); this.clearPointer(); }

  private clearPointer(): void {
    this.pointer.active = false; this.pointer.leftDown = false;
    this.pointer.rightDown = false; this.pointer.leftPressed = false;
    this.updateCursor();
  }

  private updateCursor(): void {
    if (this.canvas) this.canvas.style.cursor = this.pointerEnabled && !this.blocked && this.pointer.active ? 'none' : this.previousCursor;
  }

  getPointerState(): Readonly<PointerState> { return { ...this.pointer }; }

  consumePointerState(): PointerState {
    const sample = { ...this.pointer };
    this.pointer.leftPressed = false;
    return sample;
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
