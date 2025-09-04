import { AssetLoader } from "../core/AssetLoader";
import { Camera } from "../core/Camera";
import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { Player } from "../objects/Player";

/**
 * 游戏主场景类，负责管理游戏的核心逻辑、渲染和交互
 */
export class GameScene extends Scene {
  /** 游戏地图实例 */
  private map: TileMap;

  /** 资源加载器实例 */
  private loader: AssetLoader;

  /** 玩家角色实例 */
  private player: Player;

  /** 游戏摄像机实例 */
  private camera: Camera;

  /** 资源是否加载完成的标志 */
  private loaded = false;

  /** 上一帧到当前帧的时间间隔（毫秒） */
  private deltaSinceLastFrame = 0;

  /** 玩家角色大小常量 */
  private static readonly PLAYER_SIZE = 49;

  constructor() {
    super();

    // 初始化游戏地图，设置为1000x1000的大小
    this.map = new TileMap(1000, 1000);

    // 初始化相机，设置视口大小为窗口的两倍，死区为800x500，缓动系数为5
    this.camera = new Camera(window.innerWidth * 2, window.innerHeight * 2, 800, 500, 5);

    // 获取摄像头死区范围，用于在其中生成玩家初始位置
    const deadZoneLeft = this.camera.x + (this.camera.width - this.camera.deadZoneWidth) / 2;
    const deadZoneTop = this.camera.y + (this.camera.height - this.camera.deadZoneHeight) / 2;
    const deadZoneWidth = this.camera.deadZoneWidth;
    const deadZoneHeight = this.camera.deadZoneHeight;

    // 在死区内生成可行走位置作为玩家出生点
    const spawn = this.getSpawnPositionInArea(deadZoneLeft, deadZoneTop, deadZoneWidth, deadZoneHeight, GameScene.PLAYER_SIZE);
    this.player = new Player(spawn.x, spawn.y);

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
    this.loader = new AssetLoader({
      "player": "/assets/avatar.png",
    });
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
  getSpawnPositionInArea(x: number, y: number, width: number, height: number, size: number): { x: number; y: number } {
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
    await this.loader.load();
    this.loaded = true;

    // 设置玩家精灵
    const sprite = this.loader.getImage("player");
    if (sprite) this.player.setSprite(sprite);

    // 尝试播放背景音乐
    const bgm = this.loader.getAudio("bgm");
    bgm?.play();
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

    // 相机跟随玩家中心位置
    const playerCenterX = this.player.x + this.player.getSize() / 2;
    const playerCenterY = this.player.y + this.player.getSize() / 2;
    this.camera.follow(playerCenterX, playerCenterY, delta);
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

    // 绘制玩家（在子弹上方），使用带震动偏移的相机位置
    this.player.draw(ctx, cameraOffset.x, cameraOffset.y);

    // 绘制相机死区（调试用）
    this.camera.drawDebug(ctx);
  }
}