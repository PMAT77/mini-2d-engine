import { Camera } from "../core/Camera";
import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
import { TileMap, TileMapOptions } from "../map/TileMap";
import { solidPath } from '../map/SolidTerrain';
import { TileTypeId, getTileType } from "../map/TileType";
import { Vector2 } from "../math/Vector2";
import { ParticleSystem } from "../objects/ParticleSystem";
import { Player, PlayerAimInput } from "../objects/Player";
import { PlayerConfig } from "../objects/PlayerConfig";
import { PlayerDebugPanel } from "../ui/PlayerDebugPanel";

// 导入光照系统相关类
import { ConfigLoader } from "../core/ConfigLoader";
import { LightSource } from "../core/LightSource";
import { LightingSystem } from "../core/LightingSystem";
import { VisibilitySystem } from "../core/VisibilitySystem";
import { ModifierManager } from "../core/ModifierManager";

import { PickupItem, PickupType } from "../objects/PickupItem";
import { GoldPickup } from "../objects/GoldPickup";
import { Torch } from "../objects/Torch";
import { seededRandom } from "../map/WaterTerrain";
import { ColliderShape, DEFAULT_SHAPE, compileShape, rectangleCollider, transformCollider } from "../physics/Collider";


/**
 * 游戏主场景类，负责管理游戏的核心逻辑、渲染和交互
 */
export class GameScene extends Scene {
  private player!: Player;
  private map!: TileMap;
  private camera!: Camera;
  private worldCanvas!: HTMLCanvasElement;
  private worldContext!: CanvasRenderingContext2D;
  private displayedView?: { x: number; y: number; width: number; height: number };
  private configLoader!: ConfigLoader;
  private loaded: boolean = false;
  private loadingPromise?: Promise<void>;
  private loadError = "";
  private active = false;
  private debugPanel?: PlayerDebugPanel;
  private initialPlayerConfig?: PlayerConfig;
  private initialPlayerLight?: { radius: number; intensity: number };
  private readonly resizeListener = () => this.handleResize();
  private deltaSinceLastFrame: number = 0;

  // 添加玩家光源引用
  private playerLight: LightSource;

  // 常量定义
  private static readonly PLAYER_SIZE = 49;
  private static readonly CAMERA_ZOOM = 0.85;
  private static readonly GOLD_DROP_COUNT = 20;
  private static readonly GOLD_DROP_THRESHOLDS = [0.9, 0.7, 0.5, 0.3, 0.1];
  private goldPickups: GoldPickup[] = [];
  private goldDroppedByTile = new Map<number, number>();

  // 粒子系统
  private particleSystem: ParticleSystem;
  // 光照系统
  private lightingSystem: LightingSystem;
  private visibilitySystem = new VisibilitySystem();
  // 属性修改器
  private modifierManager: ModifierManager;

  private pickupItems: PickupItem[] = []; // 仅由特殊矿完全击碎后生成
  private torches: Torch[] = [];

  /**
   * 构造函数
   */
  constructor(mapOptions?: TileMapOptions) {
    super();

    // 100×100 个瓦片，每格 50 像素
    this.map = new TileMap(100, 100, mapOptions);

    // 获取设备像素比，默认为1
    const dpr = window.devicePixelRatio || 1;

    // 扩大世界视口，合成到主画布时统一缩小世界与光照。
    this.camera = new Camera(Math.ceil(window.innerWidth * dpr / GameScene.CAMERA_ZOOM),
      Math.ceil(window.innerHeight * dpr / GameScene.CAMERA_ZOOM), 400, 250, 5);

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
      const earned = GameScene.GOLD_DROP_THRESHOLDS.filter(threshold => hp / maxHp <= threshold + Number.EPSILON).length * 2;
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

    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    const playerCenter = new Vector2(playerCenterX, playerCenterY);

    // 设置玩家光源（位置跟随玩家中心，照射范围400，暖白色，强度1，发光半径16）
    this.playerLight = new LightSource(playerCenter, 400, "#FFF4E8", 1.0, 16);
    this.lightingSystem.addLightSource(this.playerLight);

    this.torches = Torch.generate(this.map, mapOptions?.seed === undefined ? Math.random : seededRandom(mapOptions.seed ^ 0x746f7263));
    this.torches.forEach(torch => this.lightingSystem.addLightSource(torch.light));

    // 从原环境光中分出微弱的左上方入射光，保持无遮挡暗区的原有亮度。
    this.lightingSystem.setAmbientLight("#2F3843");
    this.lightingSystem.setTerrainLight({
      position: { x: -this.map.width * this.map.tileSize, y: -this.map.height * this.map.tileSize },
      color: "#B4C8E0", intensity: 0.06,
      shadowLength: this.map.tileSize * 0.4, softness: this.map.tileSize * 0.04,
    });

    // 设置射击回调，配置震动参数
    this.player.setOnShootCallback((shootDir?: Vector2) => {
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
    });


    this.modifierManager = new ModifierManager(this.player);

    this.configLoader = new ConfigLoader({
      "playerConfig": "/configs/playerConfig.json",
    });
  }

