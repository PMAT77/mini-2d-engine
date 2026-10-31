/**
 * 世界声音的空间衰减。
 *
 * 纯函数，不读配置、不碰音频上下文：音频起播、逐帧音量与敌人听觉必须共用
 * 同一条曲线，否则会出现“听得到却算作听不见”或“远处仍被吓到”的两套答案。
 */

/** 近场：这个距离内保持全响度，避免贴脸时声音反而被压小。 */
const NEAR_FIELD = 50;
/** 软化距离：把线性衰减换成平方反比式的缓坡，中距离的变化更自然。 */
const SOFTEN_DISTANCE = 180;
/** 从这个比例开始向 0 淡出，保证边界处连续而不是突然静音。 */
const FADE_START_RATIO = 0.78;

/**
 * 距离 d、传播半径 range 处的归一化可听增益（0–1）。
 * range 外恒为 0；range 内先按近场 + 软化距离衰减，最后一段线性淡出。
 */
export function computeAudibleGain(distance: number, range: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(range)) return 0;
  if (range <= 0) return 0;

  const d = Math.max(0, distance);
  if (d >= range) return 0;

  const softened = Math.max(0, d - NEAR_FIELD) / SOFTEN_DISTANCE;
  const falloff = 1 / (1 + softened * softened);

  const fadeStart = range * FADE_START_RATIO;
  const fade = d <= fadeStart ? 1 : (range - d) / (range - fadeStart);

  return Math.max(0, Math.min(1, falloff * fade));
}
