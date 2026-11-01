import { COMBAT_FEEDBACK } from '../combat/CombatFeedbackConfig';

/** Static decorations are indexed once by center; query padding includes their full extent. */
export class GroundEffectGrid<T extends { x: number; y: number }> {
  private readonly cells = new Map<string, T[]>();
  private count = 0;
  get size(): number { return this.count; }
  add(value: T): void {
    const s = COMBAT_FEEDBACK.groundCellSize, key = `${Math.floor(value.x / s)},${Math.floor(value.y / s)}`;
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(value); else this.cells.set(key, [value]);
    this.count++;
  }
  *query(x: number, y: number, width: number, height: number, pad = 64): IterableIterator<T> {
    const s = COMBAT_FEEDBACK.groundCellSize;
    for (let row = Math.floor((y - pad) / s); row <= Math.floor((y + height + pad) / s); row++)
      for (let col = Math.floor((x - pad) / s); col <= Math.floor((x + width + pad) / s); col++) {
        const bucket = this.cells.get(`${col},${row}`); if (bucket) yield* bucket;
      }
  }
  *values(): IterableIterator<T> { for (const bucket of this.cells.values()) yield* bucket; }
  clear(): void { this.cells.clear(); this.count = 0; }
}
