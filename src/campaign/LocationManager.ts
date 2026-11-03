import type { Game } from '../core/Game';
import { GameScene, InvalidLocationStateError } from '../scenes/GameScene';
import { CampaignHud } from '../ui/CampaignHud';
import type { Rect } from '../ui/HudTypes';
import { CampaignSession } from './CampaignSession';
import { parseCampaignState } from './CampaignState';
import type { LocationResumeState } from './LocationResumeState';
import type { LocationId, LocationState, PersistentPlayerState, Pose } from './CampaignState';
import { SaveRepository, CampaignSaveError } from './SaveRepository';
import { CAMPAIGN_DEFINITION_VERSION, LOCATION_DEFINITIONS, createLocationMap, initializeLocation } from './LocationDefinitions';

/** 只模拟当前地图。候选加载期间保留源运行态，成功激活后一次提交并销毁源场景。 */
export class LocationManager {
  session!: CampaignSession;
  private current?: GameScene;
  private generation = 0;
  private loading = false;
  private ended = false;
  private message = '';
  private hud?: CampaignHud;
  private hudOwner?: GameScene;
  private saveElapsed = 0;
  private savePending = false;
  private saveError = false;
  private saveLocked = false;
  private saveMessage = '自动保存已启用';
  private lastPayload = '';
  private readonly onPageHide = () => { this.requestSave(); };
  private constructor(private readonly game: Game, private readonly saves: SaveRepository) {}

  static async start(game: Game, saves: SaveRepository, resume = false): Promise<LocationManager> {
    const manager = new LocationManager(game, saves);
    const previousScene = game.sceneManager.getCurrentScene();
    let target: GameScene | undefined;
    try {
      if (resume) {
        const loaded = saves.read();
        if (!loaded.exists) throw new Error('没有可继续的战役');
        for (let index = 0; index < loaded.candidates.length; index++) {
          const candidate = loaded.candidates[index], state = candidate.state;
          const scene = manager.createScene(state.locations[state.presence.locationId], state.player,
            state.nextInstanceSequence, { position: state.presence.position, facing: state.presence.facing }, candidate.runtime);
          try { await scene.load(); }
          catch (error) {
            scene.disposePrepared();
            if (error instanceof InvalidLocationStateError) continue;
            throw error;
          }
          target = scene; manager.session = CampaignSession.restore(state); saves.select(candidate);
          manager.lastPayload = JSON.stringify({ state, runtime: candidate.runtime });
          manager.saveMessage = loaded.recovered || index > 0 ? '已从上一份有效自动存档恢复' : '已继续战役 · 自动保存已启用';
          break;
        }
        if (!target) throw new CampaignSaveError('corrupt', '自动存档中的地点数据无效，原数据已保留。');
      } else {
        const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
        const empty: LocationState = { locationId: 'outpost', definitionVersion: CAMPAIGN_DEFINITION_VERSION,
          seed: (seed ^ 0x6f757470) >>> 0, initialized: false, lastVisitedDay: null,
          spawns: {}, containers: {}, groundItems: [], terrainChanges: [], exploration: null, structures: [] };
        target = manager.createScene(initializeLocation(empty, 1), undefined, 0);
        await target.load();
        manager.session = CampaignSession.create({ worldSeed: seed, definitionVersion: CAMPAIGN_DEFINITION_VERSION,
          player: target.captureCampaignPlayer(), outpostSpawn: target.captureCampaignPose() });
        manager.session.commitCurrentLocation(0, target.captureCampaignCheckpoint(1));
      }
      if (game.sceneManager.getCurrentScene() !== previousScene) throw new Error('启动已取消');
      manager.current = target; target.campaign = manager;
      const state = manager.session.getSnapshot();
      manager.ended = state.lifecycle.kind !== 'playing';
      if (manager.ended) manager.message = state.lifecycle.kind === 'recovering' ? '战役等待恢复结算。' : '战役已经结束。';
      const previousManager = game.campaign;
      game.sceneManager.changePreparedScene(target, () => {
        if (!resume) {
          const runtime = target!.captureCampaignRuntime();
          saves.create(state, runtime); manager.lastPayload = JSON.stringify({ state, runtime });
        }
        game.campaign = manager;
      });
      previousManager?.dispose();
      window.addEventListener('pagehide', manager.onPageHide);
      game.resetFrameTime();
      return manager;
    } catch (error) {
      target?.disposePrepared();
      throw error;
    }
  }

