import { transformCollider } from "../physics/Collider";
import type { Collider, Contact, Point } from "../physics/Collider";
import type { MotionResult } from "../physics/Motion";
import type { BulletImpact, KnockbackProfile } from "./CombatTypes";
import { computeKnockbackSpeed, validateKnockbackProfile } from "./KnockbackProfiles";

/**
 * 击退运动层。
 *
 * 它只拥有「击退速度」这一份独立状态：不读取也不写入宿主的普通移动速度，
 * 也不调用 Entities.moveAndRotate（那条路径会把位移投影回普通速度）。
 * 每次子步都通过地图的 resolveMotion 求合法位姿，再直接写回宿主的 x/y。
 */

/** 击退需要的地图能力；TileMap 天然满足。 */
export interface KnockbackWorld {
  getShapeSpeedFactor(collider: Collider): number;
  resolveMotion(collider: Collider, movement: Point, rotation?: number): MotionResult;
}

/** 被击退的宿主：只暴露位置、尺寸与当前碰撞体。 */
export interface KnockbackHost {
  x: number;
  y: number;
  getSize(): number;
  getCollider(): Collider;
}

/** 子步上限：60Hz 下约 2 子步，144Hz 下 1 子步。 */
export const KNOCKBACK_MAX_SUBSTEP_SECONDS = 1 / 120;
/** 单个子步的最大期望位移；保证贴墙时不会整帧跳过一堵薄墙。 */
export const KNOCKBACK_MAX_SUBSTEP_DISTANCE = 2;
/** 单帧子步上限，防止 update(大数) 把逻辑拖死。 */
export const KNOCKBACK_MAX_SUBSTEPS = 240;
/** 单帧最多推进的时间；更长的 delta 会被截断，避免一次更新跨越整段地图。 */
const MAX_DELTA_SECONDS = 0.5;
const DRY_TOLERANCE = 1e-6;
const TINY = 1e-9;

const finitePose = (pose: { x: number; y: number }): boolean => Number.isFinite(pose.x) && Number.isFinite(pose.y);

/**
 * 一个目标的击退状态机。
 *
 * 速度按指数阻尼积分：`v(t+dt) = v(t) * e^(-k*dt)`，位移取解析积分
 * `v(t) * (1 - e^(-k*dt)) / k`，因此 30/60/144 FPS 的终点一致。
 */
export class KnockbackMotion {
  private readonly profile: KnockbackProfile;
  private vx = 0;
  private vy = 0;
  private elapsedSeconds = 0;
  private active = false;
  private lastAppliedSpeed = 0;

  constructor(private readonly host: KnockbackHost, private readonly world: KnockbackWorld, profile: KnockbackProfile) {
    this.profile = validateKnockbackProfile(profile);
    const size = host.getSize();
    if (!Number.isFinite(size) || size <= 0) throw new Error("无效击退宿主: 尺寸必须是正有限数值");
  }

  /**
   * 叠加一次真实命中的击退冲量。
   *
   * 连射会在同一速度矢量上累加，总量按 maxSpeed 裁剪；方向来自命中瞬间的弹道，
   * 不接受准星位置等外部参数。
   */
  addImpact(impact: BulletImpact, lethal = false): number {
    const speed = computeKnockbackSpeed(impact, this.profile, lethal);
    if (!(speed > 0)) return 0;
    const length = Math.hypot(impact.direction.x, impact.direction.y);
    if (!Number.isFinite(length) || length <= TINY) return 0;
    this.vx += (impact.direction.x / length) * speed;
    this.vy += (impact.direction.y / length) * speed;
    this.clampVelocity();
    this.lastAppliedSpeed = speed;
    this.active = this.getSpeed() > this.profile.stopSpeed;
    return speed;
  }

  /** 推进击退；非法 delta 直接忽略，长帧被截断并拆成有上限的子步。 */
  update(delta: number): void {
    if (!this.active) return;
    if (!Number.isFinite(delta) || delta <= 0) return;
    const seconds = Math.min(delta, MAX_DELTA_SECONDS);
    const speed = this.getSpeed();
    if (!(speed > this.profile.stopSpeed)) { this.stop(); return; }
    const steps = Math.min(
      KNOCKBACK_MAX_SUBSTEPS,
      Math.max(
        1,
        Math.ceil(seconds / KNOCKBACK_MAX_SUBSTEP_SECONDS),
        Math.ceil((speed * seconds) / KNOCKBACK_MAX_SUBSTEP_DISTANCE),
      ),
    );
    const stepSeconds = seconds / steps;
    const decay = Math.exp(-this.profile.damping * stepSeconds);
    const travel = (1 - decay) / this.profile.damping;
    for (let i = 0; i < steps; i++) {
      if (this.integrate(stepSeconds, decay, travel)) return;
    }
    if (this.getSpeed() <= this.profile.stopSpeed) this.stop();
  }

