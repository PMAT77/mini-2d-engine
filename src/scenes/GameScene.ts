import { StructureSystem, structureCollider } from '../structures/StructureSystem';
import { WOOD_WALL } from '../structures/StructureDefinition';
import { StructurePanel } from '../ui/StructurePanel';
import { PausePanel } from '../ui/PausePanel';
import { DayClockHud } from '../ui/DayClockHud';
import type { DayClockHudState } from '../ui/DayClockHudLayout';
import type { LocationManager } from '../campaign/LocationManager';
import type { LocationState, PersistentPlayerState, CurrentLocationCheckpoint, GroundItemState, Pose, QuickSlots, EffectStat } from '../campaign/CampaignState';
import { parsePersistentPlayer } from '../campaign/CampaignState';
import { captureFirearm } from '../objects/Player';
import { LOCATION_DEFINITIONS } from '../campaign/LocationDefinitions';
import { ZOMBIE_CONFIG } from '../enemies/ZombieConfig';
import { TradingStation } from '../objects/TradingStation';
import { collectBlastTerrain } from '../throwables/BlastTerrain';
import { Camera } from "../core/Camera";
import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
import { MenuScene } from "./MenuScene";
import { resolveFirstDamageableHit, resolveFirstMeleeHit } from "../combat/HitTargetResolver";
import { PUNCH_MOVES, PUNCH_RANGE } from '../combat/PlayerPunchController';
import { CombatScoreSystem } from "../combat/CombatScoreSystem";
import { ActorCollisionWorld } from "../physics/ActorCollisionWorld";
import { EnemySystem, selectPlayerNoises } from "../enemies/EnemySystem";
import type { DamageableEntry } from "../combat/HitTargetResolver";
import { Zombie } from "../enemies/Zombie";
import { ZombieGoreSystem } from "../enemies/ZombieGoreSystem";
import { DamageFeedbackOverlay } from "../ui/DamageFeedbackOverlay";
import { COMBAT_FEEDBACK as C } from "../combat/CombatFeedbackConfig";
import { EncounterSpawning } from "../enemies/EncounterSpawning";
import { PlayerSurvivalSystem } from "../survival/PlayerSurvivalSystem";
import { PlayerStatusHud, getPlayerStatusHudRect } from "../ui/PlayerStatusHud";
import { drawPlayerVitalsHud, getPlayerVitalsHudRect } from "../ui/PlayerVitalsHud";
import { BackpackHud, getBackpackHudRect } from "../ui/BackpackHud";
import { QuickSlotHud, getQuickSlotHudLayout } from "../ui/QuickSlotHud";
import { BackpackPanel } from "../ui/BackpackPanel";
import { createBackpackView, createQuickSlotViews, type BackpackItemId } from "../ui/BackpackView";
import { VaccinePickup } from "../objects/VaccinePickup";
import { DroppedWeaponPickup } from "../objects/DroppedWeaponPickup";
import type { InteractablePickup } from "../interaction/InteractablePickup";
import { TileMap, TileMapOptions } from "../map/TileMap";
// 世界几何（实心地形轮廓）由 TileMap 统一提供，绘制时不再直接遍历多边形。
import { TileTypeId, getTileType } from "../map/TileType";
import { Vector2 } from "../math/Vector2";
import { ParticleSystem } from "../objects/ParticleSystem";
import { CraterSystem } from "../objects/CraterSystem";
import { BloodStainSystem } from "../objects/BloodStainSystem";
import { FootprintSystem } from "../objects/FootprintSystem";
import { RippleSystem } from "../objects/RippleSystem";
import { SoundRippleSystem } from "../objects/SoundRippleSystem";
import { BoundaryRippleSystem } from "../objects/BoundaryRippleSystem";
import { MapBoundaryOverlay } from "../map/MapBoundaryOverlay";
import { Player, PlayerAimInput } from "../objects/Player";
import { PlayerConfig } from "../objects/PlayerConfig";
import { THROWABLE_CONFIG as TC, THROWABLE_IDS, THROWABLE_ITEMS, isThrowable, blastDamage, type ThrowableId } from '../throwables/ThrowableConfig';
import { ThrowableController } from '../throwables/ThrowableController';
import { parseLocationResume } from '../campaign/LocationResumeState';
import type { LocationResumeState } from '../campaign/LocationResumeState';
import { launchThrowable, stepThrowable, previewThrow, type ThrowableBody } from '../throwables/ThrowablePhysics';
import { SmokeSystem } from '../throwables/SmokeSystem';
import { ThrowablePickup, drawThrowable } from '../throwables/ThrowablePickup';
import { Chicken } from "../objects/Chicken";
import { PlayerDebugPanel } from "../ui/PlayerDebugPanel";
import { FloatingTextSystem } from "../ui/FloatingTextSystem";
import { WeaponListHud, getWeaponListLayout } from "../ui/WeaponListHud";
import { preloadWeaponHudAssets } from "../ui/WeaponHudAssets";
import { FlashlightHud, getFlashlightHudRect } from "../ui/FlashlightHud";
import { CrosshairOverlay, getCrosshairOffset } from "../ui/CrosshairOverlay";
import { KillIndicator } from "../ui/KillIndicator";
import { NoiseSystem } from "../core/NoiseSystem";
import { computeAudibleGain } from "../core/SoundAttenuation";

// 导入光照系统相关类
import { ConfigLoader } from "../core/ConfigLoader";
import { LightSource } from "../core/LightSource";
import { ConeLight } from "../core/ConeLight";
import { LightingSystem } from "../core/LightingSystem";
import { sampleEnvironment, type EnvironmentState } from '../core/EnvironmentLighting';
import { drawBodySunShadow, type DirectionalLight } from '../core/DirectionalShadow';
import { VisibilitySystem } from "../core/VisibilitySystem";
import { PerceptionSystem } from "../vision/PerceptionSystem";
import { HearingSensor } from "../ai/HearingSensor";
import { PerceptionRenderer } from "../vision/PerceptionRenderer";
import { createVisionRules } from "../vision/VisionRules";
import type {
  EntityVisibility, PerceptionLight, PerceptionTarget, PerceptionView, VisionDebugLayer,
  VisionMode, VisionObserver,
} from "../vision/VisionTypes";
import { ModifierManager } from "../core/ModifierManager";
import {
  AudioConfig, DEFAULT_AUDIO_CONFIG, cloneAudioConfig, parseAudioConfig,
} from "../core/AudioConfig";
import {
  GraphicsConfig, DEFAULT_GRAPHICS_CONFIG, cloneGraphicsConfig, parseGraphicsConfig,
} from "../core/GraphicsConfig";

import { PickupItem, PickupType } from "../objects/PickupItem";
import { GoldPickup } from "../objects/GoldPickup";
import { MeatPickup } from "../objects/MeatPickup";
import { InteractionController } from "../interaction/InteractionController";
import type { InteractionSnapshot } from "../interaction/InteractionController";
import {
  createPickupCandidate,
  type PickupCandidate,
} from "../interaction/PickupTargetResolver";
import { resolvePickupVisibility, type PickupVisibilityDecision } from "../interaction/PickupVisibilityPolicy";
import type { PickupConfig, PickupMarker } from "../interaction/PickupTypes";
import { PickupPromptRenderer } from "../ui/PickupPromptRenderer";
import { CircularMinimapHud } from "../ui/CircularMinimapHud";
import { collectMineralMarkers } from "../minimap/MinimapMarkerSources";
import { entityMarkerId } from "../minimap/MinimapMarkerStore";
import type { MinimapMarkerSpec } from "../minimap/MinimapTypes";
import { hasLineOfSight } from "../vision/SightGeometry";
import type { BulletEntityHit } from "../objects/Bullet";
import type { BulletImpact, DeathFinished } from "../combat/CombatTypes";
import { Torch } from "../objects/Torch";
import { seededRandom } from "../map/WaterTerrain";
import { ColliderShape, DEFAULT_SHAPE, compileShape, rectangleCollider, circleCollider, transformCollider } from "../physics/Collider";
import { SoundPlayer } from "../core/SoundPlayer";
import type { PlayOptions, SoundHandle } from "../core/SoundPlayer";

/**
 * 声音资源。目录按 `public/audio/<分类>/<用途>.<扩展名>` 组织，分类与 audioConfig 的分组
 * （footsteps／pickups／flashlight／chicken／weapon）一一对应，文件名只写用途、不重复分类。
 * 枪声与换弹声由当前武器决定，见 Player 的武器状态。
 */
/** 干地循环与涉水循环。 */
const DRY_STEP_SOUND = "/audio/footsteps/dry.wav";
const WATER_STEP_SOUND = "/audio/footsteps/water.wav";
/** 小鸡：走路时每一步的轻响，以及停下时偶尔的叫声。 */
const CHICKEN_STEP_SOUND = "/audio/chicken/step.wav";
/** 三段真实鸡叫，每次随机取一段；每段都完整播完，不用同一句反复循环。 */
const CHICKEN_CLUCK_SOUNDS = [
  "/audio/chicken/cluck-1.mp3",
  "/audio/chicken/cluck-2.mp3",
  "/audio/chicken/cluck-3.mp3",
] as const;
/** 拾取：肉块只留入口的第一口撕咬（采样已裁到 0.75 秒），金块是一声硬币落袋的清脆响。 */
const MEAT_PICKUP_SOUND = "/audio/pickups/meat.wav";
const GOLD_PICKUP_SOUND = "/audio/pickups/gold.wav";
/** 机械咔嗒声：手电开关（开灯、关灯都播）与滚轮切枪共用同一段采样。 */
const SWITCH_CLICK_SOUND = "/audio/flashlight/switch.mp3";



/** 画面配置里保存的是 #RRGGBB 与 0–2 的亮度，光照系统需要 rgba 字符串。 */
function hexToRgba(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}

/**
 * 是否开发构建。
 *
 * 首选 `__DEV__`：生产构建会被替换成 `false`，开发服务器由 Vite 注入同名全局。
 * 部分浏览器测试会把 `/@vite/client` 打桩（避免 HMR 连接），此时 Vite 注入全局的
 * 时机被跳过，因此用入口脚本路径兜底：开发服务器加载 `/src/main.ts`，生产构建加载
 * 带哈希的 `/assets/*.js`。
 */
function isDevelopmentBuild(): boolean {
  if (typeof __DEV__ !== "undefined") return __DEV__ === true;
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('script[type="module"][src*="/src/main.ts"]'));
}

/**
 * 视觉模式解析。
 *
 * 正式规则：三层感知是唯一受支持的玩法视野。生产构建永远返回 three-layer，
 * 不允许玩家用 URL 恢复“地形全可见”的 legacy 模式来绕过探索与黑暗规则。
 * 开发构建保留 legacy 作为回归与对照路径：只有显式 `?vision=legacy` 才启用，
 * 其余（无参数、`?vision=three-layer`、未知值）一律三层。
 *
 * 玩法模式不写进 graphicsConfig.json，也不受 F2 画质面板影响。
 */
function resolveVisionMode(): VisionMode {
  if (!isDevelopmentBuild()) return "three-layer";
  if (typeof window === "undefined") return "three-layer";
  const value = new URLSearchParams(window.location?.search ?? "").get("vision");
  return value === "legacy" ? "legacy" : "three-layer";
}

/**
 * 图层隔离调试层：`?visionDebug=outline` 等。
 * 只在开发构建生效——生产构建下 `world` 会暴露未探索地图，必须关闭。
 */
function resolveVisionDebugLayer(): VisionDebugLayer | null {
  if (!isDevelopmentBuild()) return null;
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location?.search ?? "").get("visionDebug");
  switch (value) {
    case "world":
    case "outline":
    case "memory":
    case "near":
    case "light":
    case "grid":
      return value;
    default:
      return null;
  }
}

/**
 * 游戏主场景类，负责管理游戏的核心逻辑、渲染和交互
 */
export interface GameSceneOptions extends TileMapOptions {
  map?: TileMap;
  /** Top-left player position, applied before radius-safe encounter generation. */
  playerSpawn?: { x: number; y: number };
  encounters?: { shambler?: number; runner?: number; vaccines?: number; grenades?: number; smokeGrenades?: number; tradingStations?: number };
  chickenCount?: number;
  campaignData?: { location: LocationState; player?: PersistentPlayerState; pose: Pose; nextInstanceSequence: number; runtime?: LocationResumeState };
}

export class InvalidLocationStateError extends Error {}

