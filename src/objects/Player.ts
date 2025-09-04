import { Input } from "../core/Input";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { IdleState } from "../status/IdleState";
import { MovingState } from "../status/MovingState";
import { ShootingState } from "../status/ShootingState";
import { StateMachine } from "../status/StateMachine";
import { Bullet } from "./Bullet";
import { Entities } from "./Entities";
import { ParticleSystem } from "./ParticleSystem";

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
  private fireCooldown: number = 0; // 开火冷却计时器（控制射速）

  private bulletSpeed: number = 800; // 子弹速度 

  private maxShootingTime: number = 3.5; // 最长持续射击时间（秒）
  private shootingTimeRemaining: number = this.maxShootingTime; // 当前剩余可射击时间
  private maxOverheatCooldownTime: number = 1.0; // 最长过热冷却时间（秒）
  private overheatCooldownRemaining: number = this.maxOverheatCooldownTime; // 当前过热后的冷却时间（秒）
  private isOverheated: boolean = false; // 是否处于过热状态

  // 进度条可见性相关属性
  private cooldownBarAlpha: number = 0; // 进度条透明度（0-1）
  private isBarVisible: boolean = false; // 进度条是否应该可见
  private fadeSpeed: number = 5; // 淡入淡出速度系数

  // 回调函数定义
  private onShootCallback?: (shootDir: Vector2) => void; // 射击回调，用于触发摄像机震动等效果

  // 状态机系统
  private stateMachine: StateMachine<Player>;

  // 粒子系统
  private particleSystem?: ParticleSystem;

  /**
   * 构造函数
   * @param x 初始X坐标
   * @param y 初始Y坐标
   * @param sprite 玩家精灵图像
   * @param particleSystem 可选的粒子系统引用
   */
  constructor(
    x: number,
    y: number,
    sprite?: HTMLImageElement,
    particleSystem?: ParticleSystem
  ) {
    super(x, y, sprite);

    // 初始化状态机
    this.stateMachine = new StateMachine<Player>(this);
    this.stateMachine.addState(IdleState);
    this.stateMachine.addState(MovingState);
    this.stateMachine.addState(ShootingState);
    this.stateMachine.changeState("idle"); // 默认进入空闲状态

    // 设置粒子系统
    this.particleSystem = particleSystem;
  }

  /**
   * 设置粒子系统
   * @param system 粒子系统引用
   */
  setParticleSystem(system: ParticleSystem): void {
    this.particleSystem = system;
  }

  /**
   * 获取移动方向（基于WADS按键）
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
  * 绘制竖向冷却进度条
  * @param ctx Canvas渲染上下文
  * @param offsetX 绘制偏移X
  * @param offsetY 绘制偏移Y
  */
  private drawCooldownBar(ctx: CanvasRenderingContext2D, offsetX: number = 0, offsetY: number = 0): void {
    // 如果透明度为0，不绘制进度条
    if (this.cooldownBarAlpha <= 0) {
      return;
    }

    ctx.save();

    const drawX = this.x - offsetX;
    const drawY = this.y - offsetY;

    // 进度条配置
    const barWidth = 10; // 进度条宽度
    const barHeight = this.size * 1.5; // 进度条高度
    const barOffset = this.size / 2 + 40; // 与玩家的距离
    const barX = drawX + barOffset; // 进度条X坐标（玩家右侧）
    const barY = drawY - barHeight / 2 + this.size / 2; // 进度条Y坐标（居中对齐玩家）

    // 设置透明度
    ctx.globalAlpha = this.cooldownBarAlpha;

    // 绘制进度条背景
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // 根据状态绘制进度条填充
    if (this.isOverheated) {
      // 过热冷却状态 - 显示冷却进度（从满格向下消退）
      const coolDownProgress = 1 - this.getOverheatCooldownProgress(); // 反转进度值
      const fillHeight = barHeight * coolDownProgress;

      // 创建渐变效果（上热下冷）
      const gradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
      gradient.addColorStop(1, "#33ff33"); // 红色（热）
      gradient.addColorStop(0, "#ff3333"); // 橙色（冷却中）

      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY + barHeight - fillHeight, barWidth, fillHeight); // 从顶部开始填充
    } else {
      // 正常状态 - 显示射击热量（绿色到红色渐变）
      const heatProgress = this.getHeatPercentage();
      const fillHeight = barHeight * heatProgress;

      // 创建渐变效果
      const gradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
      gradient.addColorStop(1, "#33ff33"); // 绿色（冷）
      gradient.addColorStop(0, "#ff3333"); // 红色（热）

      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY + barHeight - fillHeight, barWidth, fillHeight);
    }

    ctx.restore();
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
  // 在shoot方法中添加新的逻辑
  shoot(inputDir: Vector2, damage: number = 10): void {
    // 验证射击方向
    if (!inputDir || inputDir.length() === 0) return;

    // 检查是否过热
    if (this.isOverheated) return;

    // 检查剩余射击时间
    if (this.shootingTimeRemaining <= 0) {
      this.startOverheat();
      return;
    }

    // 检查射击冷却
    if (this.fireCooldown > 0) return;
    this.fireCooldown = this.fireRate;

    // 减少剩余射击时间
    this.shootingTimeRemaining -= this.fireRate;

    // 生成子弹
    const bulletPos = new Vector2(this.x + this.size / 2, this.y + this.size / 2);
    const bulletVel = inputDir.clone().scale(this.bulletSpeed);
    const bullet = new Bullet(bulletPos, bulletVel, damage, this.particleSystem);
    this.bullets.push(bullet);

    // 触发射击回调（用于摄像机震动等效果）
    this.onShootCallback?.(inputDir);

    // 更新状态
    this.stateMachine.changeState("shooting");
    this.isShooting = true;
  }

  // 添加过热处理方法
  private startOverheat(): void {
    this.isOverheated = true;
    this.shootingTimeRemaining = 0;
    this.fireCooldown = 0;
    // 可以在这里添加过热特效或音效
  }

  // 修改update方法，添加过热冷却逻辑
  update(delta: number, input: Input, map?: TileMap): void {
    // 调用父类的移动逻辑
    super.update(delta, input, map);

    // 更新射击冷却和过热状态
    if (this.isOverheated) {
      // 过热冷却倒计时
      this.overheatCooldownRemaining -= delta;
      if (this.overheatCooldownRemaining <= 0) {
        // 过热冷却完成
        this.isOverheated = false;
        this.shootingTimeRemaining = this.maxShootingTime;
        this.overheatCooldownRemaining = this.maxOverheatCooldownTime; // 重置过热冷却时间
      }
    } else {
      // 常规射击冷却
      if (this.fireCooldown > 0) {
        this.fireCooldown -= delta;
      }

      // 当玩家停止射击时，缓慢恢复射击时间
      if (!this.isShooting && this.shootingTimeRemaining < this.maxShootingTime) {
        // 每秒恢复50%的最大射击时间
        this.shootingTimeRemaining += delta * this.maxShootingTime * 0.5;
        // 确保不超过最大值
        if (this.shootingTimeRemaining > this.maxShootingTime) {
          this.shootingTimeRemaining = this.maxShootingTime;
        }
      }
    }

    // 管理进度条可见性
    if (this.isShooting || this.isOverheated || this.shootingTimeRemaining < this.maxShootingTime) {
      this.isBarVisible = true;
    } else {
      this.isBarVisible = false;
    }

    // 更新进度条透明度
    if (this.isBarVisible) {
      this.cooldownBarAlpha = Math.min(1, this.cooldownBarAlpha + delta * this.fadeSpeed);
    } else {
      this.cooldownBarAlpha = Math.max(0, this.cooldownBarAlpha - delta * this.fadeSpeed);
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

  // 添加获取射击状态的方法（可选，用于UI显示）
  /**
   * 获取当前射击热量百分比（0-1）
   * @returns 射击热量百分比
   */
  getHeatPercentage(): number {
    return 1 - (this.shootingTimeRemaining / this.maxShootingTime);
  }

  /**
   * 获取是否处于过热状态
   * @returns 是否过热
   */
  getIsOverheated(): boolean {
    return this.isOverheated;
  }

  /**
   * 获取过热冷却进度（0-1）
   * @returns 过热冷却进度
   */
  getOverheatCooldownProgress(): number {
    if (!this.isOverheated) return 0;
    return 1 - (this.overheatCooldownRemaining / this.maxOverheatCooldownTime);
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

    // 调用单独的方法绘制冷却进度条
    this.drawCooldownBar(ctx, offsetX, offsetY);
  }
}