  getSpeed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  getVelocity(): Point {
    return { x: this.vx, y: this.vy };
  }

  isActive(): boolean {
    return this.active;
  }

  getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  getProfile(): KnockbackProfile {
    return this.profile;
  }

  getLastAppliedSpeed(): number {
    return this.lastAppliedSpeed;
  }

  stop(): void {
    this.vx = 0;
    this.vy = 0;
    this.active = false;
  }

  /** 返回 true 表示本帧提前停止。 */
  private integrate(stepSeconds: number, decay: number, travel: number): boolean {
    if (!(this.getSpeed() > this.profile.stopSpeed)) { this.stop(); return true; }
    const move = { x: this.vx * travel, y: this.vy * travel };
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) { this.stop(); return true; }
    const collider = this.host.getCollider();
    if (!collider || !finitePose(collider.pose)) { this.stop(); return true; }
    // 先在不移动宿主的前提下求「停在干地上」的最大位移比例，禁止先漂到水里再拉回。
    const dryFraction = this.dryFraction(collider, move);
    if (!(dryFraction > TINY)) { this.stop(); return true; }
    const allowed = dryFraction >= 1 ? move : { x: move.x * dryFraction, y: move.y * dryFraction };
    const result = this.world.resolveMotion(collider, allowed, 0);
    if (!result || result.exhausted || !finitePose(result.collider.pose)) { this.stop(); return true; }
    // resolveMotion 的贴墙修正也不允许把碰撞体带进水面。
    if (!this.isDry(result.collider)) { this.stop(); return true; }
    // 零法线（cast 迭代耗尽）与非法法线都按保守停止处理，先不落位姿。
    if (!this.projectVelocity(result.contacts)) { this.stop(); return true; }
    this.applyCenter(result.collider.pose.x, result.collider.pose.y);
    this.vx *= decay;
    this.vy *= decay;
    this.elapsedSeconds += stepSeconds;
    if (dryFraction < 1) { this.stop(); return true; }
    if (this.getSpeed() <= this.profile.stopSpeed) { this.stop(); return true; }
    return false;
  }

  private clampVelocity(): void {
    const speed = this.getSpeed();
    if (speed > this.profile.maxSpeed && speed > TINY) {
      const scale = this.profile.maxSpeed / speed;
      this.vx *= scale;
      this.vy *= scale;
    }
  }

  private applyCenter(centerX: number, centerY: number): void {
    const half = this.host.getSize() / 2;
    this.host.x = centerX - half;
    this.host.y = centerY - half;
  }

  /** 去掉击退速度中指向障碍内部的分量，保留沿墙滑动。 */
  private projectVelocity(contacts: readonly Contact[]): boolean {
    for (const contact of contacts) {
      const length = Math.hypot(contact.normal.x, contact.normal.y);
      if (!Number.isFinite(length) || length <= TINY) return false;
      const nx = contact.normal.x / length;
      const ny = contact.normal.y / length;
      const inward = this.vx * nx + this.vy * ny;
      if (inward < 0) {
        this.vx -= nx * inward;
        this.vy -= ny * inward;
      }
    }
    return true;
  }

  private dryFraction(collider: Collider, move: Point): number {
    if (this.isDry(this.translate(collider, move.x, move.y))) return 1;
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (this.isDry(this.translate(collider, move.x * mid, move.y * mid))) low = mid;
      else high = mid;
    }
    return low;
  }

  private isDry(collider: Collider): boolean {
    const factor = this.world.getShapeSpeedFactor(collider);
    return Number.isFinite(factor) && Math.abs(factor - 1) <= DRY_TOLERANCE;
  }

  private translate(collider: Collider, dx: number, dy: number): Collider {
    return transformCollider(collider.compiled, { ...collider.pose, x: collider.pose.x + dx, y: collider.pose.y + dy });
  }
}
