import { NavigationGrid, distance } from './NavigationGrid';
import type { Point } from '../physics/Collider';
import type { TileMap } from '../map/TileMap';

export type NavigationStatus = 'pending' | 'found' | 'invalid' | 'unreachable' | 'budgetExceeded' | 'cancelled';
export interface NavigationResult { status: NavigationStatus; path: Point[]; revision: number; radius: number; expanded: number; }
export interface NavigationRequest { id: string; start: Point; goal: Point; radius: number; priority?: number; }
export interface NavigationLimits { starts: number; active: number; nodes: number; slice: number; searchNodes: number; }
export const DEFAULT_NAVIGATION_LIMITS: Readonly<NavigationLimits> = Object.freeze({ starts: 2, active: 4, nodes: 512, slice: 128, searchNodes: 10000 });
interface OpenNode { key: number; g: number; f: number; order: number; }
/** Stable binary heap, duplicate records are discarded against best g on pop. */
class Heap {
  private nodes: OpenNode[] = [];
  get length(): number { return this.nodes.length; }
  get first(): OpenNode | undefined { return this.nodes[0]; }
  private less(a: OpenNode, b: OpenNode): boolean { return a.f < b.f || (a.f === b.f && a.order < b.order); }
  push(n: OpenNode): void {
    let i = this.nodes.length; this.nodes.push(n);
    while (i) { const parent = (i - 1) >> 1; if (!this.less(n, this.nodes[parent])) break; this.nodes[i] = this.nodes[parent]; i = parent; }
    this.nodes[i] = n;
  }
  pop(): OpenNode {
    const first = this.nodes[0], last = this.nodes.pop()!;
    if (this.nodes.length) {
      let i = 0;
      while (i * 2 + 1 < this.nodes.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.nodes.length && this.less(this.nodes[child + 1], this.nodes[child])) child++;
        if (!this.less(this.nodes[child], last)) break;
        this.nodes[i] = this.nodes[child]; i = child;
      }
      this.nodes[i] = last;
    }
    return first;
  }
}
interface Job {
  request: NavigationRequest; grid: NavigationGrid; result: NavigationResult; age: number;
  open: Heap; g: Map<number, number>; parent: Map<number, number>; closed: Set<number>;
  goals: { point: Point; connections: Map<number, number> }[]; order: number;
  alternatives: Point[]; best?: { key: number; goal: Point; cost: number };
}