export class GameScene extends Scene {
  private player!: Player;
  campaign?: LocationManager;
  private readonly dayClockHud = new DayClockHud();
  private dayClockPreview?: DayClockHudState;
  private transitionPaused = false;
  private hiddenPaused = false;
  private readonly baseTiles: TileTypeId[][];
  private readonly baseHp: number[][];
  private readonly persistentItemIds = new WeakMap<object, string>();
  private nextInstanceSequence = 0;
  private readonly actorWorld: ActorCollisionWorld;
  private readonly enemies: EnemySystem;
  private readonly enemyBlood: BloodStainSystem;
  private readonly zombieGore: ZombieGoreSystem;
  private readonly damageFeedback = new DamageFeedbackOverlay();
  private feedbackResetVersion = 0;
  private readonly survival: PlayerSurvivalSystem;
  private readonly statusHud = new PlayerStatusHud();
  private vaccinePickups: VaccinePickup[] = [];
  private weaponPickups: DroppedWeaponPickup[] = [];
  private throwablePickups: ThrowablePickup[] = [];
  private readonly throwable: ThrowableController;
  private readonly smoke: SmokeSystem;
  private throwableBodies: ThrowableBody[] = [];
  private throwableId = 0;
  private throwableRemainder = 0;
  private explosions: { x: number; y: number; age: number }[] = [];
  private focusPaused = false;
  private readonly onFocusLost = () => { if (this.active) { this.cancelConstructionDrag(); this.focusPaused = true; this.syncModalState(); this.campaign?.requestSave(); } };
  private readonly onFocusGained = () => { if (this.active) { this.focusPaused = false; this.game?.resetFrameTime?.(); this.syncModalState(); } };
  private readonly onVisibilityChange = () => {
    if (this.active) {
      this.hiddenPaused = document.hidden; this.game?.resetFrameTime?.(); this.syncModalState();
      if (this.hiddenPaused) { this.cancelConstructionDrag(); this.campaign?.requestSave(); }
    }
  };
  private readonly quickSlotBindings: (BackpackItemId | null)[] = [null, null, null, null];
  private quickItemUse?: { slot: number; elapsed: number; inputReset: number | undefined };
  private vaccineHeld = false;
  private paused = false;
  private explicitPaused = false;
  private pausePanel?: PausePanel;
  private tradingStations: TradingStation[] = [];
  private focusedStation?: TradingStation;
  private tradeHeld = false;
  private lastTradingStationId: string | null = null;
  private readonly zombieDebugPaths: boolean;
  private readonly runSeed: number;
  private readonly spawnRandom: () => number;
  private inputResetVersion = 0;
  private deathEnterHeld = true;
  private chickens: Chicken[] = [];
  private map!: TileMap;
  private camera!: Camera;
  private worldCanvas!: HTMLCanvasElement;
  private worldContext!: CanvasRenderingContext2D;
  /** 单位层：掉落物、拾取物、投射物、粒子；只受迷雾裁剪。 */
  private unitCanvas!: HTMLCanvasElement;
  private unitContext!: CanvasRenderingContext2D;
  /** 后处理层：金块光晕等叠加光效，同样按迷雾裁剪后以 lighter 合成。 */
  private effectCanvas!: HTMLCanvasElement;
  private effectContext!: CanvasRenderingContext2D;
  private displayedView?: { x: number; y: number; width: number; height: number };
  /** 单位层与光效层当前帧的内容包围盒（画布像素），用于跳过空白区域的全屏合成。 */
  private readonly unitBounds = { x: 0, y: 0, width: 0, height: 0 };
  private readonly effectBounds = { x: 0, y: 0, width: 0, height: 0 };
  private configLoader!: ConfigLoader;
  private graphics: GraphicsConfig = DEFAULT_GRAPHICS_CONFIG;
  /** 视觉玩法模式：legacy 保持旧圆形迷雾；three-layer 启用感知遮蔽。 */
  readonly visionMode: VisionMode;
  /** 开发期图层隔离（`?visionDebug=`）；null 表示正常合成。 */
  /** 调试层暴露给浏览器测试读取；生产构建恒为 null。 */
  readonly visionDebugLayer: VisionDebugLayer | null;
  private readonly visionRules = createVisionRules();
  private perception: PerceptionSystem | null = null;
  private perceptionRenderer: PerceptionRenderer | null = null;
  private perceptionObserver: VisionObserver | null = null;
  private readonly perceptionLights: PerceptionLight[] = [];
  private readonly perceptionTargets: PerceptionTarget[] = [];
  private readonly perceptionIds = new WeakMap<object, string>();
  private nextPerceptionId = 0;
  /** 剪影复用的临时画布；按最大目标尺寸增长，不在每帧为每只目标 new canvas。 */
  private silhouetteCanvas: HTMLCanvasElement | null = null;
  private audio: AudioConfig = DEFAULT_AUDIO_CONFIG;
  /** 击发、拾取等一次性音效。 */
  private readonly sfx = new SoundPlayer();
  /** 正在播放的换弹音效；换弹结束或被打断时提前收掉，不会拖到下一声枪响上。 */
  private reloadVoice: SoundHandle | null = null;
  /** 小鸡的脚步声与叫声各自计时：叫声稀疏，不能被密集的脚步挤掉。 */
  private chickenStepDelay = 0;
  /** 每只鸡独立的叫声冷却：全局冷却会让一只鸡的叫声吞掉另一只鸡刚被吓到的惊叫。 */
  private readonly chickenCluckCooldowns = new Map<Chicken, number>();
  /** 每只鸡稳定的发声者 id：噪声事件在鸡群传播时能区分是谁叫的。 */
  private readonly chickenSoundIds = new WeakMap<Chicken, string>();
  private chickenSoundSeq = 0;
  /** 正在响的鸡叫：带上是哪只鸡，鸡被击杀时要立刻把这一声收掉。 */
  private activeClucks: {
    handle: SoundHandle;
    chicken: Chicken;
    x: number;
    y: number;
    volume: number;
    /** 本帧实际使用的增益，逐帧向目标值平滑，避免玩家走动时音量阶跃。 */
    gain: number;
  }[] = [];
  /** 受惊惊叫需要短促收尾：录音整段有 6.7–8.2 秒，不能拖在逃跑后面。 */
  private pendingCluckStops: { handle: SoundHandle; remaining: number }[] = [];
  private loaded: boolean = false;
  private loadingPromise?: Promise<void>;
  private loadError = "";
  private active = false;
  private debugPanel?: PlayerDebugPanel;
  private backpackPanel?: BackpackPanel;
  private structures?: StructureSystem;
  private structurePanel?: StructurePanel;
  private structuresChanged = false;
  private constructionDrag?: { pointerId: number; target: HTMLElement; overMap: boolean };
  private constructionTouchAction = '';
  private readonly constructionPointer = (event: PointerEvent) => {
    if (!this.structurePanel?.isOpen()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.button !== 0 || !event.isPrimary || this.constructionDrag) return;
    if (this.selectConstructionPoint(event) && !this.structures?.at(this.structurePanel.col, this.structurePanel.row)) this.startConstructionDrag(event);
  };
  private readonly constructionHover = (event: PointerEvent) => {
    const panel = this.structurePanel;
    if (panel?.isOpen() && !this.constructionDrag && event.pointerType === 'mouse' && !event.buttons && !this.structures?.at(panel.col, panel.row)) this.selectConstructionPoint(event);
  };
  private readonly constructionMove = (event: PointerEvent) => {
    if (this.constructionDrag?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.constructionDrag.overMap = this.selectConstructionPoint(event);
  };
  private readonly constructionRelease = (event: PointerEvent) => {
    if (this.constructionDrag?.pointerId !== event.pointerId || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const overMap = this.selectConstructionPoint(event);
    this.cancelConstructionDrag();
    if (overMap) this.structurePanel?.perform('build');
  };
  private readonly constructionCancel = (event: PointerEvent) => {
    if (this.constructionDrag?.pointerId === event.pointerId) this.cancelConstructionDrag();
  };
  private modalActive = false;
  private initialPlayerConfig?: PlayerConfig;
  private initialGraphics?: GraphicsConfig;
  private initialAudio?: AudioConfig;
  /**
   * 窗口尺寸变化必须同步生效：renderer 尺寸、相机与离屏画布一旦错位，后续所有绘制都会
   * 用旧 viewport 采样。拖拽 resize 的连续开销由浏览器自身的 resize 节流承担。
   */
  private readonly resizeListener = () => {
    this.cancelConstructionDrag();
    this.handleResize();
  };
  /** ESC owns pause before any panel keyboard handlers. */
  private readonly cursorKeyListener = (event: KeyboardEvent) => {
    if (!this.active || !this.loaded || event.repeat) return;
    if (this.structurePanel?.isOpen() && ['Escape', 'r', 'R', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const panel = this.structurePanel;
      if (event.key === 'Escape') panel.setOpen(false);
      else if (event.key === 'r' || event.key === 'R') panel.rotate();
      else panel.select(panel.col + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0),
        panel.row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0));
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); this.setExplicitPaused(!this.explicitPaused);
  };
  private cursorVisible = false;
  private deltaSinceLastFrame: number = 0;

  // 添加玩家光源引用
  private playerLight: LightSource;
  /** 面朝方向的手电筒锥光，G 键开关。 */
  private flashlight: ConeLight;
  private flashlightOn = true;
  private flashlightHeld = false;
  private reloadHeld = false;
  private cHeld = false;
  private spaceHeld = false;
  /** 按键拾取控制器：只接管 INTERACT 物品，AUTO 仍走各自碰撞流程。 */
  private readonly interaction = new InteractionController<InteractablePickup>();
  /** 本帧通过可见性过滤的交互候选与可绘制标记（世界坐标）。 */
  private pickupCandidates: PickupCandidate<InteractablePickup>[] = [];
  private pickupMarkers: { marker: PickupMarker; target: InteractablePickup | GoldPickup }[] = [];
  /** 拾取提示纯视觉层；不参与按键判断与结算。 */
  private readonly pickupPrompt = new PickupPromptRenderer();
  private readonly tradingPrompt = new PickupPromptRenderer(
    "/assets/images/ui/keyboard-mouse/64/Keyboard_T.png", "T",
  );
  private promptTime = 0;
  /** 本帧完成拾取的屏幕反馈锚点（世界坐标），只用于很短的完成动画。 */
  private completedPickupFeedback: { x: number; y: number } | null = null;
  /** 本帧开火/切枪：与翻滚一起作为交互取消信号。 */
  private shotThisFrame = false;
  private weaponSwitchedThisFrame = false;
  /** 场景刚退出的那一帧不允许再结算，避免幽灵拾取；进入场景后重新打开。 */
  private interactionEnabled = true;
  /** 准星收缩进度：0 = 未瞄准，1 = 完全收紧。 */
  private crosshairTighten = 0;
  /** 独立于世界帧的准星图层；位置由鼠标事件直接驱动。 */
  private crosshairOverlay?: CrosshairOverlay;

  // 常量定义
  private static readonly PLAYER_SIZE = 49;
  private static readonly GOLD_DROP_COUNT = 10;
  private static readonly GOLD_DROP_THRESHOLDS = [0.9, 0.7, 0.5, 0.3, 0.1];
  /** 出生点周围随机游荡的小鸡数量。 */
  private static readonly CHICKEN_COUNT = 6;
  /** 同一只鸡两次叫声之间的最短间隔（秒）。 */
  private static readonly CHICKEN_CLUCK_COOLDOWN = 0.9;
  /** 同时播放的鸡叫上限：六只鸡同时受惊时只留最响的几声，世界事件一条不少。 */
  private static readonly MAX_CHICKEN_VOICES = 3;
  /** 鸡叫音量向目标值逼近的速度（每秒比例），避免玩家移动时出现阶跃。 */
  private static readonly CLUCK_GAIN_RATE = 6;
  /** 受惊惊叫的截断时长：保留短促的一声，不跟着录音拖满整段。 */
  private static readonly CHICKEN_SCREAM_SECONDS = 0.55;
  /** 准星：每秒收紧、回弹速度；外扩/内收幅度见 getCrosshairOffset。 */
  private static readonly CROSSHAIR_TIGHTEN_RATE = 9;
  private static readonly CROSSHAIR_RELEASE_RATE = 9;
  private static readonly AIM_CAMERA = { deadZone: .04, fullDistance: .45, maxRatio: .15, maxPixels: 140 };
  /** 每块鸡肉直接恢复的生命值；不再单独计数。 */
  private static readonly MEAT_HEAL = 5;
  private goldPickups: GoldPickup[] = [];
  private goldDroppedByTile = new Map<number, number>();
  /** 小鸡死亡后掉落的肉块，落地后才可收集。 */
  private meatPickups: MeatPickup[] = [];

  // 粒子系统
  private particleSystem: ParticleSystem;
  // 地面弹坑装饰
  private readonly craterSystem = new CraterSystem();
  // 地面血迹装饰：小鸡死亡收尾时留在尸体下方
  private readonly bloodStainSystem = new BloodStainSystem();
  // 地面脚印装饰
  private readonly footprintSystem = new FootprintSystem();
  // 水面涟漪装饰：涉水时替代脚印
  private readonly rippleSystem = new RippleSystem();
  // 地图边界反馈：贴边往里推时在接触点打一圈波纹
  private readonly boundaryRippleSystem = new BoundaryRippleSystem();
  // 世界噪声总线：脚步、涉水、翻滚、枪声与小鸡叫声都记录成可查询事件。
  private readonly noiseSystem = new NoiseSystem(8, 1024);
  // 听觉位置提示：只把“玩家听见了”的声音画成短暂弧线，不揭示目标本体。
  private readonly soundRippleSystem = new SoundRippleSystem();
  // 玩家自己的听觉判定与敌人共用同一套传感器；每个事件只消费一次。
  private readonly playerHearing = new HearingSensor();
  // 地图外的毛玻璃与“无法通行”水印
  private readonly boundaryOverlay = new MapBoundaryOverlay();
  // 拾取飘字：在角色身边蹦出 "金块+N" / "HP+5"，1 秒后淡出
  private readonly floatingTexts = new FloatingTextSystem();
  // 右侧武器列表 HUD：当前手持枪械在上，切换时与副武器交换位置
  private readonly weaponListHud = new WeaponListHud();
  private readonly backpackHud = new BackpackHud();
  private readonly quickSlotHud = new QuickSlotHud();
  // 手电状态条：贴在武器列表上方，开关做 150ms 的绿色/灰色渐变
  private readonly flashlightHud = new FlashlightHud();
  private readonly killIndicator = new KillIndicator();
  private readonly combatScore = new CombatScoreSystem();

  getCombatScoreState() { return this.combatScore.snapshot(); }
  /**
   * 左上角圆形战术小地图：只是“玩家已知世界”的可视化，不参与碰撞、感知或掉落。
   * 地形来自探索/记忆，标记来自感知授权，GameScene 只负责组织数据。
   */
  private readonly minimap = new CircularMinimapHud();
  /** 矿石标记来自记忆快照，按记忆 revision 重建，避免每帧扫描全部瓦片。 */
  private minimapMineralRevision = -1;
  private minimapMineralWindow = "";
  private readonly minimapMarkerSpecs: MinimapMarkerSpec[] = [];
  private minimapMineralMarkers: MinimapMarkerSpec[] = [];
  // 光照系统
  private lightingSystem: LightingSystem;
  private environment = sampleEnvironment(360);
  private environmentPreview?: number;
  private environmentStage = 4;
  private raidVisualState?: DayClockHudState['raid'];
  private facilityLights: LightSource[] = [];
  private visibilitySystem = new VisibilitySystem();
  // 属性修改器
  private modifierManager: ModifierManager;

  private pickupItems: PickupItem[] = []; // 仅由特殊矿完全击碎后生成
  private torches: Torch[] = [];

  /** 世界层每帧铺满屏幕，主循环无需额外清屏。 */
  readonly opaque = true;

  /**
   * 构造函数
   */
  constructor(private readonly sceneOptions: GameSceneOptions = {}) {
    super();
    this.visionMode = resolveVisionMode();
    this.visionDebugLayer = resolveVisionDebugLayer();
    this.zombieDebugPaths = isDevelopmentBuild() && new URLSearchParams(window.location?.search ?? "").get("zombieDebug") === "paths";
    this.runSeed = sceneOptions.seed ?? Math.floor(Math.random() * 4294967296);
    this.spawnRandom = seededRandom(this.runSeed ^ 0x706c6179);

    // 100×100 个瓦片，每格 50 像素
    this.map = sceneOptions.map ?? new TileMap(100, 100, { ...sceneOptions, seed: this.runSeed });
    this.baseTiles = sceneOptions.campaignData ? this.map.tiles.map(row => row.slice()) : [];
    this.baseHp = sceneOptions.campaignData ? this.map.tileHp.map(row => row.slice()) : [];
    this.nextInstanceSequence = sceneOptions.campaignData?.nextInstanceSequence ?? 0;
    this.smoke = new SmokeSystem(this.map);
    this.actorWorld = new ActorCollisionWorld(this.map);
    this.enemies = new EnemySystem(this.map, this.actorWorld, this.runSeed ^ 0x7a6f6d62, this.noiseSystem);
    this.zombieGore = new ZombieGoreSystem(this.map, seededRandom(this.runSeed ^ 0x676f7265));
    this.enemyBlood = new BloodStainSystem(seededRandom(this.runSeed ^ 0x626c6f64));
    if (this.visionMode === "three-layer") {
      this.perception = new PerceptionSystem({
        map: this.map,
        terrain: this.map,
        rules: this.visionRules,
      });
    }

    // 获取设备像素比，默认为1
    const dpr = window.devicePixelRatio || 1;

    // 扩大世界视口，合成到主画布时统一缩小世界与光照。
    const zoom = this.graphics.camera.zoom;
    this.camera = new Camera(Math.ceil(window.innerWidth * dpr / zoom),
      Math.ceil(window.innerHeight * dpr / zoom), 400, 250, 5);

    // 初始化粒子系统
    this.particleSystem = new ParticleSystem();
    this.map.onTileDestroyed = (col, row, type) => {
      if (type === TileTypeId.MINERAL) this.scatterGold(col, row, GameScene.GOLD_DROP_COUNT, true);
      const pickupType = getTileType(type).pickupType;
      if (pickupType !== undefined) {
        const offset = (this.map.tileSize - PickupItem.DEFAULT_SIZE) / 2;
        this.pickupItems.push(new PickupItem(col * this.map.tileSize + offset,
          row * this.map.tileSize + offset, pickupType, this.particleSystem));
      }
    };
    this.map.onTileDamaged = (col, row, type, hp, maxHp) => {
      if (type !== TileTypeId.MINERAL) return;
      // 每个已跨过的耐久门槛先散落 1 块，击毁时再补齐到 GOLD_DROP_COUNT。
      const earned = GameScene.GOLD_DROP_THRESHOLDS.filter(threshold => hp / maxHp <= threshold + Number.EPSILON).length;
      this.scatterGold(col, row, earned, false);
    };

    // 初始化光照系统
    this.lightingSystem = new LightingSystem();

    // 获取摄像头死区范围，用于在其中生成玩家初始位置
    const deadZoneLeft = this.camera.x + (this.camera.width - this.camera.deadZoneWidth) / 2;
    const deadZoneTop = this.camera.y + (this.camera.height - this.camera.deadZoneHeight) / 2;
    const deadZoneWidth = this.camera.deadZoneWidth;
    const deadZoneHeight = this.camera.deadZoneHeight;

    // 在死区内生成可行走位置作为玩家出生点
    const spawn = sceneOptions.playerSpawn ?? this.getSpawnPositionInArea(
      Math.max(0, Math.min(deadZoneLeft, this.map.width * this.map.tileSize - deadZoneWidth)),
      Math.max(0, Math.min(deadZoneTop, this.map.height * this.map.tileSize - deadZoneHeight)),
      Math.min(deadZoneWidth, this.map.width * this.map.tileSize),
      Math.min(deadZoneHeight, this.map.height * this.map.tileSize), GameScene.PLAYER_SIZE, { type: "circle", radius: 0.5 });
    this.player = new Player(sceneOptions.playerSpawn?.x ?? spawn.x, sceneOptions.playerSpawn?.y ?? spawn.y, undefined, this.particleSystem);
    this.survival = new PlayerSurvivalSystem(this.player);
    this.throwable = new ThrowableController(this.survival.inventory);
    // Preserve the sampled player/light/camera pose during the later NPC separation pass.
    this.actorWorld.register("player", this.player, false);
    this.player.setMotionResolver((body, move, rotation) => this.actorWorld.resolve("player", body, move, rotation));
    // 子弹自然落地时尝试在干燥地面留下弹坑。
    this.player.setOnBulletLanded((x, y) => this.craterSystem.spawn(x, y, this.map));
    // 移动时在干燥地面留下脚印；涉水时改写为朝行进反方向扩散的涟漪。
    this.player.setOnFootstepCallback(step => {
      if (!this.footprintSystem.spawn(step, this.map)) this.rippleSystem.spawn(step, this.map);
      // 噪声与脚印同源：每一步都记录，响度按是否涉水/是否接近满速区分。
      const speed = this.player.getVelocity().length();
      const running = speed > this.player.getMaxSpeed() * 0.75;
      this.noiseSystem.emit(step.inWater ? "waterStep" : "footstep", step.x, step.y, {
        sourceId: "player",
        loudness: step.inWater ? 0.55 : running ? 0.5 : 0.3,
        // 冲刺的脚步传得更远：小鸡对慢走与冲刺的警觉距离应该明显不同。
        ...(!step.inWater && running ? { radius: 220 } : {}),
      });
    });

    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    const playerCenter = new Vector2(playerCenterX, playerCenterY);
    if (this.perception) {
      this.perceptionObserver = {
        id: "player",
        x: playerCenterX,
        y: playerCenterY,
        facing: this.player.getVisionState().direction,
        nearSenseRadius: this.visionRules.nearSenseRadius,
        maxObservationRange: this.visionRules.maxObservationRange,
      };
    }

    // 脚边一小圈全向微光，配合面朝方向的手电筒锥光；两者都是加法补光，且只照地面。
    const light = this.graphics.playerLight;
    this.playerLight = new LightSource(playerCenter, light.radius, light.color, light.intensity, light.sourceRadius);
    this.playerLight.groundOnly = true;
    this.lightingSystem.addLightSource(this.playerLight);
    const torch = this.graphics.flashlight;
    this.flashlight = new ConeLight(playerCenter, torch.range, torch.color, torch.intensity,
      torch.angle * Math.PI / 180, torch.softness);
    this.flashlight.groundOnly = true;
    // 光从持灯者身体之外开始，人物不会被自己的手电筒打出一块高光。
    this.flashlight.setInnerRadius(torch.innerRadius, torch.innerFade);
    this.lightingSystem.addLightSource(this.flashlight);

    this.torches = sceneOptions.campaignData ? [] : Torch.generate(this.map, seededRandom(this.runSeed ^ 0x746f7263));
    this.torches.forEach(torch => this.lightingSystem.addLightSource(torch.light));
    const locationId = sceneOptions.campaignData?.location.locationId;
    for (const definition of locationId ? LOCATION_DEFINITIONS[locationId].facilityLights ?? [] : []) {
      const source = new LightSource(new Vector2(definition.x, definition.y), definition.radius, definition.color, definition.intensity, definition.sourceRadius);
      source.groundOnly = true; this.facilityLights.push(source); this.lightingSystem.addLightSource(source);
    }

    // 小鸡围绕出生点随机生成，平时只在干地上自由活动；属于单位层，会被迷雾裁剪。
    const chickenCount = sceneOptions.campaignData ? 0 : sceneOptions.chickenCount ?? GameScene.CHICKEN_COUNT;
    if (!Number.isSafeInteger(chickenCount) || chickenCount < 0 || chickenCount > 1000) throw new Error("小鸡数量必须为 0–1000 的整数");
    this.chickens = Chicken.spawn(this.map, chickenCount, playerCenter, seededRandom(this.runSeed ^ 0x63686963));
    for (const chicken of this.chickens) {
      chicken.setOnStepCallback((x, y) => this.playChickenStep(x, y));
      chicken.setOnCluckCallback((x, y, startled) => this.playChickenCluck(chicken, x, y, startled === true));
    }
    // 子弹每次位移先查询小鸡和火把，命中单位优先于该点之后的地形。
    this.player.setBulletEntityHitTest((startX, startY, endX, endY, radius, damage, aim) => {
      const chickenHit = this.findChickenHit(startX, startY, endX, endY, radius, damage);
      const torchHit = this.findTorchHit(startX, startY, endX, endY, radius, aim);
      if (!chickenHit) return torchHit;
      if (!torchHit) return chickenHit;
      return torchHit.fraction < chickenHit.fraction ? torchHit : chickenHit;
    });

    // 环境光决定整张地图的基础明暗（亮度 0.35），单位光只做局部补光。
    this.applyEnvironmentLight();

    // 设置射击回调，配置震动参数
    this.player.setOnShootCallback((shootDir: Vector2) => {
      // 开火会打断正在进行中的拾取；同帧标记，结算前消费。
      this.shotThisFrame = true;
      this.noiseSystem.emit("gunshot", this.player.x + this.player.getSize() / 2,
        this.player.y + this.player.getSize() / 2, { sourceId: "player" });
      // 按屏幕像素调手感：缩放和 DPR 改变后，开火冲击的视觉幅度保持一致。
      const viewport = this.game?.renderer?.ctx?.canvas ? this.getCanvasViewport() : undefined;
      const scale = viewport && viewport.width > 0 ? this.camera.width / viewport.width : 1;
      const magnitude = (this.player.getActiveWeaponSlot() === 'primary' ? C.primaryShotShake : C.secondaryShotShake) * scale;
      const duration = Math.max(C.shotShakeMinSeconds,
        Math.min(C.shotShakeMaxSeconds, this.player.getFireRate() * C.shotShakeDurationRatio));
      const angle = Math.atan2(shootDir.y, shootDir.x) + Math.PI + (Math.random() * 2 - 1) * C.shotShakeAngleJitter;
      this.camera.shake(magnitude, duration, angle, C.shotShakeFrequency, 'linear');
      // 单发只用一个声部：连续射击时后一发直接接管，不会叠出混浊的尾音。
      // 音色跟着当前武器走；冲锋枪略轻一点，避免高频射击盖过环境声。
      // 两把枪都用单发采样：每发跳过录音开头的静音预卷，不按弹匣余量往采样深处跳。
      const sound = this.player.getActiveWeaponSound();
      if (sound) {
        const base = this.player.getActiveWeaponSlot() === "primary"
          ? this.audio.weapon.primaryVolume : this.audio.weapon.secondaryVolume;
        this.sfx.play(sound, this.volume(base), 1, {
          count: 1,
          startAt: this.player.getActiveWeaponSoundStartAt(),
        });
      }
    });

    // 按 R（或调试开启自动换弹后打空）开始换弹/装填；两者共用当前武器的换弹采样。
    this.player.setOnReloadCallback(() => {
      // 上一段还没放完就再补弹：先掐掉，避免两段换弹声叠在一起。
      this.reloadVoice?.stop(0);
      this.reloadVoice = null;
      const sound = this.player.getActiveWeaponReloadSound();
      if (!sound) return;
      this.reloadVoice = this.sfx.play(sound, this.volume(this.audio.weapon.reloadVolume),
        this.player.getActiveWeaponReloadRate(), { count: 1 });
    });


    this.modifierManager = new ModifierManager(this.player);

    this.configLoader = new ConfigLoader({
      "playerConfig": "/configs/playerConfig.json",
      "graphics": "/configs/graphicsConfig.json",
      "audio": "/configs/audioConfig.json",
    });
  }

  /**
   * 涉水行走的循环音效：身体接触水面且这一帧真的挪动了位置时才出声。
   * 整段采样按 loop 播放，播放速率跟实际速度成正比，快走时叠得更密、慢淌时拖得更长；
   * 离水、停下或被墙挡住时目标音量归零，由 SoundPlayer 在 120 毫秒内淡出。
   */
  private updateWadingSound(speed: number): void {
    const wading = this.player.isInWater() && speed > 20;
    const base = wading ? this.audio.footsteps.waterVolume : 0;
    this.sfx.loop(WATER_STEP_SOUND, this.volume(base), Math.max(0.6, Math.min(1.6, speed / 200)));
  }

  /**
   * 干地走路的循环音效：砖地采样是连续行走的整段录音，首尾静音已裁掉（现长 4.035 秒），
   * 录音里一步约 0.58 秒。播放速率按「采样步距 / 玩家步距」折算：慢走 0.95 倍，
   * 常速 200 px/s 约 1.28 倍，冲刺 320 px/s 到 2.05 倍，跑起来脚步更密、音高也略高。
   * 涉水时让位给水声，停下或顶墙时淡出。
   */
  private updateFootstepSound(speed: number): void {
    const walking = !this.player.isInWater() && speed > 20;
    const base = walking ? this.audio.footsteps.dryVolume : 0;
    this.sfx.loop(DRY_STEP_SOUND, this.volume(base), Math.max(0.95, Math.min(2.05, speed / 156)));
  }

  /** 小鸡发声的距离衰减：与听觉传感器共用同一条软化曲线，起播与持续音量不再各算一套。 */
  private chickenAttenuation(x: number, y: number): number {
    const dx = x - this.player.x - this.player.getSize() / 2;
    const dy = y - this.player.y - this.player.getSize() / 2;
    return computeAudibleGain(Math.hypot(dx, dy), this.audio.chicken.range);
  }

  /**
   * 小鸡原地发声：按与玩家的距离线性衰减，默认 450 像素外直接不响。
   * 声音在迷雾里也该有方向感，所以远近比音色更重要。
   * @param options 声部数量（鸡叫是整段几秒的录音，需要多留几个声部）等播放方式
   */
  private playChickenAt(url: string, x: number, y: number, volume: number, options?: PlayOptions): boolean {
    const attenuation = this.chickenAttenuation(x, y);
    if (attenuation <= this.audio.chicken.minAttenuation) return false;
    this.sfx.play(url, this.volume(volume * attenuation), 0.92 + Math.random() * 0.16, options);
    return true;
  }

  /**
   * 小鸡走路的脚步声：小鸡一秒约三步，抽稀到 0.25 秒一次，六只一起走也不会盖过玩家自己的脚步。
   * 录音本身是整段十秒的鸡舍环境，从随机位置起播，每次听到的都是不同的一截。
   */
  private playChickenStep(x: number, y: number): void {
    if (this.chickenStepDelay > 0) return;
    // 小鸡只是背景点缀：贴身 0.25 左右，仍比玩家脚步（0.4）低一截。
    if (this.playChickenAt(CHICKEN_STEP_SOUND, x, y, this.audio.chicken.stepVolume, { randomStart: true })) {
      this.chickenStepDelay = 0.25;
    }
  }

  /**
   * 叫声：比脚步稀疏得多，单独计时，免得被密集的脚步声挤掉。
   * 三种鸡叫随机取一种；每段都有 6.7–8.2 秒，所以排三个声部，
   * 0.9 秒内连叫几声时前一声还能继续响，更密的连叫才会让位给新的叫声。
   * 录音这几秒里玩家可能已经走远或走近，所以音量交给 updateCluckVolumes 每帧重算。
   *
   * 先发布世界噪声事件，再决定放不播放：距离、静音与声部预算都不能让世界上少一声鸡叫。
   * startled 为 true 表示这是受惊的惊叫：更响、且短促收尾，不拖满整段录音。
   */
  private playChickenCluck(chicken: Chicken, x: number, y: number, startled = false): void {
    if ((this.chickenCluckCooldowns.get(chicken) ?? 0) > 0) return;
    this.chickenCluckCooldowns.set(chicken, GameScene.CHICKEN_CLUCK_COOLDOWN);

    this.noiseSystem.emit("cluck", x, y, {
      sourceId: this.getChickenSoundId(chicken),
      radius: this.audio.chicken.range,
      // 受惊的叫声更响，但第一版仍不引发鸡群连锁惊逃。
      loudness: startled ? 0.55 : 0.45,
    });

    const gain = this.chickenAttenuation(x, y);
    if (gain <= this.audio.chicken.minAttenuation) return;

    this.reserveChickenVoice();
    const url = CHICKEN_CLUCK_SOUNDS[Math.floor(Math.random() * CHICKEN_CLUCK_SOUNDS.length)];
    const base = this.audio.chicken.cluckVolume;
    const handle = this.sfx.play(url, this.volume(base * gain),
      0.92 + Math.random() * 0.16, { count: 3 });
    if (!handle) return;
    this.activeClucks.push({ handle, chicken, x, y, volume: base, gain });
    if (startled) this.pendingCluckStops.push({ handle, remaining: GameScene.CHICKEN_SCREAM_SECONDS });
  }

  /** 同时发声的鸡叫不超过预算：超了就掐掉当前最轻的一声，让新叫声还能被听见。 */
  private reserveChickenVoice(): void {
    while (this.activeClucks.length >= GameScene.MAX_CHICKEN_VOICES) {
      let quietest = 0;
      for (let i = 1; i < this.activeClucks.length; i++) {
        if (this.activeClucks[i].gain < this.activeClucks[quietest].gain) quietest = i;
      }
      const [dropped] = this.activeClucks.splice(quietest, 1);
      dropped.handle.stop(0.08);
      this.forgetPendingCluckStop(dropped.handle);
    }
  }

  private forgetPendingCluckStop(handle: SoundHandle): void {
    for (let i = this.pendingCluckStops.length - 1; i >= 0; i--) {
      if (this.pendingCluckStops[i].handle === handle) this.pendingCluckStops.splice(i, 1);
    }
  }

  /** 稳定的发声者 id：同一只鸡始终用同一个 id，WeakMap 不会延长它的生命周期。 */
  private getChickenSoundId(chicken: Chicken): string {
    let id = this.chickenSoundIds.get(chicken);
    if (!id) {
      id = `chicken-${++this.chickenSoundSeq}`;
      this.chickenSoundIds.set(chicken, id);
    }
    return id;
  }

  /** 推进每只鸡的叫声冷却；归零即删，Map 不会随着死亡个体无限增长。 */
  private updateChickenCluckCooldowns(delta: number): void {
    if (this.chickenCluckCooldowns.size === 0) return;
    for (const [chicken, remaining] of [...this.chickenCluckCooldowns]) {
      if (remaining <= delta) this.chickenCluckCooldowns.delete(chicken);
      else this.chickenCluckCooldowns.set(chicken, remaining - delta);
    }
  }

  /**
   * 每帧按玩家当前位置重算正在响的鸡叫音量：走远渐弱、走近渐强，而不是触发时定死。
   * 鸡在录音中途被击杀时，这一声立刻掐掉——录音有 6.7–8.2 秒，不能留在原地继续叫。
   */
  private updateCluckVolumes(delta: number): void {
    const px = this.player.x + this.player.getSize() / 2;
    const py = this.player.y + this.player.getSize() / 2;
    const rate = Math.min(1, delta * GameScene.CLUCK_GAIN_RATE);
    this.activeClucks = this.activeClucks.filter(cluck => {
      if (!cluck.chicken.isAlive()) {
        cluck.handle.stop();
        this.forgetPendingCluckStop(cluck.handle);
        return false;
      }
      if (!cluck.handle.isPlaying()) {
        this.forgetPendingCluckStop(cluck.handle);
        return false;
      }
      // 声音要跟着活鸡走：录音这几秒里鸡可能边叫边跑，不能再用发声瞬间的旧坐标。
      const cx = cluck.chicken.x + cluck.chicken.getSize() / 2;
      const cy = cluck.chicken.y + cluck.chicken.getSize() / 2;
      const target = computeAudibleGain(Math.hypot(cx - px, cy - py), this.audio.chicken.range);
      cluck.x = cx;
      cluck.y = cy;
      cluck.gain += (target - cluck.gain) * rate;
      if (cluck.gain < 0.01 && target < 0.01) {
        cluck.handle.stop(0.1);
        this.forgetPendingCluckStop(cluck.handle);
        return false;
      }
      cluck.handle.setVolume(this.volume(cluck.volume * cluck.gain));
      return true;
    });

    // 受惊惊叫的短促收尾：到点淡出，避免叫声盖过已经跑远的鸡。
    for (let i = this.pendingCluckStops.length - 1; i >= 0; i--) {
      const stop = this.pendingCluckStops[i];
      stop.remaining -= delta;
      if (stop.remaining > 0) continue;
      stop.handle.stop(0.15);
      this.pendingCluckStops.splice(i, 1);
    }
  }

  /** 鸡被击杀的同一帧就把它的叫声收掉，不等下一帧的逐帧音量更新。 */
  private stopChickenClucks(chicken: Chicken): void {
    this.activeClucks = this.activeClucks.filter(cluck => {
      if (cluck.chicken !== chicken) return true;
      cluck.handle.stop();
      this.forgetPendingCluckStop(cluck.handle);
      return false;
    });
  }

  /**
   * 玩家听得见的声音变成迷雾上的短暂提示：听见不等于看见。
   * 位置经过轻微模糊，玩家能判断大致方向，但不能靠弧心精确射击黑暗里的目标。
   */
  private updateSoundRipples(delta: number): void {
    this.soundRippleSystem.update(delta);
    const px = this.player.x + this.player.getSize() / 2;
    const py = this.player.y + this.player.getSize() / 2;
    const heard = this.playerHearing.poll(this.map, { id: "player", x: px, y: py },
      this.noiseSystem.getEvents());
    for (const stimulus of heard) {
      // 自己的脚步与枪声不需要提示：位置本来就知道。
      if (stimulus.sourceId === "player" && stimulus.noiseKind !== 'explosion') continue;
      if (stimulus.noiseKind === 'explosion' && this.canObserveThrowPoint(stimulus.x, stimulus.y)) {
        const c = this.camera.getOffset();
        if (stimulus.x >= c.x && stimulus.y >= c.y && stimulus.x <= c.x + this.camera.width && stimulus.y <= c.y + this.camera.height) continue;
      }
      const chicken = this.findChickenBySoundId(stimulus.sourceId) ?? this.enemies.findBySoundId(stimulus.sourceId);
      // 已完整看见的目标不再重复画声音提示；只看见剪影时仍保留，避免信息突然断档。
      if (chicken && this.perception && this.getEntityVisibility(chicken) === "identified") continue;
      const cue = SoundRippleSystem.resolveCue(stimulus.x, stimulus.y,
        stimulus.distance, stimulus.occluded, stimulus.eventId);
      this.soundRippleSystem.spawn({
        x: cue.x,
        y: cue.y,
        strength: stimulus.strength,
        distance: stimulus.distance,
        occluded: stimulus.occluded,
        eventId: stimulus.eventId,
        style: stimulus.noiseKind === 'explosion' ? 'explosion' : 'sound',
      });
    }
  }

  private findChickenBySoundId(sourceId: string | undefined): Chicken | undefined {
    if (!sourceId) return undefined;
    for (const chicken of this.chickens) {
      if (this.getChickenSoundId(chicken) === sourceId) return chicken;
    }
    return undefined;
  }

  /**
   * 初始化光照系统
   */
  private initLightingSystem(): void {
    this.worldCanvas ??= document.createElement("canvas");
    this.worldContext ??= this.worldCanvas.getContext("2d")!;
    this.unitCanvas ??= document.createElement("canvas");
    this.unitContext ??= this.unitCanvas.getContext("2d")!;
    this.effectCanvas ??= document.createElement("canvas");
    this.effectContext ??= this.effectCanvas.getContext("2d")!;
    for (const canvas of [this.worldCanvas, this.unitCanvas, this.effectCanvas]) {
      canvas.width = this.camera.width;
      canvas.height = this.camera.height;
    }
    this.lightingSystem.initialize(this.camera.width, this.camera.height);
    // 旧迷雾只在 legacy 模式真正绘制时才有必要分配遮罩画布。
    if (this.visionMode === "legacy") {
      this.visibilitySystem.initialize(this.camera.width, this.camera.height);
    }
    if (this.visionMode === "three-layer" && this.perception) {
      if (!this.perceptionRenderer) {
        this.perceptionRenderer = new PerceptionRenderer(
          this.map, this.map, this.visionRules, this.graphics.visibility);
      }
      this.perceptionRenderer.resize(this.camera.width, this.camera.height, this.graphics.visibility);
      this.perceptionRenderer.setDebugLayer(this.visionDebugLayer);
      this.perceptionRenderer.setEnvironment(this.environment);
    }
  }

  /**
   * 重置相机尺寸以适应窗口大小变化
   */
  private resizeCamera(): void {
    this.camera.clearAimOffset();
    // 相机尺寸使用缩放前的世界像素。
    const zoom = this.graphics.camera.zoom;
    this.camera.width = Math.ceil(this.game.renderer.width / zoom);
    this.camera.height = Math.ceil(this.game.renderer.height / zoom);
    // 重置相机位置以保持玩家在视野中央
    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    this.camera.x = playerCenterX - this.camera.width / 2;
    this.camera.y = playerCenterY - this.camera.height / 2;
  }

  /**
   * 处理窗口大小变化的回调函数
   */
  private handleResize(): void {
    this.displayedView = undefined;
    this.viewportCache = null;
    this.resizeCamera();
    this.resizeMinimap();
    this.initLightingSystem();
  }

  /** 小地图布局与 DPR 变化：重算圆形范围、黄金计数位置与缓存分辨率。 */
  private resizeMinimap(): void {
    const dpr = window.devicePixelRatio || 1;
    this.minimap.resize(this.game.renderer.width / dpr, this.game.renderer.height / dpr, dpr);
  }

  private scatterGold(col: number, row: number, earned: number, destroyed: boolean): void {
    const key = row * this.map.width + col;
    const dropped = this.goldDroppedByTile.get(key) ?? 0;
    const count = earned - dropped;
    if (count <= 0) return;
    const tileSize = this.map.tileSize;
    const tileX = col * tileSize, tileY = row * tileSize;
    const size = GoldPickup.SIZE;
    const origins: { x: number; y: number; angle: number }[] = [];
    if (destroyed) {
      origins.push({ x: tileX + (tileSize - size) / 2, y: tileY + (tileSize - size) / 2, angle: 0 });
    } else {
      // 活矿块仍是障碍：碎块的整个碰撞体必须从边缘外侧开始运动。
      for (const offset of [0.2, 0.5, 0.8]) {
        const x = tileX + tileSize * offset - size / 2;
        const y = tileY + tileSize * offset - size / 2;
        origins.push(
          { x: tileX - size - 0.5, y, angle: Math.PI },
          { x: tileX + tileSize + 0.5, y, angle: 0 },
          { x, y: tileY - size - 0.5, angle: -Math.PI / 2 },
          { x, y: tileY + tileSize + 0.5, angle: Math.PI / 2 }
        );
      }
    }
    const playerX = this.player.x + this.player.getSize() / 2;
    const playerY = this.player.y + this.player.getSize() / 2;
    const distanceFromPlayer = (origin: { x: number; y: number }) => Math.hypot(origin.x + size / 2 - playerX, origin.y + size / 2 - playerY);
    const safeOrigins = origins.filter(origin => this.map.isShapeWalkable(rectangleCollider(origin.x, origin.y, size, size)))
      .sort((a, b) => distanceFromPlayer(a) - distanceFromPlayer(b));
    // 未生成的额度不计入 dropped，下一次受伤重试，击毁时统一补齐。
    if (!safeOrigins.length) return;

    const phase = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const origin = safeOrigins[i % Math.min(3, safeOrigins.length)];
      const angle = destroyed ? phase + (i + Math.random() * 0.6) * Math.PI * 2 / count :
        origin.angle + (Math.random() * 2 - 1) * Math.PI / 3;
      const distance = 16 + Math.random() * 24;
      const movement = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
      const body = rectangleCollider(origin.x, origin.y, size, size);
      const hit = this.map.castShape(body, movement);
      const fraction = hit ? Math.max(0, hit.fraction - 0.001) : 1;
      let x = origin.x + movement.x * fraction, y = origin.y + movement.y * fraction;
      if (!this.map.isShapeWalkable(rectangleCollider(x, y, size, size))) {
        x = origin.x; y = origin.y;
      }
      this.goldPickups.push(new GoldPickup(origin.x, origin.y, x, y));
    }
    if (destroyed) this.goldDroppedByTile.delete(key);
    else this.goldDroppedByTile.set(key, dropped + count);
    const origin = safeOrigins[0];
    this.particleSystem.createExplosion(new Vector2(origin.x + size / 2, origin.y + size / 2),
      destroyed ? 32 : 6, destroyed ? 160 : 80, destroyed ? 8 : 4, destroyed ? 0.55 : 0.25,
      ["#ffd700", "#fff1a3", "#b77b26", "#77716a"]);
  }

