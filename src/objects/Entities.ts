import { GameObject } from "../core/GameObject";
import { Input } from "../core/Input";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { Collider, ColliderShape, Contact, DEFAULT_SHAPE, Point, compileShape, isRotationInvariant, transformCollider } from "../physics/Collider";

const defaultCollider = compileShape(DEFAULT_SHAPE);
const normalizeAngle = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

/**
 * 实体抽象类，定义游戏中所有可移动实体的基础行为
 * 包含移动、旋转、碰撞检测等核心功能
 */
export abstract class Entities extends GameObject {
  private colliderShape = defaultCollider;
  private collisionContacts: Contact[] = [];
  /** Last legal pose's terrain factor, independent of sprint and stat modifiers. */
  protected terrainSpeedFactor = 1;
  protected terrainWaterCoverage = { fraction: 0, depth: 0 };

  public setCollider(shape: ColliderShape): void { this.colliderShape = compileShape(shape); this.colliderCache = undefined; }
  private colliderCache?: { x: number; y: number; size: number; rotation: number; collider: Collider };
  public getCollider(): Collider {
    const x = this.x + this.size / 2, y = this.y + this.size / 2, rotation = this.getBodyRotation();
    const cache = this.colliderCache;
    // Entities query their collider several times per substep; reuse it while the pose is unchanged.
    if (cache && cache.x === x && cache.y === y && cache.size === this.size && cache.rotation === rotation) return cache.collider;
    const collider = transformCollider(this.colliderShape, { x, y, size: this.size, rotation });
    this.colliderCache = { x, y, size: this.size, rotation, collider };
    return collider;
  }
  public getCollisionContacts(): Contact[] { return this.collisionContacts.slice(); }
  public getMaxSpeed(): number { return this.maxSpeed; }
  protected getMovementSpeed(): number { return this.getMaxSpeed(); }
  protected getBodyRotation(): number { return this.currentRotation; }
  /** 实体尺寸（像素） */
  protected size: number = 49;

  /** 最大移动速度（像素/秒） */
  protected maxSpeed: number = 400;

  /** 加速度（像素/秒²） */
  protected accel: number = 4000;

  /** 减速度（像素/秒²） */
  protected decel: number = 1200;

  /** 当前速度向量 */
  protected velocity: Vector2 = new Vector2();

  /** 非线性移动因子，影响加速度曲线 */
  protected nonlinearFactor: number = 0.5;

  /** 输入缓冲区，存储历史输入方向 */
  protected inputBuffer: Vector2[] = [];

  /** 输入缓冲区最大容量 */
  protected maxBufferSize: number = 3;

  /** 输入缓冲区衰减因子 */
  protected bufferDecay: number = 0.8;

  /** 当前旋转角度（弧度） */
  protected currentRotation: number = 0;

  /** 旋转速度（弧度/秒） */
  protected rotationSpeed: number = Math.PI * 4;

  /** 旋转策略：顺时针(cw)、逆时针(ccw)或自动(auto) */
  protected rotationStrategy: "cw" | "ccw" | "auto" = "auto";

  /** 实体精灵图像 */
  protected sprite?: HTMLImageElement;

  /**
   * 构造函数
   * @param x 初始X坐标
   * @param y 初始Y坐标
   * @param sprite 可选的精灵图像
   */
  constructor(x: number, y: number, sprite?: HTMLImageElement) {
    super(x, y);
    this.sprite = sprite;
  }

  /**
   * 设置实体的精灵图像
   * @param img 要设置的图像元素
   */
  public setSprite(img: HTMLImageElement): void {
    this.sprite = img;
  }

  /**
   * 获取实体尺寸
   * @returns 实体尺寸（像素）
   */
  public getSize(): number {
    return this.size;
  }

  /**
   * 设置实体尺寸
   * @param newSize 新的尺寸值（像素）
   */
  public setSize(newSize: number): void {
    if (!Number.isFinite(newSize) || newSize <= 0) throw new Error("实体尺寸必须是正有限数值");
    this.size = newSize;
  }

  /**
   * 获取当前速度向量
   * @returns 当前速度向量
   */
  public getVelocity(): Vector2 {
    return this.velocity.clone();
  }

  /**
   * 子类必须实现此方法以定义如何获取移动方向
   * @param input 输入管理器实例
   * @returns 移动方向向量
   */
  protected abstract getMoveDirection(input: Input): Vector2;