  dispose(): void { this.cancelTransition(); window.removeEventListener('pagehide', this.onPageHide); }

  private createScene(location: LocationState, player: PersistentPlayerState | undefined, nextInstanceSequence: number,
    pose: Pose = LOCATION_DEFINITIONS[location.locationId].entrance, runtime?: LocationResumeState): GameScene {
    return new GameScene({ seed: location.seed, map: createLocationMap(location.locationId, location.seed), playerSpawn: pose.position,
      campaignData: { location, player, pose, nextInstanceSequence, runtime } });
  }

  /** 只在完整事务结束后调用；加载中的请求排队，当前地图的危险实体随检查点一起保存。 */
  requestSave(): boolean {
    if (!this.current || this.game.sceneManager.getCurrentScene() !== this.current || this.saveLocked) return false;
    this.savePending = true;
    if (this.loading) {
      if (!this.saveError) this.saveMessage = '自动保存等待地图加载结束';
      return false;
    }
    this.savePending = false; this.saveElapsed = 0;
    try {
      const runtime = this.current.captureCampaignRuntime();
      if (!this.ended) {
        const clock = this.session.getClockReading(), checkpoint = this.current.captureCampaignCheckpoint(clock.day);
        // 同一帧的 blur/hidden/pagehide 请求合并；保存本身不推进时间或消耗资源。
        const before = this.session.getSnapshot();
        const candidate = { ...before, player: checkpoint.player, presence: { locationId: checkpoint.locationId, ...checkpoint.pose },
          nextInstanceSequence: checkpoint.nextInstanceSequence!, locations: { ...before.locations, [checkpoint.locationId]: checkpoint.location } };
        if (JSON.stringify({ state: parseCampaignState(candidate), runtime }) !== this.lastPayload)
          this.session.commitCurrentLocation(clock.revision, checkpoint);
      }
      const state = this.session.getSnapshot(), payload = JSON.stringify({ state, runtime });
      if (payload !== this.lastPayload || this.saveError) this.saves.save(state, runtime);
      this.lastPayload = payload; this.saveError = false;
      this.saveMessage = '已自动保存';
      this.refreshHud(this.current);
      return true;
    } catch (error) {
      this.saveError = true;
      this.saveLocked = error instanceof CampaignSaveError && error.kind === 'conflict';
      this.saveMessage = error instanceof Error ? error.message : '自动保存失败，已有存档仍然保留。';
      this.refreshHud(this.current);
      return false;
    }
  }
  isEnded(): boolean { return this.ended; }
  isTransitioning(): boolean { return this.loading; }

