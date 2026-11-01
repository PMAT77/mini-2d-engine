import type { Input } from '../core/Input';
import type { NoiseEvent, NoiseSystem } from '../core/NoiseSystem';
import type { TileMap } from '../map/TileMap';
import { seededRandom } from '../map/WaterTerrain';
import type { Point } from '../physics/Collider';
import { ActorCollisionWorld } from '../physics/ActorCollisionWorld';
import { NavigationScheduler } from '../navigation/NavigationScheduler';
import type { NavigationResult } from '../navigation/NavigationScheduler';
import { VisionSensor } from '../ai/VisionSensor';
import { HearingSensor } from '../ai/HearingSensor';
import type { PerceptionLight } from '../vision/VisionTypes';
import { Zombie } from './Zombie';
import { ZombieBehavior } from './ZombieBehavior';
import { ZOMBIE_CONFIG } from './ZombieConfig';
import type { ZombieKind } from './ZombieConfig';
import { EncounterSpawning } from './EncounterSpawning';
import type { SpawnReport } from './EncounterSpawning';
import type { BulletImpact, DeathFinished, HitResult } from '../combat/CombatTypes';
import { sectorIntersectsCircle } from './MeleeAttackController';
import type { AttackMoment } from './MeleeAttackController';
import { hasLineOfSight } from '../vision/SightGeometry';
import type { Player } from '../objects/Player';
import type { PlayerDamageResult } from '../combat/PlayerDamage';

interface EnemyRecord {
  zombie: Zombie; behavior: ZombieBehavior; vision: VisionSensor; hearing: HearingSensor; random: () => number;
  result?: NavigationResult; adopted?: NavigationResult; path: Point[]; pathIndex: number;
  requestedGoal: Point | null; replanLeft: number; targetAlive: boolean;
  stepDistance: number; groanLeft: number;
}
export interface EnemyContext {
  target: Point & { alive: boolean; radius: number; emittingLightId?: string };
  lights: readonly PerceptionLight[]; playerNoises: readonly NoiseEvent[];
}
const idleInput = { isKeyDown: () => false } as unknown as Input;
const clock = (): number => typeof performance === 'undefined' ? 0 : performance.now();
export function selectPlayerNoises(events: readonly NoiseEvent[]): readonly NoiseEvent[] {
  return events.filter(e => e.sourceId === 'player' && ['footstep', 'waterStep', 'roll', 'gunshot', 'impact', 'mining'].includes(e.kind));
}

