import { campaignFields, parseCampaignState } from './CampaignState';
import type { CampaignState, CurrentLocationCheckpoint, LocationId, LocationState, NewCampaignInput } from './CampaignState';
import { GameClock } from './GameClock';
import type { ClockAdvance, ClockPauseReason, ClockReading, PhaseDurations } from './GameClock';

export interface CampaignClockReading extends ClockReading {
  revision: number;
  paused: boolean;
  pauseReasons: ClockPauseReason[];
}

function emptyLocation(locationId: LocationId, seed: number, definitionVersion: string): LocationState {
  return { locationId, seed, definitionVersion, initialized: false, lastVisitedDay: null,
    spawns: {}, containers: {}, groundItems: [], terrainChanges: [], exploration: null, structures: [] };
}

/** 长期数据的唯一提交入口；时钟只计算推进计划，不再持有第二份世界时间。 */
export class CampaignSession {
  #state: CampaignState;
  readonly #clock: GameClock;

  private constructor(state: CampaignState, durations?: PhaseDurations) {
    this.#state = parseCampaignState(state);
    this.#clock = new GameClock(durations);
  }

  /** 读取完整检查点，不重播日期事件，也不恢复上次 UI 暂停或现实时间。 */
  static restore(state: unknown): CampaignSession { return new CampaignSession(parseCampaignState(state)); }

