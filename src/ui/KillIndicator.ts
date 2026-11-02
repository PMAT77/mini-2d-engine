import { COMBO_WINDOW_SECONDS } from '../combat/CombatScoreSystem';
import type { CombatScoreSnapshot, KillFeedback, KillQuality } from '../combat/CombatScoreSystem';
import type { Rect } from './HudTypes';

const IMAGE_URL = '/assets/images/ui/crosshair/kill-icon-02.png';
const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';

/** 徽章与连杀共用安全区域，优先保持尺寸，再避让已有 HUD；坐标为逻辑像素。 */
export function getKillIndicatorLayout(width: number, height: number, reserved: readonly Rect[] = []) {
  const maxScale = Math.max(0, Math.min(1, (width - 24) / 240, height / 600));
  for (let step = 0; step < 8; step++) {
    const scale = maxScale * .85 ** step, w = 240 * scale, h = 148 * scale;
    const targetX = (width - w) / 2, targetY = Math.max(12, Math.min(height / 2 + 104 - 40 * scale, height - 12 - h));
    const xs = [targetX, 12, width - 12 - w], ys = [targetY, 12, height - 12 - h];
    for (const a of reserved) { xs.push(a.x - 12 - w, a.x + a.width + 12); ys.push(a.y - 12 - h, a.y + a.height + 12); }
    let best: { x: number; y: number; distance: number } | null = null;
    for (const x of xs) for (const y of ys) {
      if (x < 12 || y < 12 || x + w > width - 12 + 1e-8 || y + h > height - 12 + 1e-8) continue;
      if (reserved.some(a => x < a.x + a.width + 12 - 1e-8 && x + w > a.x - 12 + 1e-8 &&
        y < a.y + a.height + 12 - 1e-8 && y + h > a.y - 12 + 1e-8)) continue;
      const distance = (x - targetX) ** 2 * 1.5 + (y - targetY) ** 2;
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    if (best) return { x: best.x, y: best.y, width: w, height: h, scale };
  }
  const scale = maxScale * .25;
  return { x: (width - 240 * scale) / 2, y: 12, width: 240 * scale, height: 148 * scale, scale };
}

/** 屏幕层击杀确认；只消费致命命中，计时跟随游戏暂停。 */
export class KillIndicator {
  private image: HTMLImageElement | null = null;
  private age = Infinity;
  private chainAge = Infinity;
  private feedback: Readonly<KillFeedback> | null = null;
  private sprites: Partial<Record<KillQuality, HTMLCanvasElement>> = {};
  private sweepFrames: HTMLCanvasElement[] = [];

  private get duration(): number { return this.feedback?.quality === 'gold' ? 1.1 : .8; }

  preload(): void {
    if (this.image || typeof Image === 'undefined') return;
    this.image = new Image();
    this.image.onload = () => this.cacheSprites();
    this.image.src = IMAGE_URL;
  }

  show(feedback?: Readonly<KillFeedback>): void {
    // 中性提示不能顶掉尚未结束的评价，也不修改连杀的动画。
    if (!feedback && this.feedback && this.age < this.duration) return;
    this.feedback = feedback ?? null;
    this.age = 0;
    if (feedback) this.chainAge = 0;
    this.preload();
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.age = Math.min(this.duration, this.age + delta);
    this.chainAge = Math.min(1, this.chainAge + delta);
  }

  clear(): void { this.age = this.chainAge = Infinity; this.feedback = null; }

  /** 只在图片加载完成时生成材质和扫光帧；不在逐帧绘制中创建画布。 */
  private cacheSprites(): void {
    if (!this.image?.naturalWidth || typeof document === 'undefined') return;
    const make = (paint: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(this.image!, 0, 0, 128, 128); ctx.globalCompositeOperation = 'source-in';
      paint(ctx); return canvas;
    };
    for (const quality of ['silver', 'gold'] as const) {
      const canvas = make(ctx => {
        const gradient = ctx.createLinearGradient(0, 0, 35, 128);
        const colors = quality === 'gold' ? ['#fff1ad', '#ffd36a', '#b47a21'] : ['#f2f6fc', '#bcc8d6', '#7c8a9a'];
        colors.forEach((color, i) => gradient.addColorStop(i / 2, color));
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
      });
      if (canvas) this.sprites[quality] = canvas;
    }
    this.sweepFrames = [];
    for (let i = 0; i < 12; i++) {
      const canvas = make(ctx => {
        const x = -70 + i * 25, gradient = ctx.createLinearGradient(x - 24, 0, x + 24, 45);
        gradient.addColorStop(0, 'rgba(255,255,235,0)'); gradient.addColorStop(.5, 'rgba(255,255,235,.9)');
        gradient.addColorStop(1, 'rgba(255,255,235,0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
      });
      if (canvas) this.sweepFrames.push(canvas);
    }
  }

  /** 调用方已应用 DPR；图标不受世界缩放、光照或相机震动影响。 */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, score?: Readonly<CombatScoreSnapshot>, reserved: readonly Rect[] = []): void {
    const image = this.image;
    const ready = image?.complete && image.naturalWidth;
    const visible = this.age < this.duration;
    const chain = score && score.chainCount > 0;
    if (!visible && !chain) return;
    const layout = getKillIndicatorLayout(width, height, reserved);
    // 中性提示保留原接口与轮廓；未加载的图片安全跳过。
    if (!this.feedback && !chain) {
      if (!visible || !ready) return;
      const size = 56 * layout.scale * (1 + .18 * Math.max(0, 1 - this.age / .12) ** 2);
      ctx.save(); ctx.globalAlpha *= Math.min(1, (.8 - this.age) / .45);
      ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 5;
      ctx.drawImage(image, layout.x + layout.width / 2 - size / 2, layout.y + 40 * layout.scale - size / 2, size, size);
      ctx.restore(); return;
    }
    ctx.save();
    ctx.translate(layout.x + layout.width / 2, layout.y + 40 * layout.scale); ctx.scale(layout.scale, layout.scale);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 5;
    if (visible) {
      ctx.save(); ctx.globalAlpha *= Math.min(1, (this.duration - this.age) / (this.feedback?.quality === 'gold' ? .35 : .45));
      const gold = this.feedback?.quality === 'gold', color = gold ? '#ffe09b' : '#dae5ee';
      const t = Math.min(1, this.age / (gold ? .16 : .12));
      const pop = gold ? (t < .7 ? 1.25 - .29 * t / .7 : .96 + .04 * (t - .7) / .3) : 1 + .15 * (1 - t) ** 2;
      const size = (gold ? 60 : 56) * pop;
      if (this.feedback && this.age < .3) {
        ctx.save(); ctx.globalAlpha *= 1 - this.age / .3;
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 31 + this.age * 20, -.85, Math.PI * 1.6); ctx.stroke();
        if (gold) for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + .2, r = 33 + this.age * (10 + i % 3 * 3);
          ctx.fillStyle = color; ctx.fillRect(Math.cos(a) * r - 1, Math.sin(a) * r - 1, 2, 2);
        }
        ctx.restore();
      }
      if (ready) {
        ctx.drawImage((this.feedback && this.sprites[this.feedback.quality]) || image, -size / 2, -size / 2, size, size);
        const sweep = (this.age - .06) / .28;
        if (gold && sweep >= 0 && sweep < 1 && this.sweepFrames.length)
          ctx.drawImage(this.sweepFrames[Math.floor(sweep * this.sweepFrames.length)], -size / 2, -size / 2, size, size);
      }
      if (this.feedback) {
        ctx.fillStyle = color; ctx.font = `600 13px ${FONT}`;
        ctx.fillText(gold ? '黄金击杀 · 爆头' : '白银击杀', 0, 45);
        ctx.fillStyle = '#f4f7f8'; ctx.font = `700 19px ${FONT}`;
        ctx.fillText(`+${this.feedback.points}`, 0, 66);
      }
      ctx.restore();
    }
    if (chain) {
      const pulse = 1 + .14 * Math.max(0, 1 - this.chainAge / .12);
      ctx.save(); ctx.translate(0, 91); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#e2edf2'; ctx.font = `600 13px ${FONT}`;
      if (score.chainCount >= 2) ctx.fillText(`${score.chainCount} 连杀 · ×${score.multiplier}`, 0, 0);
      if ([3, 5, 10].includes(score.chainCount) && this.chainAge < .24) {
        ctx.globalAlpha *= 1 - this.chainAge / .24; ctx.strokeStyle = '#e2edf2'; ctx.lineWidth = 1;
        ctx.strokeRect(-66, -11, 132, 22);
      }
      ctx.restore(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(200,220,230,.2)'; ctx.fillRect(-48, 103, 96, 2);
      ctx.fillStyle = '#d4e3ec'; ctx.fillRect(-48, 103, 96 * score.chainRemaining / COMBO_WINDOW_SECONDS, 2);
    }
    ctx.restore();
  }
}