  private updateGoldPickups(delta: number): void {
    const body = this.player.getCollider();
    let collected = 0;
    this.goldPickups = this.goldPickups.filter(pickup => {
      pickup.update(delta);
      if (!this.player.isAlive() || !pickup.isCollidingWithShape(body)) return true;
      this.player.collectGold();
      collected++;
      this.particleSystem.createExplosion(new Vector2(pickup.x + GoldPickup.SIZE / 2, pickup.y + GoldPickup.SIZE / 2),
        6, 45, 3, 0.2, ["#ffd700", "#fff1a3"]);
      return false;
    });
    // 碎金常常一簇一簇地捡：同一帧只响一声，硬币音才不会叠成一团。
    if (collected > 0) {
      this.sfx.play(GOLD_PICKUP_SOUND, this.volume(this.audio.pickups.goldVolume), 0.98 + Math.random() * 0.04);
      this.showPickupText(`金块+${collected}`);
    }
  }

  /** 查找子弹线段上最早接触的小鸡；只有子弹真正走到命中点时才结算伤害。 */
  private findChickenHit(startX: number, startY: number, endX: number, endY: number,
    radius: number, damage: number): BulletEntityHit | null {
    const entries: DamageableEntry[] = this.chickens.map((chicken, index) => ({ id: `chicken-${index}`, target: chicken }));
    for (const zombie of this.enemies.zombies) entries.push({ id: zombie.id, target: zombie });
    const best = resolveFirstDamageableHit({ startX, startY, endX, endY, radius }, entries);
    if (!best) return null;
    const target = best;
    return {
      fraction: target.fraction,
      hitRegion: target.hitRegion,
      damageMultiplier: target.damageMultiplier,
      x: target.x,
      y: target.y,
      // 伤害与命中点都取真实命中快照；准星在鸡身后不会改变任何一项。
      apply: (impact: BulletImpact) => {
        this.damageCombatTarget(target.entry.target as Chicken | Zombie, impact);
      },
    };
  }

  private damageCombatTarget(entity: Chicken | Zombie, impact: BulletImpact): void {
    if (entity instanceof Chicken) this.damageChicken(entity, impact);
    else if (this.enemies.receiveHit(entity, impact) === 'killed' && this.player.isAlive()
      && (impact.source === 'bullet' || impact.source === 'melee'))
      this.killIndicator.show(this.combatScore.recordKill(entity.config.kind, impact.hitRegion));
  }

  private settlePlayerPunches(): void {
    for (const event of this.player.consumePunchImpacts()) {
      const move = PUNCH_MOVES[event.moveId], origin = { x: this.player.x + this.player.getSize() / 2, y: this.player.y + this.player.getSize() / 2 };
      const entries: DamageableEntry<Chicken | Zombie>[] = this.chickens.map((target, index) => ({ id: `chicken-${index}`, target }));
      for (const target of this.enemies.zombies) entries.push({ id: target.id, target });
      const hit = resolveFirstMeleeHit(origin, this.player.getVisualFacing(), PUNCH_RANGE, move.halfAngle, entries,
        point => !!this.map.castShape(circleCollider(origin.x, origin.y, 1), { x: point.x - origin.x, y: point.y - origin.y }, 'projectile'));
      const structure = this.structures?.meleeHit(origin, this.player.getVisualFacing(), PUNCH_RANGE, move.halfAngle);
      if (structure && (!hit || structure.distance < Math.hypot(hit.point.x - origin.x, hit.point.y - origin.y))) {
        this.structures?.damage(structure.id, this.player.getModifiedValue(move.damage, 'damage')); continue;
      }
      if (!hit) continue;
      const dx = hit.point.x - origin.x, dy = hit.point.y - origin.y, length = Math.hypot(dx, dy);
      const facing = this.player.getVisualFacing();
      this.damageCombatTarget(hit.entry.target, {
        damage: this.player.getModifiedValue(move.damage, 'damage'), point: hit.point,
        direction: length > 1e-9 ? { x: dx / length, y: dy / length } : { x: Math.cos(facing), y: Math.sin(facing) },
        impulse: move.impulse, impactSpeed: 0, initialSpeed: 0, traveledDistance: length, source: 'melee', hitRegion: 'body',
      });
    }
  }

  /**
   * 查找子弹线段上最先穿过的火苗。命中区只有火苗核心那么大，
   * 并且开火瞬间的准星必须压在火把上；准星在别处时，
   * 子弹只是从火把旁边、占地范围内甚至火苗上经过，都不算命中。
   */
  private findTorchHit(startX: number, startY: number, endX: number, endY: number,
    radius: number, aim?: { x: number; y: number }): BulletEntityHit | null {
    if (!aim) return null;
    let best: { fraction: number; torch: Torch; x: number; y: number } | null = null;
    for (const torch of this.torches) {
      if (!torch.isLit() || !torch.isAimedAt(aim.x, aim.y)) continue;
      const fraction = torch.hitTestSegment(startX, startY, endX, endY, radius);
      if (fraction === null) continue;
      if (!best || fraction < best.fraction) {
        best = {
          fraction,
          torch,
          x: startX + (endX - startX) * fraction,
          y: startY + (endY - startY) * fraction,
        };
      }
    }
    if (!best) return null;
    const target = best;
    return {
      fraction: target.fraction,
      x: target.x,
      y: target.y,
      apply: () => this.extinguishTorch(target.torch),
    };
  }

  /** 火苗被击中：永久熄灭并撤掉光源，同时扬起一团白色烟雾和几点白灰。 */
  private extinguishTorch(torch: Torch): void {
    if (!torch.extinguish()) return;
    this.lightingSystem.removeLightSource(torch.light);
    const center = new Vector2(torch.x, torch.y - 2);
    // 大颗粒慢速散开，形成能看清的白色烟团；再补一小圈快速白点作为飘散的烟屑。
    this.particleSystem.createExplosion(center, 20, 55, 6, 1.1,
      ["#ffffff", "#f7f7f7", "#ececec", "#dedede"]);
    this.particleSystem.createExplosion(center, 8, 130, 3, 0.35, ["#ffffff", "#f2f2f2"]);
  }

  /**
   * 小鸡受击：把真实命中交给目标结算，本方法只负责命中反馈与死亡当帧的音频收尾。
   *
   * 致命命中不生成白烟、不掉肉、也不立刻删鸡：这些表现全部等到尸体滑行到
   * 收尾距离、场景消费一次性 DeathFinished 之后，在收尾落点统一执行。
   */
  private damageChicken(chicken: Chicken, impact: BulletImpact): void {
    const result = chicken.receiveHit(impact, this.map);
    if (result === "ignored") return;
    if (result === "damaged") {
      this.particleSystem.createExplosion(new Vector2(impact.point.x, impact.point.y), 6, 55, 3, 0.22,
        ["#ffffff", "#f2f2f2", "#dedede"]);
      return;
    }
    // 死掉的小鸡不会再叫，几秒长的录音要当场掐断，而不是由逐帧音量更新下一帧再发现。
    this.stopChickenClucks(chicken);
  }

  /**
   * 消费一次性死亡完成事件：在尸体收尾位置同帧生成血迹、白烟与肉块，然后移除尸体。
   * 血迹、白烟、肉块与数组移除都只发生在这里，避免和「致命命中」混在同一帧。
   */
  private flushChickenDeaths(): void {
    const survivors: Chicken[] = [];
    for (const chicken of this.chickens) {
      const finished = chicken.consumeDeathFinished();
      if (!finished) {
        survivors.push(chicken);
        continue;
      }
      this.resolveDeathPresentation(finished);
    }
    this.chickens = survivors;
  }

  /** 尸体滑行收尾时的统一表现：血迹、白烟与肉块同帧落在收尾位置。 */
  private resolveDeathPresentation(finished: DeathFinished): void {
    const center = new Vector2(finished.x, finished.y);
    // 小鸡仍在滑行收尾后留下血迹，拾取肉块不再改变血迹寿命。
    this.bloodStainSystem.spawn(finished.x, finished.y, this.map);
    // 慢速大颗粒形成白色气团，再补一圈快速白点。
    this.particleSystem.createExplosion(center, 28, 70, 7, 0.9,
      ["#ffffff", "#f7f7f7", "#e8e8e8"]);
    this.particleSystem.createExplosion(center, 8, 150, 4, 0.32, ["#ffffff"]);
    // 肉块与白烟同帧出现：击杀反馈要跟着击退收尾一起到，而不是再等烟散。
    const meat = new MeatPickup(finished.x - MeatPickup.SIZE / 2, finished.y - MeatPickup.SIZE / 2);
    this.meatPickups.push(meat);
  }

  /** 只推进肉块的下落动画；拾取由交互控制器在感知更新之后判定。 */
  private updateMeatPickups(delta: number): void {
    for (const pickup of this.meatPickups) pickup.update(delta);
  }

  /**
   * 肉块拾取的一次性结算：回血、粒子、音效、飘字都只发生一次。
   * 重复调用会被 markCollected 拦下，保证同一块肉不会结算两次。
   */
  private collectMeatPickup(meat: MeatPickup): void {
    if (!meat.markCollected()) return;
    this.meatPickups = this.meatPickups.filter(pickup => pickup !== meat);
    this.player.heal(GameScene.MEAT_HEAL);
    this.particleSystem.createExplosion(
      new Vector2(meat.x + MeatPickup.SIZE / 2, meat.y + MeatPickup.SIZE / 2),
      8, 50, 3, 0.25, ["#ff9b9b", "#ffd6d6", "#ffffff"]);
    this.sfx.play(MEAT_PICKUP_SOUND, this.volume(this.audio.pickups.meatVolume));
    this.showPickupText(`HP+${GameScene.MEAT_HEAL}`);
  }

  /**
   * 感知更新之后运行：本帧决定候选、E 进度与结算。
   * 固定顺序为“感知 → 目标 → 按键计时 → 结算”，不读取上一帧的可见性。
   */
  private updateInteraction(delta: number, input: Input): void {
    this.promptTime += delta;
    this.pickupCandidates = [];
    this.pickupMarkers = [];
    this.completedPickupFeedback = null;

    if (!this.interactionEnabled || !this.player.isAlive() || this.throwable.locked) {
      // 场景已退出：清空进度，不处理任何按键，也不产生结算。
      this.interaction.update({ delta: 0, pressed: false, blocked: true, candidates: [] });
      return;
    }

    const vision = this.player.getVisionState();
    const playerAnchor = { x: vision.x, y: vision.y };
    const threeLayer = this.visionMode === "three-layer" && !!this.perception;

    for (const meat of [...this.meatPickups, ...this.getGroundInventoryPickups()]) {
      if (!meat.isPickupReady()) continue;
      if (meat.kind === 'weapon' && this.player.hasWeapon((meat as DroppedWeaponPickup).weapon.slot)) continue;
      const anchor = meat.getPickupAnchor();
      const distance = Math.hypot(anchor.x - playerAnchor.x, anchor.y - playerAnchor.y);
      const config = meat.pickupConfig;
      // 超出发现范围且不可能交互的肉块不必查询感知。
      const reach = Math.max(config.discoveryRadius, config.interactionRadius);
      if (distance > reach) continue;

      const view = threeLayer ? this.getEntityVisibility(meat) : "identified";
      const decision = this.resolvePickupDecision(config, view, distance, anchor, playerAnchor, vision.range);
      if (decision.marker) {
        this.pickupMarkers.push({
          marker: { x: anchor.x, y: anchor.y, style: config.markerStyle },
          target: meat,
        });
      }
      if (decision.prompt) {
        this.pickupCandidates.push(
          createPickupCandidate<InteractablePickup>(meat, `${meat.kind}-${meat.id}`, anchor, playerAnchor, config));
      }
    }

    // 金块只提供金色发现点，永不进入按键交互状态机。
    for (const gold of this.goldPickups) {
      const config = gold.pickupConfig;
      const anchor = {
        x: gold.x + GoldPickup.SIZE / 2,
        y: gold.y + GoldPickup.SIZE / 2,
      };
      const distance = Math.hypot(anchor.x - playerAnchor.x, anchor.y - playerAnchor.y);
      if (distance > config.discoveryRadius) continue;
      const view = threeLayer ? this.getEntityVisibility(gold) : "identified";
      const decision = this.resolvePickupDecision(config, view, distance, anchor, playerAnchor, vision.range);
      if (decision.marker) {
        this.pickupMarkers.push({
          marker: { x: anchor.x, y: anchor.y, style: config.markerStyle },
          target: gold,
        });
      }
    }

    const result = this.interaction.update({
      delta,
      pressed: input.isKeyDown("e"),
      blocked: input.isBlocked?.() === true,
      interrupted: this.shotThisFrame || !!this.player.getPunchSnapshot() || this.player.isRolling() || this.weaponSwitchedThisFrame,
      candidates: this.pickupCandidates,
    });
    if (result.completed) {
      const completed = result.completed;
      const anchor = completed.getPickupAnchor();
      // 完成反馈只读取锚点，不延迟移除与结算。
      this.completedPickupFeedback = { x: anchor.x, y: anchor.y };
      if (completed.kind === "meat") this.collectMeatPickup(completed as MeatPickup);
      else if (completed.kind === 'weapon') {
        const pickup = completed as DroppedWeaponPickup;
        if (!this.player.hasWeapon(pickup.weapon.slot) && pickup.isPickupReady() && this.player.collectWeapon(pickup.weapon)) {
          pickup.markCollected(); this.weaponPickups = this.weaponPickups.filter(item => item !== pickup);
          this.showPickupText(`${pickup.weapon.name} +1`);
        }
      }
      else if (completed.kind === 'throwable') {
        const pickup = completed as ThrowablePickup;
        if (pickup.markCollected()) {
          this.survival.inventory.add(pickup.item); this.throwablePickups = this.throwablePickups.filter(p => p !== pickup);
          this.showPickupText(`${THROWABLE_ITEMS[pickup.item].name} +1`);
        }
      }
      else if (this.survival.collectVaccine(completed)) {
        this.vaccinePickups = this.vaccinePickups.filter(p => p !== completed);
        this.showPickupText("疫苗 +1");
      }
      // 同一帧完成拾取后，该物品不能再留下候选或高亮点。
      this.pickupCandidates = this.pickupCandidates.filter(c => c.target !== completed);
      this.pickupMarkers = this.pickupMarkers.filter(entry => entry.target !== completed);
    }
  }

  /**
   * 单帧可见性判定。identified/silhouette 由三层感知给出；legacy 走视野半径 + LOS。
   * 只有剪影的近身触觉拾取才额外查一次墙体遮挡。
   */
  private resolvePickupDecision(
    config: PickupConfig,
    view: EntityVisibility,
    distance: number,
    anchor: { x: number; y: number },
    playerAnchor: { x: number; y: number },
    legacyRange: number,
  ): PickupVisibilityDecision {
    const smokeTactile = this.smoke.density(playerAnchor.x, playerAnchor.y) > .1 && distance <= config.interactionRadius;
    const needsLineOfSight = smokeTactile ||
      this.visionMode === "legacy" ||
      (view === "silhouette" && distance <= config.interactionRadius);
    const lineOfSight = needsLineOfSight
      ? hasLineOfSight(this.map, playerAnchor.x, playerAnchor.y, anchor.x, anchor.y)
      : false;
    return resolvePickupVisibility({
      smokeTactile, config,
      view,
      distance,
      lineOfSight,
      nearSense: distance <= this.visionRules.nearSenseRadius,
      visionMode: this.visionMode,
      legacyRange,
    });
  }


  /** 在角色身边蹦出一行拾取提示（例如 "金块+3"、"HP+5"）；左右位置由飘字系统随机散开。 */
  private showPickupText(text: string): void {
    this.floatingTexts.spawn(text,
      this.player.x + this.player.getSize() / 2,
      this.player.y + this.player.getSize() / 2);
  }

  // 添加更新道具的方法
  private updatePickupItems(delta: number, input: Input): void {
    // 创建一个新数组，只保留未过期或未完全消失的道具
    const activePickups: PickupItem[] = [];

    for (const pickup of this.pickupItems) {
      pickup.update(delta, input);

      // 检查道具是否完全过期 
      if (!pickup['isExpiring'] || pickup['expiryTimer'] < pickup['expiryDuration']) {
        activePickups.push(pickup);
      }
    }

    // 更新道具数组
    this.pickupItems = activePickups;
  }

  // 添加检查玩家与道具碰撞的方法
  private checkPickupCollisions(): void {
    if (!this.player.isAlive()) return;
    const playerCollider = this.player.getCollider();
    const collectedPickups: number[] = [];

    // 检查每个道具是否与玩家碰撞
    for (let i = 0; i < this.pickupItems.length; i++) {
      const pickup = this.pickupItems[i];

      // 使用PickupItem类的碰撞检测方法
      if (pickup.isCollidingWithShape(playerCollider)) {
        // 收集道具
        this.collectPickup(pickup);
        collectedPickups.push(i);
      }
    }

    // 从数组中移除已收集的道具（从后往前移除，避免索引错乱）
    for (let i = collectedPickups.length - 1; i >= 0; i--) {
      this.pickupItems.splice(collectedPickups[i], 1);
    }
  }

  // 添加收集道具的方法
  private collectPickup(pickup: PickupItem): void {
    try {
      // 获取道具效果
      const modifierEffect = pickup.getModifierEffect();

      // 应用效果
      if (modifierEffect.stat === 'health') {
        this.player.heal(modifierEffect.value);
      } else {
        // 使用ModifierManager应用其他效果
        this.modifierManager.addModifier(modifierEffect);
      }

      // 触发粒子系统效果
      this.createPickupEffect(pickup);

      console.log(`玩家收集了道具: ${PickupType[pickup.getType()]}，效果: ${modifierEffect.description}`);
    } catch (error) {
      console.error("收集道具时出错:", error);
    }
  }

