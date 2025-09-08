import { AssetLoader } from "../core/AssetLoader";
import { Camera } from "../core/Camera";
import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { ParticleSystem } from "../objects/ParticleSystem";
import { Player } from "../objects/Player";

// 导入光照系统相关类
import { ConfigLoader } from "../core/ConfigLoader";
import { LightSource } from "../core/LightSource";
import { LightingSystem } from "../core/LightingSystem";
import { ModifierManager } from "../core/ModifierManager";

import { PickupItem, PickupType } from "../objects/PickupItem";


/**
 * 游戏主场景类，负责管理游戏的核心逻辑、渲染和交互
 */
export class GameScene extends Scene {
  private player!: Player;
  private map!: TileMap;
  private camera!: Camera;
  private assetLoader!: AssetLoader;
  private configLoader!: ConfigLoader;
  private loaded: boolean = false;
  private deltaSinceLastFrame: number = 0;

  // 添加玩家光源引用
  private playerLight: LightSource;

  // 常量定义
  private static readonly PLAYER_SIZE = 49;

  // 粒子系统
  private particleSystem: ParticleSystem;
  // 光照系统
  private lightingSystem: LightingSystem;
  // 属性修改器
  private modifierManager: ModifierManager;

  // 在GameScene类中添加以下属性
  private pickupItems: PickupItem[] = [];      // 存储所有道具
  private pickupSpawnInterval: number = 3;    // 道具生成间隔（秒）
  private pickupSpawnTimer: number = 0;       // 道具生成计时器
  private maxPickups: number = 5;             // 最大道具数量
  private minDistanceFromPlayer: number = 200; // 生成道具时与玩家的最小距离

  /**
   * 构造函数
   */
  constructor() {
    super();

    // 初始化游戏地图，设置为1000x1000的大小
    this.map = new TileMap(100, 100);

    // 获取设备像素比，默认为1
    const dpr = window.devicePixelRatio || 1;

    // 初始化相机，设置视口大小为窗口的两倍，死区为800x500，缓动系数为5
    this.camera = new Camera(window.innerWidth * dpr, window.innerHeight * dpr, 800, 500, 5);

    // 初始化粒子系统
    this.particleSystem = new ParticleSystem();

    // 初始化光照系统
    this.lightingSystem = new LightingSystem();

    // 初始化拾取物生成计时器
    this.pickupSpawnTimer = this.pickupSpawnInterval;


    // 获取摄像头死区范围，用于在其中生成玩家初始位置
    const deadZoneLeft = this.camera.x + (this.camera.width - this.camera.deadZoneWidth) / 2;
    const deadZoneTop = this.camera.y + (this.camera.height - this.camera.deadZoneHeight) / 2;
    const deadZoneWidth = this.camera.deadZoneWidth;
    const deadZoneHeight = this.camera.deadZoneHeight;

    // 在死区内生成可行走位置作为玩家出生点
    const spawn = this.getSpawnPositionInArea(deadZoneLeft, deadZoneTop, deadZoneWidth, deadZoneHeight, GameScene.PLAYER_SIZE);
    this.player = new Player(spawn.x, spawn.y, undefined, this.particleSystem);

    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    const playerCenter = new Vector2(playerCenterX, playerCenterY);

    // 设置玩家光源（位置跟随玩家中心，半径600，白色，强度1） 
    this.playerLight = new LightSource(playerCenter, 600, "#FFFFFF", 1.0);
    this.lightingSystem.addLightSource(this.playerLight);

    // 设置环境光（深色背景，带有微弱的环境光）
    this.lightingSystem.setAmbientLight("rgba(30, 30, 40, 0.8)");

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
    // 设置属性变化回调，用于更新UI
    this.player.setOnStatsChangeCallback(() => {
      this.updatePlayerStatsUI();
    });

    // 初始化资源加载器，配置需要加载的资源
    this.assetLoader = new AssetLoader({
      "player": "/assets/images/avatar.png",
    });

    this.configLoader = new ConfigLoader({
      "playerConfig": "/configs/playerConfig.json",
    });
  }

