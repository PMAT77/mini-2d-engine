import { campaignFields, parseCampaignState, CAMPAIGN_SCHEMA_VERSION } from './CampaignState';
import type { CampaignState } from './CampaignState';
import { parseLocationResume } from './LocationResumeState';
import type { LocationResumeState } from './LocationResumeState';

export const ACTIVE_CAMPAIGN_KEY = 'mini-2d-engine:campaign:active';
export const campaignSaveKey = (id: string, slot: number) => 'mini-2d-engine:campaign:' + encodeURIComponent(id) + ':' + slot;
export class CampaignSaveError extends Error {
  constructor(readonly kind: 'corrupt' | 'incompatible' | 'conflict' | 'storage', message: string) { super(message); }
}
export interface SavedCampaign { slot: number; saveSequence: number; state: CampaignState; runtime: LocationResumeState; }
export interface SaveReadResult { exists: boolean; recovered: boolean; candidates: SavedCampaign[]; }
type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 两个完整自动档交替写入；不保存场景对象，也不提供历史档选择。 */
export class SaveRepository {
  private activeRaw: string | null | undefined;
  private activeId?: string;
  private slots: (string | null)[] = [null, null];
  private sequence = 0;
  private selectedSlot = -1;
  constructor(private readonly storage: SaveStorage, private readonly definitionVersion: string) {}

  read(): SaveReadResult {
    this.activeRaw = this.get(ACTIVE_CAMPAIGN_KEY);
    this.activeId = undefined; this.slots = [null, null]; this.sequence = 0; this.selectedSlot = -1;
    if (this.activeRaw === null) return { exists: false, recovered: false, candidates: [] };
    try {
      const active = JSON.parse(this.activeRaw);
      if (active?.formatVersion > 1) throw new CampaignSaveError('incompatible', '存档由更高版本创建，请使用兼容版本继续。');
      campaignFields(active, 'activeSave', ['formatVersion', 'campaignId']);
      if (active.formatVersion !== 1 || typeof active.campaignId !== 'string' || !active.campaignId.trim()) throw new Error();
      this.activeId = active.campaignId;
    } catch (error) {
      if (error instanceof CampaignSaveError) throw error;
      throw new CampaignSaveError('corrupt', '战役索引损坏，原存档已保留。');
    }
    this.slots = [0, 1].map(slot => this.get(campaignSaveKey(this.activeId!, slot)));
    const candidates: SavedCampaign[] = [];
    let invalid = false;
    for (let slot = 0; slot < 2; slot++) {
      const raw = this.slots[slot];
      if (raw === null) continue;
      try {
        const envelope = JSON.parse(raw);
        if (envelope?.formatVersion > 1 || envelope?.payload?.schemaVersion > CAMPAIGN_SCHEMA_VERSION)
          throw new CampaignSaveError('incompatible', '存档由更高版本创建，请使用兼容版本继续。');
        if (typeof envelope?.payload?.definitionVersion === 'string' && envelope.payload.definitionVersion !== this.definitionVersion)
          throw new CampaignSaveError('incompatible', '存档的地图内容版本不兼容，原存档已保留。');
        campaignFields(envelope, 'save', ['formatVersion', 'campaignId', 'saveSequence', 'payload', 'runtime']);
        if (envelope.formatVersion !== 1 || envelope.campaignId !== this.activeId
          || !Number.isSafeInteger(envelope.saveSequence) || envelope.saveSequence < 1) throw new Error();
        this.sequence = Math.max(this.sequence, envelope.saveSequence);
        const state = this.validate(envelope.payload);
        if (state.campaignId !== this.activeId) throw new Error();
        candidates.push({ slot, saveSequence: envelope.saveSequence, state, runtime: parseLocationResume(envelope.runtime, state.player) });
      } catch (error) {
        if (error instanceof CampaignSaveError && error.kind === 'incompatible') throw error;
        invalid = true;
      }
    }
    candidates.sort((a, b) => b.saveSequence - a.saveSequence);
    if (!candidates.length) throw new CampaignSaveError('corrupt', '两份自动存档均无法读取，原数据已保留。');
    if (candidates.length === 2 && candidates[0].saveSequence === candidates[1].saveSequence)
      throw new CampaignSaveError('corrupt', '自动存档序号冲突，原数据已保留。');
    this.selectedSlot = candidates[0].slot;
    return { exists: true, recovered: invalid, candidates };
  }

