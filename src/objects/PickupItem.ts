import { GameObject } from "../core/GameObject";
import { Input } from "../core/Input";
import { Modifier } from "../core/ModifierManager";

/**
 * 道具类型枚举
 */
export enum PickupType {
  HEALTH,
  SPEED_BOOST,
  FIRE_RATE_BOOST,
  BULLET_SPEED_BOOST,
  DAMAGE_BOOST
}

/**
 * 可拾取道具类
 */
export class PickupItem extends GameObject {
  public static DEFAULT_SIZE: number = 40;

  private type: PickupType;        // 道具类型
  private size: number = PickupItem.DEFAULT_SIZE;       // 道具大小
  private effectRadius: number = 15; // 效果半径
  private pulseRate: number = 2;   // 脉冲动画频率（秒）
  private pulseOffset: number = Math.random() * Math.PI * 2; // 随机初始脉冲相位
  private particleEmitRate: number = 5; // 粒子发射频率（每帧粒子数）
  private emitTimer: number = 0;   // 粒子发射计时器
  private lifetime: number = 0;   // 道具生命周期（秒，0表示无限）
  private isExpiring: boolean = false; // 是否正在过期
  private expiryTimer: number = 0; // 过期动画计时器
  private expiryDuration: number = 2; // 过期动画持续时间（秒）
  private particleSystem?: any;    // 粒子系统引用

  /**
   * 构造函数
   * @param x 初始X坐标
   * @param y 初始Y坐标
   * @param type 道具类型
   * @param particleSystem 可选的粒子系统引用
   */
  constructor(x: number, y: number, type: PickupType, particleSystem?: any) {
    super(x, y);
    this.type = type;
    this.particleSystem = particleSystem;
  }

  /**
   * 获取道具类型
   */
  getType(): PickupType {
    return this.type;
  }

  /**
   * 获取道具大小
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 获取道具的修改器效果
   */
  getModifierEffect(): Omit<Modifier, 'id'> {
    const baseDuration = 5 + Math.random() * 3; // 5-8秒随机持续时间
    // const baseDuration = 0;

    switch (this.type) {
      case PickupType.HEALTH:
        return {
          stat: 'health',
          value: 50,
          duration: 0, // 立即生效，不需要持续时间
          isMultiplier: false,
          description: '恢复50点生命值'
        };
      case PickupType.SPEED_BOOST:
        return {
          stat: 'maxSpeed',
          value: 0.3 + Math.random() * 0.2, // 30%-50%速度提升
          duration: baseDuration,
          isMultiplier: true,
          description: `移速提升 ${Math.round((0.3 + Math.random() * 0.2) * 100)}% (${Math.round(baseDuration)}秒)`
        };
      case PickupType.FIRE_RATE_BOOST:
        return {
          stat: 'fireRate',
          value: 0.3 + Math.random() * 0.2, // 30%-50%射速提升
          duration: baseDuration,
          isMultiplier: true,
          description: `射速提升 ${Math.round((0.3 + Math.random() * 0.2) * 100)}% (${Math.round(baseDuration)}秒)`
        };
      case PickupType.BULLET_SPEED_BOOST:
        return {
          stat: 'bulletSpeed',
          value: 0.4 + Math.random() * 0.3, // 40%-70%子弹速度提升
          duration: baseDuration,
          isMultiplier: true,
          description: `子弹速度提升 ${Math.round((0.4 + Math.random() * 0.3) * 100)}% (${Math.round(baseDuration)}秒)`
        };
      case PickupType.DAMAGE_BOOST:
        return {
          stat: 'damage',
          value: 0.5 + Math.random() * 0.5, // 50%-100%伤害提升
          duration: baseDuration,
          isMultiplier: true,
          description: `伤害提升 ${Math.round((0.5 + Math.random() * 0.5) * 100)}% (${Math.round(baseDuration)}秒)`
        };
      default:
        return {
          stat: 'health',
          value: 20,
          duration: 0,
          isMultiplier: false,
          description: '恢复20点生命值'
        };
    }
  }

  /**
   * 获取道具的颜色
   */
  private getColor(delta: number): string {
    // 计算脉冲效果的缩放因子
    const pulseFactor = 0.5 + 0.5 * Math.sin(Date.now() * 0.001 * this.pulseRate + this.pulseOffset);

    // 根据道具类型返回不同的颜色
    switch (this.type) {
      case PickupType.HEALTH:
        return this.isExpiring ?
          `rgba(255, ${Math.floor(100 * pulseFactor)}, ${Math.floor(100 * pulseFactor)}, ${0.5 - this.expiryTimer / this.expiryDuration})` :
          `rgba(255, ${Math.floor(100 * pulseFactor)}, 100, 1)`;
      case PickupType.SPEED_BOOST:
        return this.isExpiring ?
          `rgba(${Math.floor(100 * pulseFactor)}, ${Math.floor(255 * pulseFactor)}, ${Math.floor(100 * pulseFactor)}, ${0.5 - this.expiryTimer / this.expiryDuration})` :
          `rgba(100, ${Math.floor(255 * pulseFactor)}, 100, 1)`;
      case PickupType.FIRE_RATE_BOOST:
        return this.isExpiring ?
          `rgba(${Math.floor(255 * pulseFactor)}, ${Math.floor(180 * pulseFactor)}, ${Math.floor(50 * pulseFactor)}, ${0.5 - this.expiryTimer / this.expiryDuration})` :
          `rgba(${Math.floor(255 * pulseFactor)}, 180, 50, 1)`;
      case PickupType.BULLET_SPEED_BOOST:
        return this.isExpiring ?
          `rgba(${Math.floor(100 * pulseFactor)}, ${Math.floor(150 * pulseFactor)}, ${Math.floor(255 * pulseFactor)}, ${0.5 - this.expiryTimer / this.expiryDuration})` :
          `rgba(100, 150, ${Math.floor(255 * pulseFactor)}, 1)`;
      case PickupType.DAMAGE_BOOST:
        return this.isExpiring ?
          `rgba(${Math.floor(255 * pulseFactor)}, ${Math.floor(50 * pulseFactor)}, ${Math.floor(50 * pulseFactor)}, ${0.5 - this.expiryTimer / this.expiryDuration})` :
          `rgba(${Math.floor(255 * pulseFactor)}, 50, 50, 1)`;
      default:
        return "rgba(200, 200, 200, 1)";
    }
  }

