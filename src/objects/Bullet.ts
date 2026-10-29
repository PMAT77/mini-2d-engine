import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { ParticleSystem } from "./ParticleSystem";
import { circleCollider } from "../physics/Collider";
import { TileTypeId } from "../map/TileType";
import { BulletWaterDrag, DEFAULT_BULLET_WATER_DRAG } from "./PlayerConfig";

const WATER_DRAG_KEYS: Partial<Record<TileTypeId, keyof BulletWaterDrag>> = {
  [TileTypeId.SHALLOW_WATER]: 'shallow',
  [TileTypeId.WATER]: 'water',
  [TileTypeId.DEEP_WATER]: 'deep',
  [TileTypeId.ULTRA_DEEP_WATER]: 'ultraDeep',
};

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

  /** 子弹大小（直径） */
  private size = 10;

  /** 子弹是否已被销毁的标志 */
  private isDestroyed = false;

  /** 子弹渲染颜色 */
  private color = "yellow";

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
   */
  constructor(
    pos: Vector2,
    velocity: Vector2,
    damage = 10,
    particleSystem?: ParticleSystem,
    private readonly waterDragEnabled = false,
    waterDrag: Partial<BulletWaterDrag> = DEFAULT_BULLET_WATER_DRAG
  ) {
    // 克隆位置向量以避免引用同一对象
    this.pos = pos.clone();

    // 校准发射位置，使子弹中心与指定位置对齐
    this.pos.set(
      this.pos.x - this.size / 2,
      this.pos.y - this.size / 2
    );

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
      if (speed === 0) { this.annihilate(); return; }
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
        this.annihilate();
        return;
      }
      this.velocity.scale(Math.max(0, speed - deceleration * time) / speed);
      remaining -= step;
    }
  }

  /** 水中耗尽动能时少量白色粒子散开，不造成命中伤害。 */
  private annihilate(): void {
    this.velocity.set(0, 0);
    this.isDestroyed = true;
    this.particleSystem?.createExplosion(
      new Vector2(this.pos.x + this.size / 2, this.pos.y + this.size / 2),
      4, 35, 2, 0.22, ['#ffffff']
    );
  }

  /** 按当前速度推进给定等效时间，共用首次命中和出界处理。 */
  private move(delta: number, map?: TileMap): void {

    // 计算新的位置
    const newX = this.pos.x + this.velocity.x * delta;
    const newY = this.pos.y + this.velocity.y * delta;

    // 检查是否与地图发生碰撞
    if (map) {
      const movement = { x: newX - this.pos.x, y: newY - this.pos.y };
      const hit = map.castShape(circleCollider(this.pos.x + this.size / 2, this.pos.y + this.size / 2, this.size / 2), movement, 'projectile');
      if (hit) {
        this.pos.x += movement.x * hit.fraction;
        this.pos.y += movement.y * hit.fraction;
        // 创建爆炸效果
        if (this.particleSystem) {
          const hitPos = new Vector2(
            this.pos.x + this.size / 2,
            this.pos.y + this.size / 2
          );
          // 根据子弹颜色生成相应的爆炸效果
          this.particleSystem.createExplosion(
            hitPos,
            8,
            400,
            10,
            0.2,
            this.color === "yellow" ? ["yellow", "orange", "red"] : [this.color]
          );
        }

        // 对命中的瓦片造成伤害
        if (hit.obstacle.col >= 0) map.damageTile(hit.obstacle.col, hit.obstacle.row, this.damage);
        // 标记子弹为已销毁
        this.isDestroyed = true;
        return;
      }

      // 检查子弹是否超出地图范围
      const mapPixelWidth = map.width * map.tileSize;
      const mapPixelHeight = map.height * map.tileSize;

      // 当子弹完全离开地图区域时销毁
      if (newX + this.size < 0 ||
        newX > mapPixelWidth ||
        newY + this.size < 0 ||
        newY > mapPixelHeight) {
        this.destroy();
        return;
      }
    }

    // 更新子弹位置
    this.pos.x = newX;
    this.pos.y = newY;
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

    if (!map) { this.drawBody(ctx, offsetX, offsetY); return; }
    const extent = this.size + 4, x = this.pos.x - 2, y = this.pos.y - 2;
    const canvas = Bullet.waterCanvas ??= document.createElement('canvas');
    if (canvas.width !== extent || canvas.height !== extent) { canvas.width = extent; canvas.height = extent; }
    const buffer = canvas.getContext('2d')!;
    buffer.clearRect(0, 0, extent, extent);
    this.drawBody(buffer, x, y);
    buffer.save();
    buffer.globalCompositeOperation = 'source-atop'; buffer.globalAlpha = 0.35;
    map.drawWaterLayer(buffer, x, y, extent, extent);
    buffer.restore();
    ctx.drawImage(canvas, x - offsetX, y - offsetY);
  }

  private drawBody(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {

    // 保存当前渲染状态
    ctx.save();

    // 设置子弹颜色
    ctx.fillStyle = this.color;

    // 绘制圆形子弹
    ctx.beginPath();
    ctx.arc(
      this.pos.x - offsetX + this.size / 2,
      this.pos.y - offsetY + this.size / 2,
      this.size / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

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
        100,
        4,
        0.15,
        this.color === "yellow" ? ["yellow", "orange", "red"] : [this.color]
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
