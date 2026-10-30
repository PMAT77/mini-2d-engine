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
  /** 上一帧实际绘制的区域：只清掉它，避免整屏清除。 */
  private dirtyX = 0;
  private dirtyY = 0;
  private dirtyWidth = 0;
  private dirtyHeight = 0;

  initialize(width: number, height: number): void {
    this.canvas ??= document.createElement('canvas');
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.dirtyWidth = 0;
    this.dirtyHeight = 0;
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
    if (this.dirtyWidth > 0) mask.clearRect(this.dirtyX, this.dirtyY, this.dirtyWidth, this.dirtyHeight);
    this.dirtyWidth = 0;
    this.dirtyHeight = 0;
    if (!Number.isFinite(range) || range <= 0) return;
    const cx = x - cameraX, cy = y - cameraY;
    const inner = Math.max(0, range - Math.max(0, feather));
    const gradient = mask.createRadialGradient(cx, cy, inner, cx, cy, range);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    mask.fillStyle = gradient;
    // 渐变在 range 之外本来就是全透明，只填圆的包围盒与整屏结果完全一致。
    const left = Math.max(0, Math.floor(cx - range - 1));
    const top = Math.max(0, Math.floor(cy - range - 1));
    const right = Math.min(canvas.width, Math.ceil(cx + range + 1));
    const bottom = Math.min(canvas.height, Math.ceil(cy + range + 1));
    if (right <= left || bottom <= top) return;
    const width = right - left, height = bottom - top;
    mask.fillRect(left, top, width, height);
    this.dirtyX = left;
    this.dirtyY = top;
    this.dirtyWidth = width;
    this.dirtyHeight = height;
  }

  /**
   * 保留遮罩内的像素；目标画布必须与遮罩同尺寸。
   * 传入 bounds 时只处理该像素区域（画布其余部分已由调用方保证透明），
   * 避免每帧对整张单位层做全屏 destination-in。
   */
  apply(ctx: CanvasRenderingContext2D, bounds?: { x: number; y: number; width: number; height: number }): void {
    if (!this.canvas) return;
    const mask = this.canvas;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    if (bounds) {
      const x = Math.max(0, Math.floor(bounds.x));
      const y = Math.max(0, Math.floor(bounds.y));
      const right = Math.min(mask.width, Math.ceil(bounds.x + bounds.width));
      const bottom = Math.min(mask.height, Math.ceil(bounds.y + bounds.height));
      if (right <= x || bottom <= y) { ctx.restore(); return; }
      const width = right - x, height = bottom - y;
      // destination-in 只在裁剪区域内生效，裁剪区外保持原样（此时本来就是透明的）。
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.drawImage(mask, x, y, width, height, x, y, width, height);
    } else {
      ctx.drawImage(mask, 0, 0);
    }
    ctx.restore();
  }
}