  /**
   * 生成道具粒子效果
   */
  private emitParticles() {
    if (!this.particleSystem) return;

    const centerX = this.x + this.size / 2;
    const centerY = this.y + this.size / 2;

    for (let i = 0; i < this.particleEmitRate; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = this.size / 2 + Math.random() * this.effectRadius;
      const particleX = centerX + Math.cos(angle) * distance;
      const particleY = centerY + Math.sin(angle) * distance;

      // 根据道具类型设置粒子颜色
      let particleColor = "rgba(200, 200, 200, 0.8)";
      switch (this.type) {
        case PickupType.HEALTH:
          particleColor = "rgba(255, 100, 100, 0.8)";
          break;
        case PickupType.SPEED_BOOST:
          particleColor = "rgba(100, 255, 100, 0.8)";
          break;
        case PickupType.FIRE_RATE_BOOST:
          particleColor = "rgba(255, 180, 50, 0.8)";
          break;
        case PickupType.BULLET_SPEED_BOOST:
          particleColor = "rgba(100, 150, 255, 0.8)";
          break;
        case PickupType.DAMAGE_BOOST:
          particleColor = "rgba(255, 50, 50, 0.8)";
          break;
      }

      // 创建粒子（使用我们新添加的addParticle方法）
      this.particleSystem.addParticle({
        x: particleX,
        y: particleY,
        size: 2 + Math.random() * 3,
        color: particleColor,
        speed: 10 + Math.random() * 20,
        angle: angle + Math.PI, // 向中心方向发射
        lifetime: 0.3 + Math.random() * 0.5,
        fadeOut: true
      });
    }
  }

  /**
   * 启动过期动画
   */
  startExpiry() {
    this.isExpiring = true;
    this.expiryTimer = 0;
  }

  /**
   * 更新道具状态
   */
  update(delta: number, input: Input): void {
    // 更新生命周期
    if (this.lifetime > 0) {
      this.lifetime -= delta;

      // 当生命周期剩余2秒时开始过期动画
      if (this.lifetime <= this.expiryDuration && !this.isExpiring) {
        this.startExpiry();
      }

      // 如果生命周期结束，标记为过期
      if (this.lifetime <= 0) {
        this.isExpiring = true;
      }
    }

    // 更新过期动画
    if (this.isExpiring) {
      this.expiryTimer += delta;

      // 如果过期动画结束，可以在GameScene中处理移除
      if (this.expiryTimer >= this.expiryDuration) {
        // 可以在这里添加完全消失的逻辑，或者由GameScene处理
      }
    }

    // 发射粒子效果
    this.emitTimer += delta;
    if (this.emitTimer >= 0.1) {
      this.emitParticles();
      this.emitTimer = 0;
    }
  }

  /**
   * 绘制道具
   */
  draw(ctx: CanvasRenderingContext2D): void {
    const centerX = this.x + this.size / 2;
    const centerY = this.y + this.size / 2;
    const color = this.getColor(0);

    // 绘制效果光环
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.size / 2 + this.effectRadius, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(
      centerX, centerY, this.size / 2,
      centerX, centerY, this.size / 2 + this.effectRadius
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    // 绘制道具主体
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.size / 2, 0, Math.PI * 2);
    ctx.fill();

    // 添加道具类型指示器（简单图标）
    ctx.fillStyle = "white";
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    switch (this.type) {
      case PickupType.HEALTH:
        ctx.fillText("❤️", centerX, centerY);
        break;
      case PickupType.SPEED_BOOST:
        ctx.fillText("🪽", centerX, centerY);
        break;
      case PickupType.FIRE_RATE_BOOST:
        ctx.fillText("⚡️", centerX, centerY);
        break;
      case PickupType.BULLET_SPEED_BOOST:
        ctx.fillText("💨", centerX, centerY);
        break;
      case PickupType.DAMAGE_BOOST:
        ctx.fillText("💥", centerX, centerY);
        break;
    }
  }

  /**
   * 检查是否与矩形碰撞
   */
  isCollidingWithRect(x: number, y: number, width: number, height: number): boolean {
    // 获取圆的中心点和半径
    const circleCenterX = this.x + this.size / 2;
    const circleCenterY = this.y + this.size / 2;
    const radius = this.size / 2;

    // 找到矩形上离圆心最近的点
    const closestX = Math.max(x, Math.min(circleCenterX, x + width));
    const closestY = Math.max(y, Math.min(circleCenterY, y + height));

    // 计算圆心到最近点的距离的平方（避免使用Math.sqrt提高性能）
    const distanceSquared =
      Math.pow(circleCenterX - closestX, 2) +
      Math.pow(circleCenterY - closestY, 2);

    // 比较距离的平方和半径的平方（避免开根号）
    return distanceSquared < Math.pow(radius, 2);
  }
}