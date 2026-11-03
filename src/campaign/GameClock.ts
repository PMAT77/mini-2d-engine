export type DayPhase = 'day' | 'dusk' | 'night';
export type ClockPauseReason = 'menu' | 'blur' | 'hidden' | 'loading' | 'storage' | 'construction' | 'debug';
export interface PhaseDurations { daySeconds: number; duskSeconds: number; nightSeconds: number; }
export interface GameTime {
  worldMinute: number;
  /** 生存日于 06:00 换日，午夜仍属于同一个夜晚。 */
  day: number;
  hour: number;
  minute: number;
  phase: DayPhase;
}
export interface ClockReading extends GameTime {
  nextBoundaryMinute: number;
  secondsToNextBoundary: number;
}
export interface ClockBoundaryEvent {
  /** ID 在同一战役内稳定；DuskStarted 同时是 18:00 返程截止信号。 */
  id: string;
  type: 'DuskStarted' | 'NightStarted' | 'DayStarted';
  worldMinute: number;
  day: number;
}
export interface ClockAdvance {
  fromWorldMinute: number;
  worldMinute: number;
  events: ClockBoundaryEvent[];
}

export const WORLD_MINUTES_PER_DAY = 1440;
export const DEFAULT_PHASE_DURATIONS: Readonly<PhaseDurations> = Object.freeze({
  daySeconds: 15 * 60, duskSeconds: 2 * 60, nightSeconds: 5 * 60,
});
const DUSK_MINUTE = 720;
const NIGHT_MINUTE = 840;
const PAUSE_REASONS: readonly ClockPauseReason[] = ['menu', 'blur', 'hidden', 'loading', 'storage', 'construction', 'debug'];
// 仅在阶段边界消除浮点累积误差，最多提前百万分之一世界分钟。
const BOUNDARY_EPSILON = 1e-6;
// ponytail: 单次最多枚举 4096 个边界；更长的测试/跳时由调用方分批推进。
const MAX_BOUNDARIES = 4096;

function worldMinute(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new Error('世界时间必须是非负且不超过安全范围的有限分钟数');
}
function simulationSeconds(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error('模拟时间必须是非负有限秒数');
}
export function getGameDay(value: number): number {
  worldMinute(value);
  return Math.floor(value / WORLD_MINUTES_PER_DAY) + 1;
}
export function readGameTime(value: number): GameTime {
  const day = getGameDay(value), elapsed = value % WORLD_MINUTES_PER_DAY;
  const clockMinute = (elapsed + 360) % WORLD_MINUTES_PER_DAY;
  return { worldMinute: value, day, hour: Math.floor(clockMinute / 60), minute: Math.floor(clockMinute % 60),
    phase: elapsed < DUSK_MINUTE ? 'day' : elapsed < NIGHT_MINUTE ? 'dusk' : 'night' };
}
function nextBoundary(value: number, phase: DayPhase): number {
  const start = Math.floor(value / WORLD_MINUTES_PER_DAY) * WORLD_MINUTES_PER_DAY;
  return start + (phase === 'day' ? DUSK_MINUTE : phase === 'dusk' ? NIGHT_MINUTE : WORLD_MINUTES_PER_DAY);
}
function boundaryEvent(value: number): ClockBoundaryEvent {
  const time = readGameTime(value);
  const type = time.phase === 'day' ? 'DayStarted' : time.phase === 'dusk' ? 'DuskStarted' : 'NightStarted';
  return { id: 'day-' + time.day + ':' + type, type, worldMinute: value, day: time.day };
}
function appendBoundary(events: ClockBoundaryEvent[], value: number): void {
  if (events.length >= MAX_BOUNDARIES) throw new Error('单次时间推进跨越过多阶段，请分批推进');
  events.push(boundaryEvent(value));
}

/**
 * 只计算时间推进结果，worldMinute 始终由 CampaignSession 持有。
 * 暂停原因是运行态；没有 Date.now、定时器、DOM 或离线追赶。
 */
export class GameClock {
  readonly #rates: Record<DayPhase, number>;
  readonly #pauses = new Set<ClockPauseReason>();

  constructor(durations: PhaseDurations = DEFAULT_PHASE_DURATIONS) {
    if (!durations || typeof durations !== 'object' || Array.isArray(durations)
      || Object.keys(durations).some(key => !['daySeconds', 'duskSeconds', 'nightSeconds'].includes(key)))
      throw new Error('阶段时长配置无效');
    const rate = (minutes: number, seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(minutes / seconds) || minutes / seconds <= 0)
        throw new Error('阶段时长必须为有效的正有限秒数');
      return minutes / seconds;
    };
    this.#rates = { day: rate(720, durations.daySeconds), dusk: rate(120, durations.duskSeconds),
      night: rate(600, durations.nightSeconds) };
  }

  isPaused(): boolean { return this.#pauses.size > 0; }
  getPauseReasons(): ClockPauseReason[] { return Array.from(this.#pauses); }
  setPaused(reason: ClockPauseReason, paused: boolean): void {
    if (!PAUSE_REASONS.includes(reason) || typeof paused !== 'boolean') throw new Error('暂停原因或状态无效');
    if (paused) this.#pauses.add(reason); else this.#pauses.delete(reason);
  }
  read(value: number): ClockReading {
    const time = readGameTime(value), boundary = nextBoundary(value, time.phase);
    return { ...time, nextBoundaryMinute: boundary, secondsToNextBoundary: (boundary - value) / this.#rates[time.phase] };
  }

  /** 普通推进会消费跨阶段后剩余的模拟秒，每个阶段使用自己的倍率。 */
  advance(fromWorldMinute: number, deltaSeconds: number): ClockAdvance {
    worldMinute(fromWorldMinute); simulationSeconds(deltaSeconds);
    const result: ClockAdvance = { fromWorldMinute, worldMinute: fromWorldMinute, events: [] };
    if (this.isPaused() || deltaSeconds === 0) return result;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      const reading = this.read(result.worldMinute), rate = this.#rates[reading.phase];
      const distance = reading.nextBoundaryMinute - result.worldMinute;
      if (remaining * rate + BOUNDARY_EPSILON >= distance) {
        worldMinute(reading.nextBoundaryMinute);
        remaining = Math.max(0, remaining - reading.secondsToNextBoundary);
        result.worldMinute = reading.nextBoundaryMinute;
        appendBoundary(result.events, result.worldMinute);
      } else {
        const next = result.worldMinute + remaining * rate;
        worldMinute(next);
        if (next === result.worldMinute) throw new Error('世界时间精度不足以表达本次推进');
        result.worldMinute = next;
        remaining = 0;
      }
    }
    return result;
  }

  /** 显式向前跳时仍按 (起点, 终点] 枚举边界；起点事件不会因恢复而重播。 */
  advanceTo(fromWorldMinute: number, targetWorldMinute: number): ClockAdvance {
    worldMinute(fromWorldMinute); worldMinute(targetWorldMinute);
    if (targetWorldMinute < fromWorldMinute) throw new Error('世界时间不能倒退');
    const result: ClockAdvance = { fromWorldMinute, worldMinute: fromWorldMinute, events: [] };
    if (this.isPaused() || targetWorldMinute === fromWorldMinute) return result;
    let cursor = fromWorldMinute;
    while (true) {
      const boundary = nextBoundary(cursor, readGameTime(cursor).phase);
      if (boundary > targetWorldMinute) break;
      appendBoundary(result.events, boundary);
      cursor = boundary;
    }
    result.worldMinute = targetWorldMinute;
    return result;
  }
}