  // 添加创建道具收集效果的方法 
  private createPickupEffect(pickup: PickupItem): void {
    if (!this.particleSystem) return;

    const centerX = pickup.x + pickup.getSize() / 2;
    const centerY = pickup.y + pickup.getSize() / 2;

    // 根据道具类型设置粒子颜色
    let particleColor = "rgba(200, 200, 200, 0.8)";
    switch (pickup.getType()) {
      case PickupType.HEALTH:
        particleColor = "rgba(255, 100, 100, 0.8)";
        break;
      case PickupType.SPEED_BOOST:
        particleColor = "rgba(100, 255, 100, 0.8)";
        break;
      case PickupType.FIRE_RATE_BOOST:
        particleColor = "rgba(255, 180, 50, 0.8)";
        break;
      case PickupType.BULLET_SPEED_BOOST:
        particleColor = "rgba(100, 150, 255, 0.8)";
        break;
      case PickupType.DAMAGE_BOOST:
        particleColor = "rgba(255, 50, 50, 0.8)";
        break;
    }

    // 生成收集效果粒子
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 50;

      this.particleSystem.addParticle({
        x: centerX,
        y: centerY,
        size: 3 + Math.random() * 4,
        color: particleColor,
        speed: speed,
        angle: angle,
        lifetime: 0.5 + Math.random() * 0.5,
        fadeOut: true
      });
    }
  }

  /**
   * 获取玩家当前位置
   * @returns 包含x和y坐标的对象
   */
  public getPlayerPosition(): { x: number; y: number } {
    return { x: this.player.x, y: this.player.y };
  }

  /**
   * 动态调整环境光亮度
   * @param brightness 亮度值 (0-2)
   * @param color 基础颜色
   */
  public adjustAmbientLight(brightness: number, color: string = "#111118") {
    // 确保亮度值在有效范围内
    brightness = Math.max(0, Math.min(2, brightness));

    // 将十六进制颜色转换为RGB
    const hex = color.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // 设置新的环境光
    this.lightingSystem.setAmbientLight(`rgba(${r}, ${g}, ${b}, ${brightness})`);
  }

  /** 画面配置：校验后一次性应用，并重算视口、离屏画布与迷雾半径。 */
  private applyGraphics(config: GraphicsConfig = this.graphics): void {
    const next = parseGraphicsConfig(config);
    this.graphics = next;
    this.perceptionRenderer?.configure(next.visibility);
    this.applyEnvironmentLight();

    const light = next.playerLight;
    this.playerLight.setColor(light.color);
    this.playerLight.setRadius(light.radius);
    this.playerLight.setIntensity(light.intensity);
    this.playerLight.setSourceRadius(light.sourceRadius);

    const torch = next.flashlight;
    this.flashlight.setColor(torch.color);
    this.flashlight.setRadius(torch.range);
    this.flashlight.setIntensity(torch.intensity);
    this.flashlight.setAngle(torch.angle * Math.PI / 180);
    this.flashlight.setSoftness(torch.softness);
    this.flashlight.setInnerRadius(torch.innerRadius, torch.innerFade);

    this.player.setVisionRange(next.fog.range);
    this.displayedView = undefined;
    this.viewportCache = null;
    // 预加载阶段场景还没有绑定 game，视口与离屏画布等 onEnter 再建。
    if (!this.active || !this.game) return;
    this.resizeCamera();
    this.initLightingSystem();
  }

  private applyEnvironmentLight(): void {
    this.environment = sampleEnvironment(this.environmentPreview ?? this.campaign?.session.getClockReading().worldMinute ?? 360, this.graphics.dayNight);
    this.perception?.setEnvironment(this.environment);
    this.perceptionRenderer?.setEnvironment(this.environment);
    const auto = this.graphics.dayNight.mode === 'auto', state = this.environment;
    this.map.setSurfacePalette(auto ? { ground: this.graphics.dayNight.groundColor, wall: this.graphics.dayNight.wallColor } : null);
    const weight = auto ? state.artificialWeight : 1;
    for (const light of [this.playerLight, this.flashlight, ...this.torches.map(torch => torch.light)]) if (light) light.visualWeight = weight;
    for (const light of this.facilityLights) light.visualWeight = weight * (this.raidVisualState && state.phase === 'night' ? 1.15 : 1);
    if (auto) {
      this.lightingSystem.setAmbientLight(hexToRgba(state.ambientColor, state.ambientIntensity));
      this.lightingSystem.setTerrainLight(null);
      const sun = this.getSunLight();
      this.lightingSystem.setDirectionalLight(this.environmentStage >= 2 ? sun : { ...sun, shadowLength: 0, shadowOpacity: 0 });
      return;
    }
    this.lightingSystem.setDirectionalLight(null);
    const { ambient, terrainLight } = this.graphics;
    this.lightingSystem.setAmbientLight(hexToRgba(ambient.color, ambient.intensity));
    this.lightingSystem.setTerrainLight({
      position: { x: -this.map.width * this.map.tileSize, y: -this.map.height * this.map.tileSize },
      color: terrainLight.color, intensity: terrainLight.intensity,
      shadowLength: this.map.tileSize * terrainLight.shadowScale,
      softness: this.map.tileSize * terrainLight.softnessScale,
    });
  }

  private getSunLight(): DirectionalLight {
    const state = this.environment;
    return { direction: state.sunDirection, color: state.sunColor, intensity: state.sunIntensity,
      shadowLength: state.shadowScale * this.map.tileSize, shadowOpacity: state.shadowOpacity, softness: state.softnessScale * this.map.tileSize };
  }
  /** Development-only, deterministic inspection: never advances or saves campaign time. */
  setEnvironmentPreview(worldMinute: number | null): void {
    if (!isDevelopmentBuild()) throw new Error('时段预览仅用于开发构建');
    if (worldMinute !== null) sampleEnvironment(worldMinute);
    this.environmentPreview = worldMinute ?? undefined; this.applyEnvironmentLight();
  }
  setEnvironmentStage(stage: number): void {
    if (!isDevelopmentBuild() || !Number.isInteger(stage) || stage < 1 || stage > 4) throw new Error('阶段预览需要 1–4');
    this.environmentStage = stage; this.applyEnvironmentLight();
  }
  getEnvironmentState(): EnvironmentState { return { ...this.environment, sunDirection: { ...this.environment.sunDirection } }; }
  /** Real raid systems may supply their current wave; absence never fabricates a raid. */
  setRaidVisualState(raid: DayClockHudState['raid']): void {
    if (raid && (!Number.isSafeInteger(raid.wave) || !Number.isSafeInteger(raid.totalWaves) || raid.wave < 1 || raid.wave > raid.totalWaves)) throw new Error('夜袭波次无效');
    this.raidVisualState = raid ? { ...raid } : undefined; this.applyEnvironmentLight();
  }

  private drawSunShadows(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.graphics.dayNight.mode !== 'auto' || this.environmentStage < 2 || this.environment.sunIntensity <= 0) return;
    const sun = this.getSunLight();
    const vision = this.player.getVisionState();
    ctx.save(); ctx.translate(-ox, -oy); this.map.clipGround(ctx, ox, oy, ctx.canvas.width, ctx.canvas.height); ctx.translate(ox, oy);
    const body = (x: number, y: number, size: number, alpha = 1) => {
      if (this.visionMode !== 'three-layer' && (Math.hypot(x - vision.x, y - vision.y) > vision.range
        || !hasLineOfSight(this.map, vision.x, vision.y, x, y))) return;
      const pad = sun.shadowLength + size;
      if (x < ox - pad || y < oy - pad || x > ox + ctx.canvas.width + pad || y > oy + ctx.canvas.height + pad) return;
      drawBodySunShadow(ctx, x - ox, y - oy, size, sun, alpha);
    };
    const size = this.player.getSize(); body(this.player.x + size / 2, this.player.y + size / 2, size);
    for (const zombie of this.enemies.zombies) { const p = zombie.getCenter(); body(p.x, p.y, zombie.config.size, this.getEntityAlpha(zombie)); }
    for (const chicken of this.chickens) { const s = chicken.getSize(); body(chicken.x + s / 2, chicken.y + s / 2, s, this.getEntityAlpha(chicken)); }
    for (const pickup of this.goldPickups) body(pickup.x + GoldPickup.SIZE / 2, pickup.y + GoldPickup.SIZE / 2, GoldPickup.SIZE, this.getEntityAlpha(pickup));
    for (const station of this.tradingStations) if (this.canObserveThrowPoint(station.x, station.y)) station.drawSunShadow(ctx, ox, oy, sun);
    ctx.restore();
  }
  private drawFacilityLights(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const light of this.facilityLights) {
      const p = light.getPosition(), x = p.x - ox, y = p.y - oy;
      ctx.save(); ctx.strokeStyle = '#424C49'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.lineTo(x, y - 10); ctx.stroke();
      ctx.fillStyle = '#323C3B'; ctx.fillRect(x - 9, y - 15, 18, 9);
      ctx.fillStyle = '#FFE0A4'; ctx.globalAlpha = Math.min(1, light.visualWeight); ctx.fillRect(x - 6, y - 12, 12, 4); ctx.restore();
    }
  }
  private drawEnvironmentAtmosphere(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const state = this.environment;
    if (this.graphics.dayNight.mode !== 'auto' || this.environmentStage < 3 || state.hazeOpacity <= 0) return;
    const vision = this.player.getVisionState(), x = vision.x - ox, y = vision.y - oy;
    ctx.save();
    const fog = ctx.createRadialGradient(x, y, 140, x, y, 650);
    fog.addColorStop(0, 'rgba(0,0,0,0)'); fog.addColorStop(1, hexToRgba(state.ambientColor, state.hazeOpacity));
    ctx.fillStyle = fog;
    const left = Math.max(0, x - 450), top = Math.max(0, y - 450);
    ctx.fillRect(left, top, Math.max(0, Math.min(ctx.canvas.width, x + 450) - left), Math.max(0, Math.min(ctx.canvas.height, y + 450) - top)); ctx.restore();
  }

  private applyAudio(config: AudioConfig): void {
    this.audio = parseAudioConfig(config);
  }

  /** 所有播放音量都乘总音量；循环音与鸡叫每帧重新读取，改完下一帧生效。 */
  private volume(base: number): number {
    return base * this.audio.master;
  }

  /**
   * 在指定矩形区域内随机寻找可行走位置
   * @param x 左上角 x 坐标
   * @param y 左上角 y 坐标
   * @param width 区域宽度
   * @param height 区域高度
   * @param size 实体大小
   * @returns 找到的可行走位置坐标
   * @throws 当在指定次数尝试后仍未找到可行走位置时抛出错误
   */
  public getSpawnPositionInArea(x: number, y: number, width: number, height: number, size: number, shape: ColliderShape = DEFAULT_SHAPE): { x: number; y: number } {
    const MAX_ATTEMPTS = 1000;
    const compiled = compileShape(shape);
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      const posX = x + this.spawnRandom() * (width - size);
      const posY = y + this.spawnRandom() * (height - size);

      if (this.map.isShapeWalkable(transformCollider(compiled, { x: posX + size / 2, y: posY + size / 2, size, rotation: 0 }))) {
        return { x: posX, y: posY };
      }
      attempts++;
    }

    throw new Error("无法在死区范围内生成可通行位置");
  }

  /** The procedural player needs only configuration; report the actual resource count. */
  load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.loadingPromise) {
      return this.loadingPromise.then(() => { onProgress?.(1, 1); });
    }
    onProgress?.(0, 1);
    this.loadingPromise = (async () => {
      await Promise.all([this.configLoader.load(), this.statusHud.ready]);
      this.player.applyConfig(this.configLoader.getConfig("playerConfig"));
      this.graphics = parseGraphicsConfig(this.configLoader.getConfig("graphics"));
      this.audio = parseAudioConfig(this.configLoader.getConfig("audio"));
      this.applyGraphics(this.graphics);
      this.initialPlayerConfig = this.player.getConfigSnapshot();
      this.initialGraphics = cloneGraphicsConfig(this.graphics);
      this.initialAudio = cloneAudioConfig(this.audio);
      if (this.sceneOptions.campaignData) {
        try { this.restoreCampaignLocation(); }
        catch (error) { throw new InvalidLocationStateError(error instanceof Error ? error.message : String(error)); }
        onProgress?.(1, 1); this.loaded = true; return;
      }
      if (!this.map.isShapeWalkable(this.player.getCollider())) {
        const body = this.player.getCollider();
        const spawn = this.map.getRandomWalkablePosition(this.player.getSize(), body.compiled.shape, body.pose.rotation);
        this.player.x = spawn.x;
        this.player.y = spawn.y;
      }
      this.actorWorld.sync();
      this.enemies.spawn(this.sceneOptions.encounters ?? {}, this.player.getVisionState());
      const vaccines = this.sceneOptions.encounters?.vaccines ?? 2;
      if (!Number.isSafeInteger(vaccines) || vaccines < 0 || vaccines > 1000) throw new Error("疫苗生成数量无效");
      const origin = this.player.getVisionState(), spawner = new EncounterSpawning(this.map, origin, seededRandom(this.runSeed ^ 0x76616363));
      const occupied: { center: { x: number; y: number }; radius: number }[] = [{ center: origin, radius: this.player.getCollider().radius }];
      for (let i = 0; i < vaccines; i++) {
        const center = spawner.find(this.player.getCollider().radius, 100, 350, occupied);
        if (!center) continue;
        this.vaccinePickups.push(new VaccinePickup(center.x - 10, center.y - 10, `map-${i + 1}`));
        occupied.push({ center, radius: 10 });
      }
      this.enemies.spawnReports.push({ kind: "vaccine", requested: vaccines, spawned: this.vaccinePickups.length, skipped: vaccines - this.vaccinePickups.length,
        ...(vaccines > this.vaccinePickups.length ? { reason: "200 次候选中没有玩家体型可达的干地位置" } : {}) });
      for (const report of this.enemies.spawnReports) if (report.skipped) console.warn(`遭遇生成: ${report.kind} ${report.spawned}/${report.requested}; ${report.reason}`);
      for (const id of THROWABLE_IDS) {
        const count = this.sceneOptions.encounters?.[id === 'grenade' ? 'grenades' : 'smokeGrenades'] ?? TC.spawnCount;
        if (!Number.isSafeInteger(count) || count < 0 || count > 1000) throw new Error('投掷物生成数量无效');
        for (let i = 0; i < count; i++) {
          const p = spawner.find(this.player.getCollider().radius, 100, 350, occupied);
          if (!p) continue;
          this.throwablePickups.push(new ThrowablePickup(p.x - 10, p.y - 10, id)); occupied.push({ center: p, radius: 10 });
        }
      }
      this.spawnTradingStations();
      onProgress?.(1, 1);
      this.loaded = true;
    })();
    return this.loadingPromise;
  }

  async onEnter(): Promise<void> {
    this.active = true;
    try {
      await this.load();
      if (this.active) this.onEnterPrepared();
    } catch (error) {
      if (this.active) this.loadError = error instanceof Error ? error.message : String(error);
    }
  }

  onEnterPrepared(): void {
    if (!this.loaded) throw new Error('场景尚未完成准备');
    this.active = true; this.explicitPaused = false;
    this.applyEnvironmentLight();
    this.focusPaused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus();
    this.hiddenPaused = typeof document !== 'undefined' && document.hidden;
    this.resizeCamera();
    this.resizeMinimap();
    this.initLightingSystem();
    this.game.input.setPointerEnabled(true);
    // Tab 交给背包；只在场景有效时拦截浏览器默认的焦点导航。
    this.game.input.setCapturedKeys?.(["Tab"]);
    this.interactionEnabled = true;
    this.interaction.reset();
    this.pickupPrompt.preload();
    this.tradingPrompt.preload();
    // 武器 HUD 的装饰素材只触发加载，不参与启动成败判定；失败时 HUD 自己回退矢量图。
    preloadWeaponHudAssets();
    this.killIndicator.preload();
    // 准星改成独立图层：鼠标一动就更新，不必等这一帧的世界渲染。
    if (typeof document !== 'undefined') {
      window.addEventListener('blur', this.onFocusLost); window.addEventListener('focus', this.onFocusGained);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.crosshairOverlay ??= new CrosshairOverlay();
      this.game.input.onPointerMove = (x, y) => this.crosshairOverlay?.setPosition(x, y);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.cursorKeyListener, true);
      document.addEventListener('wheel', this.minimapWheelListener, { capture: true, passive: false });
      this.pausePanel ??= new PausePanel(() => this.setExplicitPaused(false));
      this.quickSlotHud.attach(this.game.renderer.ctx.canvas, {
        canEdit: () => this.active && this.player.isAlive() && !this.paused,
        beforeEdit: () => { this.backpackPanel?.setOpen(false); this.game.input.clear(); this.quickItemUse = undefined; },
        bound: slot => this.quickSlotBindings[slot] !== null,
        swap: (from, to) => { [this.quickSlotBindings[from], this.quickSlotBindings[to]] = [this.quickSlotBindings[to], this.quickSlotBindings[from]]; },
        unbind: slot => { this.quickSlotBindings[slot] = null; },
      });
    }
    this.debugPanel ??= new PlayerDebugPanel({
      canOpen: () => !this.explicitPaused && !this.isConstructionPlanning(),
      onPause: () => this.setExplicitPaused(true),
      player: this.player,
      input: this.game.input,
      canvas: this.game.renderer.ctx.canvas,
      getGraphics: () => this.graphics,
      setGraphics: config => this.applyGraphics(config),
      getAudio: () => this.audio,
      setAudio: config => this.applyAudio(config),
      initialPlayer: this.initialPlayerConfig,
      initialGraphics: this.initialGraphics,
      initialAudio: this.initialAudio,
      // 三层视野不读 fog.range/fog.feather，留着这两根滑杆只会误导调参。
      hiddenSections: this.visionMode === "three-layer" ? ["fog"] : [],
      onReset: () => { this.throwable.dispose(); this.player.holdingThrowable = false; this.survival.resetLife(); this.damageFeedback.clear(); this.camera.clearDamageKick(); this.camera.clearAimOffset(); },
      onOpenChange: open => {
        if (open) this.backpackPanel?.setOpen(false);
        this.syncModalState();
      },
    });
    this.backpackPanel ??= new BackpackPanel({
      canOpen: () => this.active && this.loaded && this.player.isAlive() && !this.explicitPaused && !this.debugPanel?.isOpen() && !this.isConstructionPlanning(),
      onPause: () => this.setExplicitPaused(true),
      getView: () => this.getBackpackView(),
      onAction: id => this.performBackpackAction(id),
      onDrop: id => this.dropBackpackItem(id),
      onBind: (id, slot) => this.bindQuickSlot(id, slot),
      onOpenChange: open => {
        if (open) this.debugPanel?.setOpen(false);
        this.syncModalState();
      },
    });
    window.addEventListener('resize', this.resizeListener);
    if (this.getCampaignLocationId() === 'outpost') {
      this.structurePanel = new StructurePanel(() => this.getStructurePanelView(), action => this.performStructureAction(action), open => {
        if (open) { this.backpackPanel?.setOpen(false); this.debugPanel?.setOpen(false); }
        const canvas = this.game.renderer.ctx.canvas;
        if (open) { this.constructionTouchAction = canvas.style.touchAction; canvas.style.touchAction = 'none'; }
        else { this.cancelConstructionDrag(); canvas.style.touchAction = this.constructionTouchAction; }
        this.syncModalState();
      }, event => this.startConstructionDrag(event));
      this.game.renderer.ctx.canvas.addEventListener('pointerdown', this.constructionPointer, true);
      this.game.renderer.ctx.canvas.addEventListener('pointermove', this.constructionHover, true);
    }
    this.campaign?.attachHud(this);
    this.dayClockHud.attach();
    this.syncModalState();
    this.game?.resetFrameTime?.();
  }

  onResume(): void { this.onEnterPrepared(); }

  onSuspend(): void {
    if (!this.active) return;
    if (this.structurePanel) {
      this.structurePanel.setOpen(false); this.structurePanel.dispose(); this.structurePanel = undefined;
      this.game.renderer.ctx.canvas.removeEventListener('pointerdown', this.constructionPointer, true);
      this.game.renderer.ctx.canvas.removeEventListener('pointermove', this.constructionHover, true);
    }
    this.active = false;
    window.removeEventListener('blur', this.onFocusLost); window.removeEventListener('focus', this.onFocusGained);
    window.removeEventListener('resize', this.resizeListener);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      document.removeEventListener('keydown', this.cursorKeyListener, true);
      document.removeEventListener('wheel', this.minimapWheelListener, true);
    }
    this.backpackPanel?.dispose(); this.backpackPanel = undefined;
    this.debugPanel?.dispose(); this.debugPanel = undefined;
    this.pausePanel?.dispose(); this.pausePanel = undefined;
    this.crosshairOverlay?.dispose(); this.crosshairOverlay = undefined;
    this.quickSlotHud.dispose(); this.campaign?.detachHud(this);
    this.dayClockHud.dispose();
    this.sfx.pauseAll();
    this.game?.input?.setPointerEnabled(false); this.game?.input?.clear();
    this.game?.input?.setCapturedKeys?.([]); this.game?.input?.setBlocked?.(false);
    if (this.game?.input) this.game.input.onPointerMove = undefined;
    this.setCursorVisible(false);
  }

  onExit(): void { this.onSuspend(); this.disposePrepared(); }

  /** 只释放此候选拥有的资源；未激活候选不能改动当前场景的输入或 DOM。 */
  disposePrepared(): void {
    this.active = false; this.interactionEnabled = false; this.player.cancelPunch(); this.player.cancelReload();
    this.throwable.dispose(); this.player.holdingThrowable = false;
    this.throwableBodies = []; this.throwablePickups = []; this.explosions = []; this.smoke.clear();
    if (this.map.sightOpacity === this.smoke.opacity) this.map.sightOpacity = undefined;
    this.quickItemUse = undefined; this.killIndicator.clear(); this.combatScore.reset();
    this.structures?.dispose(); this.enemies.dispose(); this.actorWorld.clear(); this.survival.dispose();
    this.vaccinePickups = []; this.weaponPickups = []; this.quickSlotBindings.fill(null); this.enemyBlood.clear();
    this.zombieGore.clear(); this.damageFeedback.clear(); this.player.consumeDamageEvents();
    this.bloodStainSystem.clear(); this.particleSystem.clear(); this.camera.clearDamageKick(); this.camera.clearAimOffset();
    this.sfx.stopAll(); this.reloadVoice?.stop(0); this.reloadVoice = null;
    this.activeClucks.forEach(cluck => cluck.handle.stop(0)); this.activeClucks = []; this.pendingCluckStops = [];
    this.soundRippleSystem.clear(); this.playerHearing.reset(); this.noiseSystem.clear(); this.chickenCluckCooldowns.clear();
    this.interaction.reset(); this.pickupCandidates = []; this.pickupMarkers = []; this.spaceHeld = false;
    this.minimap.dispose(); this.displayedView = undefined; this.viewportCache = null;
    this.map.setStaticObstacles([]); this.tradingStations = [];
  }

  getCampaignLocationId() { return this.sceneOptions.campaignData?.location.locationId; }
  getStructures(): StructureSystem | undefined { return this.structures; }
  consumeStructureChanges(): boolean { const changed = this.structuresChanged; this.structuresChanged = false; return changed; }
  isConstructionPlanning(): boolean { return this.structurePanel?.isOpen() === true; }
  canStartConstruction(): boolean {
    const clock = this.campaign?.session.getClockReading();
    return !!this.structures && this.getCampaignLocationId() === 'outpost' && this.player.isAlive() && !this.campaign?.isEnded()
      && !this.transitionPaused && !this.hasDangerousThrowables() && clock?.phase === 'day'
      && !clock.pauseReasons.some(reason => reason !== 'construction');
  }
  toggleConstruction(): void {
    if (!this.structurePanel) return;
    if (this.structurePanel.isOpen()) { this.structurePanel.setOpen(false); return; }
    if (!this.canStartConstruction()) return;
    const p = this.player.getCollider().pose;
    this.structurePanel.select(Math.floor(p.x / this.map.tileSize) + 2, Math.floor(p.y / this.map.tileSize));
    this.structurePanel.setOpen(true);
  }
  private selectConstructionPoint(event: PointerEvent): boolean {
    const panel = this.structurePanel, canvas = this.game.renderer.ctx.canvas;
    // Pointer capture keeps delivering events over panels and outside the canvas; these are not drop targets.
    if (!panel?.isOpen() || document.elementFromPoint(event.clientX, event.clientY) !== canvas) return false;
    const point = this.screenToWorld(event.clientX, event.clientY); if (!point) return false;
    panel.select(Math.floor(point.x / this.map.tileSize), Math.floor(point.y / this.map.tileSize)); return true;
  }
  private startConstructionDrag(event: PointerEvent): void {
    if (!this.structurePanel?.isOpen() || !this.canStartConstruction() || event.button !== 0 || !event.isPrimary || this.constructionDrag) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.currentTarget as HTMLElement;
    this.constructionDrag = { pointerId: event.pointerId, target, overMap: this.selectConstructionPoint(event) };
    window.addEventListener('pointermove', this.constructionMove, { capture: true, passive: false });
    window.addEventListener('pointerup', this.constructionRelease, true);
    window.addEventListener('pointercancel', this.constructionCancel, true);
    window.addEventListener('lostpointercapture', this.constructionCancel, true);
    target.setPointerCapture(event.pointerId);
  }
  private cancelConstructionDrag(): void {
    const drag = this.constructionDrag; this.constructionDrag = undefined;
    if (!drag) return;
    window.removeEventListener('pointermove', this.constructionMove, true);
    window.removeEventListener('pointerup', this.constructionRelease, true);
    window.removeEventListener('pointercancel', this.constructionCancel, true);
    window.removeEventListener('lostpointercapture', this.constructionCancel, true);
    if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
  }
  private placementContext() {
    const entrance = LOCATION_DEFINITIONS[this.getCampaignLocationId()!].entrance.position;
    const actors = [this.player.getCollider(), ...this.enemies.zombies.map(z => z.getCollider()), ...this.chickens.map(c => c.getCollider())];
    for (const pickup of [...this.vaccinePickups, ...this.throwablePickups, ...this.weaponPickups]) {
      const point = pickup.getPickupAnchor(); actors.push(circleCollider(point.x, point.y, 12));
    }
    for (const gold of this.goldPickups) { const point = gold.getRestPosition(); actors.push(circleCollider(point.x, point.y, 8)); }
    return { actors, player: this.player.getCollider(), entrance: { x: entrance.x + this.player.getSize() / 2, y: entrance.y + this.player.getSize() / 2 } };
  }
  private structureAccessError(col: number, row: number): string | null {
    if (!this.canStartConstruction()) return '只能在营地白天安全建设';
    const p = this.player.getCollider().pose, target = { x: (col + .5) * this.map.tileSize, y: (row + .5) * this.map.tileSize };
    if (Math.hypot(p.x - target.x, p.y - target.y) > 175) return '距离过远，请靠近后操作';
    const hit = this.map.castShape(circleCollider(p.x, p.y, .1), { x: target.x - p.x, y: target.y - p.y }, 'projectile');
    const state = this.structures?.at(col, row);
    return hit && hit.obstacle.ownerId !== state?.instanceId ? '建筑被其他障碍遮挡' : null;
  }
  private getStructurePanelView() {
    const panel = this.structurePanel, system = this.structures;
    if (!panel || !system) return { error: '当前地点无法建设', selected: null, canRepair: false, canRemove: false };
    const selected = system.at(panel.col, panel.row), access = this.structureAccessError(panel.col, panel.row);
    const error = access || system.placementError(panel.col, panel.row, panel.rotation, this.placementContext(), false);
    const hp = selected?.observedHp;
    return { error, selected: selected && !this.constructionDrag ? (hp === 0 ? '木墙残骸 · 可清理后重建' : '木墙 · 耐久 ' + (hp ?? '未观察') + '/' + WOOD_WALL.maxHp) : null,
      canRepair: !this.constructionDrag && !access && hp != null && hp > 0 && hp < WOOD_WALL.maxHp,
      canRemove: !this.constructionDrag && !access && !!selected && hp !== null };
  }
  private performStructureAction(action: 'build' | 'repair' | 'remove'): void {
    const panel = this.structurePanel, system = this.structures;
    if (!panel?.isOpen() || !system) throw new Error('请先进入营地建设');
    const error = this.structureAccessError(panel.col, panel.row); if (error) throw new Error(error);
    if (action === 'build') {
      if (!Number.isSafeInteger(this.nextInstanceSequence + 1)) throw new Error('建筑实例序号溢出');
      system.build('structure-' + this.nextInstanceSequence, panel.col, panel.row, panel.rotation, this.placementContext()); this.nextInstanceSequence++;
    } else {
      const selected = system.at(panel.col, panel.row); if (!selected) throw new Error('此处没有建筑');
      if (action === 'repair') system.repair(selected.instanceId); else system.dismantle(selected.instanceId);
    }
    this.campaign?.requestSave(); this.structuresChanged = false; panel.refresh();
  }
  private drawConstructionPreview(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const panel = this.structurePanel; if (!panel?.isOpen() || !this.structures) return;
    const size = this.map.tileSize, player = this.player.getCollider().pose;
    ctx.save(); ctx.translate(-ox, -oy);
    ctx.save(); ctx.beginPath(); ctx.arc(player.x, player.y, 175, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = '#b6d9be44'; ctx.lineWidth = 1; ctx.beginPath();
    for (let col = Math.max(0, Math.floor((player.x - 175) / size)); col <= Math.min(this.map.width, Math.ceil((player.x + 175) / size)); col++) {
      ctx.moveTo(col * size, Math.max(0, player.y - 175)); ctx.lineTo(col * size, Math.min(this.map.height * size, player.y + 175));
    }
    for (let row = Math.max(0, Math.floor((player.y - 175) / size)); row <= Math.min(this.map.height, Math.ceil((player.y + 175) / size)); row++) {
      ctx.moveTo(Math.max(0, player.x - 175), row * size); ctx.lineTo(Math.min(this.map.width * size, player.x + 175), row * size);
    }
    ctx.stroke(); ctx.restore();
    if (this.constructionDrag && !this.constructionDrag.overMap) { ctx.restore(); return; }
    const selected = this.constructionDrag ? undefined : this.structures.at(panel.col, panel.row), body = structureCollider(selected ?? panel, size);
    const error = this.getStructurePanelView().error;
    ctx.strokeStyle = selected ? '#e7ce94' : error ? '#f5a18d' : '#b6f2c0'; ctx.lineWidth = 1;
    ctx.strokeRect(panel.col * size, panel.row * size, size, size);
    ctx.fillStyle = selected ? '#e7ce9411' : error ? '#e1837155' : '#9dd5ab66';
    ctx.strokeStyle = selected ? '#e7ce94' : error ? '#f5a18d' : '#b6f2c0'; ctx.lineWidth = 2;
    ctx.fillRect(body.bounds.x, body.bounds.y, body.bounds.width, body.bounds.height); ctx.strokeRect(body.bounds.x, body.bounds.y, body.bounds.width, body.bounds.height); ctx.restore();
  }
  settleCampaignDeath(): void { if (!this.player.isAlive()) this.releaseThrowable(true); }
  captureCampaignRuntime(): LocationResumeState {
    return parseLocationResume({ heldGrenade: this.throwable.captureHeldGrenade(),
      bodies: this.throwableBodies.filter(body => !body.dead).map(body => ({ id: body.id, kind: body.kind,
        x: body.x, y: body.y, vx: body.vx, vy: body.vy, z: body.z, vz: body.vz, rotation: body.rotation,
        fuse: body.fuse, landed: body.landed, resting: body.resting, smokeAge: body.smokeAge })),
      lastThrowableId: this.throwableId, stepRemainder: this.throwableRemainder }, this.captureCampaignPlayer());
  }
  captureCampaignPlayer(): PersistentPlayerState {
    return parsePersistentPlayer({ ...this.player.capturePersistentCore(),
      infection: { infected: this.survival.infection.isInfected(), remainderSeconds: this.survival.infection.getRemainder() },
      consumables: this.survival.inventory.snapshot(), quickSlots: this.quickSlotBindings.slice() as QuickSlots,
      effects: this.modifierManager.capturePersistentState(),
      preferences: { autoReload: this.player.getAutoReload(), defaultReloadMode: this.player.getDefaultReloadMode(), flashlightOn: this.flashlightOn } });
  }
  captureCampaignPose(): Pose {
    return { position: { x: this.player.x, y: this.player.y }, facing: this.player.getVisualFacing() };
  }
  getTravelBlock(): string | null {
    if (!this.player.isAlive()) return '失去战斗能力时无法离开';
    if (this.hasDangerousThrowables()) return '请等待投掷物和烟雾结束后再离开';
    if (this.player.isRolling()) return '翻滚结束后才能离开';
    const id = this.getCampaignLocationId();
    if (!id) return '当前不是战役地图';
    const entrance = LOCATION_DEFINITIONS[id].entrance.position;
    if (Math.hypot(this.player.x - entrance.x, this.player.y - entrance.y) > 90) return '返回入口标记处可切换地点';
    return null;
  }
  hasDangerousThrowables(): boolean { return this.throwable.locked || this.throwableBodies.some(body => !body.dead); }
  prepareTravel(): void {
    const blocked = this.getTravelBlock(); if (blocked) throw new Error(blocked);
    this.cancelThrowable(); this.player.cancelReload(); this.player.cancelPunch();
    this.reloadVoice?.stop(0); this.reloadVoice = null;
    this.backpackPanel?.setOpen(false); this.quickItemUse = undefined; this.interaction.reset();
  }
  setTransitionPaused(paused: boolean): void { this.transitionPaused = paused; if (this.active) this.syncModalState(); }

  captureCampaignCheckpoint(day: number): CurrentLocationCheckpoint {
    const previous = this.sceneOptions.campaignData?.location;
    if (!previous || !this.loaded) throw new Error('战役地点尚未就绪');
    const itemId = (object: object) => {
      let id = this.persistentItemIds.get(object);
      if (!id) {
        if (!Number.isSafeInteger(this.nextInstanceSequence + 1)) throw new Error('物品实例序号溢出');
        id = 'dynamic-' + this.nextInstanceSequence++;
        this.persistentItemIds.set(object, id);
      }
      return id;
    };
    const loot = new Map<string, GroundItemState>();
    const add = (object: object, position: { x: number; y: number }, item: GroundItemState['item']) => {
      const instanceId = itemId(object); loot.set(instanceId, { instanceId, position: { x: position.x, y: position.y }, item });
    };
    for (const item of this.vaccinePickups) if (item.isPickupReady()) add(item, item, { kind: 'consumable', itemId: 'vaccine', quantity: 1 });
    for (const item of this.throwablePickups) if (item.isPickupReady()) add(item, item, { kind: 'consumable', itemId: item.item, quantity: 1 });
    for (const item of this.weaponPickups) if (item.isPickupReady()) add(item, item, { kind: 'firearm', weapon: captureFirearm(item.weapon) });
    for (const item of this.goldPickups) add(item, item.getRestPosition(), { kind: 'gold', quantity: 1 });
    for (const item of this.pickupItems) {
      const effect = item.getModifierEffect();
      add(item, item, { kind: 'effect', stat: effect.stat as EffectStat | 'health', value: effect.value,
        isMultiplier: effect.isMultiplier, durationSeconds: effect.duration || null });
    }
    const enemies = new Map(this.enemies.zombies.filter(z => z.isAlive()).map(z => [z.id, z] as const));
    const location: LocationState = { ...previous, initialized: true, lastVisitedDay: day, spawns: {},
      groundItems: [], terrainChanges: [], exploration: this.perception?.captureExploration('player') ?? null, structures: this.structures?.snapshot() ?? [] };
    for (const [id, spawn] of Object.entries(previous.spawns)) {
      if (spawn.occupant.kind === 'enemy') {
        const z = spawn.occupant.value && enemies.get(spawn.occupant.value.instanceId);
        location.spawns[id] = { ...spawn, occupant: { kind: 'enemy', value: z ? {
          instanceId: z.id, kind: z.config.kind, hp: z.getHealth(),
          pose: { position: { x: z.x, y: z.y }, facing: z.getFacingDirection() } } : null } };
        if (z) enemies.delete(z.id);
      } else {
        const value = spawn.occupant.value && loot.get(spawn.occupant.value.instanceId);
        location.spawns[id] = { ...spawn, occupant: { kind: 'loot', value: value ?? null } };
        if (value) loot.delete(value.instanceId);
      }
    }
    if (enemies.size) throw new Error('存在未登记的战役敌人');
    location.groundItems = Array.from(loot.values());
    for (let row = 0; row < this.map.height; row++) for (let col = 0; col < this.map.width; col++) {
      const tileTypeId = this.map.tiles[row][col], hp = this.map.tileHp[row][col], goldAlreadyIssued = this.goldDroppedByTile.get(row * this.map.width + col) ?? 0;
      if (tileTypeId !== this.baseTiles[row][col] || hp !== this.baseHp[row][col] || goldAlreadyIssued)
        location.terrainChanges.push({ row, col, tileTypeId, hp, goldAlreadyIssued });
    }
    return { locationId: location.locationId, player: this.captureCampaignPlayer(), pose: this.captureCampaignPose(),
      location, nextInstanceSequence: this.nextInstanceSequence, reason: { kind: 'checkpoint' } };
  }

  private restoreCampaignLocation(): void {
    const data = this.sceneOptions.campaignData!;
    this.map.restoreTerrain(data.location.terrainChanges);
    for (const tile of data.location.terrainChanges) if (tile.goldAlreadyIssued)
      this.goldDroppedByTile.set(tile.row * this.map.width + tile.col, tile.goldAlreadyIssued);
    this.structures = new StructureSystem(this.map, data.location.structures ?? [], () => { this.structuresChanged = true; });
    this.player.restorePersistentState(data.player ?? this.captureCampaignPlayer(), data.pose);
    if (data.player) {
      this.survival.restore(data.player);
      this.modifierManager.restorePersistentState(data.player.effects);
      this.quickSlotBindings.splice(0, 4, ...data.player.quickSlots); this.flashlightOn = data.player.preferences.flashlightOn;
    }
    if (!this.map.isShapeWalkable(this.player.getCollider())) throw new Error('保存的玩家位置不可通行');
    const restoreLoot = (saved: GroundItemState) => {
      const { x, y } = saved.position, item = saved.item;
      if (x < 0 || y < 0 || x >= this.map.width * this.map.tileSize || y >= this.map.height * this.map.tileSize)
        throw new Error('保存的物品位置超出地图');
      let object: object;
      if (item.kind === 'consumable') {
        if (item.quantity !== 1) throw new Error('当前地点只支持单件地面消耗品');
        if (item.itemId === 'vaccine') { const pickup = new VaccinePickup(x, y, saved.instanceId); this.vaccinePickups.push(pickup); object = pickup; }
        else { const pickup = new ThrowablePickup(x, y, item.itemId, saved.instanceId); this.throwablePickups.push(pickup); object = pickup; }
      } else if (item.kind === 'firearm') {
        const pickup = new DroppedWeaponPickup(x, y, this.player.createPersistentFirearm(item.weapon), saved.instanceId);
        this.weaponPickups.push(pickup); object = pickup;
      } else if (item.kind === 'gold') {
        if (item.quantity !== 1) throw new Error('当前地点只支持单个金块');
        const pickup = new GoldPickup(x, y, x, y); pickup.update(GoldPickup.SCATTER_DURATION); this.goldPickups.push(pickup); object = pickup;
      } else {
        const type = { health: PickupType.HEALTH, maxSpeed: PickupType.SPEED_BOOST, damage: PickupType.DAMAGE_BOOST,
          fireRate: PickupType.FIRE_RATE_BOOST, bulletSpeed: PickupType.BULLET_SPEED_BOOST }[item.stat];
        const pickup = new PickupItem(x, y, type, this.particleSystem, { stat: item.stat, value: item.value,
          duration: item.durationSeconds ?? 0, isMultiplier: item.isMultiplier, description: item.stat });
        this.pickupItems.push(pickup); object = pickup;
      }
      this.persistentItemIds.set(object, saved.instanceId);
    };
    for (const spawn of Object.values(data.location.spawns)) {
      if (spawn.occupant.kind === 'loot') { if (spawn.occupant.value) restoreLoot(spawn.occupant.value); }
      else if (spawn.occupant.value) {
        const saved = spawn.occupant.value, size = ZOMBIE_CONFIG[saved.kind].size;
        const z = this.enemies.add(saved.kind, { x: saved.pose.position.x + size / 2, y: saved.pose.position.y + size / 2 },
          saved.pose.facing, { id: saved.instanceId, hp: saved.hp });
        if (!this.map.isShapeWalkable(z.getCollider())) throw new Error('保存的敌人位置不可通行');
      }
    }
    data.location.groundItems.forEach(restoreLoot);
    if (data.runtime) {
      const runtime = parseLocationResume(data.runtime, this.captureCampaignPlayer());
      if (runtime.bodies.some(body => body.x < 0 || body.y < 0 || body.x >= this.map.width * this.map.tileSize || body.y >= this.map.height * this.map.tileSize))
        throw new Error('保存的投掷物位置超出地图');
      this.throwable.restoreHeldGrenade(runtime.heldGrenade); this.player.holdingThrowable = this.throwable.locked;
      this.throwableBodies = runtime.bodies.map(body => ({ ...body, dead: false }));
      this.throwableId = runtime.lastThrowableId; this.throwableRemainder = runtime.stepRemainder;
      this.smoke.sync(this.throwableBodies);
      this.map.sightOpacity = this.throwableBodies.some(body => body.kind === 'smokeGrenade' && body.smokeAge >= 0) ? this.smoke.opacity : undefined;
      this.enemies.recoverAfterLoad();
    }
    if (this.perception && this.perceptionObserver && data.location.exploration)
      this.perception.restoreExploration(this.perceptionObserver, data.location.exploration);
    this.flashlight.setActive(this.flashlightOn); this.actorWorld.sync();
  }



  /**
   * 场景更新逻辑，每帧调用
   * @param delta 时间增量（秒）
   * @param input 输入状态对象
   */
  update(delta: number, input: Input) {
    this.campaign?.refreshHud(this);
    this.deltaSinceLastFrame = this.isWorldPaused() ? 0 : delta;

    if (!this.loaded) return;
    if (this.campaign?.isEnded()) return;
    this.debugPanel?.update(delta);
    if (!this.player.isAlive()) {
      this.backpackPanel?.setOpen(false); this.quickItemUse = undefined;
      this.combatScore.endChain(); this.killIndicator.clear();
    }
    this.backpackPanel?.refresh(); this.structurePanel?.refresh();
    const lifeReset = this.player.getLifeResetVersion();
    if (lifeReset !== this.feedbackResetVersion) {
      this.feedbackResetVersion = lifeReset; this.damageFeedback.clear(); this.camera.clearDamageKick(); this.camera.clearAimOffset();
      this.combatScore.reset(); this.killIndicator.clear();
    }
    if (this.isWorldPaused() || !Number.isFinite(delta) || delta < 0) return;
    this.applyEnvironmentLight();
    // Advance existing feedback before this frame's hits so a new flash is always displayed.
    this.killIndicator.update(delta);
    this.combatScore.update(delta);
    this.damageFeedback.update(delta); this.zombieGore.update(delta); this.camera.advanceDamageKick(delta);
    input = input.captureFrame?.() ?? input;
    const wheelDirection = input.consumeWheelDirection?.() ?? 0;
    const reset = input.getResetVersion?.();
    if (reset !== undefined && reset !== this.inputResetVersion) {
      this.inputResetVersion = reset; this.interaction.reset(); this.throwable.suspend(); this.player.cancelPunch();
    }
    this.noiseSystem.update(delta);
    this.player.advanceDamageTimers(delta);
    if (!this.player.isAlive()) {
      this.flashlightOn = false;
      this.flashlight?.setActive(false);
      this.interaction.reset();
      const enter = input.isKeyDown("Enter");
      if (!this.campaign && enter && !this.deathEnterHeld) {
        this.game?.sceneManager.changeScene(new MenuScene(true), 0);
        return;
      }
      this.deathEnterHeld = enter;
    } else { this.deathEnterHeld = input.isKeyDown("Enter"); }

    // 开火/切枪信号从本帧开始累计，快捷键切枪也参与拾取中断。
    this.shotThisFrame = false;
    this.weaponSwitchedThisFrame = false;
    if (wheelDirection !== 0 && !this.throwable.locked) this.quickItemUse = undefined;
    if (this.player.isAlive() && !input.isBlocked?.()) {
      this.advanceQuickItemUse(delta, input);
      const slot = this.quickSlotHud.update(input);
      if (slot !== null && !this.throwable.locked) {
        const id = this.quickSlotBindings[slot];
        if (id) {
          if (id === 'vaccine') {
            if (this.quickItemUse?.slot !== slot) {
              const failure = this.survival.getVaccineUseFailure(this.inventoryUseContext('gameplay', input));
              if (failure) this.showPickupText(failure);
              else { this.cancelThrowable(); this.quickItemUse = { slot, elapsed: 0, inputReset: input.getResetVersion?.() }; }
            }
          } else {
            this.quickItemUse = undefined;
            const message = this.activateInventoryItem(id, 'gameplay', input);
            if (message) this.showPickupText(message);
          }
        }
      }
    }

    const throwPointer = input.getPointerState?.();
    const throwTarget = throwPointer?.active && (throwPointer.rightDown || throwPointer.aimedLeftPressed) && !this.cursorVisible && !this.quickSlotHud?.isInteracting()
      ? this.screenToWorld(throwPointer.clientX, throwPointer.clientY) ?? undefined : undefined;
    const throwRelease = !!throwPointer && this.player.isAlive() && !this.player.isRolling()
      && this.throwable.input(throwPointer, throwTarget);
    const aim = this.getPointerAim(input);
    const vaccineDown = input.isKeyDown("v");
    const actionInput = this.weaponSwitchedThisFrame || wheelDirection !== 0 || aim?.fire === true || (input.isKeyDown(" ") && !this.spaceHeld) ||
      (input.isKeyDown("r") && !this.reloadHeld) || (input.isKeyDown("c") && !this.cHeld);
    if (!this.throwable.locked && vaccineDown && !this.vaccineHeld && this.survival.tryUseVaccine({ paused: false, rolling: this.player.isRolling(),
      reloading: this.player.getWeaponView().isReloading, interacting: input.isKeyDown("e"), actionInput })) this.showPickupText("感染已治愈");
    this.vaccineHeld = vaccineDown;
    const dot = this.survival.update(delta);
    if (dot?.appliedAmount) this.showPickupText(`感染 -${dot.appliedAmount} HP`);

    // 更新玩家状态
    const prevX = this.player.x, prevY = this.player.y;
    this.actorWorld.sync();
    this.player.update(delta, input, this.map, aim);
    // R 键换弹同样只认下沿，按住不会反复起手。
    const reloadDown = input.isKeyDown("r");
    if (!this.throwable.held && reloadDown && !this.reloadHeld) this.player.requestReload();
    this.reloadHeld = reloadDown;

    // 滚轮在主副枪械之间切换，同一帧最多切换一次；C 收枪/空手。
    if (!this.throwable.locked && this.player.isAlive() && !input.isBlocked?.() && wheelDirection !== 0) {
      this.cancelThrowable();
      const previousSlot = this.player.getActiveWeaponSlot();
      this.player.cycleFirearm(wheelDirection || 1);
      if (this.player.getActiveWeaponSlot() !== previousSlot) {
        this.weaponSwitchedThisFrame = true;
        // 与手电开关同一声轻响；单声部保证快速连按时只留最后一次的尾音。
        this.sfx.play(SWITCH_CLICK_SOUND, this.volume(this.audio.weapon.switchVolume), 1, { count: 1 });
      }
    }
    const cDown = input.isKeyDown("c");
    if (!this.throwable.locked && this.player.isAlive() && cDown && !this.cHeld) {
      this.cancelThrowable();
      this.player.toggleMelee();
      this.weaponSwitchedThisFrame = true;
    }
    this.cHeld = cDown;

    // 空格翻滚只认下沿：按住不会连续起滚，连滚需要松开再按。
    const spaceDown = input.isKeyDown(" ");
    if (!this.throwable.locked && spaceDown && !this.spaceHeld && this.player.requestRoll(input)) {
      this.cancelThrowable();
      this.noiseSystem.emit("roll", this.player.x + this.player.getSize() / 2,
        this.player.y + this.player.getSize() / 2, { sourceId: "player" });
    }
    this.spaceHeld = spaceDown;
    this.updateThrowables(delta, throwRelease);
    this.settlePlayerPunches();

    // 换弹完成、被翻滚打断或切走时收掉没放完的换弹声，别压到下面那声枪响。
    if (this.reloadVoice && !this.player.getWeaponView().isReloading) {
      this.reloadVoice.stop(0.12);
      this.reloadVoice = null;
    }
    // 右侧武器列表在本帧滚轮/C 处理之后更新，保持最终武器顺序一致。
    // 用实际位移判断“在走”，顶墙原地推和被墙卡住时不会继续播放涉水声。
    const movedSpeed = delta > 0 ? Math.hypot(this.player.x - prevX, this.player.y - prevY) / delta : 0;
    this.updateWadingSound(movedSpeed);
    this.updateFootstepSound(movedSpeed);
    // 两条循环音效的目标音量都设好了，统一推进一步淡入淡出，各自都是 120 毫秒。
    this.sfx.update(delta);
    this.chickenStepDelay = Math.max(0, this.chickenStepDelay - delta);
    this.updateChickenCluckCooldowns(delta);

    // 光照与手电先于小鸡感知结算：否则小鸡看到的是上一帧的灯位、朝向与开关。
    this.torches.forEach(torch => torch.update(delta));
    this.lightingSystem.update(delta);

    // 玩家中心位置同时供相机、光源与小鸡感知使用，只在本帧算一次。
    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    if (this.player.isAlive()) this.camera.follow(playerCenterX, playerCenterY, delta);
    this.updateAimCamera(delta, input);
    const center = new Vector2(playerCenterX, playerCenterY);
    this.playerLight.setPosition(center);
    this.flashlight.setPosition(center);
    this.flashlight.setDirection(this.player.getVisionState().direction);

    // G 键是开关而不是常亮：只在下沿切换，避免按住时反复翻转。
    // 提前到感知之前，玩家视野与小鸡视觉才能在同一帧看到同一盏灯。
    const flashlightDown = input.isKeyDown("g");
    if (this.player.isAlive() && flashlightDown && !this.flashlightHeld) {
      this.flashlightOn = !this.flashlightOn;
      this.flashlight.setActive(this.flashlightOn);
      // 开关共用一声轻响；单声部保证快速连按时只留最后一次的尾音。
      this.sfx.play(SWITCH_CLICK_SOUND, this.volume(this.audio.flashlight.switchVolume), 1, { count: 1 });
    }
    this.flashlightHeld = flashlightDown;

    // 小鸡视觉与玩家三层视野共用同一份灯列表，避免两套光照判断漂移。
    this.rebuildPerceptionLights();

    this.enemies.update(delta, {
      environment: this.environment,
      target: { x: playerCenterX, y: playerCenterY, alive: this.player.isAlive(), radius: this.player.getCollider().radius, emittingLightId: "flashlight" },
      lights: this.perceptionLights,
      playerNoises: selectPlayerNoises(this.noiseSystem.getEvents()),
    });
    for (const impact of this.enemies.consumeHitEffects()) this.zombieGore.hit(impact);
    this.enemies.settleAttacks(this.player, (result, zombie, _id, random) => {
      if (result.perfectDodge) this.showPickupText("完美闪避");
      if (this.survival.onMeleeDamage(result, zombie.config.infectionChance, random)) this.showPickupText("已感染");
    });
    for (const event of this.player.consumeDamageEvents()) {
      this.damageFeedback.push(event);
      if (event.kind === 'melee' && event.sourcePosition) this.camera.kickFromDamage(Math.atan2(
        event.targetPosition.y - event.sourcePosition.y, event.targetPosition.x - event.sourcePosition.x));
    }
    if (this.player.consumeDeathEvent()) {
      this.backpackPanel?.setOpen(false);
      this.releaseThrowable(true); this.throwable.dispose(); this.player.holdingThrowable = false;
      this.combatScore.endChain(); this.killIndicator.clear();
      this.camera.clearAimOffset();
      this.deathEnterHeld = input.isKeyDown("Enter");
      this.interaction.reset(); this.flashlightOn = false; this.flashlight.setActive(false);
      this.reloadVoice?.stop(0); this.reloadVoice = null;
      this.crosshairOverlay?.setVisible(false);
    }
    for (const death of this.enemies.consumeDeaths()) {
      this.zombieGore.burst(death);
      this.enemyBlood.spawn(death.x, death.y, this.map, { scale: 1.55, direction: death.impact.direction });
    }

    // 小鸡只在干地自由游荡，不读取玩家输入；感知刺激由场景统一提供。
    this.chickens.forEach(chicken => chicken.update(delta, input, this.map, {
      targetX: playerCenterX,
      targetY: playerCenterY,
      environment: this.environment,
      lights: this.perceptionLights,
      noiseEvents: this.noiseSystem.getEvents(),
      soundSourceId: this.getChickenSoundId(chicken),
    }));
    // 尸体滑行结束的事件在本帧所有小鸡更新完之后统一消费。
    this.flushChickenDeaths();
    // 鸡叫是几秒钟的整段录音：玩家这几秒里的走动要立刻反映到音量上。
    this.updateCluckVolumes(delta);

    // 更新粒子系统
    this.particleSystem.update(delta);
    this.craterSystem.update(delta);
    this.bloodStainSystem.update(delta);
    this.enemyBlood.update(delta);
    this.footprintSystem.update(delta);
    this.rippleSystem.update(delta);
    // 边界反馈读取原始输入方向：贴墙时速度已被清零，但仍要能判断还在往里推。
    this.boundaryRippleSystem.update(delta, this.player.getCollider().bounds,
      this.player.getMoveIntent(input), this.map.width * this.map.tileSize,
      this.map.height * this.map.tileSize);
    this.floatingTexts.update(delta);

    // 更新属性修改器
    this.modifierManager.update(delta);

    // 更新道具状态
    this.updatePickupItems(delta, input);

    // 检查玩家与道具的碰撞
    this.checkPickupCollisions();
    this.updateGoldPickups(delta);
    // 白烟与肉块同帧出现，肉块当帧就开始下落。
    this.updateMeatPickups(delta);

    // 感知先于按键与交互结算：拾取系统只使用本帧的可见性结果，不读上一帧。
    this.campaign?.advance(this, delta);
    this.applyEnvironmentLight();
    this.updatePerception(delta);
    this.structures?.observe((x, y) => this.perception ? this.perception.canIdentify('player', x, y) : this.canObserveThrowPoint(x, y));
    // 小地图消费同一份感知结果：观察格/记忆刚更新过，当帧就能反映。
    this.updateMinimap(delta);
    // 声音提示只消费世界噪声事件，不参与感知，也不会被感知遮罩擦掉。
    this.updateSoundRipples(delta);

    // 拾取放在所有可能打断它的动作之后：本帧的开火/切枪/翻滚会立即取消进度。
    this.updateInteraction(delta, input);
    this.updateTradingStation(input);
    // 肉块本帧被移除后，绑定的血迹从下一帧开始走正常的保留与淡出。
    // 切枪输入结算完再推进 HUD：第一帧的武器顺序与动画起点必须同源，
    // 否则会先用旧进度画新顺序、下一帧才重新开始交换。
    this.weaponListHud.update(delta, this.player.getWeaponLoadoutView());
    // 手电开关已在感知之前结算，这里同帧推进状态条渐变，避免 HUD 慢一帧。
    this.flashlightHud.update(delta, this.flashlightOn);

  }

  /** 供敌人听觉、调试面板与测试读取的噪声总线（只读用途，写入仍由场景负责）。 */
  getNoiseSystem(): NoiseSystem { return this.noiseSystem; }
  getEnemySystem(): EnemySystem { return this.enemies; }
  getSurvivalSystem(): PlayerSurvivalSystem { return this.survival; }
  getPlayer(): Player { return this.player; }
  getVaccinePickups(): readonly VaccinePickup[] { return this.vaccinePickups; }
  isWorldPaused(): boolean { return this.paused || this.campaign?.session.getClockReading().paused === true; }
  /** 仅开发构建的外部状态预览，不修改 CampaignSession，也不推进任何世界时间。 */
  setDayClockPreview(state: Readonly<DayClockHudState> | null): void {
    if (!isDevelopmentBuild()) return;
    this.dayClockPreview = state ? { ...state, raid: state.raid ? { ...state.raid } : undefined } : undefined;
  }
  private getGroundInventoryPickups(): (VaccinePickup | DroppedWeaponPickup | ThrowablePickup)[] { return [...this.vaccinePickups, ...this.weaponPickups, ...this.throwablePickups]; }
  private getThrowableCounts() { return { grenade: this.survival.inventory.getCount('grenade'), smokeGrenade: this.survival.inventory.getCount('smokeGrenade') }; }
  private cancelThrowable(): void {
    if (!this.throwable.cancel()) return;
    this.player.holdingThrowable = false;
  }
  private throwableOrigin() {
    const p = this.player.getVisionState(), angle = this.player.getVisualFacing();
    const hand = { x: p.x + Math.cos(angle + .35) * 25, y: p.y + Math.sin(angle + .35) * 25 };
    return this.map.isShapeWalkable(circleCollider(hand.x, hand.y, TC.radius)) ? hand : { x: p.x, y: p.y };
  }
  private releaseThrowable(death = false): void {
    if (death && !this.throwable.locked) { this.cancelThrowable(); return; }
    const item = this.throwable.commit(); if (!item) return;
    const origin = death ? this.player.getVisionState() : this.throwableOrigin();
    if (item.kind === 'grenade' && item.fuse <= 1e-8) this.explodeThrowable(origin.x, origin.y);
    else {
      const body = launchThrowable(++this.throwableId, item.kind, origin, item.target, item.fuse);
      if (death) { body.vx = body.vy = body.vz = 0; }
      this.throwableBodies.push(body);
    }
    this.player.holdingThrowable = !!this.throwable.held;
    if (!this.throwable.held && !death) this.player.switchWeapon(this.player.hasWeapon(this.throwable.returnWeapon) ? this.throwable.returnWeapon : 'melee');
  }
  private updateThrowables(delta: number, release: boolean): void {
    if (!this.player.isAlive()) this.releaseThrowable(true);
    else if (release) this.releaseThrowable();
    this.throwableRemainder += delta;
    while (this.throwableRemainder + 1e-9 >= TC.step) {
      this.throwableRemainder = Math.max(0, this.throwableRemainder - TC.step);
      for (const b of this.throwableBodies) stepThrowable(b, TC.step, this.map, event => {
        if (event.type === 'explode') this.explodeThrowable(b.x, b.y);
        else if (event.type === 'land') {
          this.noiseSystem.emit('impact', b.x, b.y, { sourceId: 'player', loudness: .3 });
          this.sfx.play(SWITCH_CLICK_SOUND, this.volume(.12), .7);
        }
      });
      if (this.player.isAlive() && this.throwable.advance(TC.step)) this.releaseThrowable();
      else if (!this.player.isAlive()) this.releaseThrowable(true);
      for (const effect of this.explosions) effect.age += TC.step;
    }
    this.throwableBodies = this.throwableBodies.filter(b => !b.dead);
    this.explosions = this.explosions.filter(e => e.age < .65);
    this.smoke.sync(this.throwableBodies);
    this.map.sightOpacity = this.throwableBodies.some(b => b.kind === 'smokeGrenade' && b.smokeAge >= 0) ? this.smoke.opacity : undefined;
  }
  private explodeThrowable(x: number, y: number): void {
    const terrainHits = collectBlastTerrain(this.map, x, y), structureHits = this.structures?.collectBlast(x, y) ?? [];
    this.explosions.push({ x, y, age: 0 });
    this.particleSystem.createExplosion(new Vector2(x, y), 32, 320, 4, .5, ['#bcb39a', '#e7bd72', '#807c71']);
    this.noiseSystem.emit('explosion', x, y, { sourceId: 'player' });
    const player = this.player.getVisionState(), distance = Math.hypot(player.x - x, player.y - y);
    const gain = Math.max(0, 1 - distance / 900);
    if (gain > 0) this.camera.shake(9 * gain * gain, .32, Math.atan2(player.y - y, player.x - x), 32, 'quadratic');
    this.sfx.play('/audio/throwables/explosion.wav', this.volume(gain * .8), 1, { count: 4 });
    const impactAt = (target: { x: number; y: number }): BulletImpact | null => {
      const dx = target.x - x, dy = target.y - y, d = Math.hypot(dx, dy), damage = blastDamage(d);
      if (damage <= 0 || !hasLineOfSight(this.map, x, y, target.x, target.y)) return null;
      return { damage, point: { ...target }, direction: { x: d ? dx / d : 1, y: d ? dy / d : 0 },
        impulse: TC.impulse * damage / TC.damage, impactSpeed: 1, initialSpeed: 1, traveledDistance: d, source: 'explosion' };
    };
    // Take the alive snapshot before self-damage; simultaneous grenade kills still count.
    const credited = this.player.isAlive();
    for (const zombie of this.enemies.zombies) {
      const impact = impactAt(zombie.getCenter());
      if (impact && this.enemies.receiveHit(zombie, impact) === 'killed' && credited)
        this.killIndicator.show(this.combatScore.recordKill(zombie.config.kind));
    }
    for (const chicken of this.chickens) {
      const impact = impactAt({ x: chicken.x + chicken.getSize() / 2, y: chicken.y + chicken.getSize() / 2 });
      if (impact) this.damageChicken(chicken, impact);
    }
    const self = impactAt(player);
    if (self) this.player.applyDamage({ amount: self.damage, kind: 'explosion', sourceId: 'player', sourcePosition: { x, y } });
    for (const hit of terrainHits) this.map.damageTile(hit.col, hit.row, hit.damage);
    for (const hit of structureHits) this.structures?.damage(hit.id, hit.damage);
  }
  private spawnTradingStations(): void {
    const random = seededRandom(this.runSeed ^ 0x74726164);
    const count = this.sceneOptions.encounters?.tradingStations ?? (random() < .5 ? 1 : 2);
    if (!Number.isSafeInteger(count) || count < 0 || count > 2) throw new Error('交易站数量必须为 0–2');
    const origin = this.player.getVisionState(), spawner = new EncounterSpawning(this.map, origin, random);
    const occupied = [{ center: origin, radius: this.player.getCollider().radius },
      ...this.enemies.zombies.map(z => ({ center: z.getCenter(), radius: z.getCollider().radius })),
      ...this.getGroundInventoryPickups().map(p => ({ center: p.getPickupAnchor(), radius: 10 }))];
    for (let i = 0; i < count; i++) {
      // 第一个交易站放在出生点附近，其余交易站继续分布在地图中。
      const maxDistance = i === 0 ? 300 : Math.min(2200, Math.hypot(this.map.width, this.map.height) * this.map.tileSize);
      const p = spawner.find(this.player.getCollider().radius, 150, maxDistance, occupied, 200, true, 55);
      if (!p) break;
      this.tradingStations.push(new TradingStation(`station-${i + 1}`, p.x, p.y)); occupied.push({ center: p, radius: 130 });
    }
    this.map.setStaticObstacles(this.tradingStations.map(s => s.getCollider()));
  }
  private updateTradingStation(input: Input): void {
    const p = this.player.getVisionState();
    this.focusedStation = this.player.isAlive() && !this.throwable.locked && !input.isBlocked?.()
      ? this.tradingStations.filter(s => Math.hypot(s.x - p.x, s.y - p.y) <= 90 && hasLineOfSight(this.map, p.x, p.y, s.x, s.y)).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] : undefined;
    const down = input.isKeyDown('t');
    if (down && !this.tradeHeld && this.focusedStation) this.interactTradingStation(this.focusedStation.id);
    this.tradeHeld = down;
  }
  interactTradingStation(id: string): boolean {
    const station = this.tradingStations.find(s => s.id === id), p = this.player.getVisionState();
    if (!station || this.paused || this.modalActive || this.throwable.locked || !this.player.isAlive()
      || Math.hypot(station.x - p.x, station.y - p.y) > 90 || !hasLineOfSight(this.map, p.x, p.y, station.x, station.y)) return false;
    this.lastTradingStationId = id; this.showPickupText('交易功能暂未开放'); return true;
  }
  getTradingStationState() { return { stations: this.tradingStations.map(s => ({ id: s.id, x: s.x, y: s.y })), focused: this.focusedStation?.id ?? null, lastInteracted: this.lastTradingStationId }; }
  private canObserveThrowPoint(x: number, y: number): boolean {
    const p = this.player.getVisionState();
    if (!hasLineOfSight(this.map, p.x, p.y, x, y) || this.smoke.opacity(p.x, p.y, x, y) >= .35) return false;
    return this.perception ? this.perception.getTerrainRecall('player', x, y) === 'observed' : Math.hypot(p.x - x, p.y - y) < p.range;
  }
  private drawThrowableWorld(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const b of this.throwableBodies) {
      if (!this.canObserveThrowPoint(b.x, b.y)) continue;
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath();
      ctx.ellipse(b.x - ox, b.y - oy, Math.max(3, 9 - b.z * .03), 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      drawThrowable(ctx, b.kind, b.x - ox, b.y - b.z - oy, b.rotation, 24);
    }
    for (const e of this.explosions) {
      if (!this.canObserveThrowPoint(e.x, e.y)) continue;
      ctx.save(); ctx.beginPath();
      for (let y = e.y - TC.blastRadius; y <= e.y + TC.blastRadius; y += 20)
        for (let x = e.x - TC.blastRadius; x <= e.x + TC.blastRadius; x += 20)
          if (this.canObserveThrowPoint(x, y) && hasLineOfSight(this.map, e.x, e.y, x, y)) ctx.rect(x - ox - 10, y - oy - 10, 20, 20);
      ctx.clip();
      const radius = 25 + Math.min(1, e.age / .18) * 155;
      const gradient = ctx.createRadialGradient(e.x - ox, e.y - oy, 0, e.x - ox, e.y - oy, radius);
      gradient.addColorStop(0, `rgba(255,232,163,${Math.max(0, 1 - e.age * 5)})`);
      gradient.addColorStop(.35, `rgba(209,139,62,${Math.max(0, .7 - e.age)})`);
      gradient.addColorStop(1, 'rgba(95,91,77,0)'); ctx.fillStyle = gradient;
      ctx.fillRect(e.x - ox - radius, e.y - oy - radius, radius * 2, radius * 2);
      ctx.strokeStyle = `rgba(244,217,171,${Math.max(0, 1 - e.age / .65) * .65})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x - ox, e.y - oy, radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }
  private drawThrowableAim(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const p = this.player.getVisionState();
    this.smoke.draw(ctx, ox, oy, (x, y) => hasLineOfSight(this.map, p.x, p.y, x, y)
      && Math.hypot(p.x - x, p.y - y) <= this.visionRules.maxObservationRange);
    if (this.map.sightOpacity) this.drawPerceptionSilhouettes(ctx, ox, oy, true);
    if (!this.throwable.held || !this.player.isAlive()) return;
    const origin = this.throwableOrigin();
    ctx.save(); ctx.globalAlpha = 1 - this.smoke.density(p.x, p.y) * .75;
    drawThrowable(ctx, this.throwable.held, origin.x - ox, origin.y - oy, this.player.getVisualFacing() + Math.PI / 2, 20); ctx.restore();
    if (this.throwable.locked) {
      ctx.save(); ctx.fillStyle = this.throwable.fuse <= 1 ? '#ff7e57' : '#f0d49c'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${this.throwable.fuse.toFixed(1)}s`, p.x - ox, p.y - oy + 48); ctx.restore();
    }
    const pointer = this.game?.input.getPointerState?.();
    if (this.paused || this.cursorVisible || !pointer?.rightDown || !pointer.active) return;
    const target = this.screenToWorld(pointer.clientX, pointer.clientY); if (!target) return;
    const preview = previewThrow(this.throwable.held, origin, target, this.map, this.throwable.fuse);
    ctx.save(); ctx.strokeStyle = 'rgba(211,227,212,.65)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.beginPath();
    let complete = true;
    for (let i = 0; i < preview.points.length; i++) {
      const point = preview.points[i];
      if (!this.canObserveThrowPoint(point.x, point.y)) { complete = false; break; }
      if (!i) ctx.moveTo(point.x - ox, point.y - point.z - oy); else ctx.lineTo(point.x - ox, point.y - point.z - oy);
    }
    ctx.stroke(); ctx.setLineDash([]);
    const ring = (point: { x: number; y: number }, radius: number) => { ctx.beginPath(); ctx.arc(point.x - ox, point.y - oy, radius, 0, Math.PI * 2); ctx.stroke(); };
    if (preview.landing && this.canObserveThrowPoint(preview.landing.x, preview.landing.y)) ring(preview.landing, 5);
    if (complete) {
      ctx.strokeStyle = this.throwable.held === 'grenade' ? '#d9ac70' : '#a0c8bc'; ring(preview.end, 12);
      ctx.font = '12px sans-serif'; ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'center';
      ctx.fillText(this.throwable.held === 'grenade' ? '预计爆点' : '预计停留点', preview.end.x - ox, preview.end.y - oy + 27);
    }
    ctx.restore();
  }
  private getBackpackView() {
    return createBackpackView(this.player.getWeaponLoadoutView(), this.survival.inventory.getVaccines(),
      this.survival.getVaccineUseFailure(this.backpackVaccineContext()), this.quickSlotBindings.slice(), this.getThrowableCounts(), this.throwable.held, this.throwable.locked);
  }
  private bindQuickSlot(id: BackpackItemId, slot: number): string | null {
    if (this.throwable.locked) return '手雷已拉环，请先投出';
    if (!this.backpackPanel?.isOpen() || this.debugPanel?.isOpen() || !this.player.isAlive()
      || !Number.isInteger(slot) || slot < 0 || slot > 3 || !this.getBackpackView().items.some(item => item.id === id)) return null;
    for (let i = 0; i < 4; i++) if (this.quickSlotBindings[i] === id) this.quickSlotBindings[i] = null;
    this.quickSlotBindings[slot] = id;
    return `已放入快捷栏 ${slot + 1}`;
  }
  private dropBackpackItem(id: BackpackItemId): string | null {
    if (this.throwable.locked) return '手雷已拉环，请先投出';
    if (!this.active || !this.backpackPanel?.isOpen() || this.debugPanel?.isOpen() || !this.player.isAlive()) return null;
    if (id === 'melee') return '空手不可丢弃';
    const view = this.player.getVisionState();
    let position: { x: number; y: number } | undefined;
    for (const offset of [18, 0]) {
      const x = view.x + Math.cos(view.direction) * offset, y = view.y + Math.sin(view.direction) * offset;
      if (this.map.isShapeWalkable(circleCollider(x, y, 10))) { position = { x, y }; break; }
    }
    if (!position) return '附近没有可放置物品的位置';
    let name: string;
    if (isThrowable(id)) {
      if (this.throwable.held === id) this.cancelThrowable();
      if (!this.survival.inventory.consume(id)) return '物品不足';
      this.throwablePickups.push(new ThrowablePickup(position.x - 10, position.y - 10, id)); name = THROWABLE_ITEMS[id].name;
    } else if (id === 'vaccine') {
      if (!this.survival.inventory.consumeVaccine()) return '疫苗不足';
      this.vaccinePickups.push(new VaccinePickup(position.x - 10, position.y - 10)); name = '疫苗';
    } else {
      const item = this.player.dropWeapon(id); if (!item) return '未持有该物品';
      this.weaponPickups.push(new DroppedWeaponPickup(position.x - 10, position.y - 10, item)); name = item.name;
      this.weaponListHud.update(0, this.player.getWeaponLoadoutView());
    }
    this.updatePerception(0); this.updateMinimap(0);
    return `已丢弃 ${name} ×1`;
  }
  /** Backpack actions use the live world and the same eligibility checks as gameplay. */
  private backpackVaccineContext() {
    return { paused: this.paused, rolling: this.player.isRolling(), reloading: this.player.getWeaponView().isReloading,
      interacting: false, actionInput: false, source: 'backpack' as const };
  }
  private inventoryUseContext(source: 'gameplay' | 'backpack', input?: Input) {
    const pointer = input?.getPointerState?.();
    return { ...this.backpackVaccineContext(), source, interacting: input?.isKeyDown('e') === true,
      actionInput: this.throwable.locked || !!pointer?.leftDown || !!pointer?.leftPressed
        || ['r', 'c', ' ', 'v'].some(key => input?.isKeyDown(key) === true) };
  }
  private advanceQuickItemUse(delta: number, input: Input): void {
    const use = this.quickItemUse; if (!use) return;
    const otherQuickKey = this.quickSlotBindings.some((id, slot) => id && slot !== use.slot
      && (input.isKeyDown(String(slot + 1)) || input.isKeyDown('Numpad' + (slot + 1))));
    if (use.inputReset !== input.getResetVersion?.() || this.quickSlotBindings[use.slot] !== 'vaccine'
      || otherQuickKey
      || this.survival.getVaccineUseFailure(this.inventoryUseContext('gameplay', input))) {
      this.quickItemUse = undefined; return;
    }
    use.elapsed = Math.min(1, use.elapsed + delta);
    if (use.elapsed >= 1 - 1e-9) {
      this.quickItemUse = undefined;
      const message = this.activateInventoryItem('vaccine', 'gameplay', input);
      if (message) this.showPickupText(message);
    }
  }
  private performBackpackAction(id: BackpackItemId): string | null {
    if (!this.active || !this.backpackPanel?.isOpen() || this.debugPanel?.isOpen() || !this.player.isAlive()) return null;
    return this.activateInventoryItem(id, 'backpack');
  }
  private activateInventoryItem(id: BackpackItemId, source: 'gameplay' | 'backpack', input?: Input): string | null {
    if (this.throwable.locked) return '手雷已拉环，请先投出';
    if (isThrowable(id)) {
      if (this.player.isRolling()) return '翻滚期间无法握持';
      if (!this.throwable.equip(id, this.player.getActiveWeaponSlot())) return '物品不足';
      this.player.cancelReload(); this.reloadVoice?.stop(0); this.reloadVoice = null;
      this.player.holdingThrowable = true; this.weaponSwitchedThisFrame = true; this.quickItemUse = undefined;
      return `已握持 ${THROWABLE_ITEMS[id].name}`;
    }
    this.cancelThrowable();
    if (id === 'vaccine') {
      const context = this.inventoryUseContext(source, input);
      const failure = this.survival.getVaccineUseFailure(context);
      if (failure) return failure;
      const used = this.survival.tryUseVaccine(context);
      return used ? '感染已治愈' : '无法使用疫苗';
    }
    if (id !== 'primary' && id !== 'secondary' && id !== 'melee') return null;
    if (!this.player.hasWeapon(id)) return '未持有该武器';
    this.weaponSwitchedThisFrame ||= this.player.getActiveWeaponSlot() !== id;
    this.player.switchWeapon(id);
    if (!this.player.getWeaponView().isReloading) { this.reloadVoice?.stop(0); this.reloadVoice = null; }
    this.weaponListHud.update(0, this.player.getWeaponLoadoutView());
    return `已装备 ${this.player.getWeaponName()}`;
  }
  private setExplicitPaused(paused: boolean): void {
    this.explicitPaused = paused;
    if (paused) { this.backpackPanel?.setOpen(false); this.debugPanel?.setOpen(false); }
    this.pausePanel?.setOpen(paused); this.syncModalState();
    if (paused) this.campaign?.requestSave();
  }
  private readonly minimapWheelListener = (event: WheelEvent) => {
    if (event.target instanceof Element && event.target.closest('.backpack-panel, .backpack-menu')) return;
    if (!this.active || this.paused || event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY) || !event.deltaY) return;
    const v = this.getCanvasViewport(); if (!v) return;
    const dpr = window.devicePixelRatio || 1;
    const x = (event.clientX - v.left) * this.game.renderer.width / dpr / v.width;
    const y = (event.clientY - v.top) * this.game.renderer.height / dpr / v.height;
    if (!this.minimap.contains(x, y)) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.minimap.zoomBy(Math.sign(event.deltaY)); this.updateMinimap(0);
  };
  private syncModalState(): void {
    this.player.cancelPunch();
    const planning = this.structurePanel?.isOpen() === true;
    const open = planning || this.backpackPanel?.isOpen() === true || this.debugPanel?.isOpen() === true;
    this.modalActive = open;
    this.quickItemUse = undefined;
    this.throwable.suspend();
    this.setWorldPaused(this.explicitPaused || planning || this.debugPanel?.isOpen() === true || this.focusPaused || this.hiddenPaused || this.transitionPaused);
    if (this.campaign) {
      for (const [reason, paused] of [['menu', this.explicitPaused], ['debug', this.debugPanel?.isOpen() === true],
        ['blur', this.focusPaused], ['hidden', this.hiddenPaused], ['loading', this.transitionPaused], ['construction', planning]] as const)
        this.campaign.session.setTimePaused(reason, paused);
    }
    this.game.input.setBlocked?.(open || this.paused);
    // 切换两个面板时也清除按住状态，关闭后必须重新按键/点击。
    this.game.input.clear();
    this.setCursorVisible(open || this.paused);
  }
  private setWorldPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused; this.deltaSinceLastFrame = 0;
    if (paused) { this.quickSlotHud.cancelDrag(); this.player.cancelPunch(); }
    this.interaction.reset(); this.pickupCandidates = []; this.pickupMarkers = []; this.completedPickupFeedback = null;
    this.cHeld = this.spaceHeld = this.reloadHeld = this.vaccineHeld = this.flashlightHeld = false;
    this.game?.input.clear();
    if (paused) this.sfx.pauseAll(); else this.sfx.resumeAll();
  }
  getZombieDebugState() {
    if (!isDevelopmentBuild()) return null;
    return { seed: this.runSeed, paused: this.paused, audioPaused: this.sfx.isPaused(), enemies: this.enemies.snapshot(), navigation: { ...this.enemies.navigation.stats },
      cpu: { ...this.enemies.metrics }, survival: this.survival.snapshot(), spawns: this.enemies.spawnReports.map(r => ({ ...r })), actors: this.actorWorld.size };
  }

  /**
   * 重建本帧感知光源：玩家微光、手电与点燃的火把。
   * 玩家三层视野与小鸡视觉共用这一份结果，避免两套光照判断漂移。
   */
  private rebuildPerceptionLights(): void {
    if (!this.playerLight || !this.flashlight) return;
    const lights = this.perceptionLights;
    lights.length = 0;
    for (let i = 0; i < this.facilityLights.length; i++) {
      const light = this.facilityLights[i], position = light.getPosition();
      lights.push({ id: `facility-${i}`, x: position.x, y: position.y, radius: light.getEffectiveRadius(), intensity: light.getIntensity(),
        active: light.isLightActive(), revealsDetails: true, kind: 'facility' });
    }
    const glowPosition = this.playerLight.getPosition();
    lights.push({
      id: "player-glow",
      x: glowPosition.x, y: glowPosition.y,
      radius: this.playerLight.getEffectiveRadius(),
      intensity: this.playerLight.getIntensity(),
      active: this.playerLight.isLightActive(),
      revealsDetails: false,
      kind: "playerGlow",
    });
    const flashlightPosition = this.flashlight.getPosition();
    lights.push({
      id: "flashlight",
      x: flashlightPosition.x, y: flashlightPosition.y,
      radius: this.flashlight.getEffectiveRadius(),
      direction: this.flashlight.getDirection(),
      angle: this.flashlight.getAngle(),
      softness: this.flashlight.getSoftness(),
      innerRadius: this.flashlight.getInnerRadius(),
      innerFade: this.flashlight.getInnerFade(),
      intensity: this.flashlight.getIntensity(),
      active: this.flashlightOn && this.flashlight.isLightActive(),
      revealsDetails: true,
      kind: "flashlight",
    });
    for (let i = 0; i < this.torches.length; i++) {
      const torch = this.torches[i];
      if (!torch.isLit()) continue;
      const position = torch.light.getPosition();
      lights.push({
        id: `torch-${i}`,
        x: position.x, y: position.y,
        radius: torch.light.getEffectiveRadius(),
        intensity: torch.light.getIntensity(),
        active: torch.light.isLightActive(),
        revealsDetails: true,
        kind: "torch",
      });
    }
  }

  /**
   * 把所有观察者可见性输入同步给感知系统。
   * 光源本体与照亮区域分开：playerLight 只做近身补光，不揭示细节。
   */
  private updatePerception(delta: number): void {
    const perception = this.perception;
    const observer = this.perceptionObserver;
    if (!perception || !observer) return;

    const vision = this.player.getVisionState();
    observer.x = vision.x;
    observer.y = vision.y;
    observer.facing = vision.direction;

    // 灯列表与小鸡视觉共用同一份重建逻辑，只在本帧刷新一次。
    this.rebuildPerceptionLights();
    const lights = this.perceptionLights;

    const targets = this.perceptionTargets;
    targets.length = 0;
    for (const chicken of this.chickens) {
      if (!chicken.isPerceptionTarget()) continue;
      const size = chicken.getSize();
      targets.push({
        id: this.getPerceptionId(chicken),
        category: "enemy",
        x: chicken.x + size / 2,
        y: chicken.y + size / 2,
        bounds: { x: chicken.x, y: chicken.y, width: size, height: size },
      });
    }
    for (const zombie of this.enemies.zombies) {
      targets.push({ id: this.getPerceptionId(zombie), category: "enemy", ...zombie.getCenter(), bounds: zombie.getRenderBounds() });
    }
    for (const vaccine of this.getGroundInventoryPickups()) targets.push({ id: this.getPerceptionId(vaccine), category: "loot", ...vaccine.getPickupAnchor(), bounds: vaccine.getRenderBounds() });
    for (const gold of this.goldPickups) {
      targets.push({
        id: this.getPerceptionId(gold),
        category: "loot",
        x: gold.x + GoldPickup.SIZE / 2,
        y: gold.y + GoldPickup.SIZE / 2,
        bounds: { x: gold.x, y: gold.y, width: GoldPickup.SIZE, height: GoldPickup.SIZE },
      });
    }
    for (const meat of this.meatPickups) {
      targets.push({
        id: this.getPerceptionId(meat),
        category: "loot",
        x: meat.x + MeatPickup.SIZE / 2,
        y: meat.y + MeatPickup.SIZE / 2,
        bounds: { x: meat.x, y: meat.y, width: MeatPickup.SIZE, height: MeatPickup.SIZE },
      });
    }
    for (const pickup of this.pickupItems) {
      const size = pickup.getSize();
      targets.push({
        id: this.getPerceptionId(pickup),
        category: "loot",
        x: pickup.x + size / 2,
        y: pickup.y + size / 2,
        bounds: { x: pickup.x, y: pickup.y, width: size, height: size },
      });
    }

    perception.update(delta, [observer], lights, targets);
  }

  /**
   * 把小地图需要的“已知世界状态”喂给左下角 HUD 之外的数据层。
   * 这里只做数据搬运：地形与探索来自 PerceptionSystem 的 grid / memory（与三层视野同一份权威数据），
   * 观察格来自本轮真实 LOS/光照结果，用来区分 observed / remembered。
   */
  private updateMinimap(delta: number): void {
    const perception = this.perception;
    if (!perception) return;
    const memory = perception.getTerrainMemory("player");
    const grid = perception.getExplorationGrid("player");
    if (!memory || !grid) return;

    const vision = this.player.getVisionState();
    const radius = this.minimap.getLayout().worldRadius + 120;
    const size = memory.tileSize;
    const x = Math.floor((vision.x - radius) / size) * size, y = Math.floor((vision.y - radius) / size) * size;
    const width = Math.ceil((vision.x + radius - x) / size) * size, height = Math.ceil((vision.y + radius - y) / size) * size;
    const window = `${x},${y},${width},${height}`;
    // 收集范围始终局限于小地图，探索全图后也不累积远处矿石的逐帧开销。
    if (memory.revision !== this.minimapMineralRevision || window !== this.minimapMineralWindow) {
      this.minimapMineralRevision = memory.revision;
      this.minimapMineralWindow = window;
      this.minimapMineralMarkers = collectMineralMarkers(memory, this.minimapMineralMarkers, { x, y, width, height });
    }
    this.minimap.setMarkers(this.buildMinimapMarkers());

    this.minimap.update({
      dt: delta,
      memory,
      grid,
      observedCells: perception.getObservedCells("player"),
      observedRevision: perception.getObservedRevision("player"),
      water: this.map.water,
      playerX: vision.x,
      playerY: vision.y,
      direction: vision.direction,
    });
  }

  /**
   * 组装资源标记。visible 一律来自感知授权，而不是“对象还在数组里”：
   * 金块/肉块/增益道具要求 identified（完整辨识），火把要求该点已被记忆。
   * 矿物标记直接复用记忆快照，故被破坏后只要没再观察就仍保留最后已知位置。
   */
  private buildMinimapMarkers(): readonly MinimapMarkerSpec[] {
    const specs = this.minimapMarkerSpecs;
    specs.length = 0;
    for (const mineral of this.minimapMineralMarkers) specs.push(mineral);
    for (const vaccine of this.getGroundInventoryPickups()) specs.push({ id: entityMarkerId("pickup", this.getPerceptionId(vaccine)), type: "pickup",
      ...vaccine.getPickupAnchor(), visible: this.getEntityVisibility(vaccine) === "identified" });
    for (const gold of this.goldPickups) {
      specs.push({
        id: entityMarkerId("gold", this.getPerceptionId(gold)),
        type: "gold",
        x: gold.x + GoldPickup.SIZE / 2,
        y: gold.y + GoldPickup.SIZE / 2,
        visible: this.getEntityVisibility(gold) === "identified",
      });
    }
    for (const meat of this.meatPickups) {
      const anchor = meat.getPickupAnchor();
      specs.push({
        id: entityMarkerId("meat", this.getPerceptionId(meat)),
        type: "meat",
        x: anchor.x,
        y: anchor.y,
        visible: this.getEntityVisibility(meat) === "identified",
      });
    }
    for (const pickup of this.pickupItems) {
      const size = pickup.getSize();
      specs.push({
        id: entityMarkerId("pickup", this.getPerceptionId(pickup)),
        type: "pickup",
        x: pickup.x + size / 2,
        y: pickup.y + size / 2,
        visible: this.getEntityVisibility(pickup) === "identified",
      });
    }
    const perception = this.perception;
    for (const torch of this.torches) {
      // 火把不是感知 target，用“该点是否已被探索/记忆”授权，避免照亮轮廓即被标记。
      const recall = perception ? perception.getTerrainRecall("player", torch.x, torch.y) : "unknown";
      specs.push({
        id: entityMarkerId("torch", this.getPerceptionId(torch)),
        type: "torch",
        x: torch.x,
        y: torch.y,
        visible: recall !== "unknown",
        state: torch.isLit() ? "lit" : "dark",
      });
    }
    return specs;
  }

  private getPerceptionId(target: object): string {
    let id = this.perceptionIds.get(target);
    if (!id) {
      id = `p${++this.nextPerceptionId}`;
      this.perceptionIds.set(target, id);
    }
    return id;
  }

  private getPerceptionView(target: object): PerceptionView {
    const perception = this.perception;
    if (!perception) return { level: "identified", alpha: 1, silhouette: 0 };
    const id = this.perceptionIds.get(target);
    if (!id) return { level: "hidden", alpha: 0, silhouette: 0 };
    return perception.getView("player", id);
  }

  private getEntityVisibility(target: object): EntityVisibility {
    return this.getPerceptionView(target).level;
  }

  /** 完整辨识的渐隐权重；剪影/隐藏不读取它。 */
  private getEntityAlpha(target: object): number {
    if (this.visionMode !== "three-layer") return 1;
    return Math.max(0, Math.min(1, this.getPerceptionView(target).alpha));
  }

  /** 近身剪影权重；与完整形象权重互补，用于交叉淡化。 */
  private getEntitySilhouette(target: object): number {
    if (this.visionMode !== "three-layer") return 0;
    return Math.max(0, Math.min(1, this.getPerceptionView(target).silhouette));
  }

  /**
   * 实体绘制用的不透明度：只要还存在剪影权重，彩色形象就保持不透明画在灰色之下，
   * 由剪影权重从 1 到 0 揭开彩色；否则按 detail 渐隐。这样灰色与彩色的可见比例
   * 严格互补（s + (1-s)），不会出现“彩色先淡掉、灰色再冒出来”的中空阶段。
   */
  private getEntityDrawAlpha(target: object): number {
    if (this.visionMode !== "three-layer") return 1;
    const view = this.getPerceptionView(target);
    if (view.silhouette > 0.002) return 1;
    return Math.max(0, Math.min(1, view.alpha));
  }

  /** 实体在当前帧是否需要绘制：完整形象/剪影任一侧有非零权重都要画，保证过渡连续。 */
  private isEntityDrawn(target: object): boolean {
    if (this.visionMode !== "three-layer") return true;
    const view = this.getPerceptionView(target);
    return view.alpha > 0.002 || view.silhouette > 0.002;
  }

  /**
   * 近身剪影：灰色权重 = silhouette，彩色在它下方保持不透明，二者可见比例互补。
   *
   * 完整形象权重升高时剪影自然让位，不会再出现“彩色先消失、灰色再跳出”的突变。
   * 剪影画在光照之后、遮蔽层之前：环境光 multiply 会把普通绘制压暗，而近身剪影
   * 恰恰主要出现在暗处，必须保持可读性。
   *
   * 整层按地面轮廓裁剪：鸡只画合并后的主体轮廓，部分身体被墙挡住时不会把完整
   * 剪影画到墙顶。轮廓来自对象自身的姿态/动画，物理与碰撞完全不受影响。
   */
  private drawEnemyHitFlashes(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const flashing = this.enemies.zombies.filter(z => z.getPose().flash > 0 && this.getEntityAlpha(z) > .002);
    if (!flashing.length && !this.zombieGore.getStats().flying) return;
    ctx.save(); ctx.translate(-ox, -oy);
    this.map.clipGround(ctx, ox, oy, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const zombie of flashing) {
      const b = zombie.getRenderBounds();
      if (b.x + b.width < ox || b.y + b.height < oy || b.x > ox + ctx.canvas.width || b.y > oy + ctx.canvas.height) continue;
      ctx.globalAlpha = zombie.getPose().flash * this.getEntityAlpha(zombie);
      zombie.drawSilhouette(ctx, ox, oy);
    }
    ctx.globalAlpha = 1;
    this.zombieGore.drawFlashes(ctx, ox, oy, (x, y) => !this.perception || this.perception.canIdentify("player", x, y));
    ctx.restore();
  }

  getCombatFeedbackState() { if (!isDevelopmentBuild()) return null; return { player: this.damageFeedback.snapshot(), gore: this.zombieGore.snapshot(),
    blood: { zombies: this.enemyBlood.getStains(), chickens: this.bloodStainSystem.getStains() } }; }
  getCombatFeedbackMetrics() { if (!isDevelopmentBuild()) return null; return { ...this.zombieGore.getStats(), blood: this.enemyBlood.getActiveCount() + this.bloodStainSystem.getActiveCount(),
    bloodDrawCandidates: this.enemyBlood.lastDrawCandidates + this.bloodStainSystem.lastDrawCandidates }; }

  private drawPerceptionSilhouettes(ctx: CanvasRenderingContext2D,
    cameraX: number, cameraY: number, smokeOnly = false): void {
    if (!this.perception) return;
    const paint = (bounds: { x: number; y: number; width: number; height: number },
      weight: number,
      drawSource: (sctx: CanvasRenderingContext2D, pad: number) => void): void => {
      if (weight <= 0.002) return;
      if (smokeOnly) {
        const p = this.player.getVisionState(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        if (Math.hypot(p.x - x, p.y - y) > TC.smokeNear || !hasLineOfSight(this.map, p.x, p.y, x, y)
          || this.smoke.opacity(p.x, p.y, x, y) < .35) return;
      }
      const pad = 8;
      const width = Math.max(1, Math.ceil(bounds.width + pad * 2));
      const height = Math.max(1, Math.ceil(bounds.height + pad * 2));
      if (bounds.x + bounds.width - cameraX < -pad
        || bounds.y + bounds.height - cameraY < -pad
        || bounds.x - cameraX > ctx.canvas.width + pad
        || bounds.y - cameraY > ctx.canvas.height + pad) return;
      const canvas = this.getSilhouetteScratch(width, height);
      const sctx = canvas.getContext("2d");
      if (!sctx) return;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = "source-over";
      sctx.globalAlpha = 1;
      sctx.clearRect(0, 0, canvas.width, canvas.height);
      drawSource(sctx, pad);
      // 低饱和冷灰蓝：可读，但不像高亮描边；source-in 同时抹掉内部细节。
      sctx.globalCompositeOperation = "source-in";
      sctx.fillStyle = "rgba(126, 140, 160, 0.92)";
      sctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = weight;
      if (smokeOnly) ctx.filter = 'blur(1.4px)';
      ctx.drawImage(canvas, 0, 0, width, height,
        bounds.x - pad - cameraX, bounds.y - pad - cameraY, width, height);
      ctx.restore();
    };
    const silhouetteWeight = (target: object): number => this.getEntitySilhouette(target);

    // 地面轮廓裁剪：落在墙体/矿石顶面的剪影像素会被裁掉，避免“部分露出”变成整只画在墙上。
    // 轮廓路径是世界坐标，先平移再建立裁剪区，随后恢复屏幕坐标绘制。
    ctx.save();
    ctx.translate(-cameraX, -cameraY);
    this.map.clipGround(ctx, cameraX, cameraY, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (smokeOnly && this.smoke.density(this.player.x + this.player.getSize() / 2, this.player.y + this.player.getSize() / 2) > .2) {
      const size = this.player.getSize(), x = this.player.x - size / 2, y = this.player.y - size / 2;
      paint({ x, y, width: size * 2, height: size * 2 }, .38, (sctx, pad) => this.player.draw(sctx, x - pad, y - pad));
    }
    for (const zombie of this.enemies.zombies) {
      paint(zombie.getRenderBounds(), silhouetteWeight(zombie),
        (sctx, pad) => { const b = zombie.getRenderBounds(); zombie.drawSilhouette(sctx, b.x - pad, b.y - pad); });
    }
    for (const vaccine of this.getGroundInventoryPickups()) paint(vaccine.getRenderBounds(), silhouetteWeight(vaccine),
      (sctx, pad) => vaccine.draw(sctx, vaccine.x - pad, vaccine.y - pad));
    for (const chicken of this.chickens) {
      if (!chicken.isRenderable()) continue;
      const size = chicken.getSize();
      paint({ x: chicken.x, y: chicken.y, width: size, height: size },
        silhouetteWeight(chicken),
        (sctx, pad) => chicken.drawSilhouette(sctx, chicken.x - pad, chicken.y - pad));
    }
    for (const gold of this.goldPickups) {
      paint({ x: gold.x, y: gold.y, width: GoldPickup.SIZE, height: GoldPickup.SIZE },
        silhouetteWeight(gold),
        (sctx, pad) => gold.draw(sctx, gold.x - pad, gold.y - pad));
    }
    for (const meat of this.meatPickups) {
      paint({ x: meat.x, y: meat.y, width: MeatPickup.SIZE, height: MeatPickup.SIZE },
        silhouetteWeight(meat),
        (sctx, pad) => meat.draw(sctx, meat.x - pad, meat.y - pad));
    }
    for (const pickup of this.pickupItems) {
      const size = pickup.getSize();
      paint({ x: pickup.x, y: pickup.y, width: size, height: size },
        silhouetteWeight(pickup), (sctx, pad) => {
          sctx.save();
          sctx.translate(-(pickup.x - pad), -(pickup.y - pad));
          pickup.draw(sctx);
          sctx.restore();
        });
    }

    ctx.restore();
  }

  private getSilhouetteScratch(width: number, height: number): HTMLCanvasElement {
    let canvas = this.silhouetteCanvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.silhouetteCanvas = canvas;
    }
    if (canvas.width < width) canvas.width = width;
    if (canvas.height < height) canvas.height = height;
    return canvas;
  }

  /**
   * 场景渲染逻辑，每帧调用
   * @param ctx Canvas渲染上下文
   */
  draw(ctx: CanvasRenderingContext2D) {
    // 加载中才需要铺底：加载完成后整屏都会被世界视口覆盖，不必每帧多刷一次全屏。
    if (!this.loaded) {
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      if (this.loadError) {
        ctx.fillStyle = "#f16b67";
        ctx.font = "20px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("加载失败，请刷新页面重试", 40, 80);
        ctx.fillText(this.loadError, 40, 120, Math.max(40, ctx.canvas.width - 80));
      }
      return;
    }

    // 在世界视口中绘制，再统一缩放；屏幕 HUD 保持原尺寸。
    const screenContext = ctx;
    ctx = this.worldContext;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 获取包含震动偏移的相机位置
    const cameraOffset = this.camera.getOffset();
    const displayedView = this.displayedView;
    if (displayedView) {
      displayedView.x = cameraOffset.x;
      displayedView.y = cameraOffset.y;
      displayedView.width = ctx.canvas.width;
      displayedView.height = ctx.canvas.height;
    } else {
      this.displayedView = { ...cameraOffset, width: ctx.canvas.width, height: ctx.canvas.height };
    }

    // 地形与静态装饰始终可见：地形顶面只受环境光和单位光提亮，不会被视野遮住。
    this.map.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height, this.deltaSinceLastFrame);
    this.structures?.draw(ctx, cameraOffset.x, cameraOffset.y, false,
      this.graphics.dayNight.mode === 'auto' && this.environmentStage >= 2 ? this.environment : undefined);
    if (this.graphics.dayNight.mode === 'auto' && this.environmentStage >= 2)
      this.map.drawSunFaces(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height, this.environment);
    // 脚印、涟漪、弹坑与血迹属于地面装饰：在地图之后、单位层之前绘制，始终可见且受光照。
    this.footprintSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    this.rippleSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    this.craterSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    // 血迹压在弹坑之上：后画的斑块不会被弹坑的暗色吃掉。
    ctx.save(); ctx.translate(-cameraOffset.x, -cameraOffset.y);
    this.map.clipGround(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bloodStainSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    this.enemyBlood.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height,
      (x, y) => !this.perception || this.perception.canIdentify("player", x, y));
    this.zombieGore.draw(ctx, cameraOffset.x, cameraOffset.y,
      (x, y) => !this.perception || this.perception.canIdentify("player", x, y));
    ctx.restore();
    this.torches.forEach(torch => torch.draw(ctx, cameraOffset.x, cameraOffset.y));
    this.drawFacilityLights(ctx, cameraOffset.x, cameraOffset.y);
    this.drawSunShadows(ctx, cameraOffset.x, cameraOffset.y);

    // 单位层：只有迷雾范围内的单位才绘制，地形不参与裁剪。
    // 迷雾外的单位本来就不可见：先按视野半径剔除，既省绘制也把单位层包围盒压到视野附近。
    const vision = this.player.getVisionState();
    const threeLayer = this.visionMode === "three-layer"
      && this.perception !== null && this.perceptionObserver !== null
      && this.perceptionRenderer !== null;
    const perception = this.perception;
    const cullRadius = threeLayer && perception
      ? perception.getCullingRadius("player")
      : vision.range + 64;
    // 只要完整形象或剪影任一侧还有权重，就仍然参与单位层绘制：
    // 交叉淡化中间帧的彩色形象必须按 detail 权重继续画，不能按三态硬切。
    const drawn = (target: object): boolean => {
      if (!threeLayer) return true;
      return this.isEntityDrawn(target);
    };
    const fogCx = vision.x - cameraOffset.x;
    const fogCy = vision.y - cameraOffset.y;
    const fogRadius = vision.range + 64;
    const visible = (x: number, y: number, pad: number): boolean => {
      const dx = x - vision.x, dy = y - vision.y;
      const limit = (threeLayer ? cullRadius : vision.range + 64) + pad;
      return dx * dx + dy * dy <= limit * limit;
    };

    const units = this.unitContext;
    units.setTransform(1, 0, 0, 1, 0, 0);
    units.globalCompositeOperation = "source-over";
    units.clearRect(0, 0, this.unitCanvas.width, this.unitCanvas.height);

    // 单位层/光效层的内容包围盒：迷雾裁剪与层合成只处理真正有像素的区域，
    // 屏幕其余部分保持透明，整层 drawImage 与全屏 destination-in 都可以省掉。
    const bullets = this.player.getBullets();
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    let fxLeft = Infinity, fxTop = Infinity, fxRight = -Infinity, fxBottom = -Infinity;
    const include = (x: number, y: number, width: number, height: number) => {
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + width > right) right = x + width;
      if (y + height > bottom) bottom = y + height;
    };
    for (const pickup of this.goldPickups) {
      if (!visible(pickup.x, pickup.y, 48) || !drawn(pickup)) continue;
      const x = pickup.x - cameraOffset.x, y = pickup.y - cameraOffset.y;
      include(x - 40, y - 40, 80, 80);
      if (x - 40 < fxLeft) fxLeft = x - 40;
      if (y - 40 < fxTop) fxTop = y - 40;
      if (x + 40 > fxRight) fxRight = x + 40;
      if (y + 40 > fxBottom) fxBottom = y + 40;
    }
    for (const meat of this.meatPickups) {
      if (!visible(meat.x, meat.y, 32) || !drawn(meat)) continue;
      include(meat.x - cameraOffset.x - 32, meat.y - cameraOffset.y - 32, 64, 64);
    }
    for (const pickup of this.pickupItems) {
      if (!visible(pickup.x, pickup.y, 88) || !drawn(pickup)) continue;
      include(pickup.x - cameraOffset.x - 80, pickup.y - cameraOffset.y - 80, 160, 160);
    }
    for (const chicken of this.chickens) {
      if (!visible(chicken.x, chicken.y, 72) || !drawn(chicken)) continue;
      include(chicken.x - cameraOffset.x - 40, chicken.y - cameraOffset.y - 40, 120, 120);
    }
    for (const zombie of this.enemies.zombies) {
      if (!visible(zombie.x, zombie.y, 80) || !drawn(zombie)) continue;
      const b = zombie.getRenderBounds(); include(b.x - cameraOffset.x - 10, b.y - cameraOffset.y - 10, b.width + 20, b.height + 20);
    }
    for (const vaccine of this.getGroundInventoryPickups()) {
      if (visible(vaccine.x, vaccine.y, 32) && drawn(vaccine)) include(vaccine.x - cameraOffset.x - 16, vaccine.y - cameraOffset.y - 16, 52, 52);
    }
    for (const bullet of bullets) {
      const position = bullet.getPosition();
      if (!visible(position.x, position.y, 40)) continue;
      const size = bullet.getSize();
      const pad = size + 24;
      include(position.x - cameraOffset.x - pad, position.y - cameraOffset.y - pad, pad * 2, pad * 2);
    }
    const particleBounds = this.particleSystem.getBounds();
    if (particleBounds.width > 0) {
      include(particleBounds.x - cameraOffset.x, particleBounds.y - cameraOffset.y, particleBounds.width, particleBounds.height);
    }
    const unitBounds = this.unitBounds;
    if (left === Infinity) {
      unitBounds.width = 0;
      unitBounds.height = 0;
    } else {
      const minX = Math.max(0, Math.floor(left)), minY = Math.max(0, Math.floor(top));
      const maxX = Math.min(this.unitCanvas.width, Math.ceil(right));
      const maxY = Math.min(this.unitCanvas.height, Math.ceil(bottom));
      unitBounds.x = minX; unitBounds.y = minY;
      unitBounds.width = Math.max(0, maxX - minX);
      unitBounds.height = Math.max(0, maxY - minY);
    }
    const effectBounds = this.effectBounds;
    if (fxLeft === Infinity) {
      effectBounds.width = 0;
      effectBounds.height = 0;
    } else {
      const minX = Math.max(0, Math.floor(fxLeft)), minY = Math.max(0, Math.floor(fxTop));
      const maxX = Math.min(this.effectCanvas.width, Math.ceil(fxRight));
      const maxY = Math.min(this.effectCanvas.height, Math.ceil(fxBottom));
      effectBounds.x = minX; effectBounds.y = minY;
      effectBounds.width = Math.max(0, maxX - minX);
      effectBounds.height = Math.max(0, maxY - minY);
    }

    if (this.goldPickups.length || this.chickens.length || this.meatPickups.length || this.enemies.zombies.length || this.vaccinePickups.length || this.weaponPickups.length) {
      units.save();
      // 与光照共用同一份世界坐标地形轮廓：已按瓦片内容缓存，避免每帧重建整屏裁剪路径。
      units.translate(-cameraOffset.x, -cameraOffset.y);
      this.map.clipGround(units, cameraOffset.x, cameraOffset.y, this.unitCanvas.width, this.unitCanvas.height);
      units.setTransform(1, 0, 0, 1, 0, 0);
      // 和地图共用像素边界，地面投影不能覆盖墙壁、矿石的顶面。
      for (const vaccine of this.getGroundInventoryPickups()) {
        if (visible(vaccine.x, vaccine.y, 32) && drawn(vaccine)) { units.globalAlpha = this.getEntityAlpha(vaccine); vaccine.drawShadow(units, cameraOffset.x, cameraOffset.y); }
      }
      for (const zombie of this.enemies.zombies) {
        if (visible(zombie.x, zombie.y, 80) && drawn(zombie)) {
          units.globalAlpha = this.getEntityAlpha(zombie); zombie.drawShadow(units, cameraOffset.x, cameraOffset.y);
        }
      }
      for (const pickup of this.goldPickups) {
        if (visible(pickup.x, pickup.y, 48) && drawn(pickup)) {
          units.globalAlpha = this.getEntityAlpha(pickup);
          pickup.drawShadow(units, cameraOffset.x, cameraOffset.y, this.graphics.dayNight.mode === 'auto' && this.environment.sunIntensity > 0 ? undefined : this.playerLight.getPosition());
        }
      }
      for (const chicken of this.chickens) {
        if (visible(chicken.x, chicken.y, 72) && drawn(chicken)) {
          units.globalAlpha = this.getEntityAlpha(chicken);
          chicken.drawShadow(units, cameraOffset.x, cameraOffset.y, this.graphics.dayNight.mode === 'auto' && this.environment.sunIntensity > 0 ? undefined : this.playerLight.getPosition());
        }
      }
      for (const pickup of this.meatPickups) {
        if (visible(pickup.x, pickup.y, 32) && drawn(pickup)) {
          units.globalAlpha = this.getEntityAlpha(pickup);
          pickup.drawShadow(units, cameraOffset.x, cameraOffset.y);
        }
      }
      units.globalAlpha = 1;
      units.restore();
    }
    // 近身剪影用不透明彩色垫底、灰色叠加来保证互补比例；此时彩色本体也必须和
    // 灰色一样受地面轮廓裁剪，否则被墙挡住的部分会以暖色压在墙顶上。
    const clipSilhouetteBodies = threeLayer && (
      this.getGroundInventoryPickups().some(v => this.getEntitySilhouette(v) > 0.002) ||
      this.enemies.zombies.some(z => this.getEntitySilhouette(z) > 0.002) ||
      this.chickens.some(c => this.getEntitySilhouette(c) > 0.002) ||
      this.goldPickups.some(p => this.getEntitySilhouette(p) > 0.002) ||
      this.meatPickups.some(p => this.getEntitySilhouette(p) > 0.002) ||
      this.pickupItems.some(p => this.getEntitySilhouette(p) > 0.002)
    );
    if (clipSilhouetteBodies) {
      units.save();
      units.translate(-cameraOffset.x, -cameraOffset.y);
      this.map.clipGround(units, cameraOffset.x, cameraOffset.y, this.unitCanvas.width, this.unitCanvas.height);
      units.setTransform(1, 0, 0, 1, 0, 0);
    }
    for (const pickup of this.goldPickups) {
      if (visible(pickup.x, pickup.y, 48) && drawn(pickup)) {
        units.globalAlpha = this.getEntityDrawAlpha(pickup);
        pickup.draw(units, cameraOffset.x, cameraOffset.y);
      }
    }
    for (const pickup of this.meatPickups) {
      if (visible(pickup.x, pickup.y, 32) && drawn(pickup)) {
        units.globalAlpha = this.getEntityDrawAlpha(pickup);
        pickup.draw(units, cameraOffset.x, cameraOffset.y);
      }
    }
    // 绘制道具（在子弹上方，金块下方）
    for (const pickup of this.pickupItems) {
      if (!visible(pickup.x, pickup.y, 88) || !drawn(pickup)) continue;
      units.globalAlpha = this.getEntityDrawAlpha(pickup);
      units.save();
      units.translate(-cameraOffset.x, -cameraOffset.y);
      pickup.draw(units);
      units.restore();
    }
    // 小鸡在拾取物之上、子弹之下；随后统一做迷雾裁剪，因此迷雾外不可见。
    for (const vaccine of this.getGroundInventoryPickups()) {
      if (visible(vaccine.x, vaccine.y, 32) && drawn(vaccine)) { units.globalAlpha = this.getEntityDrawAlpha(vaccine); vaccine.draw(units, cameraOffset.x, cameraOffset.y); }
    }
    for (const zombie of this.enemies.zombies) {
      if (visible(zombie.x, zombie.y, 80) && drawn(zombie)) {
        units.save(); units.translate(-cameraOffset.x, -cameraOffset.y);
        this.map.clipGround(units, cameraOffset.x, cameraOffset.y, this.unitCanvas.width, this.unitCanvas.height);
        units.setTransform(1, 0, 0, 1, 0, 0);
        units.globalAlpha = this.getEntityDrawAlpha(zombie); zombie.draw(units, cameraOffset.x, cameraOffset.y); units.restore();
      }
    }
    for (const chicken of this.chickens) {
      if (visible(chicken.x, chicken.y, 72) && drawn(chicken)) {
        units.globalAlpha = this.getEntityDrawAlpha(chicken);
        chicken.draw(units, cameraOffset.x, cameraOffset.y);
      }
    }
    units.globalAlpha = 1;
    if (clipSilhouetteBodies) units.restore();
    // 所有世界对象共用包含震动的相机偏移
    for (const bullet of bullets) {
      const position = bullet.getPosition();
      if (visible(position.x, position.y, 40)) bullet.draw(units, cameraOffset.x, cameraOffset.y, this.map);
    }
    const particlePerception = threeLayer ? this.perception : undefined;
    this.particleSystem.draw(units, cameraOffset.x, cameraOffset.y,
      particlePerception
        ? (x: number, y: number) => particlePerception.getTerrainRecall("player", x, y) === "observed"
        : undefined);
    if (!threeLayer) {
      this.prepareFog(cameraOffset.x, cameraOffset.y);
      if (unitBounds.width > 0 && unitBounds.height > 0) {
        this.visibilitySystem.apply(units, unitBounds);
        ctx.drawImage(this.unitCanvas,
          unitBounds.x, unitBounds.y, unitBounds.width, unitBounds.height,
          unitBounds.x, unitBounds.y, unitBounds.width, unitBounds.height);
      }
    } else if (unitBounds.width > 0 && unitBounds.height > 0) {
      // 三层模式已按感知等级过滤实体，不再使用旧圆形迷雾裁剪整层。
      ctx.drawImage(this.unitCanvas,
        unitBounds.x, unitBounds.y, unitBounds.width, unitBounds.height,
        unitBounds.x, unitBounds.y, unitBounds.width, unitBounds.height);
    }

    // 绘制玩家（在所有元素上方），使用带震动偏移的相机位置
    this.drawThrowableWorld(ctx, cameraOffset.x, cameraOffset.y);
    for (const station of this.tradingStations) if (this.canObserveThrowPoint(station.x, station.y)) station.draw(ctx, cameraOffset.x, cameraOffset.y);
    const locationId = this.getCampaignLocationId();
    if (locationId) {
      const entrance = LOCATION_DEFINITIONS[locationId].entrance.position;
      const x = entrance.x + 24.5 - cameraOffset.x, y = entrance.y + 24.5 - cameraOffset.y;
      ctx.save(); ctx.strokeStyle = '#a4d6be'; ctx.fillStyle = '#dcf7e8'; ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(x, y, 55, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出入口', x, y + 76); ctx.restore();
    }
    this.player.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 应用光照效果
    this.applyLighting(ctx, cameraOffset.x, cameraOffset.y);
    if (this.graphics.dayNight.mode === 'auto' && this.environmentStage >= 3)
      this.lightingSystem.drawSurfaceResponse(ctx, this.map, cameraOffset.x, cameraOffset.y, this.environment);
    this.drawEnvironmentAtmosphere(ctx, cameraOffset.x, cameraOffset.y);
    // A local white mask remains readable under ambient lighting, still below the perception mask.
    this.drawEnemyHitFlashes(ctx, cameraOffset.x, cameraOffset.y);
    // 边界反馈画在光照之后：贴边本身是玩法信号，不能在暗处被乘暗。
    // 三层模式下它会被感知遮罩压暗，所以移到遮蔽之后绘制。
    if (!threeLayer) {
      this.boundaryRippleSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
      // 声音提示画在迷雾与光照之后，作为“听见了但没看见”的玩家信息，不擦除迷雾。
      this.soundRippleSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    }
    // 枪口火焰在光照之后绘制：它本身是光源，不能陪场景一起被乘暗。
    this.player.drawMuzzleFlash(ctx, cameraOffset.x, cameraOffset.y);
    // 后处理光效单独一层，和单位共用迷雾遮罩后以 lighter 叠加。
    // 没有发光物体（金块）时整层都省掉：清屏、迷雾裁剪、叠加都是整张画布的开销。
    const glowGold = threeLayer
      ? this.goldPickups.filter(pickup => this.getEntityAlpha(pickup) > 0.002)
      : this.goldPickups;
    if (glowGold.length) {
      const effects = this.effectContext;
      effects.setTransform(1, 0, 0, 1, 0, 0);
      effects.globalCompositeOperation = "source-over";
      effects.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);
      for (const pickup of glowGold) {
        const visibility = this.getEntityAlpha(pickup);
        pickup.drawGlow(effects, cameraOffset.x, cameraOffset.y, visibility);
        pickup.drawSparkles(effects, cameraOffset.x, cameraOffset.y, visibility);
      }
      if (effectBounds.width > 0 && effectBounds.height > 0) {
        // 三层模式的光晕只对已辨识金块绘制，不再走旧迷雾裁剪。
        if (!threeLayer) this.visibilitySystem.apply(effects, effectBounds);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(this.effectCanvas,
          effectBounds.x, effectBounds.y, effectBounds.width, effectBounds.height,
          effectBounds.x, effectBounds.y, effectBounds.width, effectBounds.height);
        ctx.restore();
      }
    }
    // 界外毛玻璃压在世界层上、屏幕层 HUD 之下：缩放与相机震动完全一致。
    this.boundaryOverlay.draw(ctx, cameraOffset.x, cameraOffset.y,
      this.map.width * this.map.tileSize, this.map.height * this.map.tileSize,
      screenContext.canvas.width / ctx.canvas.width, window.devicePixelRatio || 1);
    if (threeLayer && perception && this.perceptionObserver && this.perceptionRenderer) {
      // 剪影先画在遮蔽层之下：墙后/阴影部分由感知遮罩盖住，只有真实可见的孔洞露出轮廓。
      this.drawPerceptionSilhouettes(ctx, cameraOffset.x, cameraOffset.y);
      const explored = perception.getExplorationGrid("player");
      const memory = perception.getTerrainMemory("player");
      if (explored && memory) {
        this.perceptionRenderer.render(ctx, cameraOffset.x, cameraOffset.y,
          ctx.canvas.width, ctx.canvas.height, this.perceptionObserver,
          this.perceptionLights, explored, memory);
      }
      // 边界反馈是玩法信号，放在遮蔽之后，避免在未探索区域被压黑。
      this.boundaryRippleSystem.draw(ctx, cameraOffset.x, cameraOffset.y,
        ctx.canvas.width, ctx.canvas.height);
      // 声音提示同样在迷雾合成之后绘制：黑暗里只给出方向与大致距离，不揭示目标。
      this.soundRippleSystem.draw(ctx, cameraOffset.x, cameraOffset.y,
        ctx.canvas.width, ctx.canvas.height);
    }
    this.drawThrowableAim(ctx, cameraOffset.x, cameraOffset.y);
    this.player.drawUI(ctx, cameraOffset.x, cameraOffset.y);
    this.structures?.draw(ctx, cameraOffset.x, cameraOffset.y, true);
    this.drawConstructionPreview(ctx, cameraOffset.x, cameraOffset.y);
    screenContext.drawImage(this.worldCanvas, 0, 0, screenContext.canvas.width, screenContext.canvas.height);
    ctx = screenContext;
    ctx.save();
    const feedbackDpr = window.devicePixelRatio || 1;
    ctx.scale(feedbackDpr, feedbackDpr);
    this.damageFeedback.draw(ctx, ctx.canvas.width / feedbackDpr, ctx.canvas.height / feedbackDpr);
    ctx.restore();
    // 拾取飘字画在屏幕层：沿用 HUD 的 dpr 约定，白字不随光照变暗。
    ctx.save();
    const textDpr = window.devicePixelRatio || 1;
    ctx.scale(textDpr, textDpr);
    this.floatingTexts.draw(ctx, cameraOffset.x, cameraOffset.y,
      (screenContext.canvas.width / textDpr) / this.camera.width);
    ctx.restore();
    // 左上角圆形小地图：世界合成之后的屏幕 HUD 阶段，用逻辑像素绘制。
    // 时间独立于背包的隐藏分支；暂停时继续重画同一份权威读数。
    const clockDpr = window.devicePixelRatio || 1;
    const clockWidth = window.innerWidth, clockHeight = window.innerHeight;
    const clockReading = this.campaign?.session.getClockReading();
    const clockState = this.dayClockPreview ?? (clockReading ? { worldMinute: clockReading.worldMinute,
      location: this.getCampaignLocationId() === 'outpost' ? 'camp' as const : 'field' as const, raid: this.raidVisualState } : null);
    const minimapLayout = this.minimap.getLayout();
    const clockBackpackOpen = this.backpackPanel?.isOpen() === true;
    const clockLayout = this.dayClockHud.draw(this.active && this.player.isAlive() ? clockState : null, clockWidth, clockHeight, clockDpr, [
      { x: clockWidth - 108, y: 0, width: 108, height: 52 },
      ...clockBackpackOpen ? [] : [
        { x: minimapLayout.left, y: 0, width: minimapLayout.diameter, height: minimapLayout.top + minimapLayout.diameter + 58 },
        getWeaponListLayout(clockWidth, clockHeight).area,
      ],
    ], clockBackpackOpen);
    this.campaign?.layoutHud(this, clockLayout);
    // 背包只叠在世界上，避免小地图、黄金等透过物品列表造成文字重影。
    if (!this.backpackPanel?.isOpen()) {
      ctx.save();
      const minimapDpr = window.devicePixelRatio || 1;
      ctx.scale(minimapDpr, minimapDpr);
      this.minimap.draw(ctx);
      ctx.restore();
      // 黄金计数紧贴小地图下缘：不再与圆形小地图抢左上角，也不盖住它。
      const goldRect = this.minimap.getGoldRect();
      ctx.save();
      const dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(goldRect.iconX, goldRect.iconY, goldRect.iconSize, goldRect.iconSize);
      ctx.font = goldRect.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`黄金 ${this.player.getGold()}`, goldRect.textX, goldRect.textY);
      ctx.font = '600 12px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#d4e3ec';
      ctx.fillText(`战斗积分 ${this.combatScore.snapshot().score}`, goldRect.iconX, goldRect.textY + 24);
      ctx.restore();
      // 屏幕层 HUD：左下角生存状态与生命/体力，以及右侧武器列表、手电与背包。
      // 单独按 dpr 缩放成逻辑像素，避免继承资源栏的 transform。
      ctx.save();
      const hudDpr = window.devicePixelRatio || 1;
      ctx.scale(hudDpr, hudDpr);
      const hudWidth = ctx.canvas.width / hudDpr;
      const hudHeight = ctx.canvas.height / hudDpr;
      const loadout = this.player.getWeaponLoadoutView();
      const listLayout = getWeaponListLayout(hudWidth, hudHeight);
      const inventoryView = this.getBackpackView();
      const flashlightRect = getFlashlightHudRect(listLayout.area,
        listLayout.area.x + listLayout.area.width - listLayout.metrics.paddingRight);
      this.weaponListHud.draw(ctx, loadout, hudWidth, hudHeight);
      this.statusHud.draw(ctx, this.survival.snapshot(), hudWidth, hudHeight, listLayout.area);
      this.backpackHud.draw(ctx, hudWidth, hudHeight, listLayout.area, hudDpr,
        inventoryView.load);
      const reservedHud = [
        getPlayerStatusHudRect(hudWidth, hudHeight, listLayout.area),
        getBackpackHudRect(hudWidth, hudHeight, listLayout.area),
        listLayout.area,
      ];
      const vitalsRect = getPlayerVitalsHudRect(hudWidth, hudHeight, reservedHud);
      if (this.player.isAlive()) this.killIndicator.draw(ctx, hudWidth, hudHeight, this.combatScore.snapshot(), [
        ...reservedHud, vitalsRect, flashlightRect, getQuickSlotHudLayout(hudWidth, hudHeight, [...reservedHud, vitalsRect]),
      ]);
      drawPlayerVitalsHud(ctx, this.player, vitalsRect, hudDpr);
      this.quickSlotHud.draw(ctx, hudWidth, hudHeight, [...reservedHud, vitalsRect],
        createQuickSlotViews(loadout, this.survival.inventory.getVaccines(), this.getThrowableCounts(), this.quickSlotBindings),
        this.throwable.locked ? { slot: this.quickSlotBindings.indexOf('grenade'), progress: 1 - this.throwable.fuse / TC.fuse, remaining: this.throwable.fuse }
          : this.quickItemUse ? { slot: this.quickItemUse.slot, progress: this.quickItemUse.elapsed } : undefined);
      // 手电状态条贴在武器列表上方，文案右缘与弹药列右缘对齐。
      this.flashlightHud.draw(
        ctx,
        flashlightRect,
        hudDpr,
      );
      ctx.restore();
    }
    // 拾取标记与交互键帽放在 HUD 之后，统一使用屏幕空间布局。
    this.drawPickupPrompts(screenContext, cameraOffset);
    if (this.zombieDebugPaths) {
      const scale = screenContext.canvas.width / this.camera.width;
      ctx.save(); ctx.scale(scale, scale); ctx.translate(-cameraOffset.x, -cameraOffset.y);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#72e2bd';
      for (const z of this.enemies.snapshot()) {
        if (!z.path.length) continue;
        ctx.beginPath(); ctx.moveTo(z.x, z.y); for (const p of z.path) ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.restore();
    }
    if (!this.player.isAlive()) {
      const dpr = window.devicePixelRatio || 1;
      ctx.save(); ctx.scale(dpr, dpr);
      const width = ctx.canvas.width / dpr, height = ctx.canvas.height / dpr;
      ctx.fillStyle = "rgba(12,8,10,.82)"; ctx.fillRect(0, height / 2 - 78, width, 156);
      ctx.fillStyle = "#f2c7c7"; ctx.textAlign = "center"; ctx.font = "bold 24px sans-serif";
      const cause = this.player.getDeathCause()?.kind;
      ctx.fillText(cause === "infection" ? "感染致死" : cause === "melee" ? "遭丧尸袭击身亡" : "你已死亡", width / 2, height / 2 - 43);
      const score = this.combatScore.snapshot();
      ctx.fillStyle = '#e2edf2'; ctx.font = '600 15px "Microsoft YaHei", sans-serif';
      ctx.fillText(`战斗积分 ${score.score}`, width / 2, height / 2 - 9);
      ctx.font = '13px "Microsoft YaHei", sans-serif';
      ctx.fillText(`黄金击杀 ${score.goldKills}   ·   最高连杀 ${score.bestChain}`, width / 2, height / 2 + 16);
      ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif";
      ctx.fillText(this.campaign ? '战役等待恢复结算' : 'Enter 返回菜单', width / 2, height / 2 + 51); ctx.restore();
    }
    this.updateCrosshair();
  }

  /**
   * 高亮点、E 横向提示与圆角矩形进度框统一画在屏幕层；尺寸用 CSS 逻辑像素，
   * 位置用含震动的相机偏移换算。显示权限已在 updateInteraction 里按感知过滤。
   */
  private drawPickupPrompts(
    ctx: CanvasRenderingContext2D,
    cameraOffset: { x: number; y: number },
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const scale = (ctx.canvas.width / dpr) / this.camera.width;
    const viewport = {
      width: ctx.canvas.width / dpr,
      height: ctx.canvas.height / dpr,
    };
    const snapshot = this.interaction.getSnapshot();
    // 提示只需要一个方向依据：玩家是否站在掉落物右侧。
    const playerView = this.player.getVisionState();
    const playerScreenX = (playerView.x - cameraOffset.x) * scale;

    const markers = this.pickupMarkers.map(entry => {
      const bounds = entry.target.getRenderBounds();
      return {
        x: (entry.marker.x - cameraOffset.x) * scale,
        y: (entry.marker.y - cameraOffset.y) * scale,
        style: entry.marker.style,
        halfHeight: bounds.height / 2 * scale,
        target: entry.target === snapshot.target,
      };
    });

    let prompt = null;
    if (snapshot.target && (snapshot.state === "focused" || snapshot.state === "holding")) {
      const anchor = snapshot.target.getPickupAnchor();
      const bounds = snapshot.target.getRenderBounds();
      const anchorX = (anchor.x - cameraOffset.x) * scale;
      prompt = {
        x: anchorX,
        y: (anchor.y - cameraOffset.y) * scale,
        halfWidth: bounds.width / 2 * scale,
        halfHeight: bounds.height / 2 * scale,
        progress: snapshot.progress,
        holding: snapshot.state === "holding",
        // 玩家从右侧靠近时提示停在掉落物上方，其余情况统一在右侧。
        preferAbove: playerScreenX > anchorX + 4,
        key: snapshot.targetId ?? undefined,
      };
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    this.pickupPrompt.draw(
      ctx,
      {
        markers,
        prompt,
        // 只在“刚完成拾取、物品已移除”时向下淡出；感知/墙体导致的消失没有淡出。
        fadeOut: !!this.completedPickupFeedback,
        viewport,
      },
      this.promptTime,
    );
    const station = !this.paused && !this.modalActive ? this.focusedStation : undefined;
    this.tradingPrompt.draw(ctx, {
      markers: [],
      prompt: station ? {
        x: (station.x - cameraOffset.x) * scale,
        // 交易站画面为 76×84，底部比世界锚点低 8 像素。
        y: (station.y - 34 - cameraOffset.y) * scale,
        halfWidth: 38 * scale,
        halfHeight: 42 * scale,
        progress: 0,
        holding: false,
        preferAbove: playerView.x > station.x + 4 / scale,
        key: station.id,
      } : null,
      viewport,
    }, this.promptTime);
    ctx.restore();
  }

  /** 供浏览器验收与调试读取的拾取快照（只读用途）。 */
  getPickupDebugState() {
    const snapshot: InteractionSnapshot<InteractablePickup> = this.interaction.getSnapshot();
    return {
      state: snapshot.state,
      progress: snapshot.progress,
      targetId: snapshot.targetId,
      targetX: snapshot.target ? snapshot.target.getPickupAnchor().x : null,
      targetY: snapshot.target ? snapshot.target.getPickupAnchor().y : null,
      markerCount: this.pickupMarkers.length,
      markers: this.pickupMarkers.map(entry => ({ ...entry.marker })),
      candidateCount: this.pickupCandidates.length,
      meatCount: this.meatPickups.length,
      promptTime: this.promptTime,
      interactionEnabled: this.interactionEnabled,
      ui: this.pickupPrompt.getDebugState(),
    };
  }

  /** Invert the last displayed world transform, including zoom, DPR and camera shake. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | undefined {
    if (!this.displayedView) return undefined;
    const rect = this.getCanvasViewport();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return { x: this.displayedView.x + (clientX - rect.left) * this.displayedView.width / rect.width,
      y: this.displayedView.y + (clientY - rect.top) * this.displayedView.height / rect.height };
  }

  /** Canvas borders are outside the displayed bitmap and must not scale the mouse coordinates. */
  private getCanvasViewport(): { left: number; top: number; width: number; height: number } {
    const cached = this.viewportCache;
    if (cached) return cached;
    const canvas = this.game.renderer.ctx.canvas, rect = canvas.getBoundingClientRect();
    const scaleX = canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
    const scaleY = canvas.offsetHeight ? rect.height / canvas.offsetHeight : 1;
    // 布局读取很贵（会触发布局同步），只在尺寸/位置变化后重新测量。
    const viewport = { left: rect.left + canvas.clientLeft * scaleX, top: rect.top + canvas.clientTop * scaleY,
      width: canvas.clientWidth * scaleX, height: canvas.clientHeight * scaleY };
    this.viewportCache = viewport;
    return viewport;
  }

  private viewportCache: { left: number; top: number; width: number; height: number } | null = null;

  getPointerAim(input: Input): PlayerAimInput | undefined {
    const pointer = input.consumePointerState?.();
    if (pointer?.aimInterrupted) this.player.cancelPunch();
    if (!pointer?.active || !pointer.rightDown || this.cursorVisible || this.quickSlotHud?.isInteracting() || this.paused
      || input.isBlocked?.() || !this.player.isAlive()) return undefined;
    const target = this.screenToWorld(pointer.clientX, pointer.clientY);
    return target ? { target, fire: !this.throwable.held && (pointer.aimFireDown || pointer.aimFirePressed), face: true,
      punchPressTimes: !this.throwable.held ? pointer.aimFirePressTimes : undefined } : undefined;
  }

  private updateAimCamera(delta: number, input: Input): void {
    if (!this.player.isAlive()) { this.camera.clearAimOffset(); return; }
    let x = 0, y = 0;
    const pointer = input.getPointerState?.();
    if (pointer?.active && pointer.rightDown && !this.cursorVisible && !this.quickSlotHud?.isInteracting() && !input.isBlocked?.()) {
      const rect = this.getCanvasViewport();
      if (rect.width > 0 && rect.height > 0) {
        const scaleX = this.camera.width / rect.width, scaleY = this.camera.height / rect.height;
        // 使用基础跟随坐标，排除瞄准偏移与震屏；静止鼠标不会产生反馈漂移。
        const dx = pointer.clientX - rect.left - (this.player.x + this.player.getSize() / 2 - this.camera.x) / scaleX;
        const dy = pointer.clientY - rect.top - (this.player.y + this.player.getSize() / 2 - this.camera.y) / scaleY;
        const distance = Math.hypot(dx, dy), s = Math.min(rect.width, rect.height), c = GameScene.AIM_CAMERA;
        const t = Math.max(0, Math.min(1, (distance - c.deadZone * s) / ((c.fullDistance - c.deadZone) * s)));
        const offset = Math.min(c.maxPixels, c.maxRatio * s) * t * t * (3 - 2 * t);
        if (distance > 0) { x = dx / distance * offset * scaleX; y = dy / distance * offset * scaleY; }
      }
    }
    this.camera.updateAimOffset(x, y, delta);
  }

  /** 唤出系统鼠标时收起准星并暂停瞄准，避免两套指针同时出现。 */
  private setCursorVisible(visible: boolean): void {
    if (visible !== this.cursorVisible) this.game?.input?.clear();
    this.cursorVisible = visible;
    if (typeof document !== 'undefined') document.body.classList.toggle('cursor-visible', visible);
    if (visible) { this.crosshairTighten = 0; this.crosshairOverlay?.setVisible(false); }
  }

  /**
   * 准星外观每帧刷新（瞄准内收、后坐力外扩、压住活鸡时左右括弧转红）；位置由
   * pointermove 直接写图层，所以世界帧再慢，准星也不会落后于鼠标。
   */
  private updateCrosshair(): void {
    const overlay = this.crosshairOverlay;
    if (!overlay) return;
    const pointer = this.game.input.getPointerState?.();
    if (this.cursorVisible || this.quickSlotHud?.isInteracting() || this.paused || !this.player.isAlive() || this.game.input.isBlocked?.()
      || !pointer?.active || !pointer.rightDown) {
      this.crosshairTighten = 0;
      overlay.setAppearance(0, false);
      overlay.setVisible(false);
      return;
    }
    // 场景刚进入或指针没动过时也可能还没有位置，这里补一次；坐标没变时是空操作。
    overlay.setPosition(pointer.clientX, pointer.clientY);
    overlay.setVisible(true);

    const overTarget = !this.throwable.held && this.isCrosshairOnTarget(pointer);
    const onTarget = pointer.rightDown && overTarget;
    const dt = Math.min(Math.max(this.deltaSinceLastFrame, 0), 0.1);
    const rate = onTarget ? GameScene.CROSSHAIR_TIGHTEN_RATE : -GameScene.CROSSHAIR_RELEASE_RATE;
    this.crosshairTighten = Math.min(1, Math.max(0, this.crosshairTighten + rate * dt));
    const offset = getCrosshairOffset(this.player.getRecoilState().intensity, this.crosshairTighten);
    overlay.setAppearance(offset, overTarget);
  }

  /** 准星中心是否压在活鸡的命中圆内；与子弹使用同一套命中判定。 */
  private isCrosshairOnTarget(pointer: { clientX: number; clientY: number }): boolean {
    const world = this.screenToWorld(pointer.clientX, pointer.clientY);
    if (!world) return false;
    // 三层模式：没有辨识到的目标不提供精确准星反馈，避免黑暗中的红准星泄漏位置。
    if (this.visionMode === "three-layer" && this.perception
      && !this.perception.canIdentify("player", world.x, world.y)) {
      return false;
    }
    return [...this.chickens, ...this.enemies.zombies].some(target =>
      target.hitTestSegment(world.x, world.y, world.x, world.y, 0) !== null);
  }

  /** 重建单位可见性遮罩：以角色为中心的圆形柔边迷雾。 */
  private prepareFog(cameraX: number, cameraY: number): void {
    const vision = this.player.getVisionState();
    // 半径很小时同步收窄外缘过渡，避免整圈都是渐变。
    const feather = Math.min(this.graphics.fog.feather, vision.range * 0.35);
    this.visibilitySystem.prepare(cameraX, cameraY, vision.x, vision.y, vision.range, feather);
  }

  /**
   * 应用光照效果
   */
  private applyLighting(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number) {
    // 单位光不改变视野远近和角度：手电筒与脚边微光的范围完全由光源自身决定。
    this.lightingSystem.prepareLightingMask(
      cameraX,
      cameraY,
      this.map,
    );

    // 应用光照效果到主画布
    this.lightingSystem.applyLighting(ctx);
  }

  /**
   * 添加其他光源（例如环境光源、互动光源等）
   */
  public addLightSource(lightSource: LightSource): void {
    this.lightingSystem.addLightSource(lightSource);
  }

  /**
   * 设置环境光
   */
  public setAmbientLight(color: string): void {
    if (this.graphics.dayNight.mode !== 'manual') {
      this.graphics.dayNight.mode = 'manual'; this.applyEnvironmentLight();
    }
    this.lightingSystem.setAmbientLight(color);
  }
}
