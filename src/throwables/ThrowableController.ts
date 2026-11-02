import type { Point } from '../physics/Collider';
import type { PointerState } from '../core/Input';
import type { WeaponSlot } from '../objects/Weapon';
import type { ConsumableInventory } from '../survival/ConsumableInventory';
import { THROWABLE_CONFIG as C, type ThrowableId } from './ThrowableConfig';

/** Owns only the item in hand; launched bodies have independent lifetimes. */
export class ThrowableController {
  held: ThrowableId | null = null;
  returnWeapon: WeaponSlot = 'melee';
  prepared = false;
  fuse: number = C.fuse;
  target: Point = { x: 0, y: 0 };
  private releaseOwned = false;
  constructor(private readonly inventory: ConsumableInventory) {}
  get locked(): boolean { return this.held === 'grenade' && this.prepared; }
  equip(id: ThrowableId, previous: WeaponSlot): boolean {
    if (this.locked || this.inventory.getCount(id) < 1) return false;
    if (!this.held) this.returnWeapon = previous;
    this.cancel(); this.held = id; return true;
  }
  cancel(): boolean {
    if (this.locked) return false;
    if (this.held && this.prepared) this.inventory.release(this.held);
    this.held = null; this.prepared = false; this.releaseOwned = false; this.fuse = C.fuse;
    return true;
  }
  suspend(): void {
    this.releaseOwned = false;
    if (!this.locked && this.prepared && this.held) { this.inventory.release(this.held); this.prepared = false; }
  }
  input(pointer: Readonly<PointerState>, target?: Point): boolean {
    if (!this.held) return false;
    if (target) this.target = { ...target };
    if (this.prepared && pointer.leftPressed) this.releaseOwned = true;
    if (!this.prepared && (pointer.aimedLeftPressed || pointer.aimFirePressed) && target && this.inventory.reserve(this.held)) {
      this.prepared = true; this.releaseOwned = true; this.fuse = C.fuse;
    }
    return this.prepared && this.releaseOwned && pointer.leftReleased;
  }
  advance(dt: number): boolean {
    if (!this.locked) return false;
    this.fuse = Math.max(0, this.fuse - dt);
    return this.fuse <= 1e-8;
  }
  commit(): { kind: ThrowableId; fuse: number; target: Point } | null {
    if (!this.held || !this.prepared || !this.inventory.commit(this.held)) return null;
    const result = { kind: this.held, fuse: this.fuse, target: { ...this.target } };
    this.prepared = false; this.releaseOwned = false; this.fuse = C.fuse;
    if (!this.inventory.getCount(this.held)) this.held = null;
    return result;
  }
  dispose(): void {
    if (this.held && this.prepared) this.inventory.release(this.held);
    this.prepared = false; this.held = null; this.releaseOwned = false;
  }
}
