import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { ParticleSystem } from "./ParticleSystem";
import { circleCollider } from "../physics/Collider";
import type { ShapeCastHit } from "../physics/Motion";
import { TileTypeId } from "../map/TileType";
import { BulletWaterDrag, DEFAULT_BULLET_WATER_DRAG, DEFAULT_BALLISTICS } from "./PlayerConfig";

const WATER_DRAG_KEYS: Partial<Record<TileTypeId, keyof BulletWaterDrag>> = {
  [TileTypeId.SHALLOW_WATER]: 'shallow',
  [TileTypeId.WATER]: 'water',
  [TileTypeId.DEEP_WATER]: 'deep',
  [TileTypeId.ULTRA_DEEP_WATER]: 'ultraDeep',
};

/** 命中墙体、射程耗尽与出界时统一的白色烟尘色板。 */
const IMPACT_SMOKE = ['#ffffff', '#e8e8e8', '#cfcfcf', '#b5b5b5'];

/** 场景提供的可命中单位：返回最早接触比例和命中后的结算回调。 */
export interface BulletEntityHit {
  /** 沿本帧中心移动线段的比例，0–1。 */
  fraction: number;
  /** 世界坐标下的接触点，供命中特效定位。 */
  x: number;
  y: number;
  apply: () => void;
}

/**
 * 子弹每次位移时的单位命中查询。
 * @param radius 子弹半径，命中半径由目标自行与本值相加
 * @param damage 本颗子弹已结算增益后的伤害
 */
export type BulletEntityHitTest = (
  startX: number, startY: number, endX: number, endY: number, radius: number, damage: number,
) => BulletEntityHit | null;

/**
 * 子弹类，负责处理子弹的物理运动、碰撞检测和渲染逻辑
 */
export class Bullet {
  /** 顺序绘制的子弹共用小缓冲，避免每颗子弹分配遮罩画布。 */
  private static waterCanvas?: HTMLCanvasElement;
  /** 子弹当前位置 */
  private pos: Vector2;

  /** 子弹当前速度向量 */
  private velocity: Vector2;
  private readonly initialSpeed: number;
  private readonly waterDrag: BulletWaterDrag;

  /** 子弹大小（直径，碰撞圆仍按它计算） */
  private size = 10;

  /** 上一帧中心点，绘制时用它拉出白色细线弹道。 */
  private trailX = 0;
  private trailY = 0;

  /** 子弹是否已被销毁的标志 */
  private isDestroyed = false;

  /** 场景注入的单位命中查询；命中单位时子弹优先于该点之后的地形结算。 */
  private entityHitTest?: BulletEntityHitTest;

  /** 子弹渲染颜色 */
  private color = "#ffffff";

  /** 子弹造成的伤害值 */
  private damage: number;

  /** 粒子系统引用 */
  private particleSystem?: ParticleSystem;

  /**
   * 构造一个新的子弹实例
   * @param pos 子弹初始位置
   * @param velocity 子弹初始速度向量
   * @param damage 子弹造成的伤害值（默认10）
   * @param particleSystem 可选的粒子系统引用
   * @param waterDragEnabled 发射时角色涉水，固定该颗子弹的水体阻力资格
   * @param waterDrag 各水深每秒扣除的发射速度比例，发射时复制
   * @param remainingDistance 本次发射允许飞行的距离，按实际位移扣除
   * @param onLanded 子弹自然停止时回调（含水中耗尽），落点是否为地面由调用方判断
   */
  constructor(
    pos: Vector2,
    velocity: Vector2,
    damage = 10,
    particleSystem?: ParticleSystem,
    private readonly waterDragEnabled = false,
    waterDrag: Partial<BulletWaterDrag> = DEFAULT_BULLET_WATER_DRAG,
    private remainingDistance = DEFAULT_BALLISTICS.maxRange,
    private readonly onLanded?: (x: number, y: number) => void
  ) {
    if (!Number.isFinite(remainingDistance) || remainingDistance < 0) throw new Error('子弹飞行距离必须是非负有限数值');
    // 克隆位置向量以避免引用同一对象
    this.pos = pos.clone();

    // 校准发射位置，使子弹中心与指定位置对齐
    this.pos.set(
      this.pos.x - this.size / 2,
      this.pos.y - this.size / 2
    );
    this.trailX = this.pos.x + this.size / 2;
    this.trailY = this.pos.y + this.size / 2;

    // 克隆速度向量以避免引用同一对象
    this.velocity = velocity.clone();
    this.initialSpeed = this.velocity.length();
    this.waterDrag = { ...DEFAULT_BULLET_WATER_DRAG, ...waterDrag };
    this.damage = damage;
    this.particleSystem = particleSystem;
  }

