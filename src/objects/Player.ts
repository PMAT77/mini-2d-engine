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
import { DEFAULT_BALLISTICS, DEFAULT_MOVEMENT, DEFAULT_SPRINT, DEFAULT_ROLL, DEFAULT_BULLET_WATER_DRAG, parsePlayerCollider, parsePlayerConfig, PlayerConfig } from "./PlayerConfig";
import type { RollConfig, WeaponShootingConfig } from "./PlayerConfig";
import { ColliderShape } from "../physics/Collider";
import type { VisionState } from "../core/VisibilitySystem";
import type { FootstepEvent } from "./FootprintSystem";
import type { ReloadMode, WeaponKind, WeaponSlot, WeaponView } from "./Weapon";
import { drawMuzzleFlame } from "./WeaponVisuals";
import { getRollPose, interpolateRollPose, rollEntryBlend, rollExitBlend, rollStowedAlpha, rollVisualAngle, ROLL_REST_POSE } from "./RollPose";
import { advancePlayerAnimation, createPlayerRenderSnapshot, getPlayerMuzzleWorld, renderPlayerSnapshot } from "./animation/PlayerVisualAdapter";
import { drawCharacterShadow } from "../animation2d/render/CharacterCanvasRenderer";
import type { RollPose } from "./RollPose";

interface WeaponState {
  slot: WeaponSlot;
  name: string;
  kind: WeaponKind;
  damage: number;
  fireRate: number;
  bulletSpeed: number;
  /** 命中单位时施加的击退冲量；0 表示这把枪不产生击退。 */
  knockbackImpulse: number;
  magazineSize: number;
  magazineAmmo: number;
  chambered: boolean;
  reserveAmmo: number | null;
  reloadDuration: number;
  reloadRemaining: number;
  isReloading: boolean;
  /** 正在进行的补弹方式；空闲为 null。 */
  reloadMode: ReloadMode | null;
  /** 本次补弹动作的总时长（秒）；换弹 = reloadDuration，装填按缺弹数缩放。 */
  reloadTotal: number;
  /** 装填开始时的弹匣余弹；装填过程中按进度逐发补入。 */
  reloadBase: number;
  sound: string;
  /**
   * 枪声采样的有效起点（秒）。两段 Fire 采样开头都留了一段静音预卷，
   * 从 0 秒起播会让枪声慢半拍；跳到枪响前一刻，声音才贴得住枪口火焰。
   */
  shotStartAt: number;
  /** 换弹与装填共用的音效；空手为空串。 */
  reloadSound: string;
  /**
   * 换弹音效的播放速率。库里的 Full 采样是 4 秒的真实换弹，游戏里只有 1.4／2 秒，
   * 按 2 倍速播，退弹匣、插弹匣、拉套筒才都能落在换弹结束之前。
   */
  reloadRate: number;
}

const WEAPON_SWAP_DURATION = 0.28;
/** 装填比整匣更换更慢：每发耗时按缺弹比例换算。 */
const LOAD_TIME_FACTOR = 1.5;
/** 只补一两发时的最短装填时间（秒）。 */
const LOAD_MIN_SECONDS = 0.35;
/** 枪口火焰的持续时间（秒）；比冲锋枪 0.075 秒的射速略短。 */
const MUZZLE_FLASH_TIME = 0.07;

/** 受击晃动的视觉时长（秒）；只驱动动画，不改生命、位移或输入。 */
const HIT_REACT_SECONDS = 0.22;

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
/** 站立姿态的肘点在肩手连线上的位置：两段胶囊拼起来与旧版整根胶囊重合。 */
const NORMAL_ELBOW_T = 0.6;
/** 跑步摇摆权重的平滑速率（1/秒）：翻滚结束切回普通姿态时，摇摆不会一帧跳变。 */
const RUN_SWAY_WEIGHT_RATE = 12;
/** 翻滚速度包络：前 12% 加速、12–45% 保持、45–100% 减速。 */
const ROLL_ACCEL_END = 0.12;
const ROLL_DECEL_START = 0.45;
/**
 * 翻滚结束时普通移动的起步预热比例。
 * 翻滚末帧速度已经接近 0，若 movementTime 也从 0 开始，会再花 80ms 才回到全速，
 * 手感上就是起身后“顿一下”。这里预先推进一部分起步曲线，让第一帧就有明显速度，
 * 又保留几帧的加速过渡，不会从 0 直接跳到全速。
 */
const ROLL_EXIT_MOVEMENT_START = 0.45;

/** 速度包络：0–12% smoothstep 加速、12–45% 保持、45–100% smoothstep 减速；积分面积 0.665。 */
function rollEnvelopeArea(u: number): number {
  const p = Math.min(1, Math.max(0, u));
  if (p <= 0) return 0;
  if (p <= ROLL_ACCEL_END) {
    const t = ROLL_ACCEL_END > 0 ? p / ROLL_ACCEL_END : 1;
    return ROLL_ACCEL_END * (t * t * t - t * t * t * t / 2);
  }
  const accel = ROLL_ACCEL_END / 2;
  if (p <= ROLL_DECEL_START) return accel + (p - ROLL_ACCEL_END);
  const t = (p - ROLL_DECEL_START) / (1 - ROLL_DECEL_START);
  const fall = (1 - ROLL_DECEL_START) * (t - t * t * t + t * t * t * t / 2);
  return accel + (ROLL_DECEL_START - ROLL_ACCEL_END) + fall;
}

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
 * 当前帧交给骨架渲染器的姿态与变换。
 * 正常站立与翻滚共用同一份结构，测试可以直接采样它来验证
 * 抬枪/换枪/奔跑/翻滚之间的渲染连续性。
 */
