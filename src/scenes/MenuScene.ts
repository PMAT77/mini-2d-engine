import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
import { GameScene } from "./GameScene";

/**
 * 游戏主菜单场景类
 * 负责显示游戏启动界面，处理玩家进入游戏的输入事件
 * 继承自基础Scene类
 */
export class MenuScene extends Scene {
  /**
   * 更新场景逻辑
   * @param delta 时间增量，以秒为单位
   * @param input 输入系统实例，用于检测玩家输入
   */
  public update(delta: number, input: Input): void {
    // 检测玩家是否按下Enter键，如果是则切换到游戏场景
    if (input.isKeyDown("Enter")) {
      this.game.sceneManager.changeScene(new GameScene());
    }
  }

  /**
   * 渲染场景内容
   * @param ctx Canvas 2D渲染上下文，用于绘制场景元素
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    // 设置背景颜色并填充整个画布
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 设置文字样式并居中显示提示信息
    ctx.fillStyle = "white";
    ctx.font = "32px sans-serif";
    const text = "按 Enter 启动游戏";
    // 计算文本居中位置
    const x = ctx.canvas.width / 2 - ctx.measureText(text).width / 2;
    const y = ctx.canvas.height - 160; // 距离底部160像素的位置
    ctx.fillText(text, x, y);
  }
}