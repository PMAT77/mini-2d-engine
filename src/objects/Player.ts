import { AimChange, Input } from "../core/Input";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { IdleState } from "../status/IdleState";
import { MovingState } from "../status/MovingState";
import { ShootingState } from "../status/ShootingState";
import { StateMachine } from "../status/StateMachine";
import { Bullet } from "./Bullet";
import { Entities } from "./Entities";
import { ParticleSystem } from "./ParticleSystem";
import { DEFAULT_AIM, DEFAULT_MOVEMENT, DEFAULT_SPRINT, DEFAULT_BULLET_WATER_DRAG, parsePlayerCollider, parsePlayerConfig, PlayerConfig } from "./PlayerConfig";
import { ColliderShape } from "../physics/Collider";

const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const WADING_COLORS = [[98, 186, 255], [177, 143, 178], [255, 100, 100], [255, 64, 64]];

export interface PlayerDebugValues {
  health: number;
  stamina: number;
  heatPercentage: number;
  overheatCooldownRemaining: number;
}

/**
 * 玩家类 - 处理玩家的移动、射击和状态管理
 */
export class Player extends Entities {
  public setCollider(shape: ColliderShape): void { super.setCollider(parsePlayerCollider(shape)); }
  protected getBodyRotation(): number { return this.currentRotation - Math.PI / 2; }
  private health = 100;
  private maxHealth = 100;
  private gold = 0;

  getGold(): number { return this.gold; }
  collectGold(): void { this.gold++; }

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
  private wadingMap?: TileMap;
  private wadingAlpha = 0;
  private wadingColor = 'rgb(98, 186, 255)';
  private wadingCanvas?: HTMLCanvasElement;

  getStamina(): number { return this.stamina; }
  getMaxStamina(): number { return this.sprint.maxStamina; }
  getIsSprinting(): boolean { return this.sprinting; }

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

  // 射击相关属性
  private isShooting: boolean = false; // 玩家是否正在开火
  private aim = { ...DEFAULT_AIM };
  private aimAngle = 0;
  private aimTarget = 0;
  private aimFrom = 0;
  private aimArc = 0;
  private aimStarted = 0;
  private aimTime = 0;
  private aimPrevious: number | null = null;
  private aimVisible = false;
  private aimUsesEvents = false;
  private bullets: Bullet[] = []; // 存储玩家发射的子弹

  private fireRate: number = 0.2; // 射速（秒/发）
  private fireCooldown: number = 0; // 开火冷却计时器（控制射速）

  private bulletSpeed: number = 800; // 子弹速度 
  private bulletWaterDrag = { ...DEFAULT_BULLET_WATER_DRAG };
  private damage = 10;

  private maxShootingTime: number = 3.5; // 最长持续射击时间（秒）
  private shootingTimeRemaining: number = this.maxShootingTime; // 当前剩余可射击时间
  private maxOverheatCooldownTime: number = 1.0; // 最长过热冷却时间（秒）
  private overheatCooldownRemaining: number = this.maxOverheatCooldownTime; // 当前过热后的冷却时间（秒）
  private isOverheated: boolean = false; // 是否处于过热状态

  // 进度条可见性相关属性
  private cooldownBarAlpha: number = 0; // 进度条透明度（0-1）
  private isBarVisible: boolean = false; // 进度条是否应该可见
  private fadeSpeed: number = 5; // 淡入淡出速度系数

  // 回调函数定义
  private onShootCallback?: (shootDir: Vector2) => void; // 射击回调，用于触发摄像机震动等效果
  private onStatsChangeCallback?: () => void; // 属性变化回调

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

  /** A tiny angular damping softens turns without slowing movement or delaying reversals. */
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
    const ratio = 1 - (1 - this.movement.startSpeedRatio) * Math.pow(1 - t, 3);
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

  /**
   * 获取朝向方向（基于方向键）
   * @param input 输入系统引用
   * @returns 归一化的朝向向量
   */
  private readShootingDirection(input: Input): Vector2 {
    const dir = new Vector2();
    if (input.isKeyDown("ArrowUp")) dir.y -= 1;
    if (input.isKeyDown("ArrowDown")) dir.y += 1;
    if (input.isKeyDown("ArrowLeft")) dir.x -= 1;
    if (input.isKeyDown("ArrowRight")) dir.x += 1;

    // 归一化方向向量
    if (dir.length() > 0) dir.normalize();
    return dir;
  }

