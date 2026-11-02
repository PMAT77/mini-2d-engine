import type { ThrowableId } from '../throwables/ThrowableConfig';
export type ConsumableId = 'vaccine' | ThrowableId;
export class ConsumableInventory {
  private readonly counts: Record<ConsumableId, number> = { vaccine: 0, grenade: 0, smokeGrenade: 0 };
  private readonly reserved: Record<ConsumableId, number> = { vaccine: 0, grenade: 0, smokeGrenade: 0 };
  getCount(id: ConsumableId): number { return this.counts[id]; }
  getAvailable(id: ConsumableId): number { return this.counts[id] - this.reserved[id]; }
  getVaccines(): number { return this.getCount('vaccine'); }
  private validate(amount: number): void { if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('消耗品数量必须是非负安全整数'); }
  canAddVaccines(amount: number): boolean { this.validate(amount); return Number.isSafeInteger(this.counts.vaccine + amount); }
  addVaccines(amount = 1): void {
    if (!this.canAddVaccines(amount)) throw new Error('疫苗数量溢出');
    this.add('vaccine', amount);
  }
  add(id: ConsumableId, amount = 1): void {
    this.validate(amount);
    if (!Number.isSafeInteger(this.counts[id] + amount)) throw new Error('物品数量溢出');
    this.counts[id] += amount;
  }
  consume(id: ConsumableId): boolean { if (!this.getAvailable(id)) return false; this.counts[id]--; return true; }
  reserve(id: ThrowableId): boolean { if (!this.getAvailable(id)) return false; this.reserved[id]++; return true; }
  release(id: ThrowableId): void { this.reserved[id] = Math.max(0, this.reserved[id] - 1); }
  commit(id: ThrowableId): boolean {
    if (!this.reserved[id]) return false;
    this.reserved[id]--; this.counts[id]--; return true;
  }
  consumeVaccine(): boolean { return this.consume('vaccine'); }
  clear(): void { for (const id of Object.keys(this.counts) as ConsumableId[]) { this.counts[id] = 0; this.reserved[id] = 0; } }
}
