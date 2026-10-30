/**
 * 翻滚的“接地”视觉量：伪高度、重心前压、逐帧深度。
 *
 * 全部是视觉专用曲线，不写回玩法状态，也不参与碰撞 / 位移 / 冷却计算；
 * 阶段三只改 rig 渲染路径，legacy 路径不读取这里任何数值。
 */

import { clamp01, smoothstep } from "../../animation2d/math/angles";

/** 伪高度：起势抬升、中段最高、支撑段落回地面；单位与 size 一致（像素）。 */
export function rollAltitudePx(progress: number, size: number): number {
  const p = clamp01(progress);
  const rise = smoothstep(.04, .36, p);
  const fall = 1 - smoothstep(.50, .70, p);
  return Math.max(0, size * .30 * rise * fall);
}

/** 重心沿翻滚方向前压（归一化到 size）；两端为 0，峰值不超过 0.10。 */
export function rollComOffsetX(progress: number): number {
  const p = clamp01(progress);
  const lean = smoothstep(.12, .34, p) * (1 - smoothstep(.40, .64, p));
  const recover = smoothstep(.64, .86, p) * (1 - smoothstep(.86, 1, p));
  return .10 * lean - .03 * recover;
}

/** 翻滚中段头/胸的正确穿插：头收进躯干后方，由渲染部件顺序表达。 */
export function rollDepthTucked(progress: number): boolean {
  return progress >= .34 && progress < .62;
}
