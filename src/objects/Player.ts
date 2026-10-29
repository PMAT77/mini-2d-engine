import { Input } from "../core/Input";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { IdleState } from "../status/IdleState";
import { MovingState } from "../status/MovingState";
import { ShootingState } from "../status/ShootingState";
import { StateMachine } from "../status/StateMachine";
import { Bullet, BulletEntityHitTest } from "./Bullet";
import { Entities } from "./Entities";
import { ParticleSystem } from "./ParticleSystem";
import { DEFAULT_BALLISTICS, DEFAULT_MOVEMENT, DEFAULT_SPRINT, DEFAULT_BULLET_WATER_DRAG, parsePlayerCollider, parsePlayerConfig, PlayerConfig } from "./PlayerConfig";
import { ColliderShape } from "../physics/Collider";
import type { VisionState } from "../core/VisibilitySystem";
import type { FootstepEvent } from "./FootprintSystem";

const WADING_COLORS = [[98, 186, 255], [177, 143, 178], [255, 100, 100], [255, 64, 64]];
/** 脚印步距（世界像素），按实际位移累计而不是按时间。 */
const FOOTSTEP_STRIDE = 26;
/** 离水后继续留下湿脚印的时长（秒）。 */
const FOOTSTEP_WET_SECONDS = 1.5;
/** 单帧最多补发的脚印数，避免长帧后一次爆发。 */
const FOOTSTEP_MAX_PER_FRAME = 8;
/** 跑步摇摆的最大速度权重，与疾跑倍率一致，避免移速增益叠加后失控。 */
const RUN_SWAY_MAX_WEIGHT = 1.6;
/** 双手前后摆动的幅度相对整体摇摆的比例。 */
const RUN_SWAY_HAND_SCALE = 0.75;
/** 双手滞后头部的相位（弧度），让手臂有一点跟随感。 */
const RUN_SWAY_HAND_LAG = 0.5;
/** 头部摇摆相对整体摇摆的比例；行走与奔跑都只保留轻微晃动。 */
const RUN_SWAY_HEAD_SCALE = 0.5;

export interface PlayerAimInput {
  target: { x: number; y: number };
  fire: boolean;
  face: boolean;
}

export interface PlayerDebugValues {
  health?: number;
  stamina?: number;
  magazineAmmo?: number;
  chambered?: boolean;
  reloadProgress?: number;
}

/**
 * 玩家类 - 处理玩家的移动、射击和状态管理
 */
export class Player extends Entities {
  protected maxSpeed = 200;
  public setCollider(shape: ColliderShape): void { super.setCollider(parsePlayerCollider(shape)); }
  protected getBodyRotation(): number { return this.currentRotation - Math.PI / 2; }
  private health = 100;
  private maxHealth = 100;
  private gold = 0;
  private meat = 0;

  getGold(): number { return this.gold; }
  collectGold(): void { this.gold++; }
  getMeat(): number { return this.meat; }
  collectMeat(): void { this.meat++; }

  private movement = { ...DEFAULT_MOVEMENT };
  private sprint = { ...DEFAULT_SPRINT };
  private movementTime = 0;
  private movementDirection = new Vector2();
  private stopTime = 0;
  private stopDuration = 0;
  private stopVelocity = new Vector2();
  private stamina = DEFAULT_SPRINT.maxStamina;
  private sprinting = false;
  private sprintTime = 0;
  private exhausted = false;
  private releasedAfterExhaustion = false;
  private staminaRegenDelay = 0;
  private trailDistance = 0;
  private footstepDistance = 0;
  private footstepWetTimer = 0;
  private footstepWaterDepth = 0;
  private onFootstepCallback?: (step: FootstepEvent) => void;
  private wadingMap?: TileMap;
  private wadingAlpha = 0;
  private wadingColor = 'rgb(98, 186, 255)';
  private wadingCanvas?: HTMLCanvasElement;

  getStamina(): number { return this.stamina; }
  getMaxStamina(): number { return this.sprint.maxStamina; }
  getIsSprinting(): boolean { return this.sprinting; }
  /** 身体是否接触水体（任何水深，含岸边的一点重叠）；脚印湿度与涉水音效共用。 */
  isInWater(): boolean { return this.terrainWaterCoverage.fraction > 1e-6; }
  /** 刚出水的湿身计时中：脚步仍是湿身的踩踏声，干地的循环脚步该让位。 */
  isFootWet(): boolean { return this.footstepWetTimer > 0; }

  getHealth(): number { return this.health; }
  getMaxHealth(): number { return this.maxHealth; }
  takeDamage(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("伤害必须是非负有限数值");
    this.health = Math.max(0, this.health - amount);
    this.onStatsChangeCallback?.();
  }
  heal(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("回血量必须是非负有限数值");
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.onStatsChangeCallback?.();
  }
  // 动画相关属性
  private idleTime: number = 0; // 玩家待机状态的计时器
  private walkTime: number = 0; // 玩家移动状态的计时器
  private scale: number = 1; // 玩家缩放比例
  private breathingAmplitude: number = 3; // 呼吸动画振幅
  private breathingSpeed: number = 2; // 呼吸动画速度
  private runSwayAmplitude: number = 2.5; // 跑步摇摆幅度，占 size 的百分比
  private runSwaySpeed: number = 10; // 基础移速下的摇摆角速度（弧度/秒）
  private runSwayPhase: number = 0; // 跑步摇摆相位
  private runSwayWeight: number = 0; // 本帧实际移速权重，0–1.6

  // 射击相关属性
  private isShooting: boolean = false; // 玩家是否正在开火
  private ballistics = { ...DEFAULT_BALLISTICS };
  private pointerAim?: PlayerAimInput;
  private armLift = 0;
  private armAngle = -Math.PI;
  private armDistance = Infinity;
  private shotPoseTime = 0;
  private recoil = 0;
  /** 战争迷雾半径（世界像素）；手电筒的张角和距离固定，不受这里影响。 */
  private visionRange = 400;
  private timeSinceShot = Infinity;
  private bullets: Bullet[] = []; // 存储玩家发射的子弹

  private fireRate: number = 0.2; // 射速（秒/发）
  private fireCooldown: number = 0; // 开火冷却计时器（控制射速）

  private bulletSpeed: number = 2600; // 子弹速度
  private bulletWaterDrag = { ...DEFAULT_BULLET_WATER_DRAG };
  private damage = 10;