  /**
   * 初始化光照系统
   */
  private initLightingSystem(): void {
    const dpr = window.devicePixelRatio || 1;
    // 使用相机的实际尺寸而不是窗口尺寸
    const width = this.camera.width;
    const height = this.camera.height;
    this.lightingSystem.initialize(width * dpr, height * dpr);
  }

  /**
   * 重置相机尺寸以适应窗口大小变化
   */
  private resizeCamera(): void {
    const dpr = window.devicePixelRatio || 1;
    // 更新相机视口大小为窗口的两倍
    this.camera.width = window.innerWidth * dpr;
    this.camera.height = window.innerHeight * dpr;
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
    this.resizeCamera();
    this.initLightingSystem();
  }

  /**
   * 类型保护函数：检查值是否为有效的 PickupType 枚举值
   */
  private isPickupType(value: any): value is PickupType {
    return typeof value === 'number' && value >= 0 && value < Object.keys(PickupType).length / 2;
  }

  // 添加生成单个道具的方法 
  private spawnPickupItem(): void {
    // 检查当前道具数量是否已达上限
    if (this.pickupItems.length >= this.maxPickups) {
      return;
    }

    try {
      // 生成随机道具类型
      const pickupTypes = Object.values(PickupType).filter(this.isPickupType);
      const randomType = pickupTypes[Math.floor(Math.random() * pickupTypes.length)];

      // 尝试生成一个距离玩家足够远的可行走位置
      let attempts = 0;
      const maxAttempts = 100;
      let position: { x: number; y: number } | null = null;

      while (attempts < maxAttempts) {
        // 获取随机可行走位置
        try {
          const randomPos = this.map.getRandomWalkablePosition(PickupItem.DEFAULT_SIZE);

          // 计算与玩家的距离
          const playerCenterX = this.player.x + this.player.getSize() / 2;
          const playerCenterY = this.player.y + this.player.getSize() / 2;
          const dx = randomPos.x + PickupItem.DEFAULT_SIZE / 2 - playerCenterX;
          const dy = randomPos.y + PickupItem.DEFAULT_SIZE / 2 - playerCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          // 如果距离足够远，则使用这个位置
          if (distance >= this.minDistanceFromPlayer) {
            position = randomPos;
            break;
          }
        } catch (error) {
          console.warn("无法生成道具位置:", error);
        }
        attempts++;
      }

      // 如果找到合适位置，创建并添加道具
      if (position) {
        const pickup = new PickupItem(position.x, position.y, randomType, this.particleSystem);
        this.pickupItems.push(pickup);
        console.log(`生成了道具: ${PickupType[randomType]} 在位置 [${position.x.toFixed(0)}, ${position.y.toFixed(0)}]`);
      }
    } catch (error) {
      console.error("生成道具时出错:", error);
    }
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
    const playerSize = this.player.getSize();
    const collectedPickups: number[] = [];

    // 检查每个道具是否与玩家碰撞
    for (let i = 0; i < this.pickupItems.length; i++) {
      const pickup = this.pickupItems[i];

      // 使用PickupItem类的碰撞检测方法
      if (pickup.isCollidingWithRect(this.player.x, this.player.y, playerSize, playerSize)) {
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
      if (modifierEffect.stat === 'HEALTH') {
        // 特殊处理生命值恢复
        // 假设Player类有一个heal方法
        // if (this.player['heal']) {
        //   this.player['heal'](modifierEffect.value);
        // }
      } else {
        // 使用ModifierManager应用其他效果
        this.modifierManager.addModifier(modifierEffect);
        console.log('fireRate', this.player.getFireRate())
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
  public getSpawnPositionInArea(x: number, y: number, width: number, height: number, size: number): { x: number; y: number } {
    const MAX_ATTEMPTS = 1000;
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      const posX = x + Math.random() * (width - size);
      const posY = y + Math.random() * (height - size);

      if (this.map.isWalkableArea(posX, posY, size)) {
        return { x: posX, y: posY };
      }
      attempts++;
    }

    throw new Error("无法在死区范围内生成可通行位置");
  }

  // 添加一个显示玩家状态的UI更新方法
  private updatePlayerStatsUI(): void {
    // 这里实现UI更新逻辑，例如显示当前的 buff 列表、属性值等
    // 由于没有看到您的UI系统实现，这里仅提供一个框架
    console.log('玩家属性已更新:');
    // console.log('- 最大速度:', this.player.getMaxSpeed());
    // console.log('- 射速:', this.player.getFireRate());
    // console.log('- 子弹速度:', this.player.getBulletSpeed());

    // 显示当前激活的修改器
    const activeModifiers = this.modifierManager.getActiveModifiers();
    if (activeModifiers.length > 0) {
      console.log('激活的属性修改:');
      activeModifiers.forEach(mod => {
        console.log(`- ${mod.description}`);
      });
    }
  }

  /**
   * 场景进入时的初始化逻辑
   * 负责加载游戏资源并设置玩家精灵
   */
  async onEnter() {
    await this.assetLoader.load();
    await this.configLoader.load();
    this.loaded = true;

    // 获取并应用玩家配置
    const playerConfig = this.configLoader.getConfig("playerConfig");
    console.log("玩家配置:", playerConfig)
    if (playerConfig) {
      this.player.applyConfig(playerConfig);
    }

    // 设置玩家精灵
    const sprite = this.assetLoader.getImage("player");
    if (sprite) this.player.setSprite(sprite);

    // 尝试播放背景音乐
    const bgm = this.assetLoader.getAudio("bgm");
    bgm?.play();

    // 初始化光照系统尺寸
    this.initLightingSystem();

    // 监听窗口大小变化，同时更新相机和光照系统
    window.addEventListener('resize', () => this.handleResize());
  }

  /**
   * 场景退出时的清理逻辑
   */
  onExit() {
    // 移除窗口大小变化的事件监听，避免内存泄漏
    window.removeEventListener('resize', () => this.handleResize());
  }


  /**
   * 场景更新逻辑，每帧调用
   * @param delta 时间增量（毫秒）
   * @param input 输入状态对象
   */
  update(delta: number, input: Input) {
    this.deltaSinceLastFrame = delta;

    if (!this.loaded) return;

    // 更新道具生成计时器
    this.pickupSpawnTimer -= delta;
    if (this.pickupSpawnTimer <= 0) {
      this.spawnPickupItem();
      this.pickupSpawnTimer = this.pickupSpawnInterval;
    }

    // 更新玩家状态
    this.player.update(delta, input, this.map);

    // 更新粒子系统
    this.particleSystem.update(delta);

    // 更新光照系统
    this.lightingSystem.update(delta);

    // 更新属性修改器
    this.modifierManager.update(delta);

    // 更新道具状态
    this.updatePickupItems(delta, input);

    // 检查玩家与道具的碰撞
    this.checkPickupCollisions();

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

    if (!this.loaded) return;

    // 获取包含震动偏移的相机位置
    const cameraOffset = this.camera.getOffset();

    // 绘制地图，使用带震动偏移的相机位置
    this.map.draw(ctx, cameraOffset.x, cameraOffset.y, ctx.canvas.width, ctx.canvas.height, this.deltaSinceLastFrame);

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

    // 绘制子弹（在玩家下方），使用相机的基础位置（不带震动偏移）
    this.player.getBullets().forEach(bullet => {
      bullet.draw(ctx, this.camera.x, this.camera.y);
    });

    // 绘制粒子（在子弹上方，玩家下方）
    this.particleSystem.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 绘制玩家（在所有元素上方），使用带震动偏移的相机位置
    this.player.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 绘制相机死区（调试用）
    this.camera.drawDebug(ctx);

    // 应用光照效果
    this.applyLighting(ctx, cameraOffset.x, cameraOffset.y);
  }

  /**
   * 应用光照效果
   */
  private applyLighting(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number) {
    // 准备光照遮罩
    const dpr = window.devicePixelRatio || 1;
    // 使用相机的实际尺寸
    this.lightingSystem.prepareLightingMask(
      cameraX,
      cameraY,
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