export class EnemySystem {
  private time = 0;
  private intents: (AttackMoment & { zombie: Zombie })[] = [];
  readonly navigation: NavigationScheduler;
  private records: EnemyRecord[] = [];
  private nextId = 0;
  private deathEvents: DeathFinished[] = [];
  readonly spawnReports: SpawnReport[] = [];
  readonly metrics = { perceptionMs: 0, navigationMs: 0, movementMs: 0 };
  constructor(readonly map: TileMap, private readonly actors: ActorCollisionWorld, private readonly seed: number, private readonly noises?: NoiseSystem) {
    this.navigation = new NavigationScheduler(map);
  }
  get zombies(): readonly Zombie[] { return this.records.map(r => r.zombie); }
  add(kind: ZombieKind, center: Point, facing = 0): Zombie {
    const id = `zombie-${++this.nextId}`, config = ZOMBIE_CONFIG[kind], random = seededRandom((this.seed ^ Math.imul(this.nextId, 0x9e3779b1)) >>> 0);
    const zombie = new Zombie(id, center.x - config.size / 2, center.y - config.size / 2, config, facing);
    this.actors.register(id, zombie);
    zombie.setMotionResolver((body, move, angle) => this.actors.resolve(id, body, move, angle));
    this.records.push({ zombie, behavior: new ZombieBehavior(config, random), vision: new VisionSensor(config.senses), hearing: new HearingSensor(config.senses),
      random, path: [], pathIndex: 0, requestedGoal: null, replanLeft: 0, targetAlive: true, stepDistance: 0, groanLeft: 4 + random() * 6 });
    return zombie;
  }
  spawn(counts: { shambler?: number; runner?: number }, origin: Point): void {
    const spawner = new EncounterSpawning(this.map, origin, seededRandom(this.seed ^ 0x73706177));
    const occupied = [{ center: origin, radius: 25 }];
    for (const kind of ['shambler', 'runner'] as const) {
      const requested = counts[kind] ?? 2;
      if (!Number.isSafeInteger(requested) || requested < 0 || requested > 1000) throw new Error('遭遇数量必须为 0–1000 的整数');
      let spawned = 0;
      for (let i = 0; i < requested; i++) {
        const radius = ZOMBIE_CONFIG[kind].size / 2, p = spawner.find(radius, 350, 900, occupied);
        if (!p) continue;
        this.add(kind, p, seededRandom(this.seed + this.nextId)() * Math.PI * 2);
        occupied.push({ center: p, radius }); spawned++;
      }
      const skipped = requested - spawned;
      this.spawnReports.push({ kind, requested, spawned, skipped, ...(skipped ? { reason: '200 次候选中没有干地、连通且无严重重叠的位置' } : {}) });
    }
  }
  receiveHit(zombie: Zombie, impact: BulletImpact): HitResult {
    const result = zombie.receiveHit(impact, {
      getShapeSpeedFactor: body => this.map.getShapeSpeedFactor(body),
      resolveMotion: (body, move, rotation = 0) => this.actors.resolve(zombie.id, body, move, rotation),
    });
    if (!zombie.isAlive()) this.navigation.cancel(zombie.id);
    return result;
  }
  findBySoundId(id?: string): Zombie | undefined { return this.records.find(r => r.zombie.id === id)?.zombie; }
  update(delta: number, context: EnemyContext): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.time += delta; this.intents = [];
    const start = clock();
    for (const r of this.records) {
      const z = r.zombie; r.replanLeft = Math.max(0, r.replanLeft - delta);
      if (!z.isAlive()) { this.navigation.cancel(z.id); continue; }
      const center = z.getCenter();
      if (!context.target.alive && r.targetAlive) { r.behavior.clearTarget(); r.vision.reset(); r.hearing.reset(); r.path = []; this.navigation.cancel(z.id); }
      r.targetAlive = context.target.alive;
      const sight = context.target.alive ? r.vision.sense(delta, this.map, { ...center, facing: z.getFacingDirection() }, context.target, context.lights) : null;
      const heard = context.target.alive ? r.hearing.poll(this.map, { id: z.id, ...center }, context.playerNoises)[0] : null;
      r.behavior.update(delta, center, sight?.visible ? context.target : null, heard ?? null);
      const moment = z.attack.advance(this.time);
      if (moment && !z.isStunned() && context.target.alive) this.intents.push({ ...moment, zombie: z });
      if (context.target.alive && sight?.visible && !z.isStunned() && z.attack.canStart(this.time) &&
        sectorIntersectsCircle(center, z.getFacingDirection(), z.config.attackRadius, z.config.attackHalfAngle, context.target, context.target.radius) &&
        hasLineOfSight(this.map, center.x, center.y, context.target.x, context.target.y)) {
        if (z.attack.start(this.time, z.getFacingDirection())) this.noises?.emit('zombieAttack', center.x, center.y, { sourceId: z.id });
      }
      if (!context.target.alive) z.attack.cancel();
      if (z.isStunned() || z.attack.isBusy(this.time)) { z.stopMovement(); continue; }
      const goal = r.behavior.getGoal();
      if (!goal) { z.setMovement({ x: 0, y: 0 }, false); continue; }
      const grid = this.navigation.grid(z.getSize() / 2);
      if (r.result && (r.result.revision !== this.map.getNavigationRevision() || r.result.radius !== z.getSize() / 2)) {
        this.navigation.cancel(z.id); r.result = undefined; r.adopted = undefined; r.path = []; r.replanLeft = 0;
      }
      if (r.result?.status === 'found' && r.result !== r.adopted) { r.path = r.result.path; r.pathIndex = 1; r.adopted = r.result; }
      if (r.result && ['invalid', 'unreachable', 'budgetExceeded', 'cancelled'].includes(r.result.status) && r.result !== r.adopted) {
        r.adopted = r.result; r.path = []; r.replanLeft = 1;
        if (r.behavior.getState() === 'wander' || r.behavior.getState() === 'search') r.behavior.rejectGoal();
      }
      const movedGoal = !r.requestedGoal || Math.hypot(goal.x - r.requestedGoal.x, goal.y - r.requestedGoal.y) >= 25;
      if (r.replanLeft <= 0 && (r.result?.status === 'pending' ? movedGoal : !r.path.length || movedGoal)) {
        r.result = this.navigation.request({ id: z.id, start: center, goal, radius: z.getSize() / 2,
          priority: r.behavior.getState() === 'chase' ? (r.path.length ? 1 : 3) : 0 });
        r.requestedGoal = goal; r.replanLeft = .45;
      }
      // A cached segment is verified again before it can produce any translation.
      while (r.pathIndex < r.path.length && Math.hypot(r.path[r.pathIndex].x - center.x, r.path[r.pathIndex].y - center.y) < 8) r.pathIndex++;
      const next = r.path[r.pathIndex];
      if (next && Number.isFinite(grid.segmentCost(center, next))) {
        const dx = next.x - center.x, dy = next.y - center.y, length = Math.hypot(dx, dy);
        z.setMovement({ x: dx / Math.max(1e-9, length), y: dy / Math.max(1e-9, length) }, r.behavior.getState() === 'chase');
      } else {
        z.setMovement({ x: 0, y: 0 }, false);
        if (next) { r.path = []; r.replanLeft = Math.min(r.replanLeft, .15); }
      }
    }
    const navStart = clock(); this.metrics.perceptionMs = navStart - start;
    this.navigation.update(delta);
    const moveStart = clock(); this.metrics.navigationMs = moveStart - navStart;
    for (const r of this.records) {
      const before = r.zombie.getCenter();
      r.zombie.update(delta, idleInput, this.map);
      if (r.zombie.isAlive()) {
        const after = r.zombie.getCenter();
        r.stepDistance += Math.hypot(after.x - before.x, after.y - before.y);
        if (r.stepDistance >= 28 && r.zombie.getVelocity().length() > 1) {
          r.stepDistance %= 28; this.noises?.emit('zombieStep', after.x, after.y, { sourceId: r.zombie.id });
        }
        r.groanLeft -= delta;
        if (r.groanLeft <= 0) { r.groanLeft = 4 + r.random() * 6; this.noises?.emit('zombieGroan', after.x, after.y, { sourceId: r.zombie.id }); }
      }
      const death = r.zombie.consumeDeathFinished();
      if (death) { this.deathEvents.push(death); this.actors.unregister(r.zombie.id); this.navigation.cancel(r.zombie.id); }
    }
    this.records = this.records.filter(r => r.zombie.getLifeState() !== 'removed');
    this.actors.separate(); this.metrics.movementMs = clock() - moveStart;
  }
  consumeDeaths(): DeathFinished[] { const events = this.deathEvents; this.deathEvents = []; return events; }
  settleAttacks(player: Player, onHit?: (result: PlayerDamageResult, zombie: Zombie, attackId: string, random: () => number) => void): void {
    this.intents.sort((a, b) => a.occurredAt - b.occurredAt || a.attackId.localeCompare(b.attackId));
    for (const intent of this.intents) {
      const z = intent.zombie;
      if (!z.isAlive() || z.isStunned() || !z.attack.isValid(intent.attackId) || !player.isAlive()) continue;
      const origin = z.getCenter(), body = player.getCollider();
      if (!sectorIntersectsCircle(origin, intent.facing, z.config.attackRadius, z.config.attackHalfAngle, body.pose, body.radius) ||
        !hasLineOfSight(this.map, origin.x, origin.y, body.pose.x, body.pose.y)) continue;
      const result = player.applyDamage({ kind: 'melee', amount: z.config.damage, sourceId: z.id, attackId: intent.attackId });
      const r = this.records.find(r => r.zombie === z);
      if (r) onHit?.(result, z, intent.attackId, r.random);
    }
    this.intents = [];
    if (!player.isAlive()) this.forgetPlayer();
  }
  private forgetPlayer(): void {
    for (const r of this.records) if (r.targetAlive) {
      r.targetAlive = false; r.behavior.clearTarget(); r.vision.reset(); r.hearing.reset(); r.zombie.attack.cancel(); r.path = [];
      this.navigation.cancel(r.zombie.id);
    }
  }
  snapshot() {
    return this.records.map(r => ({ id: r.zombie.id, kind: r.zombie.config.kind, ...r.zombie.getCenter(), life: r.zombie.getLifeState(), health: r.zombie.getHealth(),
      state: r.behavior.getState(), action: r.zombie.getActionState(), memory: r.behavior.memory.snapshot(), goal: r.behavior.getGoal(), path: r.path.map(p => ({ ...p })), navigation: r.result?.status ?? null }));
  }
  dispose(): void { for (const r of this.records) this.actors.unregister(r.zombie.id); this.records = []; this.deathEvents = []; this.intents = []; this.navigation.clear(); }
}