  static create(input: NewCampaignInput, durations?: PhaseDurations): CampaignSession {
    campaignFields(input, 'newCampaign', ['definitionVersion', 'player', 'outpostSpawn'], ['campaignId', 'worldSeed']);
    const spawn = campaignFields(input.outpostSpawn, 'newCampaign.outpostSpawn', ['position', 'facing']);
    const campaignId = input.campaignId === undefined ? globalThis.crypto.randomUUID() : input.campaignId;
    const seed = input.worldSeed === undefined ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] : input.worldSeed;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('战役种子必须是无符号 32 位整数');
    return new CampaignSession({
      schemaVersion: 2, definitionVersion: input.definitionVersion, campaignId, worldSeed: seed,
      worldMinute: 0, revision: 0, nextInstanceSequence: 0, lifecycle: { kind: 'playing' },
      presence: { locationId: 'outpost', position: spawn.position as NewCampaignInput['outpostSpawn']['position'], facing: spawn.facing as number },
      player: input.player,
      locations: {
        outpost: emptyLocation('outpost', (seed ^ 0x6f757470) >>> 0, input.definitionVersion),
        residential: emptyLocation('residential', (seed ^ 0x72657369) >>> 0, input.definitionVersion),
      },
      resolvedRaidIds: [], statistics: { kills: 0, expeditions: 0 },
    }, durations);
  }

  /** 返回脱离内部状态的检查点；调用方可自由编辑副本。 */
  getSnapshot(): CampaignState { return parseCampaignState(this.#state); }

  getClockReading(): CampaignClockReading {
    return { ...this.#clock.read(this.#state.worldMinute), revision: this.#state.revision,
      paused: this.#clock.isPaused(), pauseReasons: this.#clock.getPauseReasons() };
  }

  setTimePaused(reason: ClockPauseReason, paused: boolean): void {
    if (paused && (reason === 'storage' || reason === 'construction')
      && (this.#state.presence.locationId !== 'outpost' || this.#clock.read(this.#state.worldMinute).phase !== 'day'))
      throw new Error('仓储和建造规划只能在营地白天暂停');
    this.#clock.setPaused(reason, paused);
  }

  /** 完整模拟夜间；所有事件在成功提交后才返回，失败不会对外派发。 */
  advanceTime(expectedRevision: number, deltaSeconds: number): ClockAdvance {
    this.assertCurrentRevision(expectedRevision);
    if (this.#state.lifecycle.kind !== 'playing') throw new Error('待结算或失败的战役不能推进时间');
    return this.commitTime(this.#clock.advance(this.#state.worldMinute, deltaSeconds));
  }

  /** UI 完成确认后调用；跳到 18:00，仍保留黄昏准备时间。 */
  endDay(expectedRevision: number): ClockAdvance {
    this.assertCurrentRevision(expectedRevision);
    const reading = this.#clock.read(this.#state.worldMinute);
    if (this.#state.lifecycle.kind !== 'playing' || this.#state.presence.locationId !== 'outpost' || reading.phase !== 'day')
      throw new Error('只能在营地白天提前结束白天');
    return this.commitTime(this.#clock.advanceTo(this.#state.worldMinute, reading.nextBoundaryMinute));
  }

  private commitTime(result: ClockAdvance): ClockAdvance {
    if (result.worldMinute === this.#state.worldMinute) return result;
    const revision = this.#state.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('战役检查点版本溢出');
    // 时间只向前，既有日期/资源约束仍成立；无需每帧复制整张地图。
    this.#state = { ...this.#state, worldMinute: result.worldMinute, revision };
    return result;
  }

  private assertCurrentRevision(expectedRevision: number): void {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== this.#state.revision)
      throw new Error('战役检查点已过期或版本无效');
  }

  commitCurrentLocation(expectedRevision: number, checkpoint: CurrentLocationCheckpoint): void {
    this.assertCurrentRevision(expectedRevision);
    if (this.#state.lifecycle.kind !== 'playing') throw new Error('待结算或失败的战役不能通过普通检查点恢复');
    campaignFields(checkpoint, 'checkpoint', ['locationId', 'player', 'pose', 'location', 'reason'], ['nextInstanceSequence']);
    campaignFields(checkpoint.pose, 'checkpoint.pose', ['position', 'facing']);
    if (checkpoint.locationId !== this.#state.presence.locationId) throw new Error('普通检查点不能切换地点');
    const reason = campaignFields(checkpoint.reason, 'checkpoint.reason', ['kind'], ['resolutionId']);
    let nextLifecycle: CampaignState['lifecycle'] = this.#state.lifecycle;
    if (reason.kind === 'player-death') {
      campaignFields(reason, 'checkpoint.reason', ['kind', 'resolutionId']);
      nextLifecycle = { kind: 'recovering', resolutionId: reason.resolutionId as string,
        deathLocationId: checkpoint.locationId, deathWorldMinute: this.#state.worldMinute, raidId: null };
    } else if (reason.kind === 'checkpoint') {
      campaignFields(reason, 'checkpoint.reason', ['kind']);
    } else throw new Error('不支持的战役检查点原因');

    // 先构造和验证整份候选，最后才替换；失效输入不会留下半次物品转移。
    const next = parseCampaignState({
      ...this.#state, revision: this.#state.revision + 1, lifecycle: nextLifecycle,
      nextInstanceSequence: this.checkSequence(checkpoint.nextInstanceSequence),
      player: checkpoint.player,
      presence: { locationId: checkpoint.locationId, position: checkpoint.pose.position, facing: checkpoint.pose.facing },
      locations: { ...this.#state.locations, [checkpoint.locationId]: checkpoint.location },
    });
    this.validateLocationTransition(this.#state.locations[checkpoint.locationId], next.locations[checkpoint.locationId]);
    this.#state = next;
  }

  /** 源地点、目标地点和随身物品只有一个提交点；旅行耗时在 P1 为零。 */
  commitLocationTransition(expectedRevision: number, source: CurrentLocationCheckpoint, target: CurrentLocationCheckpoint): void {
    this.assertCurrentRevision(expectedRevision);
    if (this.#state.lifecycle.kind !== 'playing' || source.locationId !== this.#state.presence.locationId
      || target.locationId === source.locationId || source.reason.kind !== 'checkpoint' || target.reason.kind !== 'checkpoint'
      || !target.location.initialized) throw new Error('地点切换状态无效');
    for (const checkpoint of [source, target]) {
      campaignFields(checkpoint, 'checkpoint', ['locationId', 'player', 'pose', 'location', 'reason'], ['nextInstanceSequence']);
      campaignFields(checkpoint.pose, 'checkpoint.pose', ['position', 'facing']);
      campaignFields(checkpoint.reason, 'checkpoint.reason', ['kind']);
      if (checkpoint.locationId !== 'outpost' && checkpoint.locationId !== 'residential') throw new Error('未知地点');
      this.validateLocationTransition(this.#state.locations[checkpoint.locationId], checkpoint.location);
    }
    const sourceSequence = this.checkSequence(source.nextInstanceSequence);
    const targetSequence = this.checkSequence(target.nextInstanceSequence ?? sourceSequence);
    if (targetSequence < sourceSequence) throw new Error('物品实例序号不能倒退');
    const next = parseCampaignState({ ...this.#state, revision: this.#state.revision + 1,
      nextInstanceSequence: targetSequence, player: source.player,
      presence: { locationId: target.locationId, ...target.pose },
      locations: { ...this.#state.locations, [source.locationId]: source.location, [target.locationId]: target.location },
      statistics: { ...this.#state.statistics, expeditions: this.#state.statistics.expeditions + (target.locationId === 'residential' ? 1 : 0) } });
    if (JSON.stringify(parseCampaignState({ ...next, player: target.player }).player) !== JSON.stringify(next.player))
      throw new Error('切图不能修改随身资源');
    this.#state = next;
  }

  private checkSequence(value = this.#state.nextInstanceSequence): number {
    if (!Number.isSafeInteger(value) || value < this.#state.nextInstanceSequence) throw new Error('物品实例序号无效或倒退');
    return value;
  }

  private validateLocationTransition(previous: LocationState, next: LocationState): void {
    if (previous.seed !== next.seed || previous.definitionVersion !== next.definitionVersion)
      throw new Error('普通检查点不能修改地点种子或定义版本');
    if (previous.initialized && !next.initialized) throw new Error('不能重置已初始化地点');
    if (previous.lastVisitedDay !== null && (next.lastVisitedDay === null || next.lastVisitedDay < previous.lastVisitedDay))
      throw new Error('地点访问日期不能倒退');
    if (!previous.initialized) return;
    if (Object.keys(previous.spawns).length !== Object.keys(next.spawns).length
      || Object.keys(previous.containers).length !== Object.keys(next.containers).length)
      throw new Error('普通检查点不能重新生成地点内容');
    for (const [id, old] of Object.entries(previous.spawns)) {
      const current = next.spawns[id];
      if (!current || old.generation !== current.generation || old.lastRefreshDay !== current.lastRefreshDay
        || old.occupant.kind !== current.occupant.kind
        || (old.occupant.value === null && current.occupant.value !== null)
        || (old.occupant.value && current.occupant.value && old.occupant.value.instanceId !== current.occupant.value.instanceId))
        throw new Error('普通检查点不能刷新或重建生成点: ' + id);
    }
    for (const [id, old] of Object.entries(previous.containers)) {
      const current = next.containers[id];
      if (!current || old.generation !== current.generation || old.lastRefreshDay !== current.lastRefreshDay || (old.opened && !current.opened))
        throw new Error('普通检查点不能重置容器: ' + id);
    }
  }
}