  /**
   * 初始化光照系统
   */
  private initLightingSystem(): void {
    this.worldCanvas ??= document.createElement("canvas");
    this.worldContext ??= this.worldCanvas.getContext("2d")!;
    this.worldCanvas.width = this.camera.width;
    this.worldCanvas.height = this.camera.height;
    this.lightingSystem.initialize(this.camera.width, this.camera.height);
    this.visibilitySystem.initialize(this.camera.width, this.camera.height);
  }

  /**
   * 重置相机尺寸以适应窗口大小变化
   */
  private resizeCamera(): void {
    // 相机尺寸使用缩放前的世界像素。
    this.camera.width = Math.ceil(this.game.renderer.width / GameScene.CAMERA_ZOOM);
    this.camera.height = Math.ceil(this.game.renderer.height / GameScene.CAMERA_ZOOM);
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
    this.goldPickups = this.goldPickups.filter(pickup => {
      pickup.update(delta);
      if (!pickup.isCollidingWithShape(body)) return true;
      this.player.collectGold();
      this.particleSystem.createExplosion(new Vector2(pickup.x + GoldPickup.SIZE / 2, pickup.y + GoldPickup.SIZE / 2),
        6, 45, 3, 0.2, ["#ffd700", "#fff1a3"]);
      return false;
    });
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
      this.initialPlayerConfig = this.player.getConfigSnapshot();
      this.initialPlayerLight = { radius: this.playerLight.getRadius(), intensity: this.playerLight.getIntensity() };
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
      this.debugPanel ??= new PlayerDebugPanel(this.player, this.game.input, this.game.renderer.ctx.canvas,
        this.playerLight, this.initialPlayerConfig, this.initialPlayerLight);
      window.addEventListener('resize', this.resizeListener);
    } catch (error) {
      if (this.active) this.loadError = error instanceof Error ? error.message : String(error);
    }
  }

  onExit(): void {
    this.active = false;
    this.game?.input?.setPointerEnabled(false);
    this.game?.input?.clear();
    this.displayedView = undefined;
    this.debugPanel?.dispose();
    this.debugPanel = undefined;
    window.removeEventListener('resize', this.resizeListener);
  }


  /**
   * 场景更新逻辑，每帧调用
   * @param delta 时间增量（秒）
   * @param input 输入状态对象
   */
  update(delta: number, input: Input) {
    this.deltaSinceLastFrame = delta;

    if (!this.loaded) return;

    // 更新玩家状态
    this.player.update(delta, input, this.map, this.getPointerAim(input));

    // 更新粒子系统
    this.particleSystem.update(delta);

    // 更新光照系统
    this.torches.forEach(torch => torch.update(delta));
    this.lightingSystem.update(delta);

    // 更新属性修改器
    this.modifierManager.update(delta);
    this.debugPanel?.update(delta);

    // 更新道具状态
    this.updatePickupItems(delta, input);

    // 检查玩家与道具的碰撞
    this.checkPickupCollisions();
    this.updateGoldPickups(delta);

    // 相机跟随玩家中心位置
    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;

    this.camera.follow(playerCenterX, playerCenterY, delta);
    this.playerLight.setPosition(new Vector2(playerCenterX, playerCenterY));
  }

  /**
   * 场景渲染逻辑，每帧调用
   * @param ctx Canvas渲染上下文
   */
  draw(ctx: CanvasRenderingContext2D) {
    // 绘制背景
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (!this.loaded) {
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
    this.displayedView = { ...cameraOffset, width: ctx.canvas.width, height: ctx.canvas.height };

    // 绘制地图，使用带震动偏移的相机位置
    this.map.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height, this.deltaSinceLastFrame);
    this.torches.forEach(torch => torch.draw(ctx, cameraOffset.x, cameraOffset.y));
    this.goldPickups.forEach(pickup => pickup.draw(ctx, cameraOffset.x, cameraOffset.y));

    // 绘制道具（在子弹上方，玩家下方）
    this.pickupItems.forEach(pickup => {
      // 保存当前上下文状态
      ctx.save();
      // 应用相机偏移
      ctx.translate(-cameraOffset.x, -cameraOffset.y);
      // 绘制道具
      pickup.draw(ctx);
      // 恢复上下文状态
      ctx.restore();
    });

    // 所有世界对象共用包含震动的相机偏移
    this.player.getBullets().forEach(bullet => {
      bullet.draw(ctx, cameraOffset.x, cameraOffset.y, this.map);
    });

    // 绘制粒子（在子弹上方，玩家下方）
    this.particleSystem.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 绘制玩家（在所有元素上方），使用带震动偏移的相机位置
    this.player.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 绘制相机死区（调试用）
    this.camera.drawDebug(ctx);

    // 应用光照效果
    this.applyLighting(ctx, cameraOffset.x, cameraOffset.y);
    // 分层绘制全部掉落物，后一个金块的光晕不能重新照亮前一个的投影。
    this.goldPickups.forEach(pickup => pickup.drawGlow(ctx, cameraOffset.x, cameraOffset.y));
    if (this.goldPickups.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
      solidPath(ctx, this.map.getBlockingPolygons(cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height), cameraOffset.x, cameraOffset.y);
      // 和地图共用像素边界，短投影及其柔边均不能覆盖墙壁、矿石的顶面。
      ctx.clip("evenodd");
      this.goldPickups.forEach(pickup => pickup.drawShadow(ctx, cameraOffset.x, cameraOffset.y, this.playerLight.getPosition()));
      ctx.restore();
    }
    this.goldPickups.forEach(pickup => pickup.drawSparkles(ctx, cameraOffset.x, cameraOffset.y));
    this.visibilitySystem.apply(ctx, cameraOffset.x, cameraOffset.y, this.player.getVisionState(), this.map,
      mask => this.player.drawVisibilitySilhouette(mask, cameraOffset.x, cameraOffset.y));
    this.player.drawUI(ctx, cameraOffset.x, cameraOffset.y);
    screenContext.drawImage(this.worldCanvas, 0, 0, screenContext.canvas.width, screenContext.canvas.height);
    ctx = screenContext;
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
    this.drawCrosshair(ctx);
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
  private getCanvasViewport() {
    const canvas = this.game.renderer.ctx.canvas, rect = canvas.getBoundingClientRect();
    const scaleX = canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
    const scaleY = canvas.offsetHeight ? rect.height / canvas.offsetHeight : 1;
    return { left: rect.left + canvas.clientLeft * scaleX, top: rect.top + canvas.clientTop * scaleY,
      width: canvas.clientWidth * scaleX, height: canvas.clientHeight * scaleY };
  }

  getPointerAim(input: Input): PlayerAimInput | undefined {
    const pointer = input.consumePointerState?.();
    if (!pointer?.active) return undefined;
    const target = this.screenToWorld(pointer.clientX, pointer.clientY);
    return target ? { target, fire: pointer.leftDown || pointer.leftPressed, face: pointer.rightDown } : undefined;
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D): void {
    const pointer = this.game.input.getPointerState?.();
    if (!pointer?.active) return;
    const rect = this.getCanvasViewport();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = pointer.clientX - rect.left, y = pointer.clientY - rect.top;
    const gap = 4 + this.player.getRecoilState().intensity * 8;
    ctx.save();
    ctx.setTransform(ctx.canvas.width / rect.width, 0, 0, ctx.canvas.height / rect.height, 0, 0);
    ctx.beginPath();
    ctx.moveTo(x - gap - 7, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + 7, y);
    ctx.moveTo(x, y - gap - 7); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + 7);
    ctx.strokeStyle = '#101820'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = '#d8faff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#d8faff'; ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.restore();
  }

  /**
   * 应用光照效果
   */
  private applyLighting(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number) {
    this.playerLight.setRangeScale(this.player.getVisionState().range / 400);
    // 准备光照遮罩
    // 使用与世界绘制一致的相机偏移
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