  attachHud(scene: GameScene): void {
    this.hud?.dispose(); this.hudOwner = scene;
    this.hud = new CampaignHud(() => { void this.travel(); }, () => this.endDay(), () => this.cancelTransition(), () => { this.requestSave(); }, () => scene.toggleConstruction());
    this.refreshHud(scene);
  }
  detachHud(scene: GameScene): void {
    if (this.hudOwner !== scene) return;
    this.hud?.dispose(); this.hud = undefined; this.hudOwner = undefined;
  }
  layoutHud(scene: GameScene, clock: Rect): void {
    if (this.hudOwner === scene) this.hud?.setClockLayout(clock);
  }
  refreshHud(scene: GameScene): void {
    if (!this.hud || this.hudOwner !== scene) return;
    const id = scene.getCampaignLocationId()!, definition = LOCATION_DEFINITIONS[id], reading = this.session.getClockReading();
    const blocked = id === 'outpost' && reading.phase !== 'day'
      ? reading.phase === 'night' ? '夜间请留在营地防守' : '黄昏期间请留在营地准备' : scene.getTravelBlock();
    this.hud.update(reading, definition.name, LOCATION_DEFINITIONS[definition.destination].name, blocked,
      id === 'outpost' && reading.phase === 'day' && !scene.hasDangerousThrowables(), this.loading, this.ended, this.message,
      this.saveMessage, this.saveError && !this.saveLocked, scene.canStartConstruction(), scene.isConstructionPlanning());
  }
  advance(scene: GameScene, seconds: number): void {
    if (scene !== this.current || this.loading || this.ended) return;
    const result = this.session.advanceTime(this.session.getClockReading().revision, seconds);
    const clock = this.session.getClockReading();
    if (!scene.getPlayer().isAlive()) {
      scene.settleCampaignDeath();
      const death = scene.captureCampaignCheckpoint(clock.day);
      death.reason = { kind: 'player-death', resolutionId: 'death-' + clock.revision };
      this.session.commitCurrentLocation(clock.revision, death);
      this.ended = true; this.message = '已失去战斗能力，战役等待恢复结算。';
    } else {
      if (result.events.some(e => e.type === 'DayStarted')) this.message = '新的一天开始了';
      else if (result.events.some(e => e.type === 'DuskStarted')) this.message = '黄昏已至，准备返回营地';
    }
    if (!clock.paused) this.saveElapsed += seconds;
    const structuresChanged = scene.consumeStructureChanges();
    if (this.ended || result.events.length || structuresChanged || this.savePending || this.saveElapsed >= 30) this.requestSave();
    this.refreshHud(scene);
  }
  endDay(): void {
    if (!this.current || this.loading || this.ended || this.current.hasDangerousThrowables()) return;
    try { this.session.endDay(this.session.getClockReading().revision); this.message = '已进入黄昏，准备夜间防守'; this.requestSave(); }
    catch (error) { this.message = error instanceof Error ? error.message : String(error); }
    this.game.resetFrameTime?.(); this.refreshHud(this.current);
  }

  cancelTransition(): void {
    if (!this.loading) return;
    this.generation++; this.loading = false; this.message = '已取消出发';
    this.current?.setTransitionPaused(false);
    this.game.resetFrameTime?.();
  }

  async travel(): Promise<boolean> {
    const source = this.current;
    if (!source || this.loading || this.ended || this.game.sceneManager.getCurrentScene() !== source) return false;
    const reading = this.session.getClockReading(), id = source.getCampaignLocationId()!;
    if (reading.paused || (id === 'outpost' && reading.phase !== 'day')) return false;
    let candidate: GameScene | undefined;
    const generation = ++this.generation;
    try {
      source.prepareTravel(); this.requestSave();
      this.loading = true; source.setTransitionPaused(true); this.message = '正在前往另一处地点…';
      const checkpoint = source.captureCampaignCheckpoint(reading.day);
      const saved = this.session.getSnapshot(), destination: LocationId = LOCATION_DEFINITIONS[id].destination;
      const location = initializeLocation(saved.locations[destination], reading.day);
      candidate = this.createScene(location, checkpoint.player, checkpoint.nextInstanceSequence!);
      await candidate.load();
      if (generation !== this.generation || this.game.sceneManager.getCurrentScene() !== source) {
        candidate.disposePrepared(); return false;
      }
      const target = candidate.captureCampaignCheckpoint(reading.day);
      candidate.campaign = this;
      this.game.sceneManager.changePreparedScene(candidate, () => {
        this.session.commitLocationTransition(saved.revision, checkpoint, target);
        this.current = candidate;
      });
      this.message = '已到达' + LOCATION_DEFINITIONS[destination].name; this.savePending = true;
      return true;
    } catch (error) {
      candidate?.disposePrepared();
      if (generation === this.generation) this.message = '切换未完成：' + (error instanceof Error ? error.message : String(error)) + '。原地点已保留，可重试。';
      return false;
    } finally {
      if (generation === this.generation) {
        this.loading = false; this.current?.setTransitionPaused(false); this.game.resetFrameTime?.();
        if (this.savePending) this.requestSave();
        if (this.current) this.refreshHud(this.current);
      }
    }
  }
}
