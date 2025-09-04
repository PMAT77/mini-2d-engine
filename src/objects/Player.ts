import { Input } from "../core/Input";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { IdleState } from "../status/IdleState";
import { MovingState } from "../status/MovingState";
import { ShootingState } from "../status/ShootingState";
import { StateMachine } from "../status/StateMachine";
import { Bullet } from "./Bullet";
import { Entities } from "./Entities";

/**
 * 玩家类 - 处理玩家的移动、射击和状态管理
 */
export class Player extends Entities {
  // 动画相关属性
  private idleTime: number = 0; // 玩家待机状态的计时器
  private walkTime: number = 0; // 玩家移动状态的计时器
  private scale: number = 1; // 玩家缩放比例
  private breathingAmplitude: number = 3; // 呼吸动画振幅
  private breathingSpeed: number = 2; // 呼吸动画速度

  // 射击相关属性
  private isShooting: boolean = false; // 玩家是否正在开火
  private bullets: Bullet[] = []; // 存储玩家发射的子弹
  private fireRate: number = 0.1; // 射速（秒/发）
  private fireCooldown: number = 0; // 开火冷却计时器
  private bulletSpeed: number = 800; // 子弹速度

  // 回调函数定义
  private onShootCallback?: (shootDir: Vector2) => void; // 射击回调，用于触发摄像机震动等效果

  // 状态机系统
  private stateMachine: StateMachine<Player>;

  /**
   * 构造函数
   * @param x 初始X坐标
   * @param y 初始Y坐标
   * @param sprite 玩家精灵图像
   */
  constructor(x: number, y: number, sprite?: HTMLImageElement) {
    super(x, y, sprite);

    // 初始化状态机
    this.stateMachine = new StateMachine<Player>(this);
    this.stateMachine.addState(IdleState);
    this.stateMachine.addState(MovingState);
    this.stateMachine.addState(ShootingState);
    this.stateMachine.changeState("idle"); // 默认进入空闲状态
  }

  /**
   * 获取移动方向（基于WASD按键）
   * @param input 输入系统引用
   * @returns 归一化的移动方向向量
   */
  protected getMoveDirection(input: Input): Vector2 {
    const dir = new Vector2();
    if (input.isKeyDown("w")) dir.y -= 1;
    if (input.isKeyDown("s")) dir.y += 1;
    if (input.isKeyDown("a")) dir.x -= 1;
    if (input.isKeyDown("d")) dir.x += 1;

    // 归一化向量，确保多方向移动时速度一致
    if (dir.length() > 0) dir.normalize();
    return dir;
  }

  /**
   * 获取朝向方向（基于方向键）
   * @param input 输入系统引用
   * @returns 归一化的朝向向量
   */
  protected getLookDirection(input: Input): Vector2 {
    const dir = new Vector2();
    if (input.isKeyDown("ArrowUp")) dir.y -= 1;
    if (input.isKeyDown("ArrowDown")) dir.y += 1;
    if (input.isKeyDown("ArrowLeft")) dir.x -= 1;
    if (input.isKeyDown("ArrowRight")) dir.x += 1;

    // 根据方向键状态更新射击状态
    if (input.isKeyDown("ArrowUp") ||
      input.isKeyDown("ArrowDown") ||
      input.isKeyDown("ArrowLeft") ||
      input.isKeyDown("ArrowRight")) {
      this.isShooting = true;
    }

    // 当所有方向键都松开时，取消射击状态
    if (input.isKeyUp("ArrowUp") &&
      input.isKeyUp("ArrowDown") &&
      input.isKeyUp("ArrowLeft") &&
      input.isKeyUp("ArrowRight")) {
      this.isShooting = false;
    }

    // 归一化方向向量
    if (dir.length() > 0) dir.normalize();
    return dir;
  }

  /**
   * 检查玩家是否处于空闲状态
   * @returns 如果玩家静止且未射击，则返回true
   */
  private isIdle(): boolean {
    return this.velocity.length() === 0 && !this.isShooting;
  }

  /**
   * 更新呼吸动画计时器
   * @param delta 时间增量
   */
  private updateBreathAnimation(delta: number): void {
    if (this.isIdle()) {
      this.idleTime += delta;
    } else {
      this.idleTime = 0;
    }
  }

  /**
  * 获取玩家空闲时间
  * @returns 当前空闲时间（秒）
  */
  getIdleTime(): number {
    return this.idleTime;
  }