  /**
   * 更新子弹状态
   * @param delta 时间增量（秒）
   * @param map 可选的地图引用，用于碰撞检测
   */
  update(delta: number, map?: TileMap): void {
    // 如果子弹已被销毁，则不进行更新
    if (this.isDestroyed) return;
    if (!Number.isFinite(delta) || delta < 0) return;

    if (!this.waterDragEnabled || !map || delta === 0) {
      this.move(delta, map);
      return;
    }

    let remaining = delta;
    while (remaining > 0 && !this.isDestroyed) {
      const speed = this.velocity.length();
      if (speed === 0) { this.annihilate(map); return; }
      const body = circleCollider(this.pos.x + this.size / 2, this.pos.y + this.size / 2, this.size / 2);
      let deceleration = 0;
      for (const coverage of map.getTerrainCoverage(body)) {
        const key = WATER_DRAG_KEYS[coverage.type];
        if (key) deceleration += this.initialSpeed * this.waterDrag[key] * coverage.fraction;
      }
      // 每步至多一像素，跨曲线岸线和水深边界时也按实际覆盖计阻力。
      const step = Math.min(remaining, 1 / 120, 1 / speed);
      const timeToStop = deceleration > 0 ? speed / deceleration : Infinity;
      const stops = timeToStop <= step + 1e-12;
      const time = Math.min(step, timeToStop);
      this.move(time * (1 - deceleration * time / (2 * speed)), map);
      if (this.isDestroyed) return;
      if (stops) {
        this.annihilate(map);
        return;
      }
      this.velocity.scale(Math.max(0, speed - deceleration * time) / speed);
      remaining -= step;
    }
  }

  /** 水中耗尽动能或射程耗尽时停止；粒子与落地回调使用同一个终点。 */
  private annihilate(map?: TileMap): void {
    this.velocity.set(0, 0);
    this.isDestroyed = true;
    const hitPos = new Vector2(this.pos.x + this.size / 2, this.pos.y + this.size / 2);
    this.particleSystem?.createExplosion(hitPos, 4, 60, 4, 0.35, IMPACT_SMOKE);
    if (map) this.onLanded?.(hitPos.x, hitPos.y);
  }

  /** Sweep the otherwise skipped body-to-hand segment so an extended arm cannot fire through walls. */
  checkLaunchPath(origin: Vector2, map: TileMap): void {
    const movement = { x: this.pos.x + this.size / 2 - origin.x, y: this.pos.y + this.size / 2 - origin.y };
    const hit = map.castShape(circleCollider(origin.x, origin.y, this.size / 2), movement, 'projectile');
    if (!hit) return;
    this.pos.set(origin.x + movement.x * hit.fraction - this.size / 2, origin.y + movement.y * hit.fraction - this.size / 2);
    this.hitTerrain(hit, map);
  }

  private hitTerrain(hit: ShapeCastHit, map: TileMap): void {
    this.particleSystem?.createExplosion(new Vector2(this.pos.x + this.size / 2, this.pos.y + this.size / 2),
      10, 130, 7, .45, IMPACT_SMOKE);
    if (hit.obstacle.col >= 0) map.damageTile(hit.obstacle.col, hit.obstacle.row, this.damage);
    this.isDestroyed = true;
  }

  /** 按当前速度推进给定等效时间，共用首次命中、单位命中和出界处理。 */
  private move(delta: number, map?: TileMap): void {
    const requestedDistance = this.velocity.length() * delta;
    const distance = Math.min(requestedDistance, this.remainingDistance);
    const fraction = requestedDistance > 0 ? distance / requestedDistance : 0;
    // Clip the swept segment before collision, so nothing beyond the endpoint can be hit.
    const newX = this.pos.x + this.velocity.x * delta * fraction;
    const newY = this.pos.y + this.velocity.y * delta * fraction;
    const movement = { x: newX - this.pos.x, y: newY - this.pos.y };
    const startX = this.pos.x + this.size / 2, startY = this.pos.y + this.size / 2;
    const terrainHit = map ? map.castShape(circleCollider(startX, startY, this.size / 2), movement, 'projectile') : null;
    // 单位线段检测使用中心点；如果地形更近，仍由地形先吞掉子弹。
    const entityHit = this.entityHitTest?.(startX, startY, startX + movement.x, startY + movement.y,
      this.size / 2, this.damage);
    if (entityHit && (!terrainHit || entityHit.fraction < terrainHit.fraction - 1e-9)) {
      this.pos.x += movement.x * entityHit.fraction;
      this.pos.y += movement.y * entityHit.fraction;
      this.isDestroyed = true;
      entityHit.apply();
      return;
    }

    // 检查是否与地图发生碰撞
    if (terrainHit && map) {
      this.pos.x += movement.x * terrainHit.fraction;
      this.pos.y += movement.y * terrainHit.fraction;
      this.hitTerrain(terrainHit, map);
      return;
    }

    if (map) {
      // 检查子弹是否超出地图范围
      const mapPixelWidth = map.width * map.tileSize;
      const mapPixelHeight = map.height * map.tileSize;
      if (newX + this.size < 0 ||
        newX > mapPixelWidth ||
        newY + this.size < 0 ||
        newY > mapPixelHeight) {
        this.destroy();
        return;
      }
    }

    // 更新子弹位置
    this.trailX = startX;
    this.trailY = startY;
    this.pos.x = newX;
    this.pos.y = newY;
    this.remainingDistance = Math.max(0, this.remainingDistance - distance);
    if (this.remainingDistance <= 1e-8) this.annihilate(map);
  }

