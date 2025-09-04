import { LightSource } from "./LightSource";

/**
 * 光照系统类，负责管理所有光源和处理光照效果
 */
export class LightingSystem {
  private lightSources: LightSource[] = [];
  private ambientLight: string = "rgba(0, 0, 0, 0.8)"; // 降低环境光亮度
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private initialized: boolean = false;

  /**
   * 初始化光照系统
   * @param width 画布宽度
   * @param height 画布高度
   */
  initialize(width: number, height: number): void {
    // 创建阴影画布用于绘制光照遮罩
    this.shadowCanvas = document.createElement('canvas');
    this.shadowCanvas.width = width;
    this.shadowCanvas.height = height;
    this.shadowCtx = this.shadowCanvas.getContext('2d');
    this.initialized = !!this.shadowCtx;
  }

  /**
   * 添加光源
   * @param lightSource 光源实例
   */
  addLightSource(lightSource: LightSource): void {
    this.lightSources.push(lightSource);
  }

  /**
   * 移除光源
   * @param lightSource 要移除的光源实例
   */
  removeLightSource(lightSource: LightSource): void {
    const index = this.lightSources.indexOf(lightSource);
    if (index !== -1) {
      this.lightSources.splice(index, 1);
    }
  }

  /**
   * 清除所有光源
   */
  clearAllLights(): void {
    this.lightSources = [];
  }

  /**
   * 设置环境光
   * @param color 环境光颜色（带透明度）
   */
  setAmbientLight(color: string): void {
    this.ambientLight = color;
  }

  /**
   * 更新所有光源
   * @param delta 时间增量
   */
  update(delta: number): void {
    for (const light of this.lightSources) {
      light.update(delta);
    }
  }

  /**
   * 准备光照遮罩
   * @param cameraX 相机X坐标
   * @param cameraY 相机Y坐标
   * @param screenWidth 屏幕宽度
   * @param screenHeight 屏幕高度
   * @param dpr 设备像素比
   */
  /**
  * 准备光照遮罩
  */
  prepareLightingMask(
    cameraX: number,
    cameraY: number,
  ): void {
    if (!this.initialized || !this.shadowCtx || !this.shadowCanvas) {
      return;
    }

    const ctx = this.shadowCtx;

    // 清空阴影画布，使用环境光作为基础
    ctx.fillStyle = this.ambientLight;
    ctx.fillRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);

    // 绘制每个光源
    for (const light of this.lightSources) {
      if (!light.isLightActive()) continue;

      const pos = light.getPosition();
      const radius = light.getRadius();
      const color = light.getColor();
      const intensity = light.getIntensity();

      // 计算光源在屏幕上的位置（只考虑相机偏移，不再乘以DPR）
      const screenX = pos.x - cameraX;
      const screenY = pos.y - cameraY;
      const screenRadius = radius;

      // 创建径向渐变和绘制光源的代码保持不变
      const gradient = ctx.createRadialGradient(
        screenX, screenY,
        0,
        screenX, screenY,
        screenRadius
      );

      // 设置渐变颜色，增强光照效果
      const colorRgb = this.hexToRgb(color) || { r: 255, g: 255, b: 255 };
      gradient.addColorStop(0, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, ${intensity})`);
      gradient.addColorStop(0.5, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, ${intensity * 0.5})`);
      gradient.addColorStop(1, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0)`);

      // 绘制光源
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gradient;
      ctx.fillRect(
        screenX - screenRadius,
        screenY - screenRadius,
        screenRadius * 2,
        screenRadius * 2
      );
    }

    // 恢复默认合成模式
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * 将光照效果应用到主画布
   * @param mainCtx 主画布上下文
   */
  applyLighting(mainCtx: CanvasRenderingContext2D): void {
    if (!this.initialized || !this.shadowCanvas) {
      return;
    }

    // 使用multiply混合模式将光照遮罩应用到主画布
    mainCtx.globalCompositeOperation = 'multiply';
    mainCtx.drawImage(this.shadowCanvas, 0, 0);

    // 恢复默认混合模式
    mainCtx.globalCompositeOperation = 'source-over';
  }

  /**
   * 获取光照系统中光源的数量
   */
  getLightCount(): number {
    return this.lightSources.length;
  }

  /**
   * 将十六进制颜色转换为RGB
   * @param hex 十六进制颜色字符串
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }
}