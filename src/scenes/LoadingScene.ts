import { AssetLoader, AssetMap } from "../core/AssetLoader";
import { Input } from "../core/Input";
import { Scene } from "../core/Scene";

/**
 * 加载场景类
 * 负责显示游戏资源加载过程，并在加载完成后切换到目标场景
 */
export class LoadingScene extends Scene {
  /**
   * 资源加载器实例
   * @private
   */
  private readonly loader: AssetLoader;

  /**
   * 当前加载进度（0-1之间的数值）
   * @private
   */
  private progress = 0;

  /**
   * 加载完成后要切换到的目标场景
   * @private
   */
  private readonly targetScene?: Scene;

  /**
   * 模拟加载的计数器
   * @private
   */
  private fakeLoadCount = 0;

  /**
   * 模拟加载的总资源数量
   * @private
   */
  private readonly totalFake = 20;

  /**
   * 构造函数
   * @param assets 需要加载的资源映射表
   * @param targetScene 加载完成后要切换到的目标场景
   */
  constructor(assets: AssetMap, targetScene: Scene) {
    super();
    this.loader = new AssetLoader(assets);
    this.targetScene = targetScene;
  }

  /**
   * 场景进入时的钩子函数
   * 启动资源加载过程
   */
  public async onEnter(): Promise<void> {
    try {
      // 注释掉的实际资源加载代码
      // await this.loader.load((loaded, total) => {
      //   this.progress = loaded / total;
      // });

      // 使用模拟加载
      for (let i = 0; i < this.totalFake; i++) {
        await this.fakeLoad();
        this.fakeLoadCount++;
        this.progress = this.fakeLoadCount / this.totalFake;
      }
    } catch (e) {
      console.error("资源加载异常", e);
    }

    // 加载完成后切换到目标场景
    if (this.targetScene) {
      // 注意：注释中提到的0.8秒过渡时间与实际代码中的0秒不一致
      // 根据实际代码逻辑，这里使用0秒过渡时间（即无过渡）
      this.game.sceneManager.changeScene(this.targetScene, 0);
    }
  }

  /**
   * 模拟单个资源加载过程
   * @private
   * @returns Promise<void> 加载完成时解析的Promise
   */
  private fakeLoad(): Promise<void> {
    return new Promise<void>(resolve => {
      // 随机延迟20~70毫秒，模拟不同资源的加载时间
      setTimeout(resolve, Math.random() * 50 + 20);
    });
  }

  /**
   * 更新场景状态
   * LoadingScene通常不需要复杂的逻辑更新
   * @param delta 时间增量（秒）
   * @param input 输入系统实例
   */
  public update(delta: number, input: Input): void {
    // LoadingScene 不需要复杂的逻辑更新
    // 加载进度由onEnter方法中的加载过程控制
  }

  /**
   * 绘制加载场景内容
   * @param ctx Canvas 2D渲染上下文
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    // 绘制黑色背景
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 绘制加载文本
    ctx.fillStyle = "white";
    ctx.font = "28px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `加载中... ${Math.floor(this.progress * 100)}%`,
      50,
      (ctx.canvas.height - 200)
    );

    // 绘制进度条背景
    ctx.fillStyle = "#333333";
    ctx.fillRect(50, (ctx.canvas.height - 180), (ctx.canvas.width - 100), 20);

    // 绘制进度条前景
    ctx.fillStyle = "white";
    ctx.fillRect(50, (ctx.canvas.height - 180), (ctx.canvas.width - 100) * this.progress, 20);
  }
}