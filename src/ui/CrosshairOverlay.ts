/** 准星素材：左右大括弧 + 中心点，运行时按三段裁切。 */
const IMAGE_URL = '/assets/images/ui/crosshair/crosshair-08.png';
const SOURCE_SIZE = 256;
/** 素材整体显示边长（CSS px）：所有几何都按它等比缩放。 */
const DISPLAY_SIZE = 36;
/** 画布边长：容纳左右括弧最大外扩后的包围盒（最远约 57 px < 64 px）。 */
const CANVAS_SIZE = 64;
const IDLE_COLOR = '#d8faff';
const TARGET_COLOR = '#ff3b30';
/** body 上的标记类：对局内隐藏系统指针（见 index.html），只留准星。 */
const HIDE_CURSOR_CLASS = 'crosshair-active';

/** 源图中的左右括弧与中心点。裁剪框留出透明边距，缩放时不会裁掉描边。 */
interface PieceRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 扩散方向：1 沿坐标轴正方向、-1 沿负方向；中心点为 0。 */
  readonly spreadX: -1 | 0 | 1;
  readonly spreadY: -1 | 0 | 1;
}

const BRACKETS: readonly PieceRegion[] = [
  { x: 0, y: 0, width: 80, height: 256, spreadX: -1, spreadY: 0 },
  { x: 176, y: 0, width: 80, height: 256, spreadX: 1, spreadY: 0 },
];

const DOT_PIECE: PieceRegion = { x: 96, y: 96, width: 64, height: 64, spreadX: 0, spreadY: 0 };

/** 括弧相对素材原始位置的偏移上限（CSS px）：后坐力 1.0 外扩、完全瞄准内收。 */
export const CROSSHAIR_SPREAD = { outward: 7, inward: 4 } as const;

/**
 * 准星偏移：正数向外扩散，负数向内收缩。
 *
 * 静止为 0，括弧保持在素材里的原始间距；夹住非法输入，避免画布出现 NaN 坐标。
 */
export function getCrosshairOffset(recoil: number, tighten: number): number {
  const r = Number.isFinite(recoil) ? Math.min(1, Math.max(0, recoil)) : 0;
  const t = Number.isFinite(tighten) ? Math.min(1, Math.max(0, tighten)) : 0;
  return r * CROSSHAIR_SPREAD.outward - t * CROSSHAIR_SPREAD.inward;
}

/** 把白色素材按颜色做乘法染色，保留 alpha 与深色描边。 */
function tint(source: CanvasImageSource, color: string): CanvasImageSource {
  const canvas = document.createElement('canvas');
  canvas.width = SOURCE_SIZE;
  canvas.height = SOURCE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  try {
    const image = ctx.getImageData(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    const data = image.data;
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round((data[i] * red) / 255);
      data[i + 1] = Math.round((data[i + 1] * green) / 255);
      data[i + 2] = Math.round((data[i + 2] * blue) / 255);
    }
    ctx.putImageData(image, 0, 0);
  } catch {
    // 跨域图片读不到像素时保留白色原图：准星仍可用，只是目标态不变红。
  }
  return canvas;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  piece: PieceRegion,
  origin: number,
  shiftX: number,
  shiftY: number,
  scale: number,
): void {
  ctx.drawImage(
    source,
    piece.x, piece.y, piece.width, piece.height,
    origin + piece.x * scale + shiftX,
    origin + piece.y * scale + shiftY,
    piece.width * scale,
    piece.height * scale,
  );
}

/** 存活的准星图层数：场景切换时新旧图层可能短暂并存，最后一个销毁才恢复指针。 */
let activeLayers = 0;

function retainHiddenCursor(): void {
  activeLayers += 1;
  document.body.classList.add(HIDE_CURSOR_CLASS);
}

function releaseHiddenCursor(): void {
  activeLayers = Math.max(0, activeLayers - 1);
  if (activeLayers === 0) document.body.classList.remove(HIDE_CURSOR_CLASS);
}

/**
 * 准星独立图层。
 *
 * 位置在 pointermove 里同步写进 transform，交给合成器搬运已有图层，
 * 不再等待下一帧世界渲染；世界帧再慢，准星也只跟随指针。
 *
 * 外观来自 crosshair-08.png：素材按左括弧／中心点／右括弧三段裁进一张
 * 小画布，左右两段只做水平平移，所以扩散/收缩不会拉伸线宽，中心点也始终不动。
 * 偏移由场景按帧计算（后坐力外扩、瞄准内收），图片与染色只准备一次。
 */