  /**
   * 子类必须实现此方法以定义如何获取朝向方向
   * @param input 输入管理器实例
   * @returns 朝向方向向量
   */
  protected abstract getLookDirection(input: Input): Vector2;

  /**
   * 更新输入缓冲区，添加新的方向并维护缓冲区大小
   * @param dir 新的方向向量
   */
  protected updateInputBuffer(dir: Vector2): void {
    this.inputBuffer.push(dir.clone());
    if (this.inputBuffer.length > this.maxBufferSize) {
      this.inputBuffer.shift();
    }
  }

  /**
   * 计算缓冲的方向向量，考虑历史输入的加权平均值
   * @returns 加权平均后的方向向量
   */
  protected calculateBufferedDirection(): Vector2 {
    const dir = new Vector2();
    let weight = 1.0, totalWeight = 0;

    // 从最新到最旧遍历输入缓冲区，应用衰减权重
    for (let i = this.inputBuffer.length - 1; i >= 0; i--) {
      const bufferDir = this.inputBuffer[i];
      dir.x += bufferDir.x * weight;
      dir.y += bufferDir.y * weight;
      totalWeight += weight;
      weight *= this.bufferDecay;
    }

    // 归一化结果
    if (totalWeight > 0) {
      dir.x /= totalWeight;
      dir.y /= totalWeight;
      const len = dir.length();
      if (len > 1) {
        dir.scale(1 / len);
      }
    }
    return dir;
  }

  /**
   * 限制实体位置在地图边界内
   * @param map 瓦片地图实例
   */
  protected limitPosition(map: TileMap): void {
    const mapWidth = map.width * map.tileSize;
    const mapHeight = map.height * map.tileSize;

    const b = this.getCollider().bounds;
    this.x += Math.max(0, -b.x) + Math.min(0, mapWidth - b.x - b.width);
    this.y += Math.max(0, -b.y) + Math.min(0, mapHeight - b.y - b.height);
  }

  /**
   * 计算目标速度向量
   * @param dir 方向向量
   * @returns 基于最大速度和方向的目标速度向量
   */
  protected calculateTargetVelocity(dir: Vector2): Vector2 {
    return dir.clone().scale(this.maxSpeed);
  }

  /**
   * 非线性更新速度，考虑加速度和减速度
   * @param targetVel 目标速度向量
   * @param dir 移动方向向量
   * @param delta 时间增量（秒）
   */
  protected updateVelocityNonlinear(targetVel: Vector2, dir: Vector2, delta: number): void {
    const diff = targetVel.clone().sub(this.velocity);
    const diffLen = diff.length();

    if (diffLen > 0) {
      // 根据是否有输入决定使用加速度还是减速度
      const acceleration = dir.length() > 0 ? this.accel : this.decel;
      const targetSpeed = targetVel.length();
      const currentSpeed = this.velocity.length();
      const speedRatio = targetSpeed > 0 ? currentSpeed / targetSpeed : 0;

      // 计算最大速度变化量，应用非线性因子
      let maxDelta = acceleration * delta;
      if (dir.length() > 0) {
        maxDelta *= Math.sqrt(speedRatio + this.nonlinearFactor);
      } else {
        maxDelta *= Math.sqrt(1 - speedRatio + this.nonlinearFactor);
      }

      // 限制速度变化量并应用到当前速度
      if (diffLen > maxDelta) {
        diff.normalize().scale(maxDelta);
      }
      this.velocity.add(diff);
    }

    // 速度过小则视为静止
    if (this.velocity.length() < 1) {
      this.velocity.set(0, 0);
    }
  }

  /**
   * 更新位置，支持碰撞检测与滑墙效果
   * @param delta 时间增量（秒）
   * @param map 可选的瓦片地图实例，用于碰撞检测
   */
  protected updatePosition(delta: number, map?: TileMap): void {
    this.moveAndRotate({ x: this.velocity.x * delta, y: this.velocity.y * delta }, 0, map);
  }

  protected moveAndRotate(movement: Point, angle: number, map?: TileMap): void {
    if (!map) { this.x += movement.x; this.y += movement.y; this.currentRotation = normalizeAngle(this.currentRotation + angle); return; }
    const before = this.getCollider(), result = map.resolveMotion(before, movement, angle);
    this.x = result.collider.pose.x - this.size / 2;
    this.y = result.collider.pose.y - this.size / 2;
    this.currentRotation = normalizeAngle(this.currentRotation + result.collider.pose.rotation - before.pose.rotation);
    this.collisionContacts.push(...result.contacts);
    for (const { normal } of result.contacts) {
      const inward = Math.min(0, this.velocity.x * normal.x + this.velocity.y * normal.y);
      this.velocity.x -= normal.x * inward; this.velocity.y -= normal.y * inward;
    }
  }