  /** 运行态校验若拒绝最新档，下一次写入必须保护真正恢复成功的备份。 */
  select(candidate: SavedCampaign): void {
    if (candidate.state.campaignId !== this.activeId || ![0, 1].includes(candidate.slot)) throw new Error('恢复来源不匹配');
    this.selectedSlot = candidate.slot;
  }

  create(value: CampaignState, runtime: LocationResumeState): void {
    const state = this.validate(value), raw = this.encode(state, runtime, 1);
    this.assertUnchanged();
    if (state.campaignId === this.activeId) throw new Error('新战役必须使用新身份');
    const key = campaignSaveKey(state.campaignId, 0);
    if (this.get(key) !== null || this.get(campaignSaveKey(state.campaignId, 1)) !== null) throw new Error('新战役身份已存在');
    this.put(key, raw);
    const active = JSON.stringify({ formatVersion: 1, campaignId: state.campaignId });
    // 指针切换是最后一步；写入失败时，之前的战役仍是继续游戏的来源。
    try { this.put(ACTIVE_CAMPAIGN_KEY, active); }
    catch (error) {
      try { this.storage.removeItem(key); } catch { /* 不影响旧活动战役。 */ }
      throw error;
    }
    const oldId = this.activeId;
    this.activeRaw = active; this.activeId = state.campaignId;
    this.slots = [raw, null]; this.sequence = 1; this.selectedSlot = 0;
    // 新战役确认成功后再清理旧命名空间；清理失败不撤销已经完成的保存。
    if (oldId) for (let slot = 0; slot < 2; slot++) {
      try { this.storage.removeItem(campaignSaveKey(oldId, slot)); } catch { /* 仅遗留无活动引用的数据。 */ }
    }
  }

  save(value: CampaignState, runtime: LocationResumeState): void {
    const state = this.validate(value);
    if (state.campaignId !== this.activeId || this.selectedSlot < 0) throw new Error('未绑定当前战役存档');
    const next = this.sequence + 1;
    if (!Number.isSafeInteger(next)) throw new Error('存档序号溢出');
    const raw = this.encode(state, runtime, next);
    this.assertUnchanged();
    const slot = 1 - this.selectedSlot;
    this.put(campaignSaveKey(state.campaignId, slot), raw);
    this.slots[slot] = raw; this.sequence = next; this.selectedSlot = slot;
  }

  private validate(value: unknown): CampaignState {
    const state = parseCampaignState(value);
    if (state.definitionVersion !== this.definitionVersion
      || Object.values(state.locations).some(location => location.definitionVersion !== this.definitionVersion))
      throw new CampaignSaveError('incompatible', '存档的地图内容版本不兼容，原存档已保留。');
    if (!state.locations[state.presence.locationId].initialized) throw new Error('当前地点尚未初始化');
    return state;
  }
  private encode(state: CampaignState, runtime: LocationResumeState, sequence: number): string {
    return JSON.stringify({ formatVersion: 1, campaignId: state.campaignId, saveSequence: sequence,
      payload: state, runtime: parseLocationResume(runtime, state.player) });
  }
  private assertUnchanged(): void {
    if (this.activeRaw === undefined) throw new Error('保存前必须读取当前存档');
    if (this.get(ACTIVE_CAMPAIGN_KEY) !== this.activeRaw || (this.activeId && this.slots.some((raw, slot) => this.get(campaignSaveKey(this.activeId!, slot)) !== raw)))
      throw new CampaignSaveError('conflict', '存档已被其他窗口更新，请刷新页面后继续；本窗口不会覆盖它。');
  }
  private get(key: string): string | null {
    try { return this.storage.getItem(key); }
    catch { throw new CampaignSaveError('storage', '无法读取本地存档，请检查浏览器的存储权限。'); }
  }
  private put(key: string, raw: string): void {
    try { this.storage.setItem(key, raw); }
    catch { throw new CampaignSaveError('storage', '自动保存失败：本地存储不可用或空间不足。已有完整存档仍然保留。'); }
  }
}
