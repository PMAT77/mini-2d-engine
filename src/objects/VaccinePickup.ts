import type { InteractablePickup } from '../interaction/InteractablePickup';
import { VACCINE_PICKUP_CONFIG } from '../interaction/PickupTypes';
export class VaccinePickup implements InteractablePickup {
  static readonly SIZE = 20;
  private static nextId = 0;
  readonly kind = 'vaccine' as const;
  readonly pickupConfig = VACCINE_PICKUP_CONFIG;
  private collected = false;
  constructor(readonly x: number, readonly y: number, readonly id = `vaccine-${++VaccinePickup.nextId}`) {}
  getPickupAnchor() { return { x: this.x + 10, y: this.y + 10 }; }
  getRenderBounds() { return { x: this.x, y: this.y, width: 20, height: 20 }; }
  isPickupReady(): boolean { return !this.collected; }
  markCollected(): boolean { if (this.collected) return false; this.collected = true; return true; }
  draw(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void {
    if (this.collected) return;
    const p = this.getPickupAnchor(); ctx.save(); ctx.translate(p.x - ox, p.y - oy); ctx.rotate(-.35);
    ctx.fillStyle = '#d9eef0'; ctx.fillRect(-6, -8, 12, 16);
    ctx.fillStyle = '#688b95'; ctx.fillRect(-5, -10, 10, 4);
    ctx.fillStyle = '#46aa9d'; ctx.fillRect(-5, -3, 10, 9);
    ctx.fillStyle = '#f0fff9'; ctx.fillRect(-1, -2, 2, 7); ctx.fillRect(-3, 0, 6, 2); ctx.restore();
  }
  drawShadow(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void {
    const p = this.getPickupAnchor(); ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath();
    ctx.ellipse(p.x - ox, p.y + 3 - oy, 10, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