  // 弹药：初始武器是格罗特手枪，弹匣 6 发 + 膛内 1 发，备弹无限。
  private readonly weaponName = '格罗特手枪';
  private magazineSize: number = 6; // 弹匣容量（不含膛内那一发）
  private magazineAmmo: number = 6; // 弹匣内余弹
  private chambered: boolean = true; // 膛内是否还有一发
  /** 调试选项：打空最后一发时是否自动换弹。默认关闭，正常流程只能按 R 换弹。 */
  private autoReload: boolean = false;

  // 换弹：没有热量和过热，只有"打空 → 按 R 换弹"。
  private reloadDuration: number = 1.4; // 换弹时长（秒）
  private reloadRemaining: number = 0; // 换弹剩余时间（秒）
  private isReloading: boolean = false; // 是否正在换弹

  // 进度环可见性相关属性：只在换弹时显示
  private reloadBarAlpha: number = 0; // 进度环透明度（0-1）
  private fadeSpeed: number = 5; // 淡入淡出速度系数

  // 回调函数定义
  private onShootCallback?: (shootDir: Vector2) => void; // 射击回调，用于触发摄像机震动等效果
  private onBulletLandedCallback?: (x: number, y: number) => void; // 子弹自然停止回调，用于生成地面弹坑
  private onStatsChangeCallback?: () => void; // 属性变化回调
  private onReloadCallback?: () => void; // 换弹回调（开始换弹时触发，用于播放换弹音效）
  /** 场景提供的子弹可命中单位查询，发射时转发给每颗新子弹。 */
  private bulletEntityHitTest?: BulletEntityHitTest;

  // 状态机系统
  private stateMachine: StateMachine<Player>;

  // 粒子系统
  private particleSystem?: ParticleSystem;

  // 属性修改系统
  private modifiers: Map<string, { value: number; isMultiplier: boolean }> = new Map();

  /**
   * 构造函数
   * @param x 初始X坐标
   * @param y 初始Y坐标
   * @param sprite 玩家精灵图像
   * @param particleSystem 可选的粒子系统引用
   */
  constructor(
    x: number,
    y: number,
    sprite?: HTMLImageElement,
    particleSystem?: ParticleSystem
  ) {
    super(x, y, sprite);
    this.setCollider({ type: "circle", radius: 0.5 });

    // 初始化状态机
    this.stateMachine = new StateMachine<Player>(this);
    this.stateMachine.addState(IdleState);
    this.stateMachine.addState(MovingState);
    this.stateMachine.addState(ShootingState);
    this.stateMachine.changeState("idle"); // 默认进入空闲状态

    // 设置粒子系统
    this.particleSystem = particleSystem;
  }

  /**
   * 获取移动方向（基于WADS按键）
   * @param input 输入系统引用
   * @returns 归一化的移动方向向量
   */
  protected getMoveDirection(input: Input): Vector2 {
    const dir = new Vector2();
    if (input.isKeyDown("w")) dir.y -= 1;
    if (input.isKeyDown("s")) dir.y += 1;
    if (input.isKeyDown("a")) dir.x -= 1;
    if (input.isKeyDown("d")) dir.x += 1;

    // 归一化向量，确保多方向移动时速度一致
    if (dir.length() > 0) dir.normalize();
    return dir;
  }

  protected getMovementSpeed(): number {
    return this.getMaxSpeed() * (this.sprinting ? this.sprint.speedMultiplier : 1);
  }

  /** Smooth startup acceleration; angular damping does not slow turns or delay reversals. */
  protected updateVelocityNonlinear(targetVel: Vector2, dir: Vector2, delta: number): void {
    this.sprintTime = this.sprinting ? Math.min(this.sprint.rampDuration, this.sprintTime + delta) : 0;
    if (dir.length() === 0) {
      if (this.stopTime === 0) {
        this.stopVelocity = this.velocity.clone();
        // A quick tap must not receive the full sustained-movement braking tail.
        this.stopDuration = Math.min(this.movement.stopDuration, this.movementTime);
      }
      this.movementTime = 0;
      this.movementDirection.set(0, 0);
      this.stopTime = Math.min(this.stopDuration, this.stopTime + delta);
      const remaining = this.stopDuration - this.stopTime < 1e-9 ? 0 : 1 - this.stopTime / this.stopDuration;
      this.velocity = this.stopVelocity.clone().scale(remaining * remaining * (3 - 2 * remaining));
      return;
    }
    this.stopTime = 0;
    this.movementTime = Math.min(Math.max(this.movement.startupDuration, this.movement.stopDuration), this.movementTime + delta);
    const t = this.movement.startupDuration === 0 ? 1 : Math.min(1, this.movementTime / this.movement.startupDuration);
    const ratio = this.movement.startSpeedRatio + (1 - this.movement.startSpeedRatio) * t * t * (3 - 2 * t);
    const dot = this.movementDirection.x * dir.x + this.movementDirection.y * dir.y;
    if (this.movementDirection.length() === 0 || this.movement.turnDamping === 0 || dot < 0) {
      this.movementDirection = dir.clone();
    } else {
      const angle = Math.atan2(this.movementDirection.y, this.movementDirection.x);
      const turn = Math.atan2(this.movementDirection.x * dir.y - this.movementDirection.y * dir.x, dot);
      const next = angle + turn * (1 - Math.exp(-delta / this.movement.turnDamping));
      this.movementDirection.set(Math.cos(next), Math.sin(next));
    }
    // Smoothstep spreads the walk-to-sprint transition over time without affecting steering.
    const sprintProgress = this.sprint.rampDuration === 0 ? 1 : this.sprintTime / this.sprint.rampDuration;
    const blend = sprintProgress * sprintProgress * (3 - 2 * sprintProgress);
    const sprintRatio = this.sprinting ? (1 + (this.sprint.speedMultiplier - 1) * blend) / this.sprint.speedMultiplier : 1;
    this.velocity = this.movementDirection.clone().scale(targetVel.length() * ratio * sprintRatio);
  }

