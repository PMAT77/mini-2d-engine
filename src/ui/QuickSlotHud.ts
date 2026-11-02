import type { Input } from '../core/Input';
import type { Rect } from './HudTypes';
import type { QuickSlotItemView } from './BackpackView';
import { drawInventoryIcon } from './InventoryIcons';

const SLOT_COUNT = 4;
const SLOT_SIZE = 60;
const SLOT_GAP = 6;
const LABEL_HEIGHT = 24;
const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';

/** 底部居中；小窗口中从下往上让开生命/体力、生存状态和背包等区域。 */
export function getQuickSlotHudLayout(width: number, height: number, reserved: readonly Rect[] = []) {
  const scale = Math.max(0, Math.min(1, width / 600, height / 800));
  const size = SLOT_SIZE * scale;
  const gap = SLOT_GAP * scale;
  const barWidth = (SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP) * scale;
  const barHeight = (SLOT_SIZE + LABEL_HEIGHT) * scale;
  const x = (width - barWidth) / 2;
  let y = height - Math.min(60, height * 0.065) - barHeight;
  for (const area of [...reserved].sort((a, b) => b.y - a.y)) {
    if (x < area.x + area.width && x + barWidth > area.x && y < area.y + area.height && y + barHeight > area.y) {
      y = area.y - 6 - barHeight;
    }
  }
  return { x, y: Math.max(0, y), width: barWidth, height: barHeight, size, gap, scale };
}

