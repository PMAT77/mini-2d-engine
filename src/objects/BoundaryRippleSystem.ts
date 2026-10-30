import type { Bounds } from "../physics/Collider";

export type BoundaryEdge = "left" | "right" | "top" | "bottom";

export interface BoundaryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 玩家碰撞盒与地图边的最大间距（世界像素），超过就不再算“接触”。 */
export const BOUNDARY_CONTACT_RANGE = 4;
/** 朝边界推的输入分量阈值，避免斜着擦边时误触发。 */
export const BOUNDARY_PRESS_THRESHOLD = 0.25;
/** 同一条边两次波纹之间的最小间隔（秒）。 */
export const BOUNDARY_SPAWN_INTERVAL = 0.18;
/** 波纹起始半径、最大半径与随机浮动。 */
export const BOUNDARY_BASE_RADIUS = 12;
export const BOUNDARY_MAX_RADIUS = 40;
export const BOUNDARY_RADIUS_VARIANCE = 8;
/** 波纹寿命与透明度。 */
export const BOUNDARY_LIFE = 0.5;
export const BOUNDARY_ALPHA = 0.85;
export const BOUNDARY_INNER_RATIO = 0.62;
export const BOUNDARY_INNER_ALPHA = 0.5;
/** 只画朝向地图内侧的半圈：缺口朝着界外，读作被墙推回来。总跨度约 166°。 */
export const BOUNDARY_ARC_HALF = Math.PI * 0.46;
/** 撞击瞬间沿墙铺开的一小段亮线。 */
export const BOUNDARY_TANGENT_HALF = 11;
/** 墙面亮线只在寿命的前 40% 内出现。 */
export const BOUNDARY_TANGENT_FRACTION = 0.4;
export const BOUNDARY_COLOR = "#ffd9a8";
export const BOUNDARY_LINE_WIDTH = 1.6;
/** 同屏波纹软上限，避免极端情况下无界增长。 */
export const BOUNDARY_MAX_COUNT = 32;

const EPS = 1e-6;

/** 一条边的接触点：位置在地图边上，法线指向地图内部。 */
export interface BoundaryContact {
  edge: BoundaryEdge;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** 供测试和调试读取的波纹快照。 */
export interface BoundaryRippleView {
  edge: BoundaryEdge;
  x: number;
  y: number;
  nx: number;
  ny: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  age: number;
  life: number;
}

interface BoundaryRipple extends BoundaryContact {
  maxRadius: number;
  age: number;
  life: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * 找出碰撞盒当前贴住的边界。
 * 接触点取碰撞盒中心在墙上的投影：圆形身体的真实接触点正是这个位置；
 * 斜向贴角时两条边会同时返回。
 */
export function findBoundaryContacts(
  bounds: BoundaryBounds,
  mapWidth: number,
  mapHeight: number,
  range = BOUNDARY_CONTACT_RANGE,
): BoundaryContact[] {
  if (!bounds || !Number.isFinite(mapWidth) || !Number.isFinite(mapHeight)
    || mapWidth <= 0 || mapHeight <= 0 || !Number.isFinite(range) || range < 0) return [];
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return [];

  const centerX = clamp(x + width / 2, 0, mapWidth);
  const centerY = clamp(y + height / 2, 0, mapHeight);
  const contacts: BoundaryContact[] = [];
  if (x <= range) contacts.push({ edge: "left", x: 0, y: centerY, nx: 1, ny: 0 });
  if (mapWidth - (x + width) <= range) {
    contacts.push({ edge: "right", x: mapWidth, y: centerY, nx: -1, ny: 0 });
  }
  if (y <= range) contacts.push({ edge: "top", x: centerX, y: 0, nx: 0, ny: 1 });
  if (mapHeight - (y + height) <= range) {
    contacts.push({ edge: "bottom", x: centerX, y: mapHeight, nx: 0, ny: -1 });
  }
  return contacts;
}

/**
 * 地图边界的“被挡住”反馈：贴着边界继续往里推时，在接触点放一圈暖色弧线。
 * 纯视觉层，不参与碰撞、拾取、挡光或子弹阻挡。
 */
export class BoundaryRippleSystem {
  private ripples: BoundaryRipple[] = [];
  private readonly cooldowns: Record<BoundaryEdge, number> = {
    left: 0, right: 0, top: 0, bottom: 0,
  };

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * @param intent 原始移动意图（已归一化）；撞墙后的速度会被清零，不能拿来判断。
   */
  update(delta: number, bounds: Bounds, intent: { x: number; y: number },
    mapWidth: number, mapHeight: number): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    const cooldownStep = Number.isFinite(delta) ? delta : 0;
    this.cooldowns.left = Math.max(0, this.cooldowns.left - cooldownStep);
    this.cooldowns.right = Math.max(0, this.cooldowns.right - cooldownStep);
    this.cooldowns.top = Math.max(0, this.cooldowns.top - cooldownStep);
    this.cooldowns.bottom = Math.max(0, this.cooldowns.bottom - cooldownStep);
    this.ripples = this.ripples.filter(ripple => (ripple.age += delta) < ripple.life);
    if (!intent || !Number.isFinite(intent.x) || !Number.isFinite(intent.y)) return;

