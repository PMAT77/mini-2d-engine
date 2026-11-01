export class ConsumableInventory {
  private vaccines = 0;
  getVaccines(): number { return this.vaccines; }
  private validate(amount: number): void { if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('消耗品数量必须是非负安全整数'); }
  canAddVaccines(amount: number): boolean { this.validate(amount); return Number.isSafeInteger(this.vaccines + amount); }
  addVaccines(amount = 1): void {
    if (!this.canAddVaccines(amount)) throw new Error('疫苗数量溢出');
    this.vaccines += amount;
  }
  consumeVaccine(): boolean { if (!this.vaccines) return false; this.vaccines--; return true; }
  clear(): void { this.vaccines = 0; }
}
