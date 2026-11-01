import type { Point } from '../physics/Collider';
interface Memory { position: Point; age: number; }
/** Only legal sensor results enter memory; no live target reference is retained. */
export class TargetMemory {
  private sight: Memory | null = null;
  private sound: Memory | null = null;
  update(delta: number): void { if (this.sight) this.sight.age += delta; if (this.sound) this.sound.age += delta; }
  see(position: Point): void { this.sight = { position: { ...position }, age: 0 }; }
  hear(position: Point): void { this.sound = { position: { ...position }, age: 0 }; }
  visual(seconds: number): Point | null { return this.sight && this.sight.age < seconds ? { ...this.sight.position } : null; }
  auditory(seconds: number): Point | null { return this.sound && this.sound.age < seconds ? { ...this.sound.position } : null; }
  lastVisual(): Point | null { return this.sight ? { ...this.sight.position } : null; }
  clear(): void { this.sight = null; this.sound = null; }
  snapshot() { return { sight: this.sight ? { position: { ...this.sight.position }, age: this.sight.age } : null, sound: this.sound ? { position: { ...this.sound.position }, age: this.sound.age } : null }; }
}