/** 数字键只在按下沿激活；绑定与物品状态由场景持有。 */
export class QuickSlotHud {
  private layout?: ReturnType<typeof getQuickSlotHudLayout>;
  private hovered = false;
  private pointer = { x: -1, y: -1 };
  private drag?: { slot: number; pointer: number; x: number; y: number; moved: boolean; source: HTMLCanvasElement };
  private detach?: () => void;
  isInteracting(): boolean { return this.hovered || !!this.drag; }
  slotAt(x: number, y: number): number | null {
    const l = this.layout; if (!l || y < l.y || y > l.y + l.size) return null;
    for (let slot = 0; slot < 4; slot++) if (x >= l.x + slot * (l.size + l.gap) && x <= l.x + slot * (l.size + l.gap) + l.size) return slot;
    return null;
  }
  cancelDrag(): void { const drag = this.drag; this.drag = undefined;
    if (drag?.source.hasPointerCapture(drag.pointer)) drag.source.releasePointerCapture(drag.pointer);
    this.hovered = false; if (typeof document !== 'undefined') document.body.classList.remove('hud-pointer'); }
  attach(canvas: HTMLCanvasElement, options: { canEdit(): boolean; beforeEdit(): void; bound(slot: number): boolean; swap(from: number, to: number): void; unbind(slot: number): void }): void {
    this.dispose();
    const point = (e: MouseEvent | PointerEvent) => { const r = canvas.getBoundingClientRect(), sx = r.width / canvas.offsetWidth, sy = r.height / canvas.offsetHeight; return { x: (e.clientX - r.left - canvas.clientLeft * sx) * canvas.width / (window.devicePixelRatio || 1) / (canvas.clientWidth * sx), y: (e.clientY - r.top - canvas.clientTop * sy) * canvas.height / (window.devicePixelRatio || 1) / (canvas.clientHeight * sy) }; };
    const covered = (e: Event) => e.target instanceof Element && !!e.target.closest('.backpack-panel, .backpack-menu');
    const move = (e: PointerEvent) => {
      this.pointer = point(e); this.hovered = !covered(e) && options.canEdit() && this.slotAt(this.pointer.x, this.pointer.y) !== null;
      if (this.drag && e.pointerId === this.drag.pointer) this.drag.moved ||= Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) >= 6;
      document.body.classList.toggle('hud-pointer', this.isInteracting());
    };
    const down = (e: PointerEvent) => {
      if (covered(e) || !options.canEdit() || e.pointerType !== 'mouse' || (e.button !== 0 && e.button !== 2)) return;
      const p = point(e), slot = this.slotAt(p.x, p.y); if (slot === null) return;
      e.preventDefault(); e.stopImmediatePropagation(); options.beforeEdit();
      if (e.button === 2) options.unbind(slot);
      else if (options.bound(slot)) { this.drag = { slot, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, source: canvas }; canvas.setPointerCapture(e.pointerId); }
    };
    const up = (e: PointerEvent) => {
      const drag = this.drag; if (!drag || drag.pointer !== e.pointerId) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.drag = undefined;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (drag.moved) { const p = point(e), slot = this.slotAt(p.x, p.y); if (slot === null) options.unbind(drag.slot); else options.swap(drag.slot, slot); }
    };
    const context = (e: MouseEvent) => { const p = point(e); if (options.canEdit() && this.slotAt(p.x, p.y) !== null) e.preventDefault(); };
    const cancel = () => this.cancelDrag();
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true); document.addEventListener('contextmenu', context, true);
    document.addEventListener('pointercancel', cancel, true); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', cancel);
    this.detach = () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('contextmenu', context, true); document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', cancel); };
  }
  dispose(): void { this.detach?.(); this.detach = undefined; this.cancelDrag(); }
  private selectedSlot = 0;
  private held = 0;
  private inputReset = -1;

  getSelectedSlot(): number { return this.selectedSlot; }

  update(input: Pick<Input, 'isKeyDown'> & Partial<Pick<Input, 'getResetVersion'>>): number | null {
    const reset = input.getResetVersion?.();
    if (reset !== undefined && reset !== this.inputReset) { this.inputReset = reset; this.held = 0; }
    let keys = 0;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      if (input.isKeyDown(String(slot + 1)) || input.isKeyDown(`Numpad${slot + 1}`)) keys |= 1 << slot;
    }
    const pressed = keys & ~this.held; this.held = keys;
    for (let slot = 0; slot < SLOT_COUNT; slot++) if (pressed & (1 << slot)) { this.selectedSlot = slot; return slot; }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, reserved: readonly Rect[] = [],
    items: readonly (QuickSlotItemView | null)[] = [], use?: { slot: number; progress: number; remaining?: number }): void {
    const layout = this.layout = getQuickSlotHudLayout(width, height, reserved);
    if (layout.size < 1) return;
    ctx.save();
    ctx.translate(layout.x, layout.y);
    ctx.scale(layout.scale, layout.scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 24px ${FONT}`;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const x = slot * (SLOT_SIZE + SLOT_GAP);
      ctx.fillStyle = 'rgba(6,12,16,.36)';
      ctx.fillRect(x, 0, SLOT_SIZE, SLOT_SIZE);
      if (use?.slot === slot) {
        const progress = Number.isFinite(use.progress) ? Math.max(0, Math.min(1, use.progress)) : 0;
        ctx.fillStyle = use.remaining !== undefined ? (use.remaining <= 1 ? 'rgba(235,84,53,.65)' : 'rgba(218,170,91,.45)') : 'rgba(133,217,192,.4)';
        ctx.fillRect(x + 1, 1, (SLOT_SIZE - 2) * progress, SLOT_SIZE - 2);
      }
      ctx.strokeStyle = 'rgba(177,195,202,.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.75, 0.75, SLOT_SIZE - 1.5, SLOT_SIZE - 1.5);
      const item = items[slot];
      if (item) {
        ctx.save(); if (item.available === false) ctx.globalAlpha *= .3;
        drawInventoryIcon(ctx, item.icon, { x: x + 7, y: 7, width: SLOT_SIZE - 14, height: SLOT_SIZE - 18 });
        ctx.restore();
        if (item.category === 'consumables' || item.category === 'throwables') {
          ctx.font = `600 13px ${FONT}`; ctx.textAlign = 'right'; ctx.fillStyle = '#e7f2f2';
          ctx.fillText(String(item.quantity), x + SLOT_SIZE - 6, SLOT_SIZE - 9);
          ctx.font = `400 24px ${FONT}`; ctx.textAlign = 'center';
        }
      }
      if (this.drag?.slot === slot) { ctx.strokeStyle = '#d3d6c0'; ctx.lineWidth = 2; ctx.strokeRect(x + 2, 2, SLOT_SIZE - 4, SLOT_SIZE - 4); }
      if (use?.slot === slot && use.remaining !== undefined) {
        ctx.font = `700 15px ${FONT}`; ctx.fillStyle = '#fff4d8'; ctx.fillText(`${use.remaining.toFixed(1)}s`, x + SLOT_SIZE / 2, 12);
        ctx.font = `400 24px ${FONT}`;
      }
      ctx.fillStyle = '#9aa8af';
      ctx.fillText(String(slot + 1), x + SLOT_SIZE / 2, SLOT_SIZE + LABEL_HEIGHT / 2);
    }
    ctx.restore();
    if (this.drag?.moved) {
      const item = items[this.drag.slot];
      if (item) { ctx.save(); ctx.globalAlpha = .8; drawInventoryIcon(ctx, item.icon, { x: this.pointer.x - 23, y: this.pointer.y - 23, width: 46, height: 46 }); ctx.font = `12px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#d3d6c0'; ctx.fillText(this.slotAt(this.pointer.x, this.pointer.y) === null ? '松开解绑' : '松开交换位置', this.pointer.x, this.pointer.y + 36); ctx.restore(); }
    }
  }
}
