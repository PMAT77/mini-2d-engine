import { Collider, circleCollider, collide } from "../physics/Collider";
import { MEAT_PICKUP_CONFIG, type PickupConfig } from "../interaction/PickupTypes";

const MEAT_LIGHT = "#F58A8A";
const MEAT_MID = "#E05A5A";
const MEAT_DARK = "#B03F3F";
const BONE = "#F4E8CC";
const BONE_SHADE = "#D8C8A6";

/**
 * 小鸡死亡后掉落的肉块。落地前只播放下落动画，落地后才可被玩家拾取；
 * 与金块一样属于单位层，受迷雾和世界光照影响。
 */
export class MeatPickup {
  static readonly SIZE = 16;
  static readonly FALL_SECONDS = 0.28;
  private static nextId = 1;

  /** 稳定 id：多个肉块距离相同时，交互目标选择结果仍然确定。 */
  readonly id = MeatPickup.nextId++;
  /** 拾取配置：按住 E 0.5 秒完成交互。 */
  readonly pickupConfig: Readonly<PickupConfig> = MEAT_PICKUP_CONFIG;

  private age = 0;
  private readonly phase = Math.random() * Math.PI * 2;
  private collected = false;

  constructor(readonly x: number, readonly y: number) {}

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    this.age += delta;
  }

  /** 下落动画结束（落地）。 */
  isReady(): boolean {
    return this.age >= MeatPickup.FALL_SECONDS;
  }

  /** 交互锚点：肉块中心（世界坐标）。 */
  getPickupAnchor(): { x: number; y: number } {
    return { x: this.x + MeatPickup.SIZE / 2, y: this.y + MeatPickup.SIZE / 2 };
  }

  /** 可以成为交互候选：已落地且尚未结算。 */
  isPickupReady(): boolean {
    return this.isReady() && !this.collected;
  }

  isCollected(): boolean {
    return this.collected;
  }

  /** 一次性结算标记：返回 false 表示这块肉已经被拾取过。 */
  markCollected(): boolean {
    if (this.collected) return false;
    this.collected = true;
    return true;
  }

  getCollider(): Collider {
    return circleCollider(this.x + MeatPickup.SIZE / 2, this.y + MeatPickup.SIZE / 2, MeatPickup.SIZE / 2);
  }

  isCollidingWithShape(body: Collider): boolean {
    return this.isReady() && collide(body, this.getCollider()).length > 0;
  }

  /** 地面投影：肉块很矮，只画脚下一小块椭圆，不向光源反方向拉长。 */
  drawShadow(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    const x = this.x + MeatPickup.SIZE / 2 - offsetX;
    const y = this.y + MeatPickup.SIZE / 2 - offsetY;
    if (x < -32 || y < -32 || x > ctx.canvas.width + 32 || y > ctx.canvas.height + 32) return;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 2, MeatPickup.SIZE * 0.44, MeatPickup.SIZE * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    const progress = Math.min(1, this.age / MeatPickup.FALL_SECONDS);
    // 从死亡位置上方落回地面，落地前不参与拾取。
    const lift = (1 - progress) * (1 - progress) * 26;
    const s = MeatPickup.SIZE;
    const x = this.x + s / 2 - offsetX;
    const y = this.y + s / 2 - offsetY - lift;
    if (x < -40 || y < -40 || x > ctx.canvas.width + 40 || y > ctx.canvas.height + 40) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(this.age * 2 + this.phase) * 0.06);

    // 骨头先画，肉块盖住根部。
    ctx.fillStyle = BONE;
    ctx.fillRect(-0.58 * s, -0.12 * s, 0.38 * s, 0.24 * s);
    ctx.fillStyle = BONE_SHADE;
    ctx.fillRect(-0.58 * s, 0.04 * s, 0.38 * s, 0.08 * s);
    ctx.fillStyle = BONE;
    ctx.beginPath();
    ctx.arc(-0.62 * s, 0, 0.15 * s, 0, Math.PI * 2);
    ctx.fill();

    this.shape(ctx, [[-0.30, -0.40], [0.20, -0.50], [0.48, -0.12], [0.40, 0.34], [-0.04, 0.48], [-0.38, 0.16]], MEAT_MID);
    this.shape(ctx, [[-0.30, -0.40], [0.20, -0.50], [0.30, -0.16], [-0.16, -0.18]], MEAT_LIGHT);
    this.shape(ctx, [[0.40, 0.34], [-0.04, 0.48], [-0.10, 0.10], [0.28, 0.04]], MEAT_DARK);

    ctx.restore();
  }

  private shape(ctx: CanvasRenderingContext2D, points: number[][], color: string): void {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(px * MeatPickup.SIZE, py * MeatPickup.SIZE);
      else ctx.lineTo(px * MeatPickup.SIZE, py * MeatPickup.SIZE);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
