import type { InteractablePickup } from '../interaction/InteractablePickup';
import { VACCINE_PICKUP_CONFIG } from '../interaction/PickupTypes';
import type { DroppedWeapon } from './Player';
import { weaponHudAssets } from '../ui/WeaponHudAssets';
import { drawHeldWeapon } from './WeaponVisuals';

export class DroppedWeaponPickup implements InteractablePickup {
  private static nextId = 0;
  readonly kind = 'weapon' as const;
  readonly pickupConfig;
  private collected = false;
  constructor(readonly x: number, readonly y: number, readonly weapon: DroppedWeapon, readonly id = 'dropped-weapon-' + ++DroppedWeaponPickup.nextId) {
    this.pickupConfig = { ...VACCINE_PICKUP_CONFIG, displayName: weapon.name };
  }
  getPickupAnchor() { return { x: this.x + 10, y: this.y + 10 }; }
  getRenderBounds() { return { x: this.x - 12, y: this.y - 4, width: 44, height: 28 }; }
  isPickupReady(): boolean { return !this.collected; }
  markCollected(): boolean { if (this.collected) return false; this.collected = true; return true; }
  draw(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void {
    if (this.collected) return;
    const p = this.getPickupAnchor();
    const image = weaponHudAssets.getImage(this.weapon.slot === 'primary' ? 'smgTactical' : 'pistolGlock');
    if (image) { const width = this.weapon.slot === 'primary' ? 42 : 29;
      const height = width * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, p.x - ox - width / 2, p.y - oy - height / 2, width, height);
    } else drawHeldWeapon(ctx, 65, 'firearm', this.weapon.slot, { x: p.x - ox - 8, y: p.y - oy });
  }
  drawShadow(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void {
    const p = this.getPickupAnchor(); ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath();
    ctx.ellipse(p.x - ox, p.y - oy + 3, 18, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
