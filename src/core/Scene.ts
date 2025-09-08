import { Game } from "./Game";
import { Input } from "./Input";

/**
 * 场景抽象基类
 * 所有游戏场景都应继承自此类，提供场景的基本生命周期和行为接口
 */
export abstract class Scene {
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
  public onEnter?(): void;

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

  /**
   * 切换到新场景
   * @param scene 目标场景
   * @param duration 过渡动画持续时间（秒），默认为0.5秒
   */
  public changeScene(scene: Scene, duration = 0.5): void {
    // 如果当前没有场景，直接设置新场景
    if (!this.currentScene) {
      scene._setGame(this.game);
      this.currentScene = scene;
      this.currentScene.onEnter?.();
      return;
    }

    // 设置过渡动画参数
    scene._setGame(this.game);
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
        // 调用当前场景的退出钩子
        this.currentScene.onExit?.();
        // 切换到下一个场景
        this.currentScene = this.nextScene;
        // 调用新场景的进入钩子
        this.currentScene.onEnter?.();
        // 重置过渡状态
        this.nextScene = null;
        this.isTransitioning = false;
      }
    }

    // 更新当前场景
    this.currentScene?.update(delta, input);

    // 如果正在过渡，也更新下一个场景以确保其状态正确
    this.nextScene?.update(delta, input);
  }

  /**
   * 绘制场景内容
   * @param ctx Canvas 2D渲染上下文
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    // 获取画布尺寸信息
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // 处理场景过渡绘制
    if (this.isTransitioning && this.currentScene && this.nextScene) {
      const t = this.transitionTime / this.transitionDuration;

      // 创建临时画布用于绘制淡出效果
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');

      if (!tempCtx) {
        console.error('无法创建临时画布的2D渲染上下文');
        // 降级处理：直接绘制当前场景
        this.currentScene?.draw(ctx);
        return;
      }

      // 重置变换矩阵以确保正确的绘制
      tempCtx.setTransform(1, 0, 0, 1, 0, 0);

      // 绘制当前场景到临时画布
      this.currentScene.draw(tempCtx);

      // 绘制半透明的黑色矩形，创造淡出效果
      tempCtx.save();
      tempCtx.fillStyle = `rgba(0, 0, 0, ${t})`;
      tempCtx.fillRect(0, 0, width, height);
      tempCtx.restore();

      // 绘制下一个场景到主画布（淡入）
      ctx.save();
      ctx.globalAlpha = t;
      this.nextScene.draw(ctx);
      ctx.restore();

      // 绘制临时画布（包含当前场景和淡出效果）到主画布
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
    } else {
      // 正常绘制当前场景
      this.currentScene?.draw(ctx);
    }
  }
}