    for (const contact of findBoundaryContacts(bounds, mapWidth, mapHeight)) {
      const pressing = intent.x * contact.nx + intent.y * contact.ny;
      if (pressing >= -BOUNDARY_PRESS_THRESHOLD) continue;
      if (this.cooldowns[contact.edge] > EPS) continue;
      this.cooldowns[contact.edge] = BOUNDARY_SPAWN_INTERVAL;
      if (this.ripples.length >= BOUNDARY_MAX_COUNT) this.ripples.shift();
      this.ripples.push({
        ...contact,
        maxRadius: BOUNDARY_MAX_RADIUS + (this.random() * 2 - 1) * BOUNDARY_RADIUS_VARIANCE,
        age: 0,
        life: BOUNDARY_LIFE,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number,
    viewWidth: number, viewHeight: number): void {
    ctx.save();
    for (const ripple of this.ripples) {
      const visual = BoundaryRippleSystem.getVisual(ripple);
      if (visual.alpha <= 0) continue;
      const x = ripple.x - cameraX, y = ripple.y - cameraY;
      const padding = ripple.maxRadius + BOUNDARY_TANGENT_HALF + 6;
      if (x + padding < 0 || y + padding < 0
        || x - padding > viewWidth || y - padding > viewHeight) continue;

      // 弧线朝地图内侧鼓出：圆心缺口对着界外，读作被边界顶住的一圈回弹。
      const normal = Math.atan2(ripple.ny, ripple.nx);
      const tangent = normal + Math.PI / 2;
      ctx.globalAlpha = visual.alpha;
      ctx.strokeStyle = BOUNDARY_COLOR;
      ctx.lineWidth = BOUNDARY_LINE_WIDTH;
      ctx.shadowColor = "rgba(255, 196, 120, 0.75)";
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(x, y, visual.radius,
        normal - BOUNDARY_ARC_HALF, normal + BOUNDARY_ARC_HALF);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = visual.alpha * BOUNDARY_INNER_ALPHA;
      ctx.beginPath();
      ctx.arc(x, y, visual.radius * BOUNDARY_INNER_RATIO,
        normal - BOUNDARY_ARC_HALF, normal + BOUNDARY_ARC_HALF);
      ctx.stroke();

      // 撞击的前 0.18 秒额外亮一下墙面，给出“硬挡住”的瞬时反馈。
      if (ripple.age < ripple.life * BOUNDARY_TANGENT_FRACTION) {
        const flash = 1 - ripple.age / (ripple.life * BOUNDARY_TANGENT_FRACTION);
        const half = BOUNDARY_TANGENT_HALF * (0.5 + 0.5 * flash);
        ctx.globalAlpha = BOUNDARY_ALPHA * flash * 0.8;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(tangent) * half, y - Math.sin(tangent) * half);
        ctx.lineTo(x + Math.cos(tangent) * half, y + Math.sin(tangent) * half);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  getActiveCount(): number {
    return this.ripples.length;
  }

  getRipples(): BoundaryRippleView[] {
    return this.ripples.map(ripple => {
      const visual = BoundaryRippleSystem.getVisual(ripple);
      return {
        edge: ripple.edge, x: ripple.x, y: ripple.y, nx: ripple.nx, ny: ripple.ny,
        radius: visual.radius, maxRadius: ripple.maxRadius,
        alpha: visual.alpha, age: ripple.age, life: ripple.life,
      };
    });
  }

  clear(): void {
    this.ripples = [];
    this.cooldowns.left = 0;
    this.cooldowns.right = 0;
    this.cooldowns.top = 0;
    this.cooldowns.bottom = 0;
  }

  /** 半径先快后慢地扩散，透明度平滑衰减。 */
  private static getVisual(ripple: BoundaryRipple): { radius: number; alpha: number } {
    const progress = Math.min(1, ripple.age / ripple.life);
    const ease = 1 - (1 - progress) * (1 - progress);
    return {
      radius: BOUNDARY_BASE_RADIUS + (ripple.maxRadius - BOUNDARY_BASE_RADIUS) * ease,
      alpha: BOUNDARY_ALPHA * (1 - progress * progress * (3 - 2 * progress)),
    };
  }
}
