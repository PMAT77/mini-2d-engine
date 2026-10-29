import { Input } from "../core/Input";
import { Scene } from "../core/Scene";

export type LoadTask = (onProgress: (loaded: number, total: number) => void) => Promise<void>;

export class LoadingScene extends Scene {
  private progress = 0;
  private error = "";
  private generation = 0;

  constructor(private readonly loadTask: LoadTask, private readonly targetScene: Scene) { super(); }

  public async onEnter(): Promise<void> {
    const generation = ++this.generation;
    this.progress = 0;
    this.error = "";
    try {
      await this.loadTask((loaded, total) => {
        if (generation === this.generation) this.progress = total === 0 ? 1 : Math.min(1, loaded / total);
      });
      if (generation === this.generation) this.game.sceneManager.changeScene(this.targetScene, 0);
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
    }
  }

  public onExit(): void { this.generation++; }
  public update(_delta: number, _input: Input): void {}

  public draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const width = Math.max(40, Math.min(520, ctx.canvas.width - 80));
    const x = (ctx.canvas.width - width) / 2, y = ctx.canvas.height / 2;
    ctx.fillStyle = this.error ? "#f16b67" : "white";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(this.error ? "加载失败，请刷新页面重试" : `加载资源 ${Math.floor(this.progress * 100)}%`, x, y - 30);
    ctx.fillStyle = "#333";
    ctx.fillRect(x, y, width, 8);
    ctx.fillStyle = "#79e2a0";
    ctx.fillRect(x, y, width * this.progress, 8);
    if (this.error) {
      ctx.fillStyle = "#ccc";
      ctx.font = "14px sans-serif";
      ctx.fillText(this.error, x, y + 40, width);
    }
  }
}
