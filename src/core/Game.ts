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

  /**
   * 构造函数
   * @param canvas 游戏画布元素
   */
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.sceneManager = new SceneManager(this);
    this.input = new Input();
  }

  /**
   * 启动游戏
   * 初始化游戏循环并开始渲染
   */
  start(): void {
    this.lastTime = performance.now();
    this.lastFpsUpdate = this.lastTime;
    requestAnimationFrame(this.loop.bind(this));
  }

  /**
   * 游戏主循环
   * 处理游戏更新、渲染和输入响应
   * @param now 当前时间戳
   * @private
   */
  private loop(now: number): void {
    // 计算时间增量（秒）
    const delta = (now - this.lastTime) / 1000;
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

    // 清空画布并绘制当前场景 
    this.renderer.clear("#1a1a1a"); // 修改为更适合光照系统的深色背景
    this.sceneManager.draw(this.renderer.ctx);

    // 绘制FPS信息
    this.renderer.drawFPS(this.fps);

    // 绘制玩家位置信息 
    this.renderer.drawPos(this.sceneManager);


    // 请求下一帧动画，继续游戏循环
    requestAnimationFrame(this.loop.bind(this));
  }

  /**
 * 调整光照系统大小（如果场景中有光照系统）
 */
  public resizeLightingSystem(): void {
    // 这里我们会在Renderer中实现对光照系统的调整
  }
}