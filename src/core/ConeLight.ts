import { LightSource } from './LightSource';
import { Vector2 } from '../math/Vector2';

const TAU = Math.PI * 2;

/**
 * 可复用的手电筒式锥形光。
 *
 * 扇形两侧和弧边都做柔和衰减：半径方向沿用 {@link LightSource} 的衰减曲线，
 * 角度方向用内切锥形渐变把两条扇形边羽化。锥光只叠加亮度，因此无论是否被墙
 * 遮挡都不会把地形压暗到环境光以下。
 */
export class ConeLight extends LightSource {
  readonly shape = 'cone' as const;
  private direction: number;
  private angle!: number;
  private softness!: number;
  /** 光源本体占位半径：光束从这里之外才开始，避免照亮持灯者自己。 */
  private innerRadius = 0;
  private innerFade = 14;
  /**
   * @param position 光源位置
   * @param radius 照射距离
   * @param color 颜色
   * @param intensity 强度
   * @param angle 扇形总张角（弧度）
   * @param softness 两条扇形边的柔和比例（0–0.5，占张角）
   */
  constructor(position: Vector2, radius = 400, color = '#FFFFFF', intensity = 1,
    angle = TAU / 3, softness = 0.3) {
    super(position, radius, color, intensity, 0);
    this.direction = 0;
    this.setAngle(angle);
    this.setSoftness(softness);
  }

  /** 光束内圈半径；0 表示从光源中心开始。 */
  getInnerRadius(): number { return this.innerRadius; }

  setInnerRadius(radius: number, fade = 14): void {
    if (!Number.isFinite(radius) || radius < 0) throw new Error('手电筒内圈半径必须是非负有限数值');
    if (!Number.isFinite(fade) || fade <= 0) throw new Error('手电筒内圈过渡宽度必须是正有限数值');
    this.innerRadius = radius;
    this.innerFade = fade;
  }

  getInnerFade(): number { return this.innerFade; }

  /** 距离 d 处相对内圈的可见比例（0–1）。 */
  innerVisibility(distance: number): number {
    if (this.innerRadius <= 0) return 1;
    const t = (distance - this.innerRadius) / this.innerFade;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  /** 朝向角度（弧度，0 指向 +X）。 */
  getDirection(): number { return this.direction; }

  setDirection(direction: number): void {
    if (!Number.isFinite(direction)) throw new Error('锥光朝向必须是有限数值');
    this.direction = direction;
  }

  getAngle(): number { return this.angle; }

  setAngle(angle: number): void {
    if (!Number.isFinite(angle) || angle <= 0 || angle > TAU) throw new Error('锥光张角必须在 (0, 2π] 内');
    this.angle = angle;
  }

  /** 单侧边的柔和宽度（弧度）。 */
  getFeather(): number { return Math.min(this.angle / 2, this.angle * this.softness); }

  getSoftness(): number { return this.softness; }

  setSoftness(softness: number): void {
    if (!Number.isFinite(softness) || softness < 0 || softness > 0.5) throw new Error('锥光边缘柔和比例必须在 0–0.5 内');
    this.softness = softness;
  }

  /** 扇形起始角（顺时针，Canvas 坐标系）。 */
  getStartAngle(): number { return this.direction - this.angle / 2; }

  getEndAngle(): number { return this.direction + this.angle / 2; }
}
