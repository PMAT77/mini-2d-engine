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

    // 更新玩家状态
    this.player.update(delta, input, this.map);

    // 更新粒子系统
    this.particleSystem.update(delta);

    // 更新光照系统
    this.lightingSystem.update(delta);

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