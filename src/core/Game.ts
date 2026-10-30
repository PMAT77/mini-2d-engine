import { Input } from "./Input";
import { Renderer } from "./Renderer";
import { SceneManager } from "./Scene";

/**
 * 游戏主类
 * 负责初始化游戏核心组件、启动游戏循环并协调各系统工作
 */
export class Game {
  /** 渲染器实例，负责所有图形绘制 */
  renderer: Renderer;

  /** 场景管理器，负责管理和切换不同游戏场景 */
  sceneManager: SceneManager;

  /** 输入系统，处理用户键盘和鼠标输入 */
  input: Input;

  /** 上一帧的时间戳，用于计算时间增量 */
  private lastTime = 0;

  /** 当前帧率 */
  private fps = 0;

  /** 用于计算FPS的帧数计数器 */
  private frameCount = 0;

  /** 上次计算FPS的时间戳 */
  private lastFpsUpdate = 0;

  /** 复用的 rAF 回调：此前每帧 `bind` 会分配一个新闭包。 */
  private readonly boundLoop = (now: number): void => this.loop(now);

  /**
   * 单帧最大推进时间。掉帧时若把整段真实时间喂给物理，
   * Entities 的 1/120 子步会成倍增长，形成“越卡越慢”的正反馈。
   */
  private static readonly MAX_DELTA = 1 / 30;

  /**
   * 构造函数
   * @param canvas 游戏画布元素
   */
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.sceneManager = new SceneManager(this);
    this.input = new Input(canvas);
  }

  /**
   * 启动游戏
   * 初始化游戏循环并开始渲染
   */
  start(): void {
    this.lastTime = performance.now();
    this.lastFpsUpdate = this.lastTime;
    requestAnimationFrame(this.boundLoop);
  }

  /**
   * 游戏主循环
   * 处理游戏更新、渲染和输入响应
   * @param now 当前时间戳
   * @private
   */
  private loop(now: number): void {
    // 计算时间增量（秒），并夹住异常长的帧（切标签页、断点、GC 停顿）
    const delta = Math.min(Game.MAX_DELTA, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    // 计算FPS
    this.frameCount++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // 更新当前场景
    this.sceneManager.update(delta, this.input);

    // 不透明场景自己会铺满画布，跳过全屏清屏；过渡期间需要清屏以免残留上一场景。
    const scene = this.sceneManager.getCurrentScene();
    if (!scene || !scene.opaque || this.sceneManager.isSceneTransitioning()) {
      this.renderer.clear("#1a1a1a"); // 修改为更适合光照系统的深色背景
    }
    this.sceneManager.draw(this.renderer.ctx);

    // 绘制FPS信息
    this.renderer.drawFPS(this.fps);

    // 绘制玩家位置信息 
    this.renderer.drawPos(this.sceneManager);


    // 请求下一帧动画，继续游戏循环
    requestAnimationFrame(this.boundLoop);
  }

  /**
 * 调整光照系统大小（如果场景中有光照系统）
 */
  public resizeLightingSystem(): void {
    // 这里我们会在Renderer中实现对光照系统的调整
  }
}
