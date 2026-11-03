import type { InteractablePickup } from '../interaction/InteractablePickup';
import { VACCINE_PICKUP_CONFIG } from '../interaction/PickupTypes';
import { drawInventoryIcon } from '../ui/InventoryIcons';
import { THROWABLE_ITEMS, type ThrowableId } from './ThrowableConfig';
export function drawThrowable(ctx: CanvasRenderingContext2D, type: ThrowableId, x: number, y: number, rotation = 0, size = 24): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
  drawInventoryIcon(ctx, `/assets/images/throwables/${THROWABLE_ITEMS[type].asset}-world.png`, { x: -size / 2, y: -size / 2, width: size, height: size });
  ctx.restore();
}
export class ThrowablePickup implements InteractablePickup {
  private static nextId = 0;
  readonly kind = 'throwable' as const;
  readonly pickupConfig;
  private collected = false;
  constructor(readonly x: number, readonly y: number, readonly item: ThrowableId, readonly id = 'throwable-' + ++ThrowablePickup.nextId) {
    this.pickupConfig = { ...VACCINE_PICKUP_CONFIG, displayName: THROWABLE_ITEMS[item].name };
  }
  getPickupAnchor() { return { x: this.x + 10, y: this.y + 10 }; }
  getRenderBounds() { return { x: this.x - 3, y: this.y - 3, width: 26, height: 26 }; }
  isPickupReady(): boolean { return !this.collected; }
  markCollected(): boolean { if (this.collected) return false; this.collected = true; return true; }
  draw(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void { if (!this.collected) drawThrowable(ctx, this.item, this.x + 10 - ox, this.y + 10 - oy, -.25); }
  drawShadow(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(this.x + 10 - ox, this.y + 14 - oy, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
