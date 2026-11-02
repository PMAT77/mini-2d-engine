import type { PickupConfig } from './PickupTypes';
import type { Bounds, Point } from '../physics/Collider';
export interface InteractablePickup {
  readonly id: string | number;
  readonly kind: 'meat' | 'vaccine' | 'weapon' | 'throwable';
  readonly pickupConfig: Readonly<PickupConfig>;
  getPickupAnchor(): Point;
  getRenderBounds(): Bounds;
  isPickupReady(): boolean;
  markCollected(): boolean;
}
