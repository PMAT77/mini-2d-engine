import { readGameTime, WORLD_MINUTES_PER_DAY } from '../campaign/GameClock';
import type { Rect } from './HudTypes';

export interface DayClockHudState {
  /** CampaignSession 的权威分钟数；0 是第 1 天 06:00，保留小数以平滑移动。 */
  worldMinute: number;
  location: 'field' | 'camp';
  /** P4 提供实际波次；缺省时不编造正在进行的夜袭。 */
  raid?: { wave: number; totalWaves: number };
}

export const DAY_CLOCK_TIMELINE = { start: 0, dusk: 720 / 1440, night: 840 / 1440, end: 1 } as const;
export const DAY_CLOCK_DIGIT_ADVANCE = 21;
export function clockDigitPositions(center: number): number[] {
  return Array.from({ length: 5 }, (_, i) => center + (i - 2) * DAY_CLOCK_DIGIT_ADVANCE);
}
export function formatClockMinutes(minutes: number): string {
  const value = Math.max(0, Math.ceil(minutes));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function getDayClockView(state: Readonly<DayClockHudState>) {
  const time = readGameTime(state.worldMinute);
  const elapsed = state.worldMinute % WORLD_MINUTES_PER_DAY;
  const remaining = Math.max(0, (time.phase === 'day' ? 720 : 840) - elapsed);
  const field = state.location === 'field';
  const missed = field && time.phase !== 'day';
  const urgent = field && time.phase === 'day' && remaining < 60;
  const warning = missed || (state.location === 'camp' && time.phase === 'dusk');
  let status: string;
  if (missed) status = '已错过返程时间';
  else if (field) status = `距返程截止 ${formatClockMinutes(remaining)}`;
  else if (time.phase === 'day') status = '白天整备时间';
  else if (time.phase === 'dusk') status = `距夜袭开始 ${formatClockMinutes(remaining)}`;
  else status = state.raid ? `夜袭进行中 · 第 ${state.raid.wave} 波 / ${state.raid.totalWaves}` : '夜间防守时间';
  const warmth = urgent ? 1 - remaining / 60 : missed ? 1 : warning ? .55 + .45 * (1 - remaining / 120) : state.raid && time.phase === 'night' ? 1 : 0;
  const color = `rgb(${Math.round(227 + 8 * warmth)},${Math.round(226 - 57 * warmth)},${Math.round(220 - 107 * warmth)})`;
  return { ...time, dayText: `第 ${String(time.day).padStart(2, '0')} 天`,
    clockText: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
    phaseText: { day: '白昼', dusk: '黄昏', night: '夜晚' }[time.phase],
    progress: elapsed / WORLD_MINUTES_PER_DAY, status, statusColor: color,
    statusIcon: warning || (state.raid && time.phase === 'night') ? 'warning' as const : time.phase === 'night' ? null : 'clock' as const };
}

export interface DayClockHudLayout extends Rect { scale: number; compact: boolean; designWidth: number; designHeight: number; }
/** 居中可用通道由既有 HUD 的矩形决定；只缩放/下移新时钟，不挪动任何占位。 */
export function getDayClockHudLayout(width: number, height: number, reserved: readonly Rect[] = [], forceCompact = false): DayClockHudLayout {
  const w = Math.max(0, width), h = Math.max(0, height);
  const laneAt = (y: number, size: number) => {
    let half = Math.max(0, w / 2 - 12);
    for (const rect of reserved) {
      if (rect.y >= y + size || rect.y + rect.height <= y) continue;
      if (rect.x + rect.width <= w / 2) half = Math.min(half, w / 2 - rect.x - rect.width - 12);
      else if (rect.x >= w / 2) half = Math.min(half, rect.x - w / 2 - 12);
      else half = 0;
    }
    return Math.max(0, half * 2);
  };
  let y = Math.min(12, h), lane = laneAt(y, 144);
  const compact = forceCompact || lane < 340 || w < 700 || h < 320;
  const designWidth = compact ? 300 : 500, designHeight = compact ? 48 : 144;
  if (compact) lane = laneAt(y, designHeight);
  if (lane < 240) {
    const topObstacles = reserved.filter(rect => rect.y < 60);
    y = Math.max(y, ...topObstacles.map(rect => rect.y + rect.height + 4));
    lane = laneAt(y, 1);
  }
  // 窄屏上顶部占位与居中武器区之间仅剩一条薄缝时，同时按这条缝的高度缩放。
  const nextObstacle = reserved.filter(rect => rect.y >= y && rect.x < (w + Math.min(lane, designWidth)) / 2
    && rect.x + rect.width > (w - Math.min(lane, designWidth)) / 2).reduce((bottom, rect) => Math.min(bottom, rect.y - 2), h - 8);
  const scale = Math.max(0, Math.min(1, lane / designWidth, (nextObstacle - y) / designHeight));
  return { x: (w - designWidth * scale) / 2, y, width: designWidth * scale, height: designHeight * scale,
    scale, compact, designWidth, designHeight };
}
