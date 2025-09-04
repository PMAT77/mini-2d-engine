/**
 * 相机类，负责游戏场景的视角控制、跟随目标和震动效果
 */
export class Camera {
  /** 相机在世界坐标系中的X坐标 */
  public x: number = 0;

  /** 相机在世界坐标系中的Y坐标 */
  public y: number = 0;

  /** 相机视口宽度 */
  public width: number;

  /** 相机视口高度 */
  public height: number;

  /** 相机死区宽度（在该区域内目标移动不会引起相机移动） */
  public deadZoneWidth: number;

  /** 相机死区高度 */
  public deadZoneHeight: number;

  /** 相机移动阻尼系数，控制相机跟随的平滑程度 */
  public damping: number;

  // === 震动属性 ===
  /** 基础震动幅度 */
  private shakeMagnitude: number = 0;

  /** 当前震动时间 */
  private shakeTime: number = 0;

  /** 总震动持续时间 */
  private shakeDuration: number = 0;

  /** 震动方向角度（弧度制） */
  private shakeAngle: number = 0;

  /** 震动频率（Hz） */
  private shakeFrequency: number = 20;

  /** 震动衰减模式枚举类型定义 */
  public shakeDecayMode: 'linear' | 'quadratic' | 'exponential' = 'quadratic';

  /**
   * 构造一个新的相机实例
   * @param width 相机视口宽度
   * @param height 相机视口高度
   * @param deadZoneWidth 相机死区宽度（默认100）
   * @param deadZoneHeight 相机死区高度（默认100）
   * @param damping 相机移动阻尼系数（默认5）
   */
  constructor(
    width: number,
    height: number,
    deadZoneWidth = 100,
    deadZoneHeight = 100,
    damping = 5
  ) {
    this.width = width;
    this.height = height;
    this.deadZoneWidth = deadZoneWidth;
    this.deadZoneHeight = deadZoneHeight;
    this.damping = damping;
  }

  /**
   * 触发一次相机震动
   * @param magnitude 震动幅度（默认3）
   * @param duration 震动持续时间（默认0.1秒）
   * @param angle 震动方向角度（弧度制，默认随机角度）
   * @param frequency 震动频率（Hz，默认20）
   * @param decayMode 震动衰减模式（默认二次方衰减）
   */
  public shake(
    magnitude: number = 3,
    duration: number = 0.1,
    angle: number = Math.random() * Math.PI * 2,
    frequency: number = 20,
    decayMode: 'linear' | 'quadratic' | 'exponential' = 'quadratic'
  ): void {
    this.shakeMagnitude = magnitude;
    this.shakeTime = 0; // 重置震动时间
    this.shakeDuration = duration;
    this.shakeAngle = angle;
    this.shakeFrequency = frequency;
    this.shakeDecayMode = decayMode;
  }

  /**
   * 获取包含震动偏移的相机位置
   * @returns 包含震动偏移的相机位置坐标
   */
  public getOffset(): { x: number; y: number } {
    if (this.shakeTime < this.shakeDuration && this.shakeMagnitude > 0) {
      // 计算衰减系数
      const decayFactor = this.calculateDecayFactor();

      // 计算当前振幅
      const currentMagnitude = this.shakeMagnitude * decayFactor;

      // 使用正弦波计算偏移量，创造平滑的震动效果
      const timeFactor = this.shakeTime * this.shakeFrequency;
      const offsetX = Math.sin(timeFactor) * currentMagnitude * Math.cos(this.shakeAngle);
      const offsetY = Math.sin(timeFactor) * currentMagnitude * Math.sin(this.shakeAngle);

      return {
        x: this.x + offsetX,
        y: this.y + offsetY
      };
    }
    return { x: this.x, y: this.y };
  }

  /**
   * 让相机跟随指定目标
   * @param targetX 目标X坐标
   * @param targetY 目标Y坐标
   * @param delta 时间增量（秒）
   */
  public follow(targetX: number, targetY: number, delta: number): void {
    // 计算死区边界
    const deadZoneLeft = this.x + (this.width - this.deadZoneWidth) / 2;
    const deadZoneRight = deadZoneLeft + this.deadZoneWidth;
    const deadZoneTop = this.y + (this.height - this.deadZoneHeight) / 2;
    const deadZoneBottom = deadZoneTop + this.deadZoneHeight;

    // 计算期望的相机位置
    let desiredX = this.x;
    let desiredY = this.y;

    if (targetX < deadZoneLeft) {
      desiredX -= deadZoneLeft - targetX;
    } else if (targetX > deadZoneRight) {
      desiredX += targetX - deadZoneRight;
    }

    if (targetY < deadZoneTop) {
      desiredY -= deadZoneTop - targetY;
    } else if (targetY > deadZoneBottom) {
      desiredY += targetY - deadZoneBottom;
    }

    // 应用阻尼效果，实现平滑移动
    const factor = 1 - Math.exp(-this.damping * delta);
    this.x += (desiredX - this.x) * factor;
    this.y += (desiredY - this.y) * factor;

    // 更新震动计时
    this.updateShakeTimer(delta);
  }

  /**
   * 将世界坐标转换为屏幕坐标
   * @param worldX 世界坐标X
   * @param worldY 世界坐标Y
   * @returns 屏幕坐标
   */
  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX - this.x,
      y: worldY - this.y
    };
  }

  /**
   * 将屏幕坐标转换为世界坐标
   * @param screenX 屏幕坐标X
   * @param screenY 屏幕坐标Y
   * @returns 世界坐标
   */
  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX + this.x,
      y: screenY + this.y
    };
  }

  /**
   * 绘制调试信息，显示相机死区和中心点
   * @param ctx Canvas渲染上下文
   */
  public drawDebug(ctx: CanvasRenderingContext2D): void {
    const dzLeft = (this.width - this.deadZoneWidth) / 2;
    const dzTop = (this.height - this.deadZoneHeight) / 2;

    ctx.save();

    // 绘制死区矩形
    ctx.strokeStyle = "rgba(255,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeRect(dzLeft, dzTop, this.deadZoneWidth, this.deadZoneHeight);

    // 绘制相机中心点
    ctx.fillStyle = "rgba(255,0,0,0.9)";
    ctx.beginPath();
    ctx.arc(this.width / 2, this.height / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    // 绘制相机视口边界
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, this.width, this.height);

    ctx.restore();
  }

  /**
   * 计算当前的震动衰减系数
   * @private
   * @returns 衰减系数（0-1之间的值）
   */
  private calculateDecayFactor(): number {
    const progress = this.shakeTime / this.shakeDuration;

    switch (this.shakeDecayMode) {
      case 'linear':
        return 1 - progress;
      case 'quadratic':
        return 1 - progress * progress;
      case 'exponential':
        return Math.exp(-progress * 5);
      default:
        return 1 - progress;
    }
  }

  /**
   * 更新震动计时器
   * @private
   * @param delta 时间增量（秒）
   */
  private updateShakeTimer(delta: number): void {
    if (this.shakeTime < this.shakeDuration) {
      this.shakeTime += delta;

      // 当震动时间超过持续时间时，重置震动状态
      if (this.shakeTime >= this.shakeDuration) {
        this.shakeMagnitude = 0;
        this.shakeTime = this.shakeDuration;
      }
    }
  }

  /**
   * 重置相机状态
   * 清除震动效果并将相机位置重置为原点
   */
  public reset(): void {
    this.x = 0;
    this.y = 0;
    this.shakeMagnitude = 0;
    this.shakeTime = 0;
    this.shakeDuration = 0;
  }
}