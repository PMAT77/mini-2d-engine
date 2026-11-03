export class InfectionController {
  private infected = false;
  private remainder = 0;
  isInfected(): boolean { return this.infected; }
  infect(): boolean { if (this.infected) return false; this.infected = true; this.remainder = 0; return true; }
  clear(): void { this.infected = false; this.remainder = 0; }
  advance(delta: number): number {
    if (!this.infected || !Number.isFinite(delta) || delta <= 0) return 0;
    const total = this.remainder + delta, ticks = Math.floor(total + 1e-9);
    this.remainder = Math.max(0, total - ticks);
    return ticks;
  }
  getRemainder(): number { return this.remainder; }
  restore(infected: boolean, remainder: number): void {
    if (typeof infected !== 'boolean' || !Number.isFinite(remainder) || remainder < 0 || remainder >= 1 || (!infected && remainder !== 0))
      throw new Error('感染状态无效');
    this.infected = infected; this.remainder = remainder;
  }
}