  /**
   * 设置玩家空闲时间
   * @param time 新的空闲时间值（秒）
   */
  setIdleTime(time: number): void {
    this.idleTime = time;
  }

  /**
   * 获取玩家行走动画时间
   * @returns 当前行走动画时间（秒）
   */
  getWalkTime(): number {
    return this.walkTime;
  }

  /**
   * 设置玩家行走动画时间
   * @param time 新的行走动画时间值（秒）
   */
  setWalkTime(time: number): void {
    this.walkTime = time;
  }

  /**
   * 获取玩家缩放比例
   * @returns 当前缩放比例
   */
  getScale(): number {
    return this.scale;
  }

  /**
   * 设置玩家缩放比例
   * @param value 新的缩放比例值
   */
  setScale(value: number): void {
    this.scale = value;
  }

  /**
   * 获取有效的子弹列表（过滤掉已销毁的子弹）
   * @returns 活跃子弹数组
   */
  getBullets(): Bullet[] {
    return this.bullets.filter(bullet => !bullet.getIsDestroyed());
  }

  /**
   * 获取武器的射速
   * @returns 弹射速度
   */
  getFireRate(): number {
    return this.fireRate;
  }

  /**
   * 设置射击回调函数
   * @param callback 射击时触发的回调函数，接收射击方向作为参数
   */
  setOnShootCallback(callback: (shootDir: Vector2) => void): void {
    this.onShootCallback = callback;
  }

  /**
   * 射击方法
   * @param inputDir 射击方向
   * @param damage 子弹伤害值
   */
  shoot(inputDir: Vector2, damage: number = 10): void {
    // 验证射击方向
    if (!inputDir || inputDir.length() === 0) return;

    // 检查射击冷却
    if (this.fireCooldown > 0) return;
    this.fireCooldown = this.fireRate;

    // 生成子弹
    const bulletPos = new Vector2(this.x + this.size / 2, this.y + this.size / 2);
    const bulletVel = inputDir.clone().scale(this.bulletSpeed);
    const bullet = new Bullet(bulletPos, bulletVel, damage);
    this.bullets.push(bullet);

    // 触发射击回调（用于摄像机震动等效果）
    this.onShootCallback?.(inputDir);

    // 更新状态
    this.stateMachine.changeState("shooting");
    this.isShooting = true;
  }

  /**
   * 更新玩家状态
   * @param delta 时间增量
   * @param input 输入系统引用
   * @param map 地图引用（可选）
   */
  update(delta: number, input: Input, map?: TileMap): void {
    // 调用父类的移动逻辑
    super.update(delta, input, map);

    // 更新射击冷却
    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
    }

    // 处理射击逻辑
    const lookDir = this.getLookDirection(input);
    if (lookDir.length() > 0) {
      this.shoot(lookDir);
    }

    // 根据当前状态切换状态机状态
    if (this.isShooting) {
      this.stateMachine.changeState("shooting");
    } else if (this.velocity.length() > 0.1) {
      this.stateMachine.changeState("moving");
    } else {
      this.stateMachine.changeState("idle");
    }

    // 更新动画和状态机
    this.updateBreathAnimation(delta);
    this.stateMachine.update(delta);

    // 更新子弹并清理已销毁的子弹
    this.bullets.forEach(bullet => bullet.update(delta, map));
    this.bullets = this.bullets.filter(bullet => !bullet.getIsDestroyed());
  }

  /**
   * 绘制玩家（包含呼吸动画效果）
   * @param ctx Canvas渲染上下文
   * @param offsetX 绘制偏移X
   * @param offsetY 绘制偏移Y
   */
  draw(ctx: CanvasRenderingContext2D, offsetX: number = 0, offsetY: number = 0): void {
    ctx.save();
    const drawX = this.x - offsetX;
    const drawY = this.y - offsetY;

    // 计算呼吸动画缩放比例
    let scale = 1;
    if (this.isIdle()) {
      scale = 1 + Math.sin(this.idleTime * this.breathingSpeed) * (this.breathingAmplitude / 100);
    }

    // 应用变换并绘制
    ctx.translate(drawX + this.size / 2, drawY + this.size / 2);
    ctx.rotate(this.currentRotation - Math.PI / 2); // 调整旋转角度以匹配精灵朝向
    ctx.scale(scale, scale);

    // 绘制玩家精灵或占位符
    if (this.sprite) {
      ctx.drawImage(this.sprite, -this.size / 2, -this.size / 2, this.size, this.size);
    } else {
      ctx.fillStyle = "red";
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    }

    ctx.restore();
  }
}