  /**
   * 渲染子弹
   * @param ctx Canvas渲染上下文
   * @param offsetX 水平偏移量（默认0）
   * @param offsetY 垂直偏移量（默认0）
   * @param map 水面遮罩使用的当前地图，与是否受水体阻力无关
   */
  draw(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0, map?: TileMap): void {
    // 如果子弹已被销毁，则不进行渲染
    if (this.isDestroyed) return;

    const trail = this.getTrailSegment();
    if (!map) { this.drawBody(ctx, offsetX, offsetY, trail); return; }
    // 水面遮罩按线段轴对齐包围盒分配，细线本身只占几个像素。
    const pad = 2;
    const minX = Math.floor(Math.min(trail.x1, trail.x2) - pad);
    const minY = Math.floor(Math.min(trail.y1, trail.y2) - pad);
    const width = Math.max(1, Math.ceil(Math.abs(trail.x2 - trail.x1) + pad * 2));
    const height = Math.max(1, Math.ceil(Math.abs(trail.y2 - trail.y1) + pad * 2));
    // 单帧拉线最长 128px：长帧只截断可见弹道，不撑爆复用缓冲。
    const extent = Math.min(128, Math.max(width, height));
    const canvas = Bullet.waterCanvas ??= document.createElement('canvas');
    if (canvas.width !== extent || canvas.height !== extent) { canvas.width = extent; canvas.height = extent; }
    const buffer = canvas.getContext('2d')!;
    buffer.clearRect(0, 0, extent, extent);
    this.drawBody(buffer, minX, minY, trail);
    buffer.save();
    buffer.globalCompositeOperation = 'source-atop'; buffer.globalAlpha = 0.35;
    map.drawWaterLayer(buffer, minX, minY, extent, extent);
    buffer.restore();
    const sourceWidth = Math.min(width, extent), sourceHeight = Math.min(height, extent);
    ctx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight,
      minX - offsetX, minY - offsetY, sourceWidth, sourceHeight);
  }

  /** 本帧的白色细线弹道；几乎没动时沿速度方向补足 6px，静止的子弹也看得见。 */
  private getTrailSegment(): { x1: number; y1: number; x2: number; y2: number } {
    const x2 = this.pos.x + this.size / 2, y2 = this.pos.y + this.size / 2;
    if (Math.hypot(x2 - this.trailX, y2 - this.trailY) >= 6) {
      return { x1: this.trailX, y1: this.trailY, x2, y2 };
    }
    const speed = this.velocity.length();
    const dx = speed > 1e-6 ? this.velocity.x / speed : 1, dy = speed > 1e-6 ? this.velocity.y / speed : 0;
    return { x1: x2 - dx * 6, y1: y2 - dy * 6, x2, y2 };
  }

  private drawBody(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number,
    trail: { x1: number; y1: number; x2: number; y2: number }): void {
    // 保存当前渲染状态
    ctx.save();

    // 白色细线：线宽固定 1.6px，长度就是本帧实际位移
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trail.x1 - offsetX, trail.y1 - offsetY);
    ctx.lineTo(trail.x2 - offsetX, trail.y2 - offsetY);
    ctx.stroke();

    // 恢复之前的渲染状态
    ctx.restore();
  }

  /**
   * 获取子弹是否已被销毁的状态
   * @returns 子弹是否已被销毁
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  /** 注入/移除场景的单位命中查询；由玩家在发射时转发。 */
  setEntityHitTest(test?: BulletEntityHitTest): void {
    this.entityHitTest = test;
  }

  /**
   * 设置子弹为已销毁状态
   */
  destroy(): void {
    // 创建爆炸效果
    if (this.particleSystem) {
      const hitPos = new Vector2(
        this.pos.x + this.size / 2,
        this.pos.y + this.size / 2
      );
      this.particleSystem.createExplosion(
        hitPos,
        6,
        90,
        5,
        0.4,
        IMPACT_SMOKE
      );
    }

    this.isDestroyed = true;
  }

  /**
   * 获取子弹当前位置
   * @returns 子弹位置的克隆
   */
  getPosition(): Vector2 {
    return this.pos.clone();
  }

  /**
   * 获取子弹大小
   * @returns 子弹大小
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 获取子弹伤害值
   * @returns 子弹伤害值
   */
  getDamage(): number {
    return this.damage;
  }

  /**
   * 设置子弹颜色
   * @param color 新的颜色值
   */
  setColor(color: string): void {
    this.color = color;
  }
}