  /**
   * 更新旋转角度：优先使用输入方向，无输入时使用速度方向
   * @param delta 时间增量（秒）
   * @param inputDir 可选的输入方向向量
   */
  protected getRotationDelta(delta: number, inputDir?: Vector2): number {
    let targetAngle: number | null = null;

    // 优先使用输入方向
    if (inputDir && inputDir.length() > 0.01) {
      targetAngle = Math.atan2(inputDir.y, inputDir.x) + Math.PI;
    }
    // 无输入时使用速度方向
    else if (this.velocity.length() > 1e-3) {
      targetAngle = Math.atan2(this.velocity.y, this.velocity.x) + Math.PI;
    }

    if (targetAngle === null) {
      return 0;
    }

    // 优化角度计算 - 使用更高效的角度标准化方法
    const turn = Math.PI * 2;
    const clockwise = ((targetAngle - this.currentRotation) % turn + turn) % turn;
    let angleDiff = clockwise > Math.PI ? clockwise - turn : clockwise;
    if (this.rotationStrategy === "cw") angleDiff = clockwise;
    if (this.rotationStrategy === "ccw") angleDiff = clockwise === 0 ? 0 : clockwise - turn;

    return Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), this.rotationSpeed * delta);
  }

  protected updateRotation(delta: number, inputDir?: Vector2, map?: TileMap): void {
    this.moveAndRotate({ x: 0, y: 0 }, this.getRotationDelta(delta, inputDir), map);
  }

  /**
   * 更新实体状态，包括位置、速度、旋转等
   * @param delta 时间增量（秒）
   * @param input 输入管理器实例
   * @param map 可选的瓦片地图实例
   */
  public update(delta: number, input: Input, map?: TileMap): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    this.collisionContacts = [];
    if (map) {
      this.limitPosition(map);
    }

    const moveDir = this.getMoveDirection(input); // W/A/S/D 控制移动
    const lookDir = this.getLookDirection(input); // 方向键控制旋转

    if (!map) { this.terrainWaterCoverage.fraction = 0; this.terrainWaterCoverage.depth = 0; }
    this.terrainSpeedFactor = map?.getShapeSpeedFactor(this.getCollider(), this.terrainWaterCoverage) ?? 1;
    if (map && map.queryShape(this.getCollider()).some(c => c.depth > 0.01)) { this.velocity.set(0, 0); return; }
    const maxSpeed = this.getMovementSpeed();
    let remaining = delta;
    let terrainFactor = this.terrainSpeedFactor;
    // ponytail: one controlled entity; reuse the tile grid rather than maintain a second spatial index.
    for (let i = 0; remaining > 1e-9 && i < 4096; i++) {
      const body = this.getCollider();
      const invariant = isRotationInvariant(body);
      const step = Math.min(remaining, 1 / 120, 1 / Math.max(1, this.velocity.length() + maxSpeed + (invariant ? 0 : this.rotationSpeed * body.radius)), invariant ? Infinity : 0.025 / this.rotationSpeed);
      const speed = maxSpeed * terrainFactor;
      this.updateVelocityNonlinear(moveDir.clone().scale(speed), moveDir, step);
      if (this.velocity.length() > speed) this.velocity.scale(speed / this.velocity.length());
      this.moveAndRotate({ x: this.velocity.x * step, y: this.velocity.y * step }, this.getRotationDelta(step, lookDir), map);
      terrainFactor = map?.getShapeSpeedFactor(this.getCollider(), this.terrainWaterCoverage) ?? 1;
      this.terrainSpeedFactor = terrainFactor;
      const finalSpeed = maxSpeed * terrainFactor;
      if (this.velocity.length() > finalSpeed) this.velocity.scale(finalSpeed / this.velocity.length());
      remaining -= step;
    }
  }

  /**
   * 绘制实体
   * @param ctx Canvas 2D上下文
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    // 平移到实体中心点并应用旋转
    ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
    ctx.rotate(this.getBodyRotation());

    // 绘制精灵或默认矩形
    if (this.sprite) {
      ctx.drawImage(this.sprite, -this.size / 2, -this.size / 2, this.size, this.size);
    } else {
      ctx.fillStyle = "red";
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    }

    ctx.restore();
  }
}
