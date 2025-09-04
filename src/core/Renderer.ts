/**
 * 渲染器类
 * 负责管理Canvas渲染上下文、处理窗口大小调整和基本绘制操作
 */
export class Renderer {
  /**
   * Canvas 2D渲染上下文
   */
  public ctx: CanvasRenderingContext2D;

  /**
   * Canvas的实际像素宽度（考虑设备像素比）
   */
  public width!: number;

  /**
   * Canvas的实际像素高度（考虑设备像素比）
   */
  public height!: number;

  /**
   * 构造函数
   * @param canvas HTML Canvas元素
   */
  constructor(private canvas: HTMLCanvasElement) {
    // 获取Canvas 2D渲染上下文
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法获取Canvas 2D渲染上下文");
    }
    this.ctx = context;

    // 初始化尺寸并设置窗口大小调整监听器
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * 调整Canvas大小以适应窗口
   * 处理高DPI显示器的像素比例问题
   */
  public resize(): void {
    // 获取设备像素比，默认为1
    const dpr = window.devicePixelRatio || 1;

    // 获取窗口的CSS像素尺寸
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;

    // 设置Canvas的实际像素尺寸（考虑设备像素比）
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;

    // 设置Canvas的CSS样式尺寸
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // 重置变换矩阵，保持坐标系与CSS像素一致
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 保存实际像素尺寸
    // this.width = cssWidth * dpr;
    // this.height = cssHeight * dpr;
  }

  /**
   * 清空画布
   * @param color 清空画布的颜色，默认为黑色
   */
  public clear(color: string = "black"): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * 在右上角绘制FPS信息
   * @param fps 当前帧数
   */
  public drawFPS(fps: number): void {
    // 保存当前渲染状态
    this.ctx.save();

    // 计算实际像素位置（考虑设备像素比）
    const dpr = window.devicePixelRatio || 1;

    // 设置字体和样式
    this.ctx.font = `${14 * dpr}px Arial`;
    this.ctx.fillStyle = "white";
    this.ctx.strokeStyle = "black";
    this.ctx.lineWidth = 2 * dpr;

    // 计算文本位置（右上角，留出边距）
    const margin = 10 * dpr;
    const text = `FPS: ${fps}`;
    const textMetrics = this.ctx.measureText(text);
    const x = this.width - textMetrics.width - margin;
    const y = 14 * dpr + margin;

    // 绘制文本描边和填充
    this.ctx.strokeText(text, x, y);
    this.ctx.fillText(text, x, y);

    // 恢复渲染状态
    this.ctx.restore();
  }
}