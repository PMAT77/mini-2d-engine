/** 拾取提示在完全不透明的状态下停留的时间（秒），之后才开始淡出。 */
export const FLOATING_TEXT_HOLD_SECONDS = 1;
/** 淡出时长（秒）；提示总寿命是停留加淡出。 */
export const FLOATING_TEXT_FADE_SECONDS = 0.4;
/** 出生点围绕角色正上方的左右散开角度（弧度），即 ±60°。 */
export const FLOATING_TEXT_SPREAD = Math.PI / 3;
/** 出生点距角色中心的距离区间（世界像素）。 */
export const FLOATING_TEXT_MIN_RADIUS = 44;
export const FLOATING_TEXT_MAX_RADIUS = 68;
/** 倾斜角度上限（弧度），让每条提示不是一个模子印出来的。 */
export const FLOATING_TEXT_TILT = 0.07;
/** 存活期间向上飘的距离（CSS 像素）。 */
export const FLOATING_TEXT_RISE = 18;
/** 同屏提示软上限，避免连捡时无界增长。 */
export const FLOATING_TEXT_MAX_COUNT = 32;
/** 字号与字体：白字，粗一点，中文优先用系统里常见的那几款。 */
const FLOATING_TEXT_FONT = '600 16px "Microsoft YaHei", "PingFang SC", sans-serif';

/** 一条拾取提示：从角色身边随机一侧跳出来，停留一会儿再淡出。 */
interface FloatingText {
  text: string;
  /** 出生点（世界坐标）。 */
  x: number;
  y: number;
  tilt: number;
  age: number;
  alpha: number;
}

/** 供测试和调试读取的提示快照；alpha 已按当前年龄算好。 */
export interface FloatingTextView {
  text: string;
  x: number;
  y: number;
  tilt: number;
  age: number;
  alpha: number;
}

/**
 * 拾取飘字：金块、肉块入袋时在角色身边蹦出一行白字（例如 "金块+3"）。
 * 每行字随机落在角色上方的左或右侧、带一点倾斜，1 秒后淡出。
 * 纯屏幕层视觉，不参与碰撞、光照和迷雾；只负责计时与绘制。
 */
export class FloatingTextSystem {
  private texts: FloatingText[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * 在角色身边生成一条提示。
   * @param text 例如 "金块+1"
   * @param centerX 角色中心（世界坐标）
   * @param centerY 角色中心（世界坐标）
   */
  spawn(text: string, centerX: number, centerY: number): void {
    if (!text || !Number.isFinite(centerX) || !Number.isFinite(centerY)) return;

    // 以正上方为中轴随机左右散开，避免每条提示都从同一个点冒出来。
    const angle = -Math.PI / 2 + (this.random() * 2 - 1) * FLOATING_TEXT_SPREAD;
    const radius = FLOATING_TEXT_MIN_RADIUS
      + this.random() * (FLOATING_TEXT_MAX_RADIUS - FLOATING_TEXT_MIN_RADIUS);
    this.texts.push({
      text,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      tilt: (this.random() * 2 - 1) * FLOATING_TEXT_TILT,
      age: 0,
      alpha: 1,
    });
    // 连捡时保留最新的几条，最老的先离开。
    while (this.texts.length > FLOATING_TEXT_MAX_COUNT) this.texts.shift();
  }

  /** 推进计时：先保持 1 秒，再用 0.4 秒线性淡出并移除。 */
  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const total = FLOATING_TEXT_HOLD_SECONDS + FLOATING_TEXT_FADE_SECONDS;
    for (const item of this.texts) {
      item.age += delta;
      const faded = (item.age - FLOATING_TEXT_HOLD_SECONDS) / FLOATING_TEXT_FADE_SECONDS;
      item.alpha = faded <= 0 ? 1 : Math.max(0, 1 - faded);
    }
    this.texts = this.texts.filter(item => item.age < total);
  }

  /** 当前存活的提示，按出生顺序；供测试与调试读取。 */
  getTexts(): readonly FloatingTextView[] {
    return this.texts;
  }

  /**
   * 画在屏幕层：白字不随光照变暗，也不会被迷雾裁掉，始终清晰。
   * @param cameraX 相机左边缘（世界坐标，含震动）
   * @param cameraY 相机上边缘（世界坐标，含震动）
   * @param scale 屏幕 CSS 像素 / 世界像素
   */
  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, scale: number): void {
    if (!this.texts.length) return;

    ctx.save();
    ctx.font = FLOATING_TEXT_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillStyle = "#ffffff";

    const total = FLOATING_TEXT_HOLD_SECONDS + FLOATING_TEXT_FADE_SECONDS;
    for (const item of this.texts) {
      const progress = Math.min(1, item.age / total);
      // 出生后 0.16 秒里从 72% 弹到原尺寸，看起来像"跳"出来。
      const pop = Math.min(1, item.age / 0.16);
      const popScale = 0.72 + 0.28 * (1 - (1 - pop) * (1 - pop) * (1 - pop));
      const x = (item.x - cameraX) * scale;
      const y = (item.y - cameraY) * scale - FLOATING_TEXT_RISE * progress;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(item.tilt);
      ctx.scale(popScale, popScale);
      ctx.globalAlpha = item.alpha;
      // 先描边再填充，亮地形和暗地形上都看得清。
      ctx.strokeText(item.text, 0, 0);
      ctx.fillText(item.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}