export class NavigationScheduler {
  private grids = new Map<number, NavigationGrid>();
  private jobs = new Map<string, Job>();
  private queued: Job[] = [];
  private active: Job[] = [];
  private accumulator = 0;
  private tick = 0;
  private rotation = 0;
  readonly stats = { ticks: 0, started: 0, expanded: 0, lastExpanded: 0, lastStarted: 0, active: 0, queued: 0, maxWaitSeconds: 0 };
  constructor(readonly map: TileMap, readonly limits: Readonly<NavigationLimits> = DEFAULT_NAVIGATION_LIMITS) {
    if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('非法导航预算');
  }
  grid(radius: number): NavigationGrid {
    let grid = this.grids.get(radius);
    if (!grid?.valid()) { grid = new NavigationGrid(this.map, radius); this.grids.set(radius, grid); }
    return grid;
  }
  request(request: NavigationRequest): NavigationResult {
    const old = this.jobs.get(request.id);
    if (old?.result.status === 'pending' && old.grid.valid() && old.request.radius === request.radius && distance(old.request.goal, request.goal) < 25) return old.result;
    const age = old?.result.status === 'pending' ? old.age : this.tick;
    this.cancel(request.id);
    const result: NavigationResult = { status: 'pending', path: [], radius: request.radius, revision: this.map.getNavigationRevision(), expanded: 0 };
    if (!Number.isFinite(request.radius) || request.radius <= 0 || ![request.start.x, request.start.y, request.goal.x, request.goal.y].every(Number.isFinite)) { result.status = 'invalid'; return result; }
    const grid = this.grid(request.radius);
    const job: Job = { request: { ...request, start: { ...request.start }, goal: { ...request.goal } }, grid, result, age,
      open: new Heap(), g: new Map(), parent: new Map(), closed: new Set(), goals: [], alternatives: [], order: 0 };
    this.jobs.set(request.id, job); this.queued.push(job);
    return result;
  }
  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (job?.result.status === 'pending') job.result.status = 'cancelled';
    this.jobs.delete(id);
    this.queued = this.queued.filter(j => j !== job); this.active = this.active.filter(j => j !== job);
  }
  clear(): void { for (const id of [...this.jobs.keys()]) this.cancel(id); this.grids.clear(); this.accumulator = 0; }
  get(id: string): NavigationResult | undefined { return this.jobs.get(id)?.result; }
  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.accumulator += delta;
    // Main loop already caps effective delta. At most 8 ticks for direct large-delta callers.
    for (let i = 0; this.accumulator + 1e-9 >= 1 / 30 && i < 8; i++) { this.accumulator -= 1 / 30; this.step(); }
  }
  private finish(job: Job, status: NavigationStatus, path: Point[] = []): void { job.result.status = status; job.result.path = path; }
  private step(): void {
    this.tick++; this.stats.ticks++;
    for (const job of this.jobs.values()) if (job.result.status === 'pending' && !job.grid.valid()) this.finish(job, 'cancelled');
    this.active = this.active.filter(j => j.result.status === 'pending');
    this.queued = this.queued.filter(j => j.result.status === 'pending');
    this.queued.sort((a, b) => ((b.request.priority ?? 0) + (this.tick - b.age) / 30) - ((a.request.priority ?? 0) + (this.tick - a.age) / 30) || a.age - b.age || a.request.id.localeCompare(b.request.id));
    let starts = 0;
    while (starts < this.limits.starts && this.active.length < this.limits.active && this.queued.length) {
      const job = this.queued.shift()!; starts++;
      this.stats.maxWaitSeconds = Math.max(this.stats.maxWaitSeconds, (this.tick - job.age) / 30);
      this.initialize(job);
      if (job.result.status === 'pending') this.active.push(job);
    }
    let remaining = this.limits.nodes, expanded = 0;
    let stalled = 0;
    while (remaining > 0 && this.active.length && stalled < this.active.length) {
      this.rotation %= this.active.length;
      const job = this.active[this.rotation++];
      const used = this.expand(job, Math.min(this.limits.slice, remaining));
      remaining -= used; expanded += used;
      if (!used) stalled++; else stalled = 0;
      this.active = this.active.filter(j => j.result.status === 'pending');
    }
    this.stats.started += starts; this.stats.expanded += expanded;
    this.stats.lastStarted = starts; this.stats.lastExpanded = expanded;
    this.stats.active = this.active.length; this.stats.queued = this.queued.length;
  }
  private initialize(job: Job): void {
    const { start, goal } = job.request, grid = job.grid;
    if (goal.x < 0 || goal.y < 0 || goal.x > this.map.width * this.map.tileSize || goal.y > this.map.height * this.map.tileSize || !grid.walkable(start)) { this.finish(job, 'invalid'); return; }
    const direct = grid.segmentCost(start, goal);
    if (Number.isFinite(direct) && direct <= distance(start, goal) * (1 + 1e-6)) { this.finish(job, 'found', [{ ...start }, { ...goal }]); return; }
    job.alternatives = grid.goalCandidates(goal);
    this.startCandidate(job);
  }
  private startCandidate(job: Job): void {
    const point = job.alternatives.shift();
    if (!point) { this.finish(job, 'unreachable'); return; }
    const grid = job.grid, start = job.request.start;
    job.open = new Heap(); job.g.clear(); job.parent.clear(); job.closed.clear(); job.best = undefined;
    job.goals = [{ point, connections: new Map(grid.connections(point).map(c => [c.point.key, c.cost])) }];
    for (const c of grid.connections(start)) {
      job.g.set(c.point.key, c.cost);
      job.open.push({ key: c.point.key, g: c.cost, f: c.cost + this.heuristic(job, c.point), order: job.order++ });
    }
    if (!job.open.length) this.finish(job, 'unreachable');
  }
  private heuristic(job: Job, p: Point): number {
    // Octile is admissible on the grid. Subtract one tile for arbitrary endpoint connections.
    return Math.max(0, Math.min(...job.goals.map(g => {
      const dx = Math.abs(p.x - g.point.x), dy = Math.abs(p.y - g.point.y);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    })) - job.grid.map.tileSize);
  }
  private expand(job: Job, quota: number): number {
    let used = 0;
    while (used < quota && job.open.length) {
      if (job.best && job.open.first!.f >= job.best.cost - 1e-9) { this.finishPath(job); return used; }
      const node = job.open.pop();
      if (job.closed.has(node.key) || node.g !== job.g.get(node.key)) continue;
      job.closed.add(node.key); used++; job.result.expanded++;
      const reached = job.goals.find(g => g.connections.has(node.key));
      if (reached) {
        const cost = node.g + reached.connections.get(node.key)!;
        if (cost < (job.best?.cost ?? Infinity)) job.best = { key: node.key, goal: reached.point, cost };
      }
      if (job.result.expanded >= this.limits.searchNodes) { this.finish(job, 'budgetExceeded'); return used; }
      for (const edge of job.grid.neighbors(job.grid.point(node.key))) {
        const g = node.g + edge.cost;
        if (g + 1e-9 >= (job.g.get(edge.point.key) ?? Infinity)) continue;
        job.g.set(edge.point.key, g); job.parent.set(edge.point.key, node.key);
        job.open.push({ key: edge.point.key, g, f: g + this.heuristic(job, edge.point), order: job.order++ });
      }
    }
    if (!job.open.length && job.result.status === 'pending') {
      if (job.best) this.finishPath(job);
      else if (job.alternatives.length) this.startCandidate(job);
      else this.finish(job, 'unreachable');
    }
    return used;
  }
  private finishPath(job: Job): void {
    const path: Point[] = [job.best!.goal]; let key: number | undefined = job.best!.key;
    while (key !== undefined) { path.push(job.grid.point(key)); key = job.parent.get(key); }
    path.push(job.request.start); path.reverse();
    this.finish(job, 'found', job.grid.smooth(path));
  }
}