  private updateMovement(delta: number, input: Input, map?: TileMap): void {
    const shift = input.isKeyDown("Shift");
    const moving = this.getMoveDirection(input).length() > 0;
    if (!shift && this.exhausted) this.releasedAfterExhaustion = true;
    this.unlockSprint();
    this.sprinting = shift && moving && !this.exhausted && this.stamina > 0;

    // Split the movement when stamina runs out, so low FPS never grants free sprint time.
    const sprintDelta = this.sprinting ? Math.min(delta, this.stamina / this.sprint.drainPerSecond) : 0;
    let consumed = false;
    if (sprintDelta > 0) {
      const x = this.x, y = this.y;
      super.update(sprintDelta, input, map);
      const dx = this.x - x, dy = this.y - y;
      consumed = Math.hypot(dx, dy) > 0.001;
      if (consumed) {
        this.stamina = Math.max(0, this.stamina - sprintDelta * this.sprint.drainPerSecond);
        this.staminaRegenDelay = this.sprint.regenDelay;
        this.emitSprintTrail(x, y, dx, dy);
        if (this.stamina < 1e-8) {
          this.stamina = 0;
          this.exhausted = true;
          this.releasedAfterExhaustion = false;
        }
      }
      this.sprinting = consumed && !this.exhausted;
    }

    const remaining = delta - sprintDelta;
    if (remaining > 1e-9 || sprintDelta === 0) {
      this.sprinting = false;
      super.update(remaining, input, map);
    }
    if (!this.sprinting) { this.trailDistance = 0; this.sprintTime = 0; }
    if (this.exhausted) {
      const speed = this.getMaxSpeed() * (map?.getShapeSpeedFactor(this.getCollider()) ?? 1);
      if (this.velocity.length() > speed) this.velocity.scale(speed / this.velocity.length());
    }

    const restDelta = consumed ? remaining : delta;
    const regenDelta = Math.max(0, restDelta - this.staminaRegenDelay);
    this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - restDelta);
    this.stamina = Math.min(this.sprint.maxStamina, this.stamina + regenDelta * this.sprint.regenPerSecond);
    this.unlockSprint();
  }

  private unlockSprint(): void {
    if (this.exhausted && this.releasedAfterExhaustion && this.stamina >= this.sprint.maxStamina * this.sprint.restartThreshold) {
      this.exhausted = false;
    }
  }

  private emitSprintTrail(x: number, y: number, dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    this.trailDistance += distance;
    const count = Math.min(8, Math.floor(this.trailDistance / 24));
    this.trailDistance %= 24;
    for (let i = 0; i < count; i++) {
      const fraction = (i + 0.5) / count;
      this.particleSystem?.addParticle({
        x: x + dx * fraction + this.size / 2 - dx / distance * this.size * 0.35,
        y: y + dy * fraction + this.size / 2 - dy / distance * this.size * 0.35,
        size: 3, color: "#75dfe9", speed: 12, angle: Math.atan2(-dy, -dx), lifetime: 0.16,
      });
    }
  }

  /** 只要身体仍接触水体就刷新湿度；离水后短暂保留，让第一步就带出深色湿脚印。 */
  private updateFootstepWetness(delta: number): void {
    if (this.terrainWaterCoverage.fraction > 1e-6) {
      this.footstepWaterDepth = Math.max(this.footstepWaterDepth, this.terrainWaterCoverage.depth);
      this.footstepWetTimer = FOOTSTEP_WET_SECONDS;
      return;
    }
    if (this.footstepWetTimer <= 0) return;
    this.footstepWetTimer = Math.max(0, this.footstepWetTimer - delta);
    if (this.footstepWetTimer === 0) this.footstepWaterDepth = 0;
  }

  /** 按实际位移每跨过固定步距发出一个候选步点；水/墙上的落地校验由接收方完成。 */
  private emitFootsteps(startX: number, startY: number): void {
    const callback = this.onFootstepCallback;
    if (!callback) return;
    const fromX = startX + this.size / 2, fromY = startY + this.size / 2;
    const dx = this.x + this.size / 2 - fromX, dy = this.y + this.size / 2 - fromY;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance < 1e-6) return;
    // 调试跳坐标或长暂停后不绘制横跨地图的轨迹。
    if (distance > this.size * 4) { this.footstepDistance = 0; return; }

    const angle = Math.atan2(dy, dx);
    // 水中与刚出水的脚步声不同：前者是涉水，后者是湿身后的踩踏。
    const inWater = this.terrainWaterCoverage.fraction > 1e-6;
    // 深水（索引 2）已经不可快速通过，视为完全湿透；超深水不可进入，仅作上限保护。
    const wetness = this.footstepWetTimer > 0
      ? 0.35 + 0.65 * Math.min(1, this.footstepWaterDepth / 2) : 0;
    const travelled = FOOTSTEP_STRIDE - this.footstepDistance;
    for (let step = travelled, count = 0; step <= distance && count < FOOTSTEP_MAX_PER_FRAME;
      step += FOOTSTEP_STRIDE, count++) {
      const fraction = step / distance;
      callback({ x: fromX + dx * fraction, y: fromY + dy * fraction, angle, wetness, inWater });
    }
    this.footstepDistance = (this.footstepDistance + distance) % FOOTSTEP_STRIDE;
  }

  protected getLookDirection(_input?: Input): Vector2 {
    if (!this.pointerAim?.face) return new Vector2();
    return new Vector2(this.pointerAim.target.x - this.x - this.size / 2,
      this.pointerAim.target.y - this.y - this.size / 2);
  }

  /** 手电筒锥光固定 120°／400；`range` 是战争迷雾半径，可由调试面板调整。 */
  getVisionState(): Readonly<VisionState> {
    return { x: this.x + this.size / 2, y: this.y + this.size / 2,
      direction: this.currentRotation - Math.PI, range: this.visionRange };
  }

  /** 战争迷雾半径（世界像素），仅供调试面板调整；手电筒不受影响。 */
  getVisionRange(): number { return this.visionRange; }

  setVisionRange(range: number): void {
    if (!Number.isFinite(range) || range <= 0) throw new Error('视野半径必须是正有限数值');
    this.visionRange = range;
  }

  private updateAimPose(delta: number): void {
    this.shotPoseTime = Math.max(0, this.shotPoseTime - delta);
    const aim = this.pointerAim;
    const dx = aim ? aim.target.x - this.x - this.size / 2 : 0;
    const dy = aim ? aim.target.y - this.y - this.size / 2 : 0;
    const distance = Math.hypot(dx, dy);
    const raised = !!(aim?.face || aim?.fire || this.shotPoseTime > 0);
    this.armLift = Math.max(0, Math.min(1, this.armLift + (raised ? 1 : -1) * delta / .1));
    if ((aim?.face || aim?.fire) && distance > 1e-6) {
      this.armAngle = Math.atan2(dy, dx); this.armDistance = distance;
    }
  }

  /** 按本帧实际位移推进跑步摇摆；撞墙或站立时权重归零。 */
  private updateRunSway(delta: number, startX: number, startY: number): void {
    if (delta <= 0) return;
    const maxSpeed = this.getMaxSpeed();
    const travel = Math.hypot(this.x - startX, this.y - startY);
    const ratio = Number.isFinite(maxSpeed) && maxSpeed > 0
      ? Math.min(RUN_SWAY_MAX_WEIGHT, travel / delta / maxSpeed)
      : 0;
    this.runSwayWeight = ratio;
    this.runSwayPhase = (this.runSwayPhase + delta * this.runSwaySpeed * ratio) % (Math.PI * 2);
  }

  /** World-space hand endpoint shared by rendering and projectile creation. */
  getMuzzlePosition(): { x: number; y: number } {
    const facing = this.currentRotation - Math.PI;
    const restX = Math.cos(facing) * .04 - Math.sin(facing) * .46;
    const restY = Math.sin(facing) * .04 + Math.cos(facing) * .46;
    const reach = Math.min(this.size * .78, Math.max(0, this.armDistance - 5));
    return { x: this.x + this.size / 2 + restX * this.size * (1 - this.armLift) + Math.cos(this.armAngle) * reach * this.armLift,
      y: this.y + this.size / 2 + restY * this.size * (1 - this.armLift) + Math.sin(this.armAngle) * reach * this.armLift };
  }

  protected getRotationDelta(delta: number, _inputDir?: Vector2): number {
    // Recompute from the moving body on every movement substep.
    if (this.pointerAim?.face) {
      const direction = this.getLookDirection();
      return direction.length() <= 1e-6 ? 0 : super.getRotationDelta(delta, direction);
    }
    return super.getRotationDelta(delta);
  }

  getRecoilState(): { intensity: number; horizontal: number; vertical: number } {
    return { intensity: this.recoil,
      horizontal: this.ballistics.spreadHorizontal + (this.ballistics.maxSpreadHorizontal - this.ballistics.spreadHorizontal) * this.recoil,
      vertical: this.ballistics.spreadVertical + (this.ballistics.maxSpreadVertical - this.ballistics.spreadVertical) * this.recoil };
  }

  private updateRecoil(delta: number): void {
    if (!Number.isFinite(this.timeSinceShot)) return;
    const before = this.timeSinceShot;
    this.timeSinceShot += delta;
    const recovery = Math.max(0, this.timeSinceShot - this.ballistics.recoilRecoveryDelay)
      - Math.max(0, before - this.ballistics.recoilRecoveryDelay);
    this.recoil = Math.max(0, this.recoil - recovery / this.ballistics.recoilRecoveryDuration);
  }

  private getOverlayLayout(offsetX = 0, offsetY = 0): { healthX: number; healthY: number; reloadX: number; reloadY: number; debuffX: number; debuffY: number } {
    const centerX = this.x - offsetX + this.size / 2, centerY = this.y - offsetY + this.size / 2;
    const radius = this.size / Math.SQRT2 + 8, reloadOffset = (radius + 28) / Math.SQRT2;
    return { healthX: centerX - this.size / 2, healthY: centerY + radius + 15,
      reloadX: centerX + reloadOffset, reloadY: centerY - reloadOffset,
      debuffX: centerX - radius - 18, debuffY: centerY };
  }

  private drawWadingIndicator(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
    if (this.wadingAlpha <= 0) return;
    const { debuffX: x, debuffY: y } = this.getOverlayLayout(offsetX, offsetY);
    ctx.save();
    ctx.globalAlpha *= this.wadingAlpha;
    ctx.beginPath(); ctx.roundRect(x - 10, y - 15, 20, 30, 7);
    ctx.fillStyle = 'rgba(12, 18, 26, 0.8)'; ctx.fill();
    ctx.strokeStyle = 'rgba(116, 200, 213, 0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const top = y - 10 + i * 7;
      ctx.beginPath();ctx.moveTo(x - 5, top);ctx.lineTo(x, top + 4);ctx.lineTo(x + 5, top);
      ctx.strokeStyle = '#0b1721';ctx.lineWidth = 4.4;ctx.stroke();
      ctx.strokeStyle = this.wadingColor;ctx.lineWidth = 2.4;ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 检查玩家是否处于空闲状态
   * @returns 如果玩家静止且未射击，则返回true
   */
  private isIdle(): boolean {
    return this.velocity.length() === 0 && !this.isShooting;
  }

  /** 换弹进度环：只在换弹时淡入，从顶部顺时针填到当前进度。 */
  private drawReloadRing(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    if (this.reloadBarAlpha <= 0.01) return;
    const { reloadX: x, reloadY: y } = this.getOverlayLayout(offsetX, offsetY);
    const progress = this.getReloadProgress();
    ctx.save();
    ctx.globalAlpha *= this.reloadBarAlpha;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12, 18, 26, 0.8)";
    ctx.fill();
    ctx.strokeStyle = "rgba(18, 26, 30, 0.55)";
    ctx.lineWidth = 4;
    ctx.stroke();
    if (progress > 0) {
      ctx.beginPath();
      ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 206, 107, 1)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 应用配置到玩家实例
   * @param config 配置对象，包含基础属性、动画属性、射击属性和UI属性
   */
  applyConfig(config: PlayerConfig): void {
    config = parsePlayerConfig(config);
    const ballistics = { ...this.ballistics };
    for (const key of Object.keys(ballistics) as (keyof typeof ballistics)[]) {
      const value = config.shooting?.[key];
      if (value !== undefined) ballistics[key] = value;
    }
    parsePlayerConfig({ shooting: ballistics });
    this.ballistics = ballistics;
    if (config.bulletWaterDrag) this.bulletWaterDrag = { ...this.bulletWaterDrag, ...config.bulletWaterDrag };
    if (config.movement) this.movement = { ...this.movement, ...config.movement };
    if (config.sprint) {
      const fraction = this.stamina / this.sprint.maxStamina;
      this.sprint = { ...this.sprint, ...config.sprint };
      this.stamina = fraction * this.sprint.maxStamina;
      this.unlockSprint();
    }
    if (config.collider) this.setCollider(config.collider);
    // 应用基础属性
    if (config.base) {
      if (config.base.maxHealth !== undefined) {
        this.health = this.health / this.maxHealth * config.base.maxHealth;
        this.maxHealth = config.base.maxHealth;
      }
      if (config.base.rotationSpeed !== undefined) this.rotationSpeed = config.base.rotationSpeed;
      if (config.base.rotationStrategy !== undefined) this.rotationStrategy = config.base.rotationStrategy;
      if (config.base.size !== undefined) {
        this.setSize(config.base.size);
      }
      if (config.base.maxSpeed !== undefined) {
        this.maxSpeed = config.base.maxSpeed;
      }
      if (config.base.accel !== undefined) {
        this.accel = config.base.accel;
      }
      if (config.base.decel !== undefined) {
        this.decel = config.base.decel;
      }
      if (config.base.nonlinearFactor !== undefined) {
        this.nonlinearFactor = config.base.nonlinearFactor;
      }
    }

    // 应用动画属性
    if (config.animation) {
      if (config.animation.breathingAmplitude !== undefined) {
        this.breathingAmplitude = config.animation.breathingAmplitude;
      }
      if (config.animation.breathingSpeed !== undefined) {
        this.breathingSpeed = config.animation.breathingSpeed;
      }
      if (config.animation.runSwayAmplitude !== undefined) {
        this.runSwayAmplitude = config.animation.runSwayAmplitude;
      }
      if (config.animation.runSwaySpeed !== undefined) {
        this.runSwaySpeed = config.animation.runSwaySpeed;
      }
    }

    // 应用射击属性
    if (config.shooting) {
      if (config.shooting.damage !== undefined) this.damage = config.shooting.damage;
      if (config.shooting.fireRate !== undefined) {
        this.fireRate = config.shooting.fireRate;
      }
      if (config.shooting.bulletSpeed !== undefined) {
        this.bulletSpeed = config.shooting.bulletSpeed;
      }
      if (config.shooting.magazineSize !== undefined) {
        this.magazineSize = config.shooting.magazineSize;
        // 容量缩小后余弹不能超出上限
        this.magazineAmmo = Math.min(this.magazineAmmo, this.magazineSize);
      }
      if (config.shooting.reloadDuration !== undefined) {
        const fraction = this.reloadDuration > 0 ? this.reloadRemaining / this.reloadDuration : 0;
        this.reloadDuration = config.shooting.reloadDuration;
        // 换弹途中改时长时保留已完成的进度比例
        if (this.isReloading) this.reloadRemaining = Math.max(0, fraction * this.reloadDuration);
      }
    }

    // 应用UI属性
    if (config.ui) {
      if (config.ui.fadeSpeed !== undefined) {
        this.fadeSpeed = config.ui.fadeSpeed;
      }
    }

    // 触发属性变化事件
    this.onStatsChangeCallback?.();
  }

  /** Detached base configuration; temporary pickup modifiers are not baked into it. */
  getConfigSnapshot(): PlayerConfig {
    return {
      collider: parsePlayerCollider(this.getCollider().compiled.shape),
      base: { size: this.size, maxHealth: this.maxHealth, maxSpeed: this.maxSpeed, accel: this.accel,
        decel: this.decel, nonlinearFactor: this.nonlinearFactor, rotationSpeed: this.rotationSpeed, rotationStrategy: this.rotationStrategy },
      movement: { ...this.movement }, sprint: { ...this.sprint },
      bulletWaterDrag: { ...this.bulletWaterDrag },
      animation: {
        breathingAmplitude: this.breathingAmplitude, breathingSpeed: this.breathingSpeed,
        runSwayAmplitude: this.runSwayAmplitude, runSwaySpeed: this.runSwaySpeed,
      },
      shooting: { ...this.ballistics, damage: this.damage, fireRate: this.fireRate, bulletSpeed: this.bulletSpeed,
        magazineSize: this.magazineSize, reloadDuration: this.reloadDuration },
      ui: { fadeSpeed: this.fadeSpeed },
    };
  }

  getDebugState() {
    return {
      health: this.health, stamina: this.stamina,
      magazineAmmo: this.magazineAmmo, magazineSize: this.magazineSize,
      chambered: this.chambered, roundsReady: this.magazineAmmo + (this.chambered ? 1 : 0),
      isReloading: this.isReloading, reloadProgress: this.getReloadProgress() * 100,
      exhausted: this.exhausted,
      effectiveSpeed: this.getMaxSpeed(), effectiveSprintSpeed: this.getMaxSpeed() * this.sprint.speedMultiplier,
      effectiveDamage: this.getModifiedValue(this.damage, 'damage'),
      effectiveFireRate: 1 / this.getFireRate(), effectiveBulletSpeed: this.getBulletSpeed(),
    };
  }

  /** Validate the entire patch first; changing current resources never changes their capacity. */
  setDebugState(values: Partial<PlayerDebugValues>): void {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('调试状态必须是对象');
    for (const [key, value] of Object.entries(values)) {
      if (!['health', 'stamina', 'magazineAmmo', 'chambered', 'reloadProgress'].includes(key)) {
        throw new Error(`无效调试值: ${key}`);
      }
      if (key === 'chambered') {
        if (typeof value !== 'boolean') throw new Error(`无效调试值: ${key}`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`无效调试值: ${key}`);
    }
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
    if (values.health !== undefined) this.health = clamp(values.health, this.maxHealth);
    if (values.stamina !== undefined) {
      this.stamina = clamp(values.stamina, this.sprint.maxStamina);
      this.exhausted = this.stamina === 0;
      this.releasedAfterExhaustion = false;
      this.staminaRegenDelay = 0;
      if (this.exhausted) this.sprinting = false;
    }
    if (values.magazineAmmo !== undefined) {
      this.magazineAmmo = Math.round(clamp(values.magazineAmmo, this.magazineSize));
      // 手动改余弹等于中止当前换弹，由玩家自己决定下一步
      this.cancelReload();
    }
    if (values.chambered !== undefined) {
      this.chambered = values.chambered;
      this.cancelReload();
    }
    if (values.reloadProgress !== undefined) {
      const progress = clamp(values.reloadProgress, 100);
      if (progress >= 100) this.finishReload();
      else if (progress <= 0) this.cancelReload();
      else {
        this.isReloading = true;
        this.reloadRemaining = (1 - progress / 100) * this.reloadDuration;
      }
    }
    this.onStatsChangeCallback?.();
  }

  /**
   * 设置粒子系统
   * @param system 粒子系统引用
   */
  setParticleSystem(system: ParticleSystem): void {
    this.particleSystem = system;
  }

  /**
   * 添加属性修改器
   * @param stat 属性名称
   * @param value 修改值
   * @param duration 持续时间（秒，0表示永久）
   * @param isMultiplier 是否为乘数（true）或加数（false）
   */
  addModifier(stat: string, value: number, duration: number = 0, isMultiplier: boolean = false): void {
    this.modifiers.set(stat, { value, isMultiplier });
    // 触发属性变化事件
    this.onStatsChangeCallback?.();
  }

  /**
   * 移除指定属性的修改器
   * @param stat 属性名称
   */
  removeModifier(stat: string): void {
    if (this.modifiers.delete(stat)) {
      // 触发属性变化事件
      this.onStatsChangeCallback?.();
    }
  }

  /**
   * 清除所有属性修改器
   */
  clearModifiers(): void {
    if (this.modifiers.size > 0) {
      this.modifiers.clear();
      // 触发属性变化事件
      this.onStatsChangeCallback?.();
    }
  }

  /**
   * 获取应用了修改器后的属性值
   * @param baseValue 基础属性值
   * @param stat 属性名称
   * @returns 应用了修改器后的最终属性值
   */
  getModifiedValue(baseValue: number, stat: string): number {
    const modifier = this.modifiers.get(stat);
    if (!modifier) {
      return baseValue;
    }

    if (modifier.isMultiplier) {
      return baseValue * (1 + modifier.value);
    } else {
      return baseValue + modifier.value;
    }
  }

  /**
   * 设置属性变化回调函数
   * @param callback 属性变化时触发的回调函数
   */
  setOnStatsChangeCallback(callback: () => void): void {
    this.onStatsChangeCallback = callback;
  }

  // Getter 和 Setter 方法
  getIdleTime(): number { return this.idleTime; }
  setIdleTime(time: number): void { this.idleTime = time; }
  getWalkTime(): number { return this.walkTime; }
  setWalkTime(time: number): void { this.walkTime = time; }
  getScale(): number { return this.scale; }
  setScale(value: number): void { this.scale = value; }

  /**
   * 获取有效的子弹列表（过滤掉已销毁的子弹）
   * @returns 活跃子弹数组
   */
  getBullets(): Bullet[] {
    return this.bullets.filter(bullet => !bullet.getIsDestroyed());
  }

  /**
   * 获取应用修改器后的最大速度
   * @returns 修改后的最大速度
   */
  getMaxSpeed(): number {
    return this.getModifiedValue(this.maxSpeed, 'maxSpeed');
  }

  /**
   * 获取武器的射速
   * @returns 修改后的射速（秒/发）
   */
  getFireRate(): number {
    // 注意：射速是时间间隔，值越小射速越快，所以使用倒数来计算修改后的值
    const modifiedRate = this.getModifiedValue(1 / this.fireRate, 'fireRate');
    return 1 / modifiedRate; // 转换回时间间隔
  }

  /**
   * 获取子弹速度
   * @returns 修改后的子弹速度
   */
  getBulletSpeed(): number {
    return this.getModifiedValue(this.bulletSpeed, 'bulletSpeed');
  }

  /**
   * 设置射击回调函数
   * @param callback 射击时触发的回调函数，接收射击方向作为参数
   */
  setOnShootCallback(callback: (shootDir: Vector2) => void): void {
    this.onShootCallback = callback;
  }

  /**
   * 设置子弹自然停止回调（落点是否为干燥地面由接收方判断）。
   * @param callback 接收子弹最终中心坐标
   */
  setOnBulletLanded(callback: (x: number, y: number) => void): void {
    this.onBulletLandedCallback = callback;
  }

  /**
   * 注册子弹对单位的命中查询；场景用它把子弹和鸡等可命中对象连接起来。
   * 每次发射时转发给新子弹，之后发射的子弹共享同一查询。
   */
  setBulletEntityHitTest(test?: BulletEntityHitTest): void {
    this.bulletEntityHitTest = test;
  }

  /**
   * 注册脚印候选点回调；左右交替、地形校验与绘制由接收方负责。
   * @param callback 接收世界坐标、行进方向和涉水湿度（0–1）
   */
  setOnFootstepCallback(callback: (step: FootstepEvent) => void): void {
    this.onFootstepCallback = callback;
  }

  /**
   * 设置换弹回调：按 R 换弹（或调试开启自动换弹后打空）开始的那一刻触发。
   * 备弹无限，换弹只消耗时间，不消耗资源。
   */
  setOnReloadCallback(callback: () => void): void {
    this.onReloadCallback = callback;
  }

  /**
   * 射击方法
   * @param inputDir 射击方向
   * @param damage 子弹伤害值
   */
  shoot(inputDir: Vector2, damage: number = this.damage, map?: TileMap): void {
    if (!inputDir || !Number.isFinite(inputDir.x) || !Number.isFinite(inputDir.y) || inputDir.length() === 0) return;
    const target = inputDir.clone().normalize().scale(this.ballistics.maxRange + this.size * .78);
    this.shootAt(new Vector2(this.x + this.size / 2 + target.x, this.y + this.size / 2 + target.y), damage, map);
  }

  /** 发射时冻结世界落点；方向辅助方法和鼠标输入共用弹药、散布与碰撞。 */
  shootAt(target: { x: number; y: number }, damage: number = this.damage, map?: TileMap): void {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    const inputDir = new Vector2(target.x - this.x - this.size / 2, target.y - this.y - this.size / 2);
    // 验证射击方向
    if (inputDir.length() <= 1e-6) return;

    // 检查射击冷却
    if (this.fireCooldown > 1e-9) return;
    // 没有子弹时只能等换弹；射击打断换弹会清零进度，必须重新按 R。
    if (!this.hasAmmo()) return;
    if (this.isReloading) this.cancelReload();
    // Preserve a sub-frame remainder without replaying missed shots after a long frame.
    this.fireCooldown = this.getFireRate() + Math.min(0, this.fireCooldown);

    this.consumeRound();

    // 生成子弹
    // A click fires immediately; the firing pose must already show the emitting hand.
    this.armAngle = Math.atan2(inputDir.y, inputDir.x);
    this.armDistance = inputDir.length();
    this.armLift = 1; this.shotPoseTime = .1;
    const muzzle = this.getMuzzlePosition();
    const bulletPos = new Vector2(muzzle.x, muzzle.y);
    // 使用修改后的子弹速度
    const distance = inputDir.length(), spread = this.getRecoilState();
    const radians = Math.PI / 180;
    inputDir.x += (Math.random() * 2 - 1) * distance * Math.tan(spread.horizontal * radians);
    inputDir.y += (Math.random() * 2 - 1) * distance * Math.tan(spread.vertical * radians);
    inputDir.x += this.x + this.size / 2 - bulletPos.x;
    inputDir.y += this.y + this.size / 2 - bulletPos.y;
    const travelDistance = Math.min(inputDir.length(), this.ballistics.maxRange);
    const direction = inputDir.clone().normalize();
    const bulletVel = direction.clone().scale(this.getBulletSpeed());
    const bullet = new Bullet(bulletPos, bulletVel, this.getModifiedValue(damage, "damage"),
      this.particleSystem, this.terrainWaterCoverage.fraction > 1e-6, this.bulletWaterDrag, travelDistance,
      this.onBulletLandedCallback);
    if (this.bulletEntityHitTest) bullet.setEntityHitTest(this.bulletEntityHitTest);
    if (map) bullet.checkLaunchPath(new Vector2(this.x + this.size / 2, this.y + this.size / 2), map);
    if (!bullet.getIsDestroyed()) this.bullets.push(bullet);
    this.recoil = Math.min(1, this.recoil + this.ballistics.recoilPerShot);
    this.timeSinceShot = 0;

    // 触发射击回调（用于摄像机震动等效果）
    this.onShootCallback?.(direction);

    // 更新状态
    this.stateMachine.changeState("shooting");
    this.isShooting = true;

    // 打空（6+1 全打完）时，只有调试面板开启自动换弹才立刻换弹；否则等玩家按 R。
    if (this.autoReload && !this.hasAmmo()) this.startReload();
  }

  /** 还有没有能立刻发射的子弹：膛内 1 发 + 弹匣内余弹。 */
  private hasAmmo(): boolean {
    return this.chambered || this.magazineAmmo > 0;
  }

  /** 先打膛内那一发，打完再从弹匣顶一发进膛。 */
  private consumeRound(): void {
    this.chambered = false;
    if (this.magazineAmmo > 0) {
      this.magazineAmmo--;
      this.chambered = true;
    }
  }

  /** 开始换弹；备弹无限，结束时总是补满。 */
  private startReload(): void {
    if (this.isReloading) return;
    this.isReloading = true;
    this.reloadRemaining = this.reloadDuration;
    // 交给场景播换弹音效
    this.onReloadCallback?.();
  }

  /** 中止换弹并清零进度；开火会打断换弹。 */
  private cancelReload(): void {
    this.isReloading = false;
    this.reloadRemaining = 0;
  }

  /** 换弹完成：膛内上膛一发、弹匣补满（幂等）。 */
  private finishReload(): void {
    this.isReloading = false;
    this.reloadRemaining = 0;
    this.chambered = true;
    this.magazineAmmo = this.magazineSize;
  }

  /** 打空最后一发后是否自动换弹（调试选项，默认关闭）。 */
  getAutoReload(): boolean { return this.autoReload; }

  /** 开关自动换弹；关闭时正在进行的换弹不受影响。 */
  setAutoReload(enabled: boolean): void { this.autoReload = !!enabled; }

  /** 玩家按 R 手动换弹；弹匣已满时什么都不做。 */
  requestReload(): void {
    if (this.isReloading || (this.magazineAmmo >= this.magazineSize && this.chambered)) return;
    this.startReload();
  }

  /**
   * 更新玩家状态
   * @param delta 时间增量
   * @param input 输入系统引用
   * @param map 可选的地图引用，用于碰撞检测
   */
  update(delta: number, input: Input, map?: TileMap, aim?: PlayerAimInput): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    this.pointerAim = aim && Number.isFinite(aim.target.x) && Number.isFinite(aim.target.y) ? aim : undefined;
    this.isShooting = !!this.pointerAim?.fire;
    this.updateRecoil(delta);
    const startX = this.x, startY = this.y;
    const movingInput = this.getMoveDirection(input).length() > 0;
    this.updateMovement(delta, input, map);
    this.updateAimPose(delta);
    this.updateRunSway(delta, startX, startY);
    this.wadingMap = this.terrainSpeedFactor < 1 - 1e-6 && this.terrainWaterCoverage.fraction > 1e-6 ? map : undefined;
    if (this.wadingMap) {
      const depth = Math.max(0, Math.min(3, this.terrainWaterCoverage.depth)), lower = Math.floor(depth), blend = depth - lower;
      const a = WADING_COLORS[lower], b = WADING_COLORS[Math.min(3, lower + 1)];
      this.wadingColor = `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * blend)).join(', ')})`;
    }
    this.wadingAlpha = this.wadingMap ? Math.min(1, this.wadingAlpha + delta / 0.08) : Math.max(0, this.wadingAlpha - delta / 0.12);
    this.updateFootstepWetness(delta);
    if (movingInput) this.emitFootsteps(startX, startY);

    // 推进换弹：按帧累积，长帧不会跨过终点后倒扣
    if (this.isReloading) {
      this.reloadRemaining -= delta;
      if (this.reloadRemaining <= 1e-9) this.finishReload();
    }
    // 开启自动换弹后，打空弹匣即开始换弹；也兼作调试面板直接清空弹匣时的兜底。
    if (this.autoReload && !this.isReloading && !this.hasAmmo()) this.startReload();

    // 射击间隔计时
    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
      if (!this.isShooting || delta >= this.getFireRate()) this.fireCooldown = Math.max(0, this.fireCooldown);
    }

    // 进度环只在换弹时淡入淡出
    if (this.isReloading) {
      this.reloadBarAlpha = Math.min(1, this.reloadBarAlpha + delta * this.fadeSpeed);
    } else {
      this.reloadBarAlpha = Math.max(0, this.reloadBarAlpha - delta * this.fadeSpeed);
    }

    // 处理射击逻辑
    if (this.pointerAim?.fire) this.shootAt(this.pointerAim.target, this.damage, map);

    // 根据当前状态切换状态机状态
    if (this.isShooting) {
      this.stateMachine.changeState("shooting");
    } else if (this.velocity.length() > 0.1) {
      this.stateMachine.changeState("moving");
    } else {
      this.stateMachine.changeState("idle");
    }

    // 更新动画和状态机
    this.stateMachine.update(delta);

    // 优化子弹更新和清理
    // 首先更新所有子弹
    for (let i = 0; i < this.bullets.length; i++) {
      this.bullets[i].update(delta, map);
    }
    // 然后清理已销毁的子弹
    this.bullets = this.bullets.filter(bullet => !bullet.getIsDestroyed());
  }

  getWeaponName(): string {
    return this.weaponName;
  }

  /** 弹匣内余弹（不含膛内那一发）。 */
  getMagazineAmmo(): number {
    return this.magazineAmmo;
  }

  getMagazineSize(): number {
    return this.magazineSize;
  }

  /** 膛内是否还有一发。 */
  getChambered(): boolean {
    return this.chambered;
  }

  getIsReloading(): boolean {
    return this.isReloading;
  }

  /** 换弹剩余时间（秒）；未换弹时为 0。 */
  getReloadRemaining(): number {
    return this.reloadRemaining;
  }

  /** 换弹进度（0-1）；未换弹时为 0。 */
  getReloadProgress(): number {
    if (!this.isReloading || this.reloadDuration <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.reloadRemaining / this.reloadDuration));
  }

  /**
   * 绘制玩家（包含呼吸动画效果）
   * @param ctx Canvas渲染上下文
   * @param offsetX 绘制偏移X
   * @param offsetY 绘制偏移Y
   */
  draw(ctx: CanvasRenderingContext2D, offsetX: number = 0, offsetY: number = 0): void {
    const centerX = this.x + this.size / 2, centerY = this.y + this.size / 2;
    // The same local raster on land and water prevents a shading/resolution pop at the shoreline.
    // A fixed maximum extent avoids reallocating the buffer on every breathing/sway frame.
    const swayPad = this.size * this.runSwayAmplitude / 100 * RUN_SWAY_MAX_WEIGHT;
    const extent = Math.ceil(this.size * 2 * (1 + this.breathingAmplitude / 100) + swayPad * 2) + 4;
    const canvas = this.wadingCanvas ??= document.createElement('canvas');
    if (canvas.width !== extent || canvas.height !== extent) { canvas.width = extent; canvas.height = extent; }
    const buffer = canvas.getContext('2d')!;
    buffer.clearRect(0, 0, extent, extent);
    this.drawModel(buffer, extent / 2, extent / 2);
    if (this.wadingMap) {
      buffer.save();
      buffer.globalCompositeOperation = 'source-atop'; buffer.globalAlpha = 0.35;
      this.wadingMap.drawWaterLayer(buffer, centerX - extent / 2, centerY - extent / 2, extent, extent);
      buffer.restore();
    }
    ctx.drawImage(canvas, centerX - extent / 2 - offsetX, centerY - extent / 2 - offsetY);
  }

  private drawModel(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
    ctx.save();

    // Visual breathing only: getCollider() uses size and never this render scale.
    let scale = 1;
    if (this.isIdle() && this.armLift === 0) {
      scale = Math.max(0, 1 + Math.sin(this.idleTime * this.breathingSpeed) * this.breathingAmplitude / 100);
    }

    // 应用变换并绘制
    ctx.translate(centerX, centerY);
    const facing = this.currentRotation - Math.PI;
    ctx.rotate(facing);
    ctx.scale(scale, scale);
    const s = this.size, c = Math.cos(facing), sn = Math.sin(facing);
    const muzzle = this.getMuzzlePosition();
    const dx = muzzle.x - this.x - s / 2, dy = muzzle.y - this.y - s / 2;
    const hand = { x: dx * c + dy * sn, y: -dx * sn + dy * c };
    // Running sway: the hands swing front and back in opposite phase (alternating),
    // while the head sways laterally at a smaller amplitude; hands only while lowered.
    const sway = s * this.runSwayAmplitude / 100 * this.runSwayWeight;
    const headSway = Math.sin(this.runSwayPhase) * sway * RUN_SWAY_HEAD_SCALE;
    const handSway = Math.sin(this.runSwayPhase - RUN_SWAY_HAND_LAG) * sway
      * RUN_SWAY_HAND_SCALE * (1 - this.armLift);
    const disc = (x: number, y: number, r: number, color: string | CanvasGradient) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    };
    const capsule = (ax: number, ay: number, bx: number, by: number, width: number, color: string) => {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
    };
    // Rounded shoulders, sleeves and hands sit below the head in the top-down view.
    const leftX = s * .04 * (1 - this.armLift) + hand.x * .67 * this.armLift;
    const leftY = -s * .46 * (1 - this.armLift) + (hand.y - s * .13) * this.armLift;
    capsule(0, -s * .31, leftX + handSway, leftY, s * .22, '#183c4a');
    capsule(0, s * .31, hand.x - handSway, hand.y, s * .22, '#183c4a');
    capsule(s * .02, -s * .31, leftX + handSway, leftY, s * .15, '#4d8999');
    capsule(s * .02, s * .31, hand.x - handSway, hand.y, s * .15, '#4d8999');
    disc(leftX + handSway, leftY, s * .085, '#e5ccb0');
    disc(hand.x - handSway, hand.y, s * .085, '#eed7b9');
    disc(-s * .055, 0, s * .45, '#102c39');
    const body = ctx.createLinearGradient(-s * .4, s * .3, s * .35, -s * .3);
    body.addColorStop(0, '#245362'); body.addColorStop(1, '#73b4bf');
    disc(0, 0, s * .405, body);
    disc(s * .055, 0, s * .29, '#23404a');
    const head = ctx.createRadialGradient(
      s * .16, -s * .12 + headSway, s * .015, s * .09, headSway, s * .28);
    head.addColorStop(0, '#fff1d6'); head.addColorStop(.65, '#ead3b2'); head.addColorStop(1, '#b49a7a');
    disc(s * .09, headSway, s * .265, head);
    // A small crown highlight indicates facing without drawing a face.
    capsule(s * .22, -s * .08 + headSway, s * .27, s * .025 + headSway, s * .035, '#fff4dd');

    ctx.restore();
  }

  /** Screen-space overlays are drawn after lighting. */
  drawUI(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    this.drawWadingIndicator(ctx, offsetX, offsetY);
    this.drawReloadRing(ctx, offsetX, offsetY);
    ctx.save();
    const { healthX: x, healthY: y } = this.getOverlayLayout(offsetX, offsetY);
    ctx.fillStyle = "#181d24";
    ctx.fillRect(x - 1, y - 1, this.size + 2, 7);
    ctx.fillStyle = this.health / this.maxHealth <= 0.25 ? "#f16b67" : "#79e2a0";
    ctx.fillRect(x, y, this.size * this.health / this.maxHealth, 5);
    ctx.fillStyle = "#181d24";
    ctx.fillRect(x - 1, y + 9, this.size + 2, 6);
    ctx.fillStyle = this.exhausted ? "#50616b" : "#75dfe9";
    ctx.fillRect(x, y + 10, this.size * this.stamina / this.sprint.maxStamina, 4);
    if (this.exhausted) {
      ctx.strokeStyle = "#ffbc70";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, y + 9, this.size + 2, 6);
    }
    ctx.restore();
  }
}
