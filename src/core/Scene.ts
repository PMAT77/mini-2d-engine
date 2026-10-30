import { Game } from "./Game";
import { Input } from "./Input";

/**
 * 场景抽象基类
 * 所有游戏场景都应继承自此类，提供场景的基本生命周期和行为接口
 */
export abstract class Scene {
  /**
   * 场景是否每帧覆盖整个画布。为 true 时主循环可跳过清屏，
   * 省下一次全屏填充；过渡动画期间仍会清屏。
   */
  public readonly opaque: boolean = false;

  /**
   * 所属游戏实例的引用
   * @protected
   */
  protected game!: Game;

  /**
   * 设置场景所属的游戏实例
   * @param game 游戏实例
   * @internal 仅由SceneManager调用，不建议手动调用
   */
  public _setGame(game: Game): void {
    this.game = game;
  }

  /**
   * 更新场景状态
   * @param delta 时间增量（秒）
   * @param input 输入系统实例
   */
  public abstract update(delta: number, input: Input): void;

  /**
   * 绘制场景内容
   * @param ctx Canvas 2D渲染上下文
   */
  public abstract draw(ctx: CanvasRenderingContext2D): void;

  /**
   * 场景进入时的钩子函数（可选）
   * 当场景被切换到前台时调用
   */
  public onEnter?(): void | Promise<void>;

  /**
   * 场景退出时的钩子函数（可选）
   * 当场景被切换到后台时调用
   */
  public onExit?(): void;
}

/**
 * 场景管理器类
 * 负责管理游戏场景的切换、过渡动画和生命周期
 */
export class SceneManager {
  /**
   * 当前激活的场景
   * @private
   */
  private currentScene: Scene | null = null;

  /**
   * 下一个要切换到的场景
   * @private
   */
  private nextScene: Scene | null = null;

  /**
   * 游戏实例的引用
   * @private
   */
  private readonly game: Game;

  /**
   * 当前过渡动画的时间进度
   * @private
   */
  private transitionTime = 0;

  /**
   * 过渡动画的总持续时间（秒）
   * @private
   */
  private transitionDuration = 0.5;

  /**
   * 是否正在进行场景过渡
   * @private
   */
  private isTransitioning = false;

  /**
   * 构造函数
   * @param game 游戏实例
   */
  constructor(game: Game) {
    this.game = game;
  }

  /**
 * 获取当前激活的场景
 * @returns 当前场景实例，如果没有则返回null
 */
  public getCurrentScene(): Scene | null {
    return this.currentScene;
  }

  /** 过渡期间需要完整清屏，因此主循环需要读取这个状态。 */
  public isSceneTransitioning(): boolean {
    return this.isTransitioning;
  }

  /**
   * 切换到新场景
   * @param scene 目标场景
   * @param duration 过渡动画持续时间（秒），默认为0.5秒
   */
  public changeScene(scene: Scene, duration = 0.5): void {
    if (this.isTransitioning || scene === this.currentScene) return;
    scene._setGame(this.game);
    if (!this.currentScene || duration <= 0) {
      const previous = this.currentScene;
      this.currentScene = scene;
      this.nextScene = null;
      this.isTransitioning = false;
      previous?.onExit?.();
      scene.onEnter?.();
      return;
    }
    this.nextScene = scene;
    this.transitionDuration = duration;
    this.transitionTime = 0;
    this.isTransitioning = true;
  }

  /**
   * 更新场景管理器和场景状态
   * @param delta 时间增量（秒）
   * @param input 输入系统实例
   */
  public update(delta: number, input: Input): void {
    // 处理场景过渡
    if (this.isTransitioning && this.currentScene && this.nextScene) {
      this.transitionTime += delta;

      // 检查过渡是否完成
      if (this.transitionTime >= this.transitionDuration) {
        const previous = this.currentScene;
        this.currentScene = this.nextScene;
        this.nextScene = null;
        this.isTransitioning = false;
        previous.onExit?.();
        this.currentScene.onEnter?.();
      }
    }

    // 更新当前场景
    this.currentScene?.update(delta, input);

  }

  /**
   * 绘制场景内容
   * @param ctx Canvas 2D渲染上下文
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    this.currentScene?.draw(ctx);
    if (this.isTransitioning && this.nextScene) {
      ctx.globalAlpha *= Math.min(1, this.transitionTime / this.transitionDuration);
      this.nextScene.draw(ctx);
    }
    ctx.restore();
  }
}