  protected getLookDirection(_input: Input): Vector2 {
    return this.aimVisible ? new Vector2(Math.cos(this.aimAngle), Math.sin(this.aimAngle)) : new Vector2();
  }

  protected getRotationDelta(delta: number, _inputDir?: Vector2): number {
    // Body facing follows movement velocity; aiming stays in world space.
    return super.getRotationDelta(delta);
  }

  getAimState(): { angle: number; targetAngle: number; visible: boolean; x: number; y: number; radius: number } {
    const radius = this.size / Math.SQRT2 + 8;
    return { angle: this.aimAngle, targetAngle: this.aimTarget, visible: this.aimVisible, radius,
      x: this.x + this.size / 2 + Math.cos(this.aimAngle) * radius,
      y: this.y + this.size / 2 + Math.sin(this.aimAngle) * radius };
  }

  private resetAim(): void {
    this.aimVisible = false;
    this.aimPrevious = null;
    this.aimFrom = this.aimAngle;
    this.aimTarget = this.aimAngle;
    this.aimArc = 0;
  }

  private advanceAim(time: number): void {
    const t = this.aim.aimTurnDuration === 0 ? 1 : Math.min(1, Math.max(0, (time - this.aimStarted) / this.aim.aimTurnDuration));
    this.aimAngle = angleDelta(0, this.aimFrom + this.aimArc * t);
    this.aimTime = time;
  }

  private changeAim({ x, y, time }: AimChange): void {
    this.advanceAim(time);
    if (x === 0 && y === 0) { this.resetAim(); return; }
    const target = Math.atan2(y, x);
    if (this.aimPrevious !== null && Math.abs(angleDelta(this.aimPrevious, target)) < 1e-9) return;
    const adjacent = this.aimPrevious !== null && Math.abs(Math.abs(angleDelta(this.aimPrevious, target)) - Math.PI / 4) < 1e-9;
    // A held direction is still active aim; only release/reset breaks the sweep.
    this.aimFrom = adjacent ? this.aimAngle : target;
    this.aimArc = adjacent ? angleDelta(this.aimAngle, target) : 0;
    this.aimTarget = target;
    this.aimStarted = time;
    this.aimPrevious = target;
    this.aimVisible = true;
  }

  private updateAim(delta: number, input: Input): void {
    const direction = this.readShootingDirection(input);
    // Polling remains supported by deterministic simulation/test inputs.
    const sample = input.consumeAimChanges?.();
    if (this.aimUsesEvents !== !!sample) {
      this.resetAim();
      this.aimTime = sample ? sample.now - delta : 0;
      this.aimUsesEvents = !!sample;
    }
    const start = this.aimTime, now = sample?.now ?? start + delta;
    if (sample?.reset) this.resetAim();
    for (const change of sample?.changes ?? []) this.changeAim(change);
    const rawAngle = direction.length() > 0 ? Math.atan2(direction.y, direction.x) : null;
    if (rawAngle === null ? this.aimVisible : this.aimPrevious === null || Math.abs(angleDelta(this.aimPrevious, rawAngle)) > 1e-9) {
      this.changeAim({ x: direction.x, y: direction.y, time: sample ? now : start });
    }
    this.advanceAim(now);
    this.isShooting = this.aimVisible;
  }

