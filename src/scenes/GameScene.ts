import { Camera } from "../core/Camera";
import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
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
import { Chicken } from "../objects/Chicken";
import { PlayerDebugPanel } from "../ui/PlayerDebugPanel";
import { FloatingTextSystem } from "../ui/FloatingTextSystem";
import { WeaponListHud, getWeaponListLayout } from "../ui/WeaponListHud";
import { drawFlashlightHud, getFlashlightHudRect } from "../ui/FlashlightHud";
import { CrosshairOverlay, getCrosshairOffset } from "../ui/CrosshairOverlay";
import { NoiseSystem } from "../core/NoiseSystem";
import { computeAudibleGain } from "../core/SoundAttenuation";

// 导入光照系统相关类
import { ConfigLoader } from "../core/ConfigLoader";
import { LightSource } from "../core/LightSource";
import { ConeLight } from "../core/ConeLight";
import { LightingSystem } from "../core/LightingSystem";
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
import { hasLineOfSight } from "../vision/SightGeometry";
import type { BulletEntityHit } from "../objects/Bullet";
import type { BulletImpact, DeathFinished } from "../combat/CombatTypes";
import { Torch } from "../objects/Torch";
import { seededRandom } from "../map/WaterTerrain";
import { ColliderShape, DEFAULT_SHAPE, compileShape, rectangleCollider, transformCollider } from "../physics/Collider";
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
/** 手电筒开关的机械轻响，开灯和关灯都播这一声。 */
const FLASHLIGHT_SWITCH_SOUND = "/audio/flashlight/switch.mp3";



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
export class GameScene extends Scene {  private player!: Player;
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
  private initialPlayerConfig?: PlayerConfig;
  private initialGraphics?: GraphicsConfig;
  private initialAudio?: AudioConfig;
  /**
   * 窗口尺寸变化必须同步生效：renderer 尺寸、相机与离屏画布一旦错位，后续所有绘制都会
   * 用旧 viewport 采样。拖拽 resize 的连续开销由浏览器自身的 resize 节流承担。
   */
  private readonly resizeListener = () => {
    this.handleResize();
  };
  /** 游戏内 Escape 唤出/收起系统鼠标；调试面板打开时由面板的 Escape 接管。 */
  private readonly cursorKeyListener = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.repeat) return;
    this.setCursorVisible(!this.cursorVisible);
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
  /** Tab 只在按下沿切枪；Q 不再绑定额外功能。 */
  private tabHeld = false;
  private cHeld = false;
  private spaceHeld = false;
  /** 按键拾取控制器：只接管 INTERACT 物品，AUTO 仍走各自碰撞流程。 */
  private readonly interaction = new InteractionController<MeatPickup>();
  /** 本帧通过可见性过滤的交互候选与可绘制标记（世界坐标）。 */
  private pickupCandidates: PickupCandidate<MeatPickup>[] = [];
  private pickupMarkers: { marker: PickupMarker; target: MeatPickup | GoldPickup }[] = [];
  /** 拾取提示纯视觉层；不参与按键判断与结算。 */
  private readonly pickupPrompt = new PickupPromptRenderer();
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
  /** 每块鸡肉直接恢复的生命值；不再单独计数。 */
  private static readonly MEAT_HEAL = 5;
  private goldPickups: GoldPickup[] = [];
  private goldDroppedByTile = new Map<number, number>();
  /** 小鸡死亡后掉落的肉块，落地后才可收集。 */
  private meatPickups: MeatPickup[] = [];
  /** 与未捡走的肉块绑定的血迹：肉块还在时血迹一直保留，被捡走后才开始淡出。 */
  private sustainedBlood = new Map<MeatPickup, () => void>();

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
  private readonly noiseSystem = new NoiseSystem();
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
  // 光照系统
  private lightingSystem: LightingSystem;
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
  constructor(mapOptions?: TileMapOptions) {
    super();
    this.visionMode = resolveVisionMode();
    this.visionDebugLayer = resolveVisionDebugLayer();

    // 100×100 个瓦片，每格 50 像素
    this.map = new TileMap(100, 100, mapOptions);
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
    const spawn = this.getSpawnPositionInArea(
      Math.max(0, Math.min(deadZoneLeft, this.map.width * this.map.tileSize - deadZoneWidth)),
      Math.max(0, Math.min(deadZoneTop, this.map.height * this.map.tileSize - deadZoneHeight)),
      Math.min(deadZoneWidth, this.map.width * this.map.tileSize),
      Math.min(deadZoneHeight, this.map.height * this.map.tileSize), GameScene.PLAYER_SIZE, { type: "circle", radius: 0.5 });
    this.player = new Player(spawn.x, spawn.y, undefined, this.particleSystem);
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

    this.torches = Torch.generate(this.map, mapOptions?.seed === undefined ? Math.random : seededRandom(mapOptions.seed ^ 0x746f7263));
    this.torches.forEach(torch => this.lightingSystem.addLightSource(torch.light));

    // 小鸡围绕出生点随机生成，平时只在干地上自由活动；属于单位层，会被迷雾裁剪。
    this.chickens = Chicken.spawn(this.map, GameScene.CHICKEN_COUNT, playerCenter);
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
    this.player.setOnShootCallback((shootDir?: Vector2) => {
      // 开火会打断正在进行中的拾取；同帧标记，结算前消费。
      this.shotThisFrame = true;
      this.noiseSystem.emit("gunshot", this.player.x + this.player.getSize() / 2,
        this.player.y + this.player.getSize() / 2, { sourceId: "player" });
      // 根据射速调整震动幅度，射速越高震动越小
      const magnitude = 3 * (1 - Math.min(this.player.getFireRate() * 0.5, 0.7));
      // 将震动持续时间设置为与射速相关，实现震动频率与射速同步
      const duration = this.player.getFireRate() * 0.7;
      // 设置随机角度，未来可以考虑根据射击方向计算角度
      let angle = Math.random() * Math.PI * 2;

      // 设置较高的频率以获得更急促的震动效果
      const frequency = 50;

      // 触发相机震动，使用线性衰减模式
      this.camera.shake(magnitude, duration, angle, frequency, 'linear');
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
      if (stimulus.sourceId === "player") continue;
      const chicken = this.findChickenBySoundId(stimulus.sourceId);
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
    }
  }

  /**
   * 重置相机尺寸以适应窗口大小变化
   */
  private resizeCamera(): void {
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
    this.initLightingSystem();
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
      if (!pickup.isCollidingWithShape(body)) return true;
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
    let best: { fraction: number; chicken: Chicken; x: number; y: number } | null = null;
    for (const chicken of this.chickens) {
      if (!chicken.isAlive()) continue;
      const fraction = chicken.hitTestSegment(startX, startY, endX, endY, radius);
      if (fraction === null) continue;
      if (!best || fraction < best.fraction) {
        best = {
          fraction,
          chicken,
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
      // 伤害与命中点都取真实命中快照；准星在鸡身后不会改变任何一项。
      apply: (impact: BulletImpact) => this.damageChicken(target.chicken, impact),
    };
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
    // 血迹落在尸体收尾的位置：肉块没被捡走前一直保留，捡走后恢复正常的保留与淡出。
    const releaseBlood = this.bloodStainSystem.spawnSustained(finished.x, finished.y, this.map);
    // 慢速大颗粒形成白色气团，再补一圈快速白点。
    this.particleSystem.createExplosion(center, 28, 70, 7, 0.9,
      ["#ffffff", "#f7f7f7", "#e8e8e8"]);
    this.particleSystem.createExplosion(center, 8, 150, 4, 0.32, ["#ffffff"]);
    // 肉块与白烟同帧出现：击杀反馈要跟着击退收尾一起到，而不是再等烟散。
    const meat = new MeatPickup(finished.x - MeatPickup.SIZE / 2, finished.y - MeatPickup.SIZE / 2);
    this.meatPickups.push(meat);
    if (releaseBlood) this.sustainedBlood.set(meat, releaseBlood);
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

    if (!this.interactionEnabled) {
      // 场景已退出：清空进度，不处理任何按键，也不产生结算。
      this.interaction.update({ delta: 0, pressed: false, blocked: true, candidates: [] });
      return;
    }

    const vision = this.player.getVisionState();
    const playerAnchor = { x: vision.x, y: vision.y };
    const threeLayer = this.visionMode === "three-layer" && !!this.perception;

    for (const meat of this.meatPickups) {
      if (!meat.isPickupReady()) continue;
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
          createPickupCandidate(meat, `meat-${meat.id}`, anchor, playerAnchor, config));
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
      interrupted: this.shotThisFrame || this.player.isRolling() || this.weaponSwitchedThisFrame,
      candidates: this.pickupCandidates,
    });
    if (result.completed) {
      const completed = result.completed;
      const anchor = completed.getPickupAnchor();
      // 完成反馈只读取锚点，不延迟移除与结算。
      this.completedPickupFeedback = { x: anchor.x, y: anchor.y };
      this.collectMeatPickup(completed);
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
    const needsLineOfSight =
      this.visionMode === "legacy" ||
      (view === "silhouette" && distance <= config.interactionRadius);
    const lineOfSight = needsLineOfSight
      ? hasLineOfSight(this.map, playerAnchor.x, playerAnchor.y, anchor.x, anchor.y)
      : false;
    return resolvePickupVisibility({
      config,
      view,
      distance,
      lineOfSight,
      nearSense: distance <= this.visionRules.nearSenseRadius,
      visionMode: this.visionMode,
      legacyRange,
    });
  }


  /**
   * 肉块被捡走（或不再存在于场景里）后才释放绑定的血迹，
   * 让血迹从完整显示开始重新走 4 秒保留＋1.6 秒淡出。
   */
  private releasePickedUpBlood(): void {
    for (const [pickup, release] of this.sustainedBlood) {
      if (this.meatPickups.includes(pickup)) continue;
      release();
      this.sustainedBlood.delete(pickup);
    }
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
    const { ambient, terrainLight } = this.graphics;
    this.lightingSystem.setAmbientLight(hexToRgba(ambient.color, ambient.intensity));
    this.lightingSystem.setTerrainLight({
      position: { x: -this.map.width * this.map.tileSize, y: -this.map.height * this.map.tileSize },
      color: terrainLight.color, intensity: terrainLight.intensity,
      shadowLength: this.map.tileSize * terrainLight.shadowScale,
      softness: this.map.tileSize * terrainLight.softnessScale,
    });
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
      const posX = x + Math.random() * (width - size);
      const posY = y + Math.random() * (height - size);

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
      await this.configLoader.load();
      this.player.applyConfig(this.configLoader.getConfig("playerConfig"));
      this.graphics = parseGraphicsConfig(this.configLoader.getConfig("graphics"));
      this.audio = parseAudioConfig(this.configLoader.getConfig("audio"));
      this.applyGraphics(this.graphics);
      this.initialPlayerConfig = this.player.getConfigSnapshot();
      this.initialGraphics = cloneGraphicsConfig(this.graphics);
      this.initialAudio = cloneAudioConfig(this.audio);
      if (!this.map.isShapeWalkable(this.player.getCollider())) {
        const body = this.player.getCollider();
        const spawn = this.map.getRandomWalkablePosition(this.player.getSize(), body.compiled.shape, body.pose.rotation);
        this.player.x = spawn.x;
        this.player.y = spawn.y;
      }
      onProgress?.(1, 1);
      this.loaded = true;
    })();
    return this.loadingPromise;
  }

  async onEnter(): Promise<void> {
    this.active = true;
    // Also support direct entry through SceneManager, outside the normal loading flow.
    try {
      await this.load();
      if (!this.active) return;
      this.resizeCamera();
      this.initLightingSystem();
      this.game.input.setPointerEnabled(true);
      // Tab 交给游戏切枪；只在场景有效时拦截浏览器默认的焦点导航。
      this.game.input.setCapturedKeys?.(["Tab"]);
      this.interactionEnabled = true;
      this.interaction.reset();
      this.pickupPrompt.preload();
      this.tabHeld = false;
      // 准星改成独立图层：鼠标一动就更新，不必等这一帧的世界渲染。
      if (typeof document !== 'undefined') {
        this.crosshairOverlay ??= new CrosshairOverlay();
        this.game.input.onPointerMove = (x, y) => this.crosshairOverlay?.setPosition(x, y);
      }
      this.debugPanel ??= new PlayerDebugPanel({
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
      });
      window.addEventListener('resize', this.resizeListener);
      if (typeof document !== 'undefined') document.addEventListener('keydown', this.cursorKeyListener);
    } catch (error) {
      if (this.active) this.loadError = error instanceof Error ? error.message : String(error);
    }
  }

  onExit(): void {
    this.active = false;
    // 循环音效不会自己停，离开场景时立即收掉，免得声音跟着残留。
    this.sfx.stopLoops();
    // 换弹声也要跟着停，否则重进场景后还会响到采样结束。
    this.reloadVoice?.stop(0);
    this.reloadVoice = null;
    // 正在响的鸡叫也失去跟踪对象了，离开场景时硬停，重新进入时从头开始。
    this.activeClucks.forEach(cluck => cluck.handle.stop(0));
    this.activeClucks.length = 0;
    this.pendingCluckStops.length = 0;
    // 声音提示与听觉水位都是本局状态：重进场景不继承上一局的弧线与去重表。
    this.soundRippleSystem.clear();
    this.playerHearing.reset();
    // 冷却表跟着场景一起丢弃，重进场景时不继承上一局的叫声节奏。
    this.chickenCluckCooldowns.clear();
    this.game?.input?.setPointerEnabled(false);
    this.game?.input?.clear();
    // 退出场景后 Tab 恢复浏览器默认行为；交互进度与按住状态一并清空。
    this.game?.input?.setCapturedKeys?.([]);
    this.interactionEnabled = false;
    this.interaction.reset();
    this.pickupCandidates = [];
    this.pickupMarkers = [];
    this.tabHeld = false;
    this.spaceHeld = false;
    if (this.game?.input) this.game.input.onPointerMove = undefined;
    this.crosshairOverlay?.dispose();
    this.crosshairOverlay = undefined;
    this.displayedView = undefined;
    this.viewportCache = null;
    this.debugPanel?.dispose();
    this.debugPanel = undefined;
    window.removeEventListener('resize', this.resizeListener);
    if (typeof document !== 'undefined') document.removeEventListener('keydown', this.cursorKeyListener);
    this.setCursorVisible(false);
  }


  /**
   * 场景更新逻辑，每帧调用
   * @param delta 时间增量（秒）
   * @param input 输入状态对象
   */
  update(delta: number, input: Input) {
    this.deltaSinceLastFrame = delta;

    if (!this.loaded) return;

    // 开火/切枪都只在本帧有效：交互取消只消费当帧信号。
    this.shotThisFrame = false;
    this.weaponSwitchedThisFrame = false;

    // 更新玩家状态
    const prevX = this.player.x, prevY = this.player.y;
    this.player.update(delta, input, this.map, this.getPointerAim(input));
    // 换弹完成、被翻滚打断或切走时收掉没放完的换弹声，别压到下面那声枪响。
    if (this.reloadVoice && !this.player.getWeaponView().isReloading) {
      this.reloadVoice.stop(0.12);
      this.reloadVoice = null;
    }
    // 右侧武器列表跟着玩家切枪走；放在 update 之后才能当帧反映切换。
    this.weaponListHud.update(delta, this.player.getWeaponLoadoutView());
    // 用实际位移判断“在走”，顶墙原地推和被墙卡住时不会继续播放涉水声。
    const movedSpeed = delta > 0 ? Math.hypot(this.player.x - prevX, this.player.y - prevY) / delta : 0;
    this.updateWadingSound(movedSpeed);
    this.updateFootstepSound(movedSpeed);
    // 两条循环音效的目标音量都设好了，统一推进一步淡入淡出，各自都是 120 毫秒。
    this.sfx.update(delta);
    this.noiseSystem.update(delta);
    this.chickenStepDelay = Math.max(0, this.chickenStepDelay - delta);
    this.updateChickenCluckCooldowns(delta);

    // 光照与手电先于小鸡感知结算：否则小鸡看到的是上一帧的灯位、朝向与开关。
    this.torches.forEach(torch => torch.update(delta));
    this.lightingSystem.update(delta);

    // 玩家中心位置同时供相机、光源与小鸡感知使用，只在本帧算一次。
    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    this.camera.follow(playerCenterX, playerCenterY, delta);
    const center = new Vector2(playerCenterX, playerCenterY);
    this.playerLight.setPosition(center);
    this.flashlight.setPosition(center);
    this.flashlight.setDirection(this.player.getVisionState().direction);

    // G 键是开关而不是常亮：只在下沿切换，避免按住时反复翻转。
    // 提前到感知之前，玩家视野与小鸡视觉才能在同一帧看到同一盏灯。
    const flashlightDown = input.isKeyDown("g");
    if (flashlightDown && !this.flashlightHeld) {
      this.flashlightOn = !this.flashlightOn;
      this.flashlight.setActive(this.flashlightOn);
      // 开关共用一声轻响；单声部保证快速连按时只留最后一次的尾音。
      this.sfx.play(FLASHLIGHT_SWITCH_SOUND, this.volume(this.audio.flashlight.switchVolume), 1, { count: 1 });
    }
    this.flashlightHeld = flashlightDown;

    // 小鸡视觉与玩家三层视野共用同一份灯列表，避免两套光照判断漂移。
    this.rebuildPerceptionLights();

    // 小鸡只在干地自由游荡，不读取玩家输入；感知刺激由场景统一提供。
    this.chickens.forEach(chicken => chicken.update(delta, input, this.map, {
      targetX: playerCenterX,
      targetY: playerCenterY,
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
    this.footprintSystem.update(delta);
    this.rippleSystem.update(delta);
    // 边界反馈读取原始输入方向：贴墙时速度已被清零，但仍要能判断还在往里推。
    this.boundaryRippleSystem.update(delta, this.player.getCollider().bounds,
      this.player.getMoveIntent(input), this.map.width * this.map.tileSize,
      this.map.height * this.map.tileSize);
    this.floatingTexts.update(delta);

    // 更新属性修改器
    this.modifierManager.update(delta);
    this.debugPanel?.update(delta);

    // 更新道具状态
    this.updatePickupItems(delta, input);

    // 检查玩家与道具的碰撞
    this.checkPickupCollisions();
    this.updateGoldPickups(delta);
    // 白烟与肉块同帧出现，肉块当帧就开始下落。
    this.updateMeatPickups(delta);

    // 感知先于按键与交互结算：拾取系统只使用本帧的可见性结果，不读上一帧。
    this.updatePerception(delta);
    // 声音提示只消费世界噪声事件，不参与感知，也不会被感知遮罩擦掉。
    this.updateSoundRipples(delta);

    // R 键换弹同样只认下沿，按住不会反复起手。
    const reloadDown = input.isKeyDown("r");
    if (reloadDown && !this.reloadHeld) this.player.requestReload();
    this.reloadHeld = reloadDown;

    // Tab 在主副枪械之间切换（Q 不再绑定），C 收枪/空手；都只认下沿。
    const tabDown = input.isKeyDown("Tab");
    if (tabDown && !this.tabHeld) {
      this.player.cycleFirearm(1);
      this.weaponSwitchedThisFrame = true;
    }
    this.tabHeld = tabDown;
    const cDown = input.isKeyDown("c");
    if (cDown && !this.cHeld) {
      this.player.toggleMelee();
      this.weaponSwitchedThisFrame = true;
    }
    this.cHeld = cDown;

    // 空格翻滚只认下沿：按住不会连续起滚，连滚需要松开再按。
    const spaceDown = input.isKeyDown(" ");
    if (spaceDown && !this.spaceHeld && this.player.requestRoll(input)) {
      this.noiseSystem.emit("roll", this.player.x + this.player.getSize() / 2,
        this.player.y + this.player.getSize() / 2, { sourceId: "player" });
    }
    this.spaceHeld = spaceDown;

    // 拾取放在所有可能打断它的动作之后：本帧的开火/切枪/翻滚会立即取消进度。
    this.updateInteraction(delta, input);
    // 肉块本帧被移除后，绑定的血迹从下一帧开始走正常的保留与淡出。
    this.releasePickedUpBlood();
  }

  /** 供敌人听觉、调试面板与测试读取的噪声总线（只读用途，写入仍由场景负责）。 */
  getNoiseSystem(): NoiseSystem { return this.noiseSystem; }

  /**
   * 重建本帧感知光源：玩家微光、手电与点燃的火把。
   * 玩家三层视野与小鸡视觉共用这一份结果，避免两套光照判断漂移。
   */
  private rebuildPerceptionLights(): void {
    if (!this.playerLight || !this.flashlight) return;
    const lights = this.perceptionLights;
    lights.length = 0;
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
  private drawPerceptionSilhouettes(ctx: CanvasRenderingContext2D,
    cameraX: number, cameraY: number): void {
    if (!this.perception) return;
    const paint = (bounds: { x: number; y: number; width: number; height: number },
      weight: number,
      drawSource: (sctx: CanvasRenderingContext2D, pad: number) => void): void => {
      if (weight <= 0.002) return;
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
      ctx.drawImage(canvas, 0, 0, width, height,
        bounds.x - pad - cameraX, bounds.y - pad - cameraY, width, height);
      ctx.restore();
    };
    const silhouetteWeight = (target: object): number => this.getEntitySilhouette(target);

    // 地面轮廓裁剪：落在墙体/矿石顶面的剪影像素会被裁掉，避免“部分露出”变成整只画在墙上。
    // 轮廓路径是世界坐标，先平移再建立裁剪区，随后恢复屏幕坐标绘制。
    const ground = this.map.getGroundContour(cameraX, cameraY, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.translate(-cameraX, -cameraY);
    ctx.clip(ground, "evenodd");
    ctx.setTransform(1, 0, 0, 1, 0, 0);

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
    // 脚印、涟漪、弹坑与血迹属于地面装饰：在地图之后、单位层之前绘制，始终可见且受光照。
    this.footprintSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    this.rippleSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    this.craterSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    // 血迹压在弹坑之上：后画的斑块不会被弹坑的暗色吃掉。
    this.bloodStainSystem.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height);
    this.torches.forEach(torch => torch.draw(ctx, cameraOffset.x, cameraOffset.y));

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

    if (this.goldPickups.length || this.chickens.length || this.meatPickups.length) {
      units.save();
      // 与光照共用同一份世界坐标地形轮廓：已按瓦片内容缓存，避免每帧重建整屏裁剪路径。
      units.translate(-cameraOffset.x, -cameraOffset.y);
      units.clip(this.map.getGroundContour(cameraOffset.x, cameraOffset.y, this.unitCanvas.width, this.unitCanvas.height), "evenodd");
      units.setTransform(1, 0, 0, 1, 0, 0);
      // 和地图共用像素边界，地面投影不能覆盖墙壁、矿石的顶面。
      for (const pickup of this.goldPickups) {
        if (visible(pickup.x, pickup.y, 48) && drawn(pickup)) {
          units.globalAlpha = this.getEntityAlpha(pickup);
          pickup.drawShadow(units, cameraOffset.x, cameraOffset.y, this.playerLight.getPosition());
        }
      }
      for (const chicken of this.chickens) {
        if (visible(chicken.x, chicken.y, 72) && drawn(chicken)) {
          units.globalAlpha = this.getEntityAlpha(chicken);
          chicken.drawShadow(units, cameraOffset.x, cameraOffset.y, this.playerLight.getPosition());
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
      this.chickens.some(c => this.getEntitySilhouette(c) > 0.002) ||
      this.goldPickups.some(p => this.getEntitySilhouette(p) > 0.002) ||
      this.meatPickups.some(p => this.getEntitySilhouette(p) > 0.002) ||
      this.pickupItems.some(p => this.getEntitySilhouette(p) > 0.002)
    );
    if (clipSilhouetteBodies) {
      units.save();
      units.translate(-cameraOffset.x, -cameraOffset.y);
      units.clip(this.map.getGroundContour(cameraOffset.x, cameraOffset.y, this.unitCanvas.width, this.unitCanvas.height), "evenodd");
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
    this.player.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 应用光照效果
    this.applyLighting(ctx, cameraOffset.x, cameraOffset.y);
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
    this.player.drawUI(ctx, cameraOffset.x, cameraOffset.y);
    screenContext.drawImage(this.worldCanvas, 0, 0, screenContext.canvas.width, screenContext.canvas.height);
    ctx = screenContext;
    // 拾取飘字画在屏幕层：沿用 HUD 的 dpr 约定，白字不随光照变暗。
    ctx.save();
    const textDpr = window.devicePixelRatio || 1;
    ctx.scale(textDpr, textDpr);
    this.floatingTexts.draw(ctx, cameraOffset.x, cameraOffset.y,
      (screenContext.canvas.width / textDpr) / this.camera.width);
    ctx.restore();
    // 黄金计数在 HUD 之前，保持原有层级。
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(24, 26, 12, 12);
    ctx.font = "18px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`黄金 ${this.player.getGold()}`, 46, 32);
    ctx.restore();
    // 屏幕层 HUD：右侧武器列表与手电胶囊；生命/体力条仍在角色脚边。
    // 单独按 dpr 缩放成逻辑像素，避免继承资源栏的 transform。
    ctx.save();
    const hudDpr = window.devicePixelRatio || 1;
    ctx.scale(hudDpr, hudDpr);
    const hudWidth = ctx.canvas.width / hudDpr;
    const hudHeight = ctx.canvas.height / hudDpr;
    const loadout = this.player.getWeaponLoadoutView();
    this.weaponListHud.draw(ctx, loadout, hudWidth, hudHeight);
    // 手电胶囊贴在武器列表上方，与列表右缘对齐。
    drawFlashlightHud(ctx, getFlashlightHudRect(getWeaponListLayout(hudWidth, hudHeight).area), this.flashlightOn);
    ctx.restore();
    // 拾取标记与 E 提示放在 HUD 之后：交互提示优先于静态信息，且布局已避让 HUD 区域。
    this.drawPickupPrompts(screenContext, cameraOffset);
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
      const halfSize = (entry.target instanceof MeatPickup ? MeatPickup.SIZE : GoldPickup.SIZE) / 2;
      return {
        x: (entry.marker.x - cameraOffset.x) * scale,
        y: (entry.marker.y - cameraOffset.y) * scale,
        style: entry.marker.style,
        halfHeight: halfSize * scale,
        target: entry.target === snapshot.target,
      };
    });

    let prompt = null;
    if (snapshot.target && (snapshot.state === "focused" || snapshot.state === "holding")) {
      const anchor = snapshot.target.getPickupAnchor();
      const halfSize = MeatPickup.SIZE / 2 * scale;
      const anchorX = (anchor.x - cameraOffset.x) * scale;
      prompt = {
        x: anchorX,
        y: (anchor.y - cameraOffset.y) * scale,
        halfWidth: halfSize,
        halfHeight: halfSize,
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
    ctx.restore();
  }

  /** 供浏览器验收与调试读取的拾取快照（只读用途）。 */
  getPickupDebugState() {
    const snapshot: InteractionSnapshot<MeatPickup> = this.interaction.getSnapshot();
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
    if (!pointer?.active || this.cursorVisible) return undefined;
    const target = this.screenToWorld(pointer.clientX, pointer.clientY);
    return target ? { target, fire: pointer.leftDown || pointer.leftPressed, face: pointer.rightDown } : undefined;
  }

  /** 唤出系统鼠标时收起准星并暂停瞄准，避免两套指针同时出现。 */
  private setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
    if (typeof document !== 'undefined') document.body.classList.toggle('cursor-visible', visible);
    if (visible) this.crosshairOverlay?.setVisible(false);
  }

  /**
   * 准星外观每帧刷新（瞄准内收、后坐力外扩、压住活鸡时左右括弧转红）；位置由
   * pointermove 直接写图层，所以世界帧再慢，准星也不会落后于鼠标。
   */
  private updateCrosshair(): void {
    const overlay = this.crosshairOverlay;
    if (!overlay) return;
    if (this.cursorVisible) {
      overlay.setVisible(false);
      return;
    }
    const pointer = this.game.input.getPointerState?.();
    if (!pointer?.active) {
      this.crosshairTighten = 0;
      overlay.setVisible(false);
      return;
    }
    // 场景刚进入或指针没动过时也可能还没有位置，这里补一次；坐标没变时是空操作。
    overlay.setPosition(pointer.clientX, pointer.clientY);
    overlay.setVisible(true);

    const overTarget = this.isCrosshairOnTarget(pointer);
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
    return this.chickens.some(chicken =>
      chicken.hitTestSegment(world.x, world.y, world.x, world.y, 0) !== null);
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
    this.lightingSystem.setAmbientLight(color);
  }
}
