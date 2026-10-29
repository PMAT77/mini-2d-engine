/**
 * 战争迷雾：以角色为中心的圆形柔边遮罩。
 *
 * 地形始终可见，遮罩只用来隐藏「游戏单位」——掉落物、拾取物、投射物、粒子
 * 以及以后的敌人。遮罩本身完全透明，后续可以整体替换成风格化迷雾后处理。
 */
export interface VisionState {
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly range: number;
}

export class VisibilitySystem {
  private canvas?: HTMLCanvasElement;

  initialize(width: number, height: number): void {
    this.canvas ??= document.createElement('canvas');
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** 供调试面板或测试读取遮罩。 */
  getCanvas(): HTMLCanvasElement | undefined { return this.canvas; }

  /**
   * 在相机空间重建圆形遮罩；相机坐标与每次绘制使用的偏移一致。
   * @param feather 外缘柔和过渡宽度（世界像素）
   */
  prepare(cameraX: number, cameraY: number, x: number, y: number, range: number, feather = range * 0.3): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const mask = canvas.getContext('2d')!;
    mask.setTransform(1, 0, 0, 1, 0, 0);
    mask.globalCompositeOperation = 'source-over';
    mask.clearRect(0, 0, canvas.width, canvas.height);
    if (!Number.isFinite(range) || range <= 0) return;
    const cx = x - cameraX, cy = y - cameraY;
    const inner = Math.max(0, range - Math.max(0, feather));
    const gradient = mask.createRadialGradient(cx, cy, inner, cx, cy, range);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    mask.fillStyle = gradient;
    mask.fillRect(0, 0, canvas.width, canvas.height);
  }

  /** 保留遮罩内的像素；目标画布必须与遮罩同尺寸。 */
  apply(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }
}