  private getOverlayLayout(offsetX = 0, offsetY = 0): { healthX: number; healthY: number; heatX: number; heatY: number; debuffX: number; debuffY: number } {
    const centerX = this.x - offsetX + this.size / 2, centerY = this.y - offsetY + this.size / 2;
    const radius = this.getAimState().radius, heatOffset = (radius + 28) / Math.SQRT2;
    return { healthX: centerX - this.size / 2, healthY: centerY + radius + 15,
      heatX: centerX + heatOffset, heatY: centerY - heatOffset,
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

  private drawAimPointer(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
    const aim = this.getAimState();
    if (!aim.visible) return;
    ctx.save();
    ctx.translate(aim.x - offsetX, aim.y - offsetY);
    ctx.rotate(aim.angle);
    ctx.scale(1.1, 1.1);
    ctx.beginPath();
    ctx.moveTo(5, 0); ctx.lineTo(-5, -4); ctx.lineTo(-5, 4); ctx.closePath();
    ctx.fillStyle = "#c9f8ff";
    ctx.strokeStyle = "#14212b";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /**
   * 检查玩家是否处于空闲状态
   * @returns 如果玩家静止且未射击，则返回true
   */
  private isIdle(): boolean {
    return this.velocity.length() === 0 && !this.isShooting;
  }

  /** Weapon heat grows clockwise; the red overheat arc shrinks during recovery. */
  private drawCooldownRing(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    if (this.cooldownBarAlpha <= 0) return;
    const { heatX: x, heatY: y } = this.getOverlayLayout(offsetX, offsetY);
    const progress = Math.max(0, Math.min(1, this.isOverheated
      ? 1 - this.getOverheatCooldownProgress() : this.getHeatPercentage()));
    ctx.save();
    ctx.globalAlpha = this.cooldownBarAlpha;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12, 18, 26, 0.8)";
    ctx.fill();
    ctx.strokeStyle = "rgba(210, 225, 240, 0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();
    if (progress > 0) {
      ctx.beginPath();
      ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = this.isOverheated ? "#ff6b64" : `hsl(${185 * (1 - progress)}, 85%, 65%)`;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    if (this.isOverheated) {
      ctx.strokeStyle = "#ff6b64";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 1);
      ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 4);
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
    }

    // 应用射击属性
    if (config.shooting) {
      if (config.shooting.damage !== undefined) this.damage = config.shooting.damage;
      if (config.shooting.aimTurnDuration !== undefined) this.aim.aimTurnDuration = config.shooting.aimTurnDuration;
      if (config.shooting.fireRate !== undefined) {
        this.fireRate = config.shooting.fireRate;
      }
      if (config.shooting.bulletSpeed !== undefined) {
        this.bulletSpeed = config.shooting.bulletSpeed;
      }
      if (config.shooting.maxShootingTime !== undefined) {
        const remainingFraction = this.shootingTimeRemaining / this.maxShootingTime;
        this.maxShootingTime = config.shooting.maxShootingTime;
        this.shootingTimeRemaining = remainingFraction * this.maxShootingTime;
        // 同时更新剩余射击时间，确保一致性
        if (!this.isOverheated) {
          this.shootingTimeRemaining = Math.min(
            this.shootingTimeRemaining,
            this.maxShootingTime
          );
        }
      }
      if (config.shooting.maxOverheatCooldownTime !== undefined) {
        const fraction = this.overheatCooldownRemaining / this.maxOverheatCooldownTime;
        this.maxOverheatCooldownTime = config.shooting.maxOverheatCooldownTime;
        this.overheatCooldownRemaining = (this.isOverheated ? fraction : 1) * this.maxOverheatCooldownTime;
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
      animation: { breathingAmplitude: this.breathingAmplitude, breathingSpeed: this.breathingSpeed },
      shooting: { ...this.aim, damage: this.damage, fireRate: this.fireRate, bulletSpeed: this.bulletSpeed,
        maxShootingTime: this.maxShootingTime, maxOverheatCooldownTime: this.maxOverheatCooldownTime },
      ui: { fadeSpeed: this.fadeSpeed },
    };
  }

  getDebugState() {
    return {
      health: this.health, stamina: this.stamina, heatPercentage: this.getHeatPercentage() * 100,
      overheatCooldownRemaining: this.isOverheated ? this.overheatCooldownRemaining : 0,
      isOverheated: this.isOverheated, exhausted: this.exhausted,
      effectiveSpeed: this.getMaxSpeed(), effectiveSprintSpeed: this.getMaxSpeed() * this.sprint.speedMultiplier,
      effectiveDamage: this.getModifiedValue(this.damage, 'damage'),
      effectiveFireRate: 1 / this.getFireRate(), effectiveBulletSpeed: this.getBulletSpeed(),
    };
  }

  /** Validate the entire patch first; changing current resources never changes their capacity. */
  setDebugState(values: Partial<PlayerDebugValues>): void {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('调试状态必须是对象');
    for (const [key, value] of Object.entries(values)) {
      if (!['health', 'stamina', 'heatPercentage', 'overheatCooldownRemaining'].includes(key)
        || typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`无效调试值: ${key}`);
    }
    const willOverheat = values.heatPercentage === undefined ? this.isOverheated : values.heatPercentage >= 100;
    if (values.overheatCooldownRemaining !== undefined && values.overheatCooldownRemaining > 0
      && !willOverheat) throw new Error('仅过热时可设置剩余冷却');
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
    if (values.health !== undefined) this.health = clamp(values.health, this.maxHealth);
    if (values.stamina !== undefined) {
      this.stamina = clamp(values.stamina, this.sprint.maxStamina);
      this.exhausted = this.stamina === 0;
      this.releasedAfterExhaustion = false;
      this.staminaRegenDelay = 0;
      if (this.exhausted) this.sprinting = false;
    }
    if (values.heatPercentage !== undefined) {
      const heat = clamp(values.heatPercentage, 100);
      this.isOverheated = false;
      this.fireCooldown = 0;
      this.shootingTimeRemaining = (1 - heat / 100) * this.maxShootingTime;
      this.overheatCooldownRemaining = this.maxOverheatCooldownTime;
      if (heat === 100) this.startOverheat();
    }
    if (values.overheatCooldownRemaining !== undefined) {
      this.overheatCooldownRemaining = clamp(values.overheatCooldownRemaining, this.maxOverheatCooldownTime);
      if (this.overheatCooldownRemaining === 0) {
        this.isOverheated = false;
        this.shootingTimeRemaining = this.maxShootingTime;
        this.fireCooldown = 0;
        this.overheatCooldownRemaining = this.maxOverheatCooldownTime;
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
   * 射击方法
   * @param inputDir 射击方向
   * @param damage 子弹伤害值
   */
  shoot(inputDir: Vector2, damage: number = this.damage): void {
    // 验证射击方向
    if (!inputDir || inputDir.length() === 0) return;

    // 检查是否过热
    if (this.isOverheated) return;

    // 检查剩余射击时间
    if (this.shootingTimeRemaining <= 0) {
      this.startOverheat();
      return;
    }

    // 检查射击冷却
    if (this.fireCooldown > 0) return;
    this.fireCooldown = this.getFireRate(); // 使用修改后的射速

    // 减少剩余射击时间
    this.shootingTimeRemaining -= this.getFireRate();

    // 生成子弹
    const bulletPos = new Vector2(this.x + this.size / 2, this.y + this.size / 2);
    // 使用修改后的子弹速度
    const bulletVel = inputDir.clone().scale(this.getBulletSpeed());
    const bullet = new Bullet(bulletPos, bulletVel, this.getModifiedValue(damage, "damage"),
      this.particleSystem, this.terrainWaterCoverage.fraction > 1e-6, this.bulletWaterDrag);
    this.bullets.push(bullet);

    // 触发射击回调（用于摄像机震动等效果）
    this.onShootCallback?.(inputDir);

    // 更新状态
    this.stateMachine.changeState("shooting");
    this.isShooting = true;
  }

  /**
   * 开始过热状态
   * @private
   */
  private startOverheat(): void {
    this.isOverheated = true;
    this.shootingTimeRemaining = 0;
    this.fireCooldown = 0;
    this.overheatCooldownRemaining = this.maxOverheatCooldownTime;
    // 可以在这里添加过热特效或音效
  }

  /**
   * 更新玩家状态
   * @param delta 时间增量
   * @param input 输入系统引用
   * @param map 可选的地图引用，用于碰撞检测
   */
  update(delta: number, input: Input, map?: TileMap): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    this.updateAim(delta, input);
    this.updateMovement(delta, input, map);
    this.wadingMap = this.terrainSpeedFactor < 1 - 1e-6 && this.terrainWaterCoverage.fraction > 1e-6 ? map : undefined;
    if (this.wadingMap) {
      const depth = Math.max(0, Math.min(3, this.terrainWaterCoverage.depth)), lower = Math.floor(depth), blend = depth - lower;
      const a = WADING_COLORS[lower], b = WADING_COLORS[Math.min(3, lower + 1)];
      this.wadingColor = `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * blend)).join(', ')})`;
    }
    this.wadingAlpha = this.wadingMap ? Math.min(1, this.wadingAlpha + delta / 0.08) : Math.max(0, this.wadingAlpha - delta / 0.12);

    // 更新射击冷却和过热状态
    if (this.isOverheated) {
      // 过热冷却倒计时
      this.overheatCooldownRemaining -= delta;
      if (this.overheatCooldownRemaining <= 0) {
        // 过热冷却完成
        this.isOverheated = false;
        this.shootingTimeRemaining = this.maxShootingTime;
        this.overheatCooldownRemaining = this.maxOverheatCooldownTime; // 重置过热冷却时间
      }

    } else {
      // 常规射击冷却
      if (this.fireCooldown > 0) {
        this.fireCooldown -= delta;
      }

      // 当玩家停止射击时，缓慢恢复射击时间
      if (!this.isShooting && this.shootingTimeRemaining < this.maxShootingTime) {
        // 每秒恢复50%的最大射击时间
        this.shootingTimeRemaining += delta * this.maxShootingTime * 0.5;
        // 确保不超过最大值
        if (this.shootingTimeRemaining > this.maxShootingTime) {
          this.shootingTimeRemaining = this.maxShootingTime;
        }
      }
    }

    // 管理进度条可见性
    if (this.isShooting || this.isOverheated || this.shootingTimeRemaining < this.maxShootingTime) {
      this.isBarVisible = true;
    } else {
      this.isBarVisible = false;
    }

    // 更新进度条透明度
    if (this.isBarVisible) {
      this.cooldownBarAlpha = Math.min(1, this.cooldownBarAlpha + delta * this.fadeSpeed);
    } else {
      this.cooldownBarAlpha = Math.max(0, this.cooldownBarAlpha - delta * this.fadeSpeed);
    }

    // 处理射击逻辑
    if (this.aimVisible) {
      this.shoot(this.getLookDirection(input));
    }

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

  /**
   * 获取当前射击热量百分比（0-1）
   * @returns 射击热量百分比
   */
  getHeatPercentage(): number {
    return 1 - (this.shootingTimeRemaining / this.maxShootingTime);
  }

  /**
   * 获取是否处于过热状态
   * @returns 是否过热
   */
  getIsOverheated(): boolean {
    return this.isOverheated;
  }

  /**
   * 获取过热冷却进度（0-1）
   * @returns 过热冷却进度
   */
  getOverheatCooldownProgress(): number {
    if (!this.isOverheated) return 0;
    return 1 - (this.overheatCooldownRemaining / this.maxOverheatCooldownTime);
  }

  /**
   * 绘制玩家（包含呼吸动画效果）
   * @param ctx Canvas渲染上下文
   * @param offsetX 绘制偏移X
   * @param offsetY 绘制偏移Y
   */
  draw(ctx: CanvasRenderingContext2D, offsetX: number = 0, offsetY: number = 0): void {
    const centerX = this.x + this.size / 2, centerY = this.y + this.size / 2;
    if (!this.wadingMap) {
      this.drawModel(ctx, centerX - offsetX, centerY - offsetY);
      return;
    }
    // A fixed maximum extent avoids reallocating the buffer on every breathing frame.
    const extent = Math.ceil(this.size * Math.SQRT2 * (1 + this.breathingAmplitude / 100)) + 4;
    const canvas = this.wadingCanvas ??= document.createElement('canvas');
    if (canvas.width !== extent || canvas.height !== extent) { canvas.width = extent; canvas.height = extent; }
    const buffer = canvas.getContext('2d')!;
    buffer.clearRect(0, 0, extent, extent);
    this.drawModel(buffer, extent / 2, extent / 2);
    buffer.save();
    buffer.globalCompositeOperation = 'source-atop'; buffer.globalAlpha = 0.35;
    this.wadingMap.drawWaterLayer(buffer, centerX - extent / 2, centerY - extent / 2, extent, extent);
    buffer.restore();
    ctx.drawImage(canvas, centerX - extent / 2 - offsetX, centerY - extent / 2 - offsetY);
  }

  private drawModel(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
    ctx.save();

    // Visual breathing only: getCollider() uses size and never this render scale.
    let scale = 1;
    if (this.isIdle()) {
      scale = Math.max(0, 1 + Math.sin(this.idleTime * this.breathingSpeed) * this.breathingAmplitude / 100);
    }

    // 应用变换并绘制
    ctx.translate(centerX, centerY);
    ctx.rotate(this.getBodyRotation());
    ctx.scale(scale, scale);

    // 绘制玩家精灵或占位符
    if (this.sprite) {
      ctx.drawImage(this.sprite, -this.size / 2, -this.size / 2, this.size, this.size);
    } else {
      ctx.fillStyle = "red";
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    }

    ctx.restore();
  }

  /** Screen-space overlays are drawn after lighting. */
  drawUI(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    this.drawWadingIndicator(ctx, offsetX, offsetY);
    this.drawAimPointer(ctx, offsetX, offsetY);
    this.drawCooldownRing(ctx, offsetX, offsetY);
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
