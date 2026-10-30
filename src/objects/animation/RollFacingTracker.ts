/**
 * 翻滚朝向展开：修掉“朝向跨过 ±π 时、朝向权重还没到 1”造成的整人跳变。
 *
 * 正常帧完全沿用旧公式（`facing + delta * weight`），保证逐像素不变；
 * 只有本帧 facing 与上一帧相差超过 π（说明发生了 ±π 环绕）时，才用连续角
 * 计算输出，使混合权重能把朝向平滑推向翻滚方向。
 */

import { shortestAngleDelta } from "../../animation2d/math/angles";

const WRAP_THRESHOLD = Math.PI;

export class RollFacingTracker {
  /** 连续（未环绕）的 facing，单位弧度。 */
  private continuous = 0;
  private previousRaw = 0;
  private active = false;
  /** 一旦跨过 ±π，本段翻滚余下的帧都走连续角，避免又跳回原始表示。 */
  private unwrapped = false;

  resolve(facing: number, rollAngle: number, weight: number): number {
    if (!Number.isFinite(facing) || !Number.isFinite(rollAngle) || !(weight > 0)) {
      this.active = false;
      this.continuous = Number.isFinite(facing) ? facing : 0;
      this.previousRaw = this.continuous;
      return facing;
    }

    if (!this.active) {
      this.active = true;
      this.unwrapped = false;
      this.continuous = facing;
      this.previousRaw = facing;
      return facing + shortestAngleDelta(facing, rollAngle) * weight;
    }

    if (Math.abs(facing - this.previousRaw) > WRAP_THRESHOLD) this.unwrapped = true;
    this.continuous += shortestAngleDelta(this.continuous, facing);
    this.previousRaw = facing;
    if (this.unwrapped) {
      return this.continuous + shortestAngleDelta(this.continuous, rollAngle) * weight;
    }
    return facing + shortestAngleDelta(facing, rollAngle) * weight;
  }

  reset(): void {
    this.active = false;
    this.unwrapped = false;
  }
}
