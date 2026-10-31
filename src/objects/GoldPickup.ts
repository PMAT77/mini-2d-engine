import { GameObject } from "../core/GameObject";
import { GOLD_FRAGMENT_SIZE } from "../map/TileType";
import { Collider, Point, collide, rectangleCollider } from "../physics/Collider";
import { GOLD_PICKUP_CONFIG, type PickupConfig } from "../interaction/PickupTypes";

/** 黄金碎块沿安全路径散落，落地后一直保留，直到被玩家拾取。 */
export class GoldPickup extends GameObject {
  static readonly SIZE = GOLD_FRAGMENT_SIZE;
  static readonly SCATTER_DURATION = 0.45;
  /** 拾取配置：保持碰撞自动拾取，只额外提供金色发现点。 */
  readonly pickupConfig: Readonly<PickupConfig> = GOLD_PICKUP_CONFIG;

  private age = 0;
  private glowPhase = Math.random() * Math.PI * 2;

  constructor(private startX: number, private startY: number, private targetX: number, private targetY: number) {
    super(startX, startY);
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    this.age += delta;
    const t = Math.min(1, this.age / GoldPickup.SCATTER_DURATION);
    const progress = 1 - (1 - t) ** 3;
    this.x = this.startX + (this.targetX - this.startX) * progress;
    this.y = this.startY + (this.targetY - this.startY) * progress;
  }

  getCollider(): Collider {
    return rectangleCollider(this.x, this.y, GoldPickup.SIZE, GoldPickup.SIZE);
  }

  isCollidingWithShape(body: Collider): boolean {
    return this.age >= GoldPickup.SCATTER_DURATION && collide(body, this.getCollider()).length > 0;
  }

  draw(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    const size = GoldPickup.SIZE;
    const t = Math.min(1, this.age / GoldPickup.SCATTER_DURATION);
    const lift = Math.sin(t * Math.PI) * 18;
    const x = this.x - offsetX, groundY = this.y - offsetY;
    ctx.save();
    ctx.fillStyle = "#a96b12";
    ctx.fillRect(x, groundY - lift, size, size);
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(x + 1, groundY - lift + 1, size - 2, size - 2);
    ctx.fillStyle = "#c78b20";
    ctx.fillRect(x + size - 2, groundY - lift + 2, 2, size - 2);
    ctx.fillStyle = "#fff1a3";
    ctx.fillRect(x + 1, groundY - lift + 1, size - 3, 2);
    ctx.restore();
  }

  /** 所有金块先画光晕，再统一绘制短投影，避免相邻光晕填平阴影。 */
  drawGlow(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0, visibility = 1): void {
    const x = this.x - offsetX + GoldPickup.SIZE / 2;
    const groundY = this.y - offsetY + GoldPickup.SIZE / 2;
    if (x < -32 || groundY < -32 || x > ctx.canvas.width + 32 || groundY > ctx.canvas.height + 32) return;
    const t = Math.min(1, this.age / GoldPickup.SCATTER_DURATION);
    const y = groundY - Math.sin(t * Math.PI) * 18;
    const pulse = 0.7 + Math.sin(this.age * 3 + this.glowPhase) * 0.3;
    const fade = Math.max(0, Math.min(1, visibility));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const sprite = GoldPickup.glowSprite();
    if (sprite) {
      // The baked halo carries the exact falloff; the pulse only scales its alpha, so the
      // per-gold radial gradient object (and its allocations) disappear from the frame.
      ctx.globalAlpha = pulse * fade;
      ctx.drawImage(sprite, x - 15, y - 15, 30, 30);
    } else {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 15);
      glow.addColorStop(0, `rgba(255, 205, 70, ${0.24 * pulse * fade})`);
      glow.addColorStop(0.4, `rgba(255, 175, 35, ${0.1 * pulse * fade})`);
      glow.addColorStop(1, "rgba(255, 150, 20, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 15, y - 15, 30, 30);
    }
    ctx.restore();
  }

  private static glow: HTMLCanvasElement | null | undefined;

  private static glowSprite(): HTMLCanvasElement | null {
    if (GoldPickup.glow !== undefined) return GoldPickup.glow;
    if (typeof document === "undefined") return (GoldPickup.glow = null);
    const size = 60;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return (GoldPickup.glow = null);
    const center = size / 2, radius = size / 2;
    const glow = ctx.createRadialGradient(center, center, 0, center, center, radius);
    glow.addColorStop(0, "rgba(255, 205, 70, 0.24)");
    glow.addColorStop(0.4, "rgba(255, 175, 35, 0.1)");
    glow.addColorStop(1, "rgba(255, 150, 20, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    return (GoldPickup.glow = canvas);
  }

  drawShadow(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0, light?: Point): void {
    const x = this.x - offsetX + GoldPickup.SIZE / 2;
    const groundY = this.y - offsetY + GoldPickup.SIZE / 2;
    if (x < -32 || groundY < -32 || x > ctx.canvas.width + 32 || groundY > ctx.canvas.height + 32) return;
    const t = Math.min(1, this.age / GoldPickup.SCATTER_DURATION);
    const y = groundY - Math.sin(t * Math.PI) * 18;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    // 投影只作用于地面，避免覆盖已经绘制的金块主体（含弹跳高度）。
    ctx.beginPath();
    ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.rect(x - GoldPickup.SIZE / 2, y - GoldPickup.SIZE / 2, GoldPickup.SIZE, GoldPickup.SIZE);
    ctx.clip("evenodd");
    const dx = light ? this.x + GoldPickup.SIZE / 2 - light.x : 1;
    const dy = light ? this.y + GoldPickup.SIZE / 2 - light.y : 1;
    ctx.translate(x, groundY);
    ctx.rotate(Math.atan2(dy, dx));
    const reach = GoldPickup.SIZE / 2 + 8 + (groundY - y) * 0.1;
    const shade = ctx.createLinearGradient(0, 0, reach, 0);
    shade.addColorStop(0, "rgba(0, 0, 0, 0.98)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = shade;
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 1;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(reach, -3);
    ctx.lineTo(reach, 3);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 每块固定三个循环光点，不累积粒子或新增场景光源。 */
  drawSparkles(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0, visibility = 1): void {
    const x = this.x - offsetX + GoldPickup.SIZE / 2;
    const groundY = this.y - offsetY + GoldPickup.SIZE / 2;
    if (x < -32 || groundY < -32 || x > ctx.canvas.width + 32 || groundY > ctx.canvas.height + 32) return;
    const t = Math.min(1, this.age / GoldPickup.SCATTER_DURATION);
    const y = groundY - Math.sin(t * Math.PI) * 18;
    const fade = Math.max(0, Math.min(1, visibility));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const progress = (this.age * 0.65 + this.glowPhase / (Math.PI * 2) + i / 3) % 1;
      const angle = this.glowPhase + i * 2.4;
      const px = x + Math.cos(angle + progress * 1.5) * (6 + i * 2);
      const py = y + Math.sin(angle) * 4 - progress * 16;
      ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.8 * fade;
      ctx.fillStyle = "#ffe9a0";
      ctx.fillRect(px - 1, py - 1, 2, 2);
      if (i === 0) {
        ctx.fillRect(px - 3, py - 0.5, 6, 1);
        ctx.fillRect(px - 0.5, py - 3, 1, 6);
      }
    }
    ctx.restore();
  }
}