export class CrosshairOverlay {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private image: HTMLImageElement | null = null;
  private idleSprite: CanvasImageSource | null = null;
  private targetSprite: CanvasImageSource | null = null;
  private imageState: 'loading' | 'loaded' | 'fallback' = 'loading';
  private x = Number.NaN;
  private y = Number.NaN;
  private offset = Number.NaN;
  private target = false;
  private visible = false;
  private disposed = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.dataset.crosshair = 'root';
    this.root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;'
      + 'pointer-events:none;z-index:5;display:none;will-change:transform;';
    this.root.dataset.crosshairOffset = '0.0';
    this.root.dataset.crosshairTarget = '0';
    this.root.dataset.crosshairImage = 'loading';
    this.canvas = document.createElement('canvas');
    this.canvas.dataset.crosshair = 'canvas';
    // index.html 给所有 canvas 加了白底和 2px 边框；准星图层必须显式覆盖掉。
    this.canvas.style.cssText = `position:absolute;left:${-CANVAS_SIZE / 2}px;top:${-CANVAS_SIZE / 2}px;`
      + `width:${CANVAS_SIZE}px;height:${CANVAS_SIZE}px;pointer-events:none;`
      + 'background:transparent;border:0;';
    this.ctx = this.canvas.getContext('2d');
    this.root.appendChild(this.canvas);
    document.body.appendChild(this.root);
    // 指针只在准星图层存在期间隐藏：回到菜单或场景退出时系统指针自动恢复。
    retainHiddenCursor();
    this.load();
  }

  /** 指针位置（client 坐标）。对齐设备像素，细线不会被合成器重采样糊掉。 */
  setPosition(clientX: number, clientY: number): void {
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(clientX * dpr) / dpr;
    const y = Math.round(clientY * dpr) / dpr;
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.root.style.transform = `translate3d(${x}px,${y}px,0)`;
    this.setVisible(true);
  }

  /**
   * offset：左右括弧相对素材原始位置的偏移，正数外扩、负数内收；
   * target：中心是否压在活鸡上（只让括弧变红，中心点保持浅青）。
   */
  setAppearance(offset: number, target: boolean): void {
    const next = Math.round(offset * 10) / 10;
    if (next === this.offset && target === this.target) return;
    this.offset = next;
    this.target = target;
    this.root.dataset.crosshairOffset = next.toFixed(1);
    this.root.dataset.crosshairTarget = target ? '1' : '0';
    this.draw();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    this.disposed = true;
    if (this.image) {
      this.image.onload = null;
      this.image.onerror = null;
    }
    this.root.remove();
    releaseHiddenCursor();
  }

  private load(): void {
    const image = new Image();
    this.image = image;
    image.onload = () => {
      if (this.disposed) return;
      this.idleSprite = tint(image, IDLE_COLOR);
      this.targetSprite = tint(image, TARGET_COLOR);
      this.imageState = 'loaded';
      this.root.dataset.crosshairImage = 'loaded';
      this.draw();
    };
    image.onerror = () => {
      if (this.disposed) return;
      this.imageState = 'fallback';
      this.root.dataset.crosshairImage = 'fallback';
      console.warn(`[crosshair] 无法加载准星素材：${IMAGE_URL}`);
      this.draw();
    };
    image.src = IMAGE_URL;
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.max(1, Math.round(CANVAS_SIZE * dpr));
    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const idle = this.idleSprite;
    if (this.imageState !== 'loaded' || !idle) {
      this.drawFallbackDot(ctx);
      return;
    }
    const scale = DISPLAY_SIZE / SOURCE_SIZE;
    const origin = (CANVAS_SIZE - DISPLAY_SIZE) / 2;
    const brackets = this.target && this.targetSprite ? this.targetSprite : idle;
    const offset = Number.isFinite(this.offset) ? this.offset : 0;
    for (const piece of BRACKETS) {
      drawPiece(ctx, brackets, piece, origin, piece.spreadX * offset, piece.spreadY * offset, scale);
    }
    drawPiece(ctx, idle, DOT_PIECE, origin, 0, 0, scale);
  }

  /** 素材加载完成前后的兜底点：保证准星不会整层消失。 */
  private drawFallbackDot(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = IDLE_COLOR;
    ctx.fill();
  }
}
