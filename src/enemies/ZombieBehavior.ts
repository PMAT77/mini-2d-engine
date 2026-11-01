import { TargetMemory } from './TargetMemory';
import type { ZombieConfig } from './ZombieConfig';
import type { Point } from '../physics/Collider';
export type ZombieBehaviorState = 'wander' | 'investigate' | 'chase' | 'search';

export class ZombieBehavior {
  readonly memory = new TargetMemory();
  private state: ZombieBehaviorState = 'wander';
  private goal: Point | null = null;
  private searchCenter: Point | null = null;
  private searchLeft = 0;
  private pauseLeft = 0;
  constructor(private readonly config: Readonly<ZombieConfig>, private readonly random: () => number) {}
  getState(): ZombieBehaviorState { return this.state; }
  getGoal(): Point | null { return this.goal ? { ...this.goal } : null; }
  rejectGoal(): void { this.goal = null; this.pauseLeft = .5; }
  clearTarget(): void { this.memory.clear(); this.state = 'wander'; this.goal = null; this.pauseLeft = 1; }
  update(delta: number, center: Point, seen: Point | null, heard: Point | null): void {
    this.memory.update(delta); this.pauseLeft = Math.max(0, this.pauseLeft - delta);
    if (seen) this.memory.see(seen);
    if (heard) this.memory.hear(heard);
    const visual = this.memory.visual(this.config.visualMemory);
    if (seen || (this.state === 'chase' && visual && !this.arrived(center, visual))) {
      this.state = 'chase'; this.goal = seen ?? visual; return;
    }
    if (heard) { this.state = 'investigate'; this.goal = { ...heard }; return; }
    if (this.state === 'chase') this.beginSearch(this.memory.lastVisual() ?? center);
    if (this.state === 'investigate') {
      const sound = this.memory.auditory(this.config.hearingMemory);
      if (!sound || this.arrived(center, sound)) this.beginSearch(this.goal ?? center);
      else { this.goal = sound; return; }
    }
    if (this.state === 'search') {
      this.searchLeft -= delta;
      if (this.searchLeft <= 1e-9) { this.state = 'wander'; this.goal = null; this.pauseLeft = this.config.wanderPause; }
    }
    if (this.goal && this.arrived(center, this.goal)) { this.goal = null; this.pauseLeft = this.config.wanderPause; }
    if (!this.goal && this.pauseLeft <= 0) {
      const origin = this.state === 'search' ? this.searchCenter! : center;
      const radius = this.state === 'search' ? this.config.searchRadius : this.config.wanderRadius;
      const angle = this.random() * Math.PI * 2, length = Math.sqrt(this.random()) * radius;
      this.goal = { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
    }
  }
  private beginSearch(center: Point): void { this.state = 'search'; this.searchCenter = { ...center }; this.searchLeft = this.config.searchDuration; this.goal = null; this.pauseLeft = 0; }
  private arrived(a: Point, b: Point): boolean { return Math.hypot(a.x - b.x, a.y - b.y) <= this.config.arrivalRadius; }
}