export interface PlayerRenderState {
  pose: RollPose;
  /** 整个身体的朝向（已包含翻滚方向权重） */
  angle: number;
  /** 视觉呼吸缩放；翻滚中会在入场/收尾两端与站立值连续过渡 */
  scale: number;
  /** 斜挎武器的可见度；正常站姿为 1 */
  stowedAlpha: number;
  /** 物理翻滚进度；0 表示未在翻滚 */
  progress: number;
  rolling: boolean;
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
  private roll: RollConfig = { ...DEFAULT_ROLL };
  /** 翻滚动作剩余时间（秒）；> 0 表示翻滚中。 */
  private rollTimeLeft = 0;
  /** 从起滚开始计的锁定时间 = duration + cooldown；归零后才允许下一次翻滚。 */
  private rollCooldownLeft = 0;
  private rollDirection = new Vector2();
  /** 本帧翻滚的平均速度（世界像素/秒），由位移曲线反推，保证不同帧率位移一致。 */
  private rollSpeed = 0;
  /** 仅在调用 super.update 期间为真，让 updateVelocityNonlinear 走翻滚分支。 */
  private rollActive = false;
  /** 翻滚视觉接地强度：实际位移 / 预期位移，撞墙时趋近 0，只影响动画。 */
  private rollGroundingScale = 1;
  private rollDustSpawned = false;
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
  /** 翻滚动作是否进行中。 */
  isRolling(): boolean { return this.rollTimeLeft > 1e-9; }
  /** 翻滚进度 0–1；不在翻滚时为 0。 */
  getRollProgress(): number {
    if (!this.isRolling()) return 0;
    if (this.roll.duration <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.rollTimeLeft / this.roll.duration));
  }
  /** 翻滚锁定剩余时间（含动作与冷却）；0 表示可以起滚。 */
  getRollCooldownRemaining(): number { return this.rollCooldownLeft; }
  /** 起滚时锁定的方向（弧度）；视觉层用它与当前朝向插值。 */
  getRollAngle(): number { return Math.atan2(this.rollDirection.y, this.rollDirection.x); }
  /**
   * 翻滚视觉接地强度。实际位移被墙削掉时趋近 0，动画据此压低伪高度与前压，
   * 避免“原地滚却还在腾空”。只参与渲染，不参与任何玩法判定。
   */
  getRollGroundingScale(): number { return this.rollGroundingScale; }
  /** 受击晃动的剩余幅度 0–1：刚受击为 1，随后衰减到 0。只读，不影响生命或移动。 */
  getHitReactProgress(): number {
    return this.hitReactTime > 0 ? this.hitReactTime / HIT_REACT_SECONDS : 0;
  }
  /** 视觉朝向（弧度）：碰撞体朝向再旋转 −π/2。 */
  getVisualFacing(): number { return this.currentRotation - Math.PI; }
  /** 身体是否接触水体（任何水深，含岸边的一点重叠）；脚印湿度与涉水音效共用。 */
  isInWater(): boolean { return this.terrainWaterCoverage.fraction > 1e-6; }
  getHealth(): number { return this.health; }
  getMaxHealth(): number { return this.maxHealth; }
  takeDamage(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("伤害必须是非负有限数值");
    this.health = Math.max(0, this.health - amount);
    if (amount > 0) this.hitReactTime = HIT_REACT_SECONDS;
    this.onStatsChangeCallback?.();
  }
  heal(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("回血量必须是非负有限数值");
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.onStatsChangeCallback?.();
  }
  // 动画相关属性
  private hitReactTime: number = 0; // 受击晃动剩余时间（秒），仅视觉
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
  /** 枪口火焰剩余时间（秒）与这一发的随机种子；连发时每发换形状。 */
  private muzzleFlashTime = 0;
  private muzzleFlashSeed = 0;
  /** 战争迷雾半径（世界像素）；手电筒的张角和距离固定，不受这里影响。 */
  private visionRange = 400;
  private timeSinceShot = Infinity;
  private bullets: Bullet[] = []; // 存储玩家发射的子弹

  private fireCooldown: number = 0; // 开火冷却计时器（控制射速）

  private bulletWaterDrag = { ...DEFAULT_BULLET_WATER_DRAG };

  // 武器：主武器（冲锋枪）背在背上，副武器（格洛克手枪）挂在腰间，
  // 近战槽当前没有武器，C 键会收枪切换为空手。
  // 弹药与换弹状态按槽各自保存，切枪时通过 accessor 读写当前槽，进度不会丢失。
  private readonly weapons: Record<WeaponSlot, WeaponState> = {
    primary: {
      slot: "primary", name: "冲锋枪", kind: "firearm",
      damage: 16, fireRate: 0.075, bulletSpeed: 2800, knockbackImpulse: 200,
      magazineSize: 30, magazineAmmo: 30, chambered: true, reserveAmmo: null,
      reloadDuration: 2, reloadRemaining: 0, isReloading: false, reloadMode: null, reloadTotal: 0, reloadBase: 0,
      sound: "/audio/weapons/Fire/05_Pistol_Type5_Fire.wav", shotStartAt: 0.02,
      reloadSound: "/audio/weapons/Reload/Type_5/Pistol_Reload_Type_5_Full.wav", reloadRate: 2,
    },
    secondary: {
      slot: "secondary", name: "格洛克手枪", kind: "firearm",
      damage: 10, fireRate: 0.2, bulletSpeed: 2600, knockbackImpulse: 280,
      magazineSize: 6, magazineAmmo: 6, chambered: true, reserveAmmo: null,
      reloadDuration: 1.4, reloadRemaining: 0, isReloading: false, reloadMode: null, reloadTotal: 0, reloadBase: 0,
      sound: "/audio/weapons/Fire/01_Pistol_Type1_Fire.wav", shotStartAt: 0.009,
      reloadSound: "/audio/weapons/Reload/Type_1/Pistol_Reload_Type_1_Full.wav", reloadRate: 2,
    },
    melee: {
      slot: "melee", name: "空手", kind: "empty",
      damage: 0, fireRate: 0.2, bulletSpeed: 0, knockbackImpulse: 0,
      magazineSize: 0, magazineAmmo: 0, chambered: false, reserveAmmo: null,
      reloadDuration: 0, reloadRemaining: 0, isReloading: false, reloadMode: null, reloadTotal: 0, reloadBase: 0,
      sound: "", shotStartAt: 0, reloadSound: "", reloadRate: 1,
    },
  };
  private activeSlot: WeaponSlot = "secondary";
  private lastFirearmSlot: "primary" | "secondary" = "secondary";
  /** 换枪动作剩余时间（秒）；只影响绘制，不改变手部与弹道判定。 */
  private weaponSwapTime = 0;
  /** 调试选项：打空最后一发时是否自动换弹。默认关闭，正常流程只能按 R 换弹。 */
  private autoReload: boolean = false;
  /** R 键默认触发的补弹方式；调试面板可切换。 */
  private defaultReloadMode: ReloadMode = "reload";

  private get weapon(): WeaponState { return this.weapons[this.activeSlot]; }
  private get weaponName(): string { return this.weapon.name; }
  private get weaponKind(): WeaponKind { return this.weapon.kind; }
  private get magazineSize(): number { return this.weapon.magazineSize; }
  private set magazineSize(value: number) { this.weapon.magazineSize = value; }
  private get magazineAmmo(): number { return this.weapon.magazineAmmo; }
  private set magazineAmmo(value: number) { this.weapon.magazineAmmo = value; }
  private get chambered(): boolean { return this.weapon.chambered; }
  private set chambered(value: boolean) { this.weapon.chambered = value; }
  private get reserveAmmo(): number | null { return this.weapon.reserveAmmo; }
  private get reloadDuration(): number { return this.weapon.reloadDuration; }
  private set reloadDuration(value: number) { this.weapon.reloadDuration = value; }
  private get reloadRemaining(): number { return this.weapon.reloadRemaining; }
  private set reloadRemaining(value: number) { this.weapon.reloadRemaining = value; }
  private get isReloading(): boolean { return this.weapon.isReloading; }
  private set isReloading(value: boolean) { this.weapon.isReloading = value; }
  private get reloadMode(): ReloadMode | null { return this.weapon.reloadMode; }
  private set reloadMode(value: ReloadMode | null) { this.weapon.reloadMode = value; }
  private get reloadTotal(): number { return this.weapon.reloadTotal; }
  private set reloadTotal(value: number) { this.weapon.reloadTotal = value; }
  private get reloadBase(): number { return this.weapon.reloadBase; }
  private set reloadBase(value: number) { this.weapon.reloadBase = value; }
  private get fireRate(): number { return this.weapon.fireRate; }
  private set fireRate(value: number) { this.weapon.fireRate = value; }
  private get bulletSpeed(): number { return this.weapon.bulletSpeed; }
  private set bulletSpeed(value: number) { this.weapon.bulletSpeed = value; }
  private get damage(): number { return this.weapon.damage; }
  private set damage(value: number) { this.weapon.damage = value; }

  // 进度环可见性相关属性：只在换弹时显示
  private reloadBarAlpha: number = 0; // 进度环透明度（0-1）
  private fadeSpeed: number = 5; // 淡入淡出速度系数

  // 回调函数定义
  private onShootCallback?: (shootDir: Vector2) => void; // 射击回调，用于触发摄像机震动等效果
  private onBulletLandedCallback?: (x: number, y: number) => void; // 子弹自然停止回调，用于生成地面弹坑
  private onStatsChangeCallback?: () => void; // 属性变化回调
  private onReloadCallback?: (mode: ReloadMode) => void; // 补弹回调（开始补弹时触发，参数区分换弹/装填）
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

  /**
   * 原始移动意图，供边界反馈使用。
   * 撞墙后 Entities 会把向内速度清零，getVelocity() 读不到“还在往里推”。
   */
  getMoveIntent(input: Input): Vector2 {
    return this.getMoveDirection(input);
  }

  protected getMovementSpeed(): number {
    // 翻滚时上限提高到峰值速度，Entities 的子步钳制与地形系数会自动沿用这个上限。
    if (this.isRolling()) return this.getMaxSpeed() * this.roll.speedMultiplier;
    return this.getMaxSpeed() * (this.sprinting ? this.sprint.speedMultiplier : 1);
  }

  /** Smooth startup acceleration; angular damping does not slow turns or delay reversals. */
  protected updateVelocityNonlinear(targetVel: Vector2, dir: Vector2, delta: number): void {
    if (this.rollActive) {
      // 翻滚期间方向锁定：位移由解析曲线算好，这里只交出本帧平均速度，
      // 让 Entities 的子步、碰撞与地形减速照常生效。
      this.velocity = this.rollDirection.clone().scale(this.rollSpeed);
      return;
    }
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
    this.rollCooldownLeft = Math.max(0, this.rollCooldownLeft - delta);
    if (this.rollTimeLeft <= 0) this.rollGroundingScale = 1;
    let remaining = delta;
    if (this.rollTimeLeft > 0) {
      // 翻滚期间跳过疾跑与体力恢复：体力只在起滚时扣一次。
      this.sprinting = false;
      this.trailDistance = 0;
      this.sprintTime = 0;
      const step = Math.min(remaining, this.rollTimeLeft);
      const elapsed = this.roll.duration - this.rollTimeLeft;
      const distance = this.getRollDistance(elapsed + step) - this.getRollDistance(elapsed);
      this.rollSpeed = step > 0 ? distance / step : 0;
      this.rollActive = true;
      const beforeX = this.x;
      const beforeY = this.y;
      super.update(step, input, map);
      const intended = this.rollSpeed * step;
      this.rollGroundingScale = intended > 1e-6
        ? Math.min(1, Math.max(0, Math.hypot(this.x - beforeX, this.y - beforeY) / intended))
        : 1;
      this.rollActive = false;
      remaining -= step;
      this.rollTimeLeft = Math.max(0, this.rollTimeLeft - step);
      if (this.rollTimeLeft < 1e-9) this.rollTimeLeft = 0;
      this.emitRollDust();
      // 翻滚在本帧中结束：余下的时间继续普通移动，长帧不会把输入吞掉。
      if (this.rollTimeLeft > 0) return;
      this.handoffRollMovement(input);
    }
    if (remaining <= 1e-9) {
      // delta 为 0 时仍要走一次实体更新，让 map.limitPosition 把角色夹回地图边界。
      super.update(0, input, map);
      return;
    }
    const shift = input.isKeyDown("Shift");
    const moving = this.getMoveDirection(input).length() > 0;
    if (!shift && this.exhausted) this.releasedAfterExhaustion = true;
    this.unlockSprint();
    this.sprinting = shift && moving && !this.exhausted && this.stamina > 0;

    // Split the movement when stamina runs out, so low FPS never grants free sprint time.
    const sprintDelta = this.sprinting ? Math.min(remaining, this.stamina / this.sprint.drainPerSecond) : 0;
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

    const moveRemaining = remaining - sprintDelta;
    if (moveRemaining > 1e-9 || sprintDelta === 0) {
      this.sprinting = false;
      super.update(moveRemaining, input, map);
    }
    if (!this.sprinting) { this.trailDistance = 0; this.sprintTime = 0; }
    if (this.exhausted) {
      const speed = this.getMaxSpeed() * (map?.getShapeSpeedFactor(this.getCollider()) ?? 1);
      if (this.velocity.length() > speed) this.velocity.scale(speed / this.velocity.length());
    }

    const restDelta = consumed ? moveRemaining : remaining;
    const regenDelta = Math.max(0, restDelta - this.staminaRegenDelay);
    this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - restDelta);
    this.stamina = Math.min(this.sprint.maxStamina, this.stamina + regenDelta * this.sprint.regenPerSecond);
    this.unlockSprint();
  }

  /**
   * 翻滚物理结束的交接：如果玩家还按着方向，提前推进一点普通移动的起步曲线。
   * 只改 movementTime / movementDirection，不改位移、碰撞或翻滚距离；
   * 没有方向输入时保持原样，正常进入刹车。
   */
  private handoffRollMovement(input: Input): void {
    const move = this.getMoveDirection(input);
    if (move.length() === 0) return;
    this.movementTime = Math.max(
      this.movementTime,
      this.movement.startupDuration * ROLL_EXIT_MOVEMENT_START,
    );
    this.movementDirection.set(move.x, move.y);
    this.stopTime = 0;
  }

  /**
   * 请求一次翻滚：方向取当前移动输入，没有输入时用身体朝向；扣体力并进入动作+冷却锁定。
   * 返回 false 表示这次按下没有生效（正在翻滚、冷却中或体力不足）。
   */
  requestRoll(input: Input): boolean {
    if (this.rollTimeLeft > 0 || this.rollCooldownLeft > 1e-9) return false;
    if (this.roll.staminaCost > 0 && this.stamina < this.roll.staminaCost) return false;
    const move = this.getMoveDirection(input);
    if (move.length() > 0) {
      this.rollDirection = move.clone().normalize();
    } else {
      const facing = this.currentRotation - Math.PI;
      this.rollDirection.set(Math.cos(facing), Math.sin(facing));
    }
    this.rollTimeLeft = this.roll.duration;
    this.rollCooldownLeft = this.roll.duration + this.roll.cooldown;
    this.rollDustSpawned = false;
    this.rollSpeed = 0;
    this.rollGroundingScale = 1;
    this.sprinting = false;
    this.sprintTime = 0;
    this.trailDistance = 0;
    // 翻滚结束时不保留起步/刹车惯性，避免把动作位移再拖长一截。
    this.movementTime = 0;
    this.stopTime = 0;
    this.muzzleFlashTime = 0;
    // 不重置 armLift / shotPoseTime：翻滚入场和收尾都要混合回“真实的”抬枪姿态，
    // 起滚瞬间把手臂清零反而会在第一帧产生跳变。翻滚期间不开火，由射击限制兜底。
    if (this.roll.staminaCost > 0) {
      this.stamina = Math.max(0, this.stamina - this.roll.staminaCost);
      this.staminaRegenDelay = this.sprint.regenDelay;
      if (this.stamina < 1e-8) {
        this.stamina = 0;
        this.exhausted = true;
        this.releasedAfterExhaustion = false;
      }
    }
    this.spawnRollDust();
    this.onStatsChangeCallback?.();
    return true;
  }

  /**
   * 解析位移：三段速度包络的积分，u = t / duration。
   * v(u) = v0 · ramp(0→12%) · hold(12–45%) · fall(45→100%)，面积 0.665；
   * 默认 v0 = 200 × 2.15 = 430px/s、duration 0.42s，总位移约 120px。
   */
  private getRollDistance(elapsed: number): number {
    const total = this.roll.duration;
    const u = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 1;
    return this.getMaxSpeed() * this.roll.speedMultiplier * total * rollEnvelopeArea(u);
  }

  private emitRollDust(): void {
    if (this.rollDustSpawned || this.getRollProgress() < 0.5) return;
    this.rollDustSpawned = true;
    this.spawnRollDust();
  }

  /** 脚边一小团尘土：水中偏青，干地偏灰。 */
  private spawnRollDust(): void {
    this.particleSystem?.addParticle({
      x: this.x + this.size / 2 + this.rollDirection.x * this.size * 0.25,
      y: this.y + this.size / 2 + this.rollDirection.y * this.size * 0.25,
      size: 4,
      color: this.isInWater() ? "#9fd8e8" : "#c8d2d6",
      speed: 25,
      angle: Math.atan2(-this.rollDirection.y, -this.rollDirection.x),
      lifetime: 0.32,
    });
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
    // 水中与刚出水的脚印不同：前者是涉水涟漪，后者是湿脚印。
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
    // 权重平滑到目标值：翻滚结束切回普通姿态时，摇摆不会在一帧内跳变。
    this.runSwayWeight += (ratio - this.runSwayWeight) * (1 - Math.exp(-delta * RUN_SWAY_WEIGHT_RATE));
    this.runSwayPhase = (this.runSwayPhase + delta * this.runSwaySpeed * ratio) % (Math.PI * 2);
  }

  /**
   * World-space hand endpoint shared by rendering and projectile creation.
   * facing 可以显式传入，供姿态混合/测试在同一局部坐标系里取样。
   */
  getMuzzlePosition(facing: number = this.currentRotation - Math.PI): { x: number; y: number } {
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

  /** 把一组火力参数写到指定武器槽；容量缩小后余弹不能超出上限。 */
  private applyWeaponConfig(weapon: WeaponState, config: WeaponShootingConfig): void {
    if (config.damage !== undefined) weapon.damage = config.damage;
    if (config.fireRate !== undefined) weapon.fireRate = config.fireRate;
    if (config.bulletSpeed !== undefined) weapon.bulletSpeed = config.bulletSpeed;
    if (config.knockbackImpulse !== undefined) weapon.knockbackImpulse = config.knockbackImpulse;
    if (config.magazineSize !== undefined) {
      weapon.magazineSize = config.magazineSize;
      weapon.magazineAmmo = Math.min(weapon.magazineAmmo, weapon.magazineSize);
    }
    if (config.reloadDuration !== undefined) {
      const fraction = weapon.reloadTotal > 0 ? weapon.reloadRemaining / weapon.reloadTotal : 0;
      weapon.reloadDuration = config.reloadDuration;
      // 补弹途中改时长时保留已完成的进度比例
      if (weapon.isReloading) {
        weapon.reloadTotal = weapon.reloadMode === "load"
          ? this.getLoadDuration(weapon)
          : weapon.reloadDuration;
        weapon.reloadRemaining = Math.max(0, fraction * weapon.reloadTotal);
      }
    }
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
    if (config.roll) {
      this.roll = { ...this.roll, ...config.roll };
      if (this.rollTimeLeft > 0) this.rollTimeLeft = Math.min(this.rollTimeLeft, this.roll.duration);
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

    // 应用射击属性：shooting 是副武器 + 共享弹道，primaryShooting 只覆盖主武器火力。
    if (config.shooting) this.applyWeaponConfig(this.weapons.secondary, config.shooting);
    if (config.primaryShooting) this.applyWeaponConfig(this.weapons.primary, config.primaryShooting);

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
      movement: { ...this.movement }, sprint: { ...this.sprint }, roll: { ...this.roll },
      bulletWaterDrag: { ...this.bulletWaterDrag },
      animation: {
        breathingAmplitude: this.breathingAmplitude, breathingSpeed: this.breathingSpeed,
        runSwayAmplitude: this.runSwayAmplitude, runSwaySpeed: this.runSwaySpeed,
      },
      shooting: { ...this.ballistics, damage: this.weapons.secondary.damage, fireRate: this.weapons.secondary.fireRate,
        bulletSpeed: this.weapons.secondary.bulletSpeed, magazineSize: this.weapons.secondary.magazineSize,
        reloadDuration: this.weapons.secondary.reloadDuration, knockbackImpulse: this.weapons.secondary.knockbackImpulse },
      primaryShooting: { damage: this.weapons.primary.damage, fireRate: this.weapons.primary.fireRate,
        bulletSpeed: this.weapons.primary.bulletSpeed, magazineSize: this.weapons.primary.magazineSize,
        reloadDuration: this.weapons.primary.reloadDuration, knockbackImpulse: this.weapons.primary.knockbackImpulse },
      ui: { fadeSpeed: this.fadeSpeed },
    };
  }

  getDebugState() {
    return {
      health: this.health, stamina: this.stamina,
      magazineAmmo: this.magazineAmmo, magazineSize: this.magazineSize,
      chambered: this.chambered, roundsReady: this.magazineAmmo + (this.chambered ? 1 : 0),
      isReloading: this.isReloading, reloadMode: this.reloadMode, reloadProgress: this.getReloadProgress() * 100,
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
        if (!this.isReloading) {
          // 直接设定进度时按当前 R 键默认行为补一个动作，保证总时长与模式一致。
          this.reloadMode = this.defaultReloadMode;
          this.reloadTotal = this.reloadMode === "load" ? this.getLoadDuration() : this.reloadDuration;
          this.reloadBase = this.magazineAmmo;
        }
        const total = this.reloadTotal || this.reloadDuration;
        this.isReloading = true;
        this.reloadRemaining = (1 - progress / 100) * total;
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
   * 设置补弹回调：按 R 补弹（或调试开启自动换弹后打空）开始的那一刻触发。
   * 参数区分换弹/装填，便于分别配音。
   */
  setOnReloadCallback(callback: (mode: ReloadMode) => void): void {
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
    // 空手 / 近战槽没有枪，不能开火。
    if (!this.isArmed()) return;
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
    // 冲量在开火瞬间快照；之后切枪或改配置都不影响已发射的子弹。
    bullet.setImpactProfile({ impulse: this.weapon.knockbackImpulse });
    if (this.bulletEntityHitTest) bullet.setEntityHitTest(this.bulletEntityHitTest);
    // 冻结原始准星落点：后坐力散布只改弹道，不应改变“这一枪有没有瞄准火把”的判定。
    bullet.setAimTarget(target);
    if (map) bullet.checkLaunchPath(new Vector2(this.x + this.size / 2, this.y + this.size / 2), map);
    if (!bullet.getIsDestroyed()) this.bullets.push(bullet);
    this.recoil = Math.min(1, this.recoil + this.ballistics.recoilPerShot);
    this.timeSinceShot = 0;
    // 枪口火焰：纯视觉，只在真正打出一发时点亮，每发重新随机一个形状。
    this.muzzleFlashTime = MUZZLE_FLASH_TIME;
    this.muzzleFlashSeed = Math.random() * 1000;

    // 触发射击回调（用于摄像机震动等效果）
    this.onShootCallback?.(direction);

    // 更新状态
    this.stateMachine.changeState("shooting");
    this.isShooting = true;

    // 打空（6+1 全打完）时，只有调试面板开启自动换弹才立刻换弹；否则等玩家按 R。
    if (this.autoReload && !this.hasAmmo()) this.startReload("reload");
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

  /** 当前补弹方式；空手或空闲时为 null。 */
  getReloadMode(): ReloadMode | null {
    return this.reloadMode;
  }

  /** R 键默认补弹方式。 */
  getDefaultReloadMode(): ReloadMode {
    return this.defaultReloadMode;
  }

  /** 切换 R 键默认补弹方式；不影响正在进行的动作。 */
  setDefaultReloadMode(mode: ReloadMode): void {
    if (mode !== "reload" && mode !== "load") throw new Error(`无效补弹方式: ${mode}`);
    this.defaultReloadMode = mode;
  }

  /** 装填耗时：按缺弹比例缩放换弹时长，至少 LOAD_MIN_SECONDS 秒。 */
  private getLoadDuration(weapon: WeaponState = this.weapon,
    missing: number = weapon.magazineSize - weapon.magazineAmmo): number {
    if (weapon.magazineSize <= 0) return LOAD_MIN_SECONDS;
    return Math.max(LOAD_MIN_SECONDS, weapon.reloadDuration * LOAD_TIME_FACTOR * missing / weapon.magazineSize);
  }

  /** 开始补弹；mode 决定整匣更换还是逐发装填。 */
  private startReload(mode: ReloadMode): void {
    if (this.isReloading) return;
    this.reloadMode = mode;
    this.reloadTotal = mode === "load" ? this.getLoadDuration() : this.reloadDuration;
    this.reloadBase = this.magazineAmmo;
    this.isReloading = true;
    this.reloadRemaining = this.reloadTotal;
    // 交给场景播补弹音效
    this.onReloadCallback?.(mode);
  }

  /** 中止补弹并清零进度；开火会打断补弹。 */
  private cancelReload(): void {
    this.isReloading = false;
    this.reloadRemaining = 0;
    this.reloadTotal = 0;
    this.reloadBase = 0;
    this.reloadMode = null;
  }

  /** 补弹完成：换弹整匣补满并上膛，装填只补弹匣、膛内状态保持不变。 */
  private finishReload(): void {
    const mode = this.reloadMode ?? "reload";
    this.isReloading = false;
    this.reloadRemaining = 0;
    this.reloadTotal = 0;
    this.reloadMode = null;
    this.magazineAmmo = this.magazineSize;
    if (mode === "reload") this.chambered = true;
  }

  /** 打空最后一发后是否自动换弹（调试选项，默认关闭）。 */
  getAutoReload(): boolean { return this.autoReload; }

  /** 开关自动换弹；关闭时正在进行的换弹不受影响。 */
  setAutoReload(enabled: boolean): void { this.autoReload = !!enabled; }

  /**
   * 玩家按 R 补弹；mode 缺省时使用 R 键默认行为。
   * 弹匣已满、手里没有枪或正在补弹时什么都不做。
   */
  requestReload(mode: ReloadMode = this.defaultReloadMode): void {
    if (!this.isArmed()) return;
    if (this.isReloading) return;
    if (mode === "load") {
      // 装填只补弹匣；弹匣满时没有可装填的空间。
      if (this.magazineAmmo >= this.magazineSize) return;
    } else if (this.magazineAmmo >= this.magazineSize && this.chambered) {
      return;
    }
    this.startReload(mode);
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
    this.isShooting = !!this.pointerAim?.fire && !this.isRolling();
    this.updateRecoil(delta);
    if (this.hitReactTime > 0) this.hitReactTime = Math.max(0, this.hitReactTime - delta);
    if (this.weaponSwapTime > 0) this.weaponSwapTime = Math.max(0, this.weaponSwapTime - delta);
    if (this.muzzleFlashTime > 0) this.muzzleFlashTime = Math.max(0, this.muzzleFlashTime - delta);
    const startX = this.x, startY = this.y;
    const movingInput = this.getMoveDirection(input).length() > 0;
    this.updateMovement(delta, input, map);
    // 翻滚姿态本身不使用 armLift/armAngle；持续更新它们，末段混合回正常姿态时
    // 抬枪与瞄准方向才是当前值，不会在结束帧突然换成旧朝向。
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
    if (movingInput && !this.isRolling()) this.emitFootsteps(startX, startY);

    // 推进换弹：只有当前枪械槽会推进；切走时进度留在原枪上。
    if (this.isArmed() && this.isReloading) {
      this.reloadRemaining -= delta;
      if (this.reloadRemaining <= 1e-9) this.finishReload();
      else if (this.reloadMode === "load" && this.reloadTotal > 0) {
        // 装填逐发入匣：已经补进去的子弹即使中途打断也保留。
        const seated = Math.floor((1 - this.reloadRemaining / this.reloadTotal) * (this.magazineSize - this.reloadBase));
        this.magazineAmmo = Math.min(this.magazineSize, this.reloadBase + Math.max(0, seated));
      }
    }
    // 开启自动换弹后，打空弹匣即开始换弹；也兼作调试面板直接清空弹匣时的兜底。
    if (this.isArmed() && this.autoReload && !this.isReloading && !this.hasAmmo()) this.startReload("reload");

    // 射击间隔计时
    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
      if (!this.isShooting || delta >= this.getFireRate()) this.fireCooldown = Math.max(0, this.fireCooldown);
    }

    // 进度环只在当前枪械换弹时淡入淡出
    if (this.isArmed() && this.isReloading) {
      this.reloadBarAlpha = Math.min(1, this.reloadBarAlpha + delta * this.fadeSpeed);
    } else {
      this.reloadBarAlpha = Math.max(0, this.reloadBarAlpha - delta * this.fadeSpeed);
    }

    // 处理射击逻辑
    if (this.pointerAim?.fire && !this.isRolling()) this.shootAt(this.pointerAim.target, this.damage, map);

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

    // 动画后端推进：只在 rig 开关打开时运行，legacy 下不增加任何每帧工作。
    advancePlayerAnimation(this, delta);
  }

  /** 切到指定槽位；换弹进度留在原枪上，切回来会继续。 */
  switchWeapon(slot: WeaponSlot): void {
    if (slot === this.activeSlot) return;
    this.activeSlot = slot;
    if (slot !== "melee") this.lastFirearmSlot = slot;
    this.reloadBarAlpha = 0;
    this.weaponSwapTime = WEAPON_SWAP_DURATION;
  }

  /** Q/E：在两把枪之间循环；空手时直接拔出最近用过的枪。 */
  cycleFirearm(_direction: 1 | -1): void {
    if (this.activeSlot === "melee") {
      this.switchWeapon(this.lastFirearmSlot);
      return;
    }
    this.switchWeapon(this.activeSlot === "secondary" ? "primary" : "secondary");
  }

  /** C：有近战武器时进近战槽，否则收枪变空手；再按一次回到最近用过的枪。 */
  toggleMelee(): void {
    if (this.activeSlot === "melee") this.switchWeapon(this.lastFirearmSlot);
    else this.switchWeapon("melee");
  }

  getActiveWeaponSlot(): WeaponSlot {
    return this.activeSlot;
  }

  getLastFirearmSlot(): "primary" | "secondary" {
    return this.lastFirearmSlot;
  }

  /** 当前武器开火音效；空手返回空串，调用方据此跳过播放。 */
  getActiveWeaponSound(): string {
    return this.weapon.sound;
  }

  /** 当前武器枪声的起播秒数，用来跳过采样开头的静音预卷。 */
  getActiveWeaponSoundStartAt(): number {
    return this.weapon.shotStartAt;
  }

  /** 当前武器的换弹音效；空手返回空串。 */
  getActiveWeaponReloadSound(): string {
    return this.weapon.reloadSound;
  }

  /** 当前武器换弹音效的播放速率，用来把 4 秒的整段换弹压进动作时长。 */
  getActiveWeaponReloadRate(): number {
    return this.weapon.reloadRate;
  }

  /** 手里是否有能开火的枪。 */
  isArmed(): boolean {
    return this.weapon.kind === "firearm";
  }

  getWeaponName(): string {
    return this.weaponName;
  }

  getWeaponKind(): WeaponKind {
    return this.weaponKind;
  }

  /** HUD 用的当前武器快照；每帧读取一次，避免 UI 直接摸内部字段。 */
  getWeaponView(): WeaponView {
    return {
      slot: this.activeSlot,
      name: this.weaponName,
      kind: this.weaponKind,
      magazineAmmo: this.magazineAmmo,
      magazineSize: this.magazineSize,
      chambered: this.chambered,
      reserveAmmo: this.reserveAmmo,
      isReloading: this.isReloading,
      reloadMode: this.reloadMode,
      reloadProgress: this.getReloadProgress(),
    };
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
    const total = this.reloadTotal || this.reloadDuration;
    if (!this.isReloading || total <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.reloadRemaining / total));
  }

  /** 枪口火焰剩余时间（秒）；仅供测试和调试。 */
  getMuzzleFlashTime(): number {
    return this.muzzleFlashTime;
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
    // 骨架渲染现在是唯一路径；保留快照供阴影与枪口共用。
    const rigSnapshot = createPlayerRenderSnapshot(this);
    renderPlayerSnapshot(buffer, rigSnapshot, extent / 2, extent / 2);
    if (this.wadingMap) {
      buffer.save();
      buffer.globalCompositeOperation = 'source-atop'; buffer.globalAlpha = 0.35;
      this.wadingMap.drawWaterLayer(buffer, centerX - extent / 2, centerY - extent / 2, extent, extent);
      buffer.restore();
    }
    // 阴影必须画在离屏缓冲之外：放进缓冲会被 source-atop 水纹染色，也会被当作角色本体缩放。
    if (rigSnapshot.altitudePx > 0) {
      drawCharacterShadow(ctx, centerX - offsetX, centerY - offsetY, this.size, rigSnapshot.altitudePx);
    }
    ctx.drawImage(canvas, centerX - extent / 2 - offsetX, centerY - extent / 2 - offsetY);
  }

  /**
   * 枪口火焰。必须画在光照合成之后：它是一团光，画在前面会被环境光乘暗。
   * 位置与朝向来自 visualMuzzle socket，与手持武器共用同一套骨骼变换。
   */
  drawMuzzleFlash(ctx: CanvasRenderingContext2D, offsetX: number = 0, offsetY: number = 0): void {
    if (this.muzzleFlashTime <= 0 || !this.isArmed()) return;
    const socket = getPlayerMuzzleWorld(this);
    const intensity = Math.min(1, this.muzzleFlashTime / (MUZZLE_FLASH_TIME * 0.4));
    ctx.save();
    ctx.translate(socket.x - offsetX, socket.y - offsetY);
    ctx.rotate(socket.facing);
    drawMuzzleFlame(ctx, this.size, intensity, this.muzzleFlashSeed);
    ctx.restore();
  }

  /**
   * 正常站立/奔跑/瞄准姿态的数据（不直接绘制）。
   * 翻滚入场把这份真实姿态混合进翻滚姿态，收尾再混合回来，因此抬枪、
   * 换枪偏移、跑步摇摆和瞄准方向都能连续衔接，而不是硬编码回 ROLL_REST_POSE。
   */
  getNormalPose(s: number = this.size, facing: number = this.currentRotation - Math.PI): RollPose {
    const c = Math.cos(facing), sn = Math.sin(facing);
    const muzzle = this.getMuzzlePosition(facing);
    const dx = muzzle.x - this.x - s / 2, dy = muzzle.y - this.y - s / 2;
    const hand = { x: dx * c + dy * sn, y: -dx * sn + dy * c };
    // Running sway: the hands swing front and back in opposite phase (alternating),
    // while the head sways laterally at a smaller amplitude; hands only while lowered.
    const sway = s * this.runSwayAmplitude / 100 * this.runSwayWeight;
    const headSway = Math.sin(this.runSwayPhase) * sway * RUN_SWAY_HEAD_SCALE;
    const handSway = Math.sin(this.runSwayPhase - RUN_SWAY_HAND_LAG) * sway
      * RUN_SWAY_HAND_SCALE * (1 - this.armLift);
    const swapProgress = this.weaponSwapTime > 0 ? 1 - this.weaponSwapTime / WEAPON_SWAP_DURATION : 1;
    const swap = Math.sin(Math.PI * swapProgress);
    const handX = hand.x - s * .10 * swap, handY = hand.y + s * .18 * swap;
    const leftX = s * .04 * (1 - this.armLift) + hand.x * .67 * this.armLift;
    const leftY = -s * .46 * (1 - this.armLift) + (hand.y - s * .13) * this.armLift;
    const pose: RollPose = {
      ...ROLL_REST_POSE,
      headY: headSway / s,
      leftHandX: (leftX + handSway) / s, leftHandY: leftY / s,
      rightHandX: (handX - handSway) / s, rightHandY: handY / s,
    };
    // 肘落在肩手连线上：两段胶囊与旧版的一整根完全重合。
    const elbow = (sx: number, sy: number, hx: number, hy: number): [number, number] =>
      [sx + (hx - sx) * NORMAL_ELBOW_T, sy + (hy - sy) * NORMAL_ELBOW_T];
    [pose.leftElbowX, pose.leftElbowY] = elbow(pose.leftShoulderX, pose.leftShoulderY, pose.leftHandX, pose.leftHandY);
    [pose.rightElbowX, pose.rightElbowY] = elbow(pose.rightShoulderX, pose.rightShoulderY, pose.rightHandX, pose.rightHandY);
    return pose;
  }

  /**
   * 本帧绘制所需的姿态/朝向/缩放/斜挎武器透明度。
   * 翻滚入场（0–12%）从当前真实姿态混入，收尾（84–100%）混回当前真实姿态；
   * 两端都调用同一份 getNormalPose，所以物理翻滚结束的那一帧不会跳变。
   */
  getRenderState(): PlayerRenderState {
    const facing = this.getVisualFacing();
    const progress = this.getRollProgress();

    // Visual breathing only: getCollider() uses size and never this render scale.
    let breathScale = 1;
    if (this.isIdle() && this.armLift === 0) {
      breathScale = Math.max(0, 1 + Math.sin(this.idleTime * this.breathingSpeed) * this.breathingAmplitude / 100);
    }

    if (progress <= 0) {
      return {
        pose: this.getNormalPose(this.size, facing),
        angle: facing,
        scale: breathScale,
        stowedAlpha: 1,
        progress: 0,
        rolling: false,
      };
    }

    const rollAngle = this.getRollAngle();
    const angle = rollVisualAngle(progress, facing, rollAngle);
    const enter = rollEntryBlend(progress);
    const exit = rollExitBlend(progress);
    let pose = getRollPose(progress);
    let scale = 1;
    if (enter < 1 || exit > 0) {
      const normal = this.getNormalPose(this.size, facing);
      if (enter < 1) pose = interpolateRollPose(normal, pose, enter);
      if (exit > 0) pose = interpolateRollPose(pose, normal, exit);
      // 呼吸缩放也沿同一段过渡，避免起滚/结束帧整颗人突然缩一下。
      const breath = exit > 0 ? exit : 1 - enter;
      scale = 1 + (breathScale - 1) * breath;
    }

    return {
      pose,
      angle,
      scale,
      stowedAlpha: rollStowedAlpha(progress),
      progress,
      rolling: true,
    };
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
