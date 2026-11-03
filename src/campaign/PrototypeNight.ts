import { GameClock } from './GameClock';
import type { ClockAdvance } from './GameClock';

/**
 * P1–P3 的临时阶段协调：20:00 后立即结束空夜袭，P4 由 RaidDirector 替换。
 * 不修改玩家资源，不生成/结算真实夜袭，不将世界分钟当成伤害或引信的模拟秒。
 */
export function advanceWithEmptyNights(clock: GameClock, fromWorldMinute: number, deltaSeconds: number): ClockAdvance {
  // 统一参数校验，包括暂停期间；零步不会在恢复到 20:00 时自行补做夜袭。
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('模拟时间必须是非负有限秒数');
  const result = clock.advance(fromWorldMinute, 0);
  if (clock.isPaused() || deltaSeconds === 0) return result;
  let remaining = deltaSeconds;
  while (remaining > 0 || clock.read(result.worldMinute).phase === 'night') {
    const reading = clock.read(result.worldMinute);
    const seconds = Math.min(remaining, reading.secondsToNextBoundary);
    const step = reading.phase === 'night'
      ? clock.advanceTo(result.worldMinute, reading.nextBoundaryMinute)
      : clock.advance(result.worldMinute, seconds);
    if (step.worldMinute === result.worldMinute) throw new Error('世界时间精度不足以表达本次推进');
    result.worldMinute = step.worldMinute;
    result.events.push(...step.events);
    if (result.events.length > 4096) throw new Error('单次时间推进跨越过多阶段，请分批推进');
    if (reading.phase !== 'night') remaining = Math.max(0, remaining - seconds);
  }
  return result;
}
