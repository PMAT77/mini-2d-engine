/**
 * 战斗层的数据契约。
 *
 * 这里只描述「发生了什么」：一次真实命中携带的伤害、方向、速度与冲量，
 * 以及目标的生命状态与受击姿态。位移计算在 KnockbackMotion，状态机在目标自身，
 * 绘制层只读取只读姿态。未来接入 2D 层级骨架时，替换的也只是姿态的消费者。
 */

/** 命中来源；只有真实命中事件能进入战斗层，准星位置不参与强度计算。 */
export type HitSource = 'bullet' | 'melee' | 'explosion' | 'script';

/**
 * 一次真实命中产生的最小数据快照。
 *
 * 命中点、方向、速度都由子弹实际飞行的那一段决定；`impulse` 是开火时从武器
 * 快照下来的击退冲量，与准星落在目标身上还是目标后方无关。
 */
export interface BulletImpact {
  /** 本次命中结算的伤害（已含伤害增益）。 */
  readonly damage: number;
  /** 世界坐标下的首次接触点。 */
  readonly point: { readonly x: number; readonly y: number };
  /** 命中瞬间的真实飞行方向（单位向量）；速度为零时为零向量。 */
  readonly direction: { readonly x: number; readonly y: number };
  /** 武器冲量；目标质量与抗性由 KnockbackProfile 提供。 */
  readonly impulse: number;
  /** 命中瞬间的速度，水中减速后可能低于初始速度。 */
  readonly impactSpeed: number;
  /** 离开枪口时的初始速度，用于计算速度衰减比例。 */
  readonly initialSpeed: number;
  /** 从枪口到命中点的真实飞行距离。 */
  readonly traveledDistance: number;
  /** 命中来源；当前只有子弹。 */
  readonly source: HitSource;
}

/**
 * 击退参数。每个目标自带一份，与武器无关；`immuneToDisplacement` 的目标
 * 只播放受击姿态，不接受位置冲量。
 */
export interface KnockbackProfile {
  /** 质量，越大位移越小；必须大于 0。 */
  mass: number;
  /** 击退抗性 0–1；1 表示完全抵抗。 */
  resistance: number;
  /** 击退速度上限，像素/秒。 */
  maxSpeed: number;
  /** 指数阻尼系数，1/秒，必须大于 0。 */
  damping: number;
  /** 低于该速度时停止减速，像素/秒。 */
  stopSpeed: number;
  /** 受击硬直时长，秒；姿态与AI抑制使用。 */
  hitStunSeconds: number;
  /** 致命命中时冲量的倍率。 */
  deathImpulseMultiplier: number;
  /** 尸体最短可见时长，秒。 */
  minDeathSeconds: number;
  /** 尸体最长可见时长，秒；超时后保守收尾。 */
  maxDeathSeconds: number;
  /** 完全免疫位移，但仍会收到受击姿态。 */
  immuneToDisplacement: boolean;
}

/** 目标的生命状态；`removed` 之后不再绘制、不再参与掉落。 */
export type LifeState = 'alive' | 'dying' | 'removed';

/** 一次结算的结果；`ignored` 不会产生姿态或位移。 */
export type HitResult = 'ignored' | 'damaged' | 'killed';

/**
 * 死亡滑行完成事件。
 *
 * 由目标自身在进入 `removed` 的那一帧产生一次，携带最终世界坐标；
 * 白烟、肉块与尸体移除都由场景消费该事件后执行，目标不再自己决定表现时序。
 */
export interface DeathFinished {
  /** 最终世界坐标（目标中心）。 */
  readonly x: number;
  /** 最终世界坐标（目标中心）。 */
  readonly y: number;
  /** 从致命命中到滑行结束的时间，秒。 */
  readonly elapsedSeconds: number;
}

/**
 * 只读受击姿态，供当前 Canvas 绘制层消费。
 *
 * 它不参与世界坐标、碰撞体或死亡结算；未来 Rig 实现同样只读这些量。
 * 角度与压缩都相对于目标自己的基准姿态，而不是世界坐标。
 */
export interface HitReactionPose {
  /** 受击强度 0–1，随击退速度衰减。 */
  readonly intensity: number;
  /** 局部前倾角，弧度；正值朝命中方向倒。 */
  readonly localLeanRadians: number;
  /** 横向压缩比例 0–1，0 表示不变形。 */
  readonly squash: number;
  /** 受击已经过的时间，秒。 */
  readonly ageSeconds: number;
  /** 是否处于死亡滑行阶段。 */
  readonly dying: boolean;
}
