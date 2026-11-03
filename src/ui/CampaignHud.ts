import type { CampaignClockReading } from '../campaign/CampaignSession';
import type { Rect } from './HudTypes';

export class CampaignHud {
  readonly root = document.createElement('section');
  private readonly clock = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly travel = document.createElement('button');
  private readonly endDay = document.createElement('button');
  private readonly cancel = document.createElement('button');
  private readonly saveStatus = document.createElement('div');
  private readonly retry = document.createElement('button');
  private readonly construction = document.createElement('button');
  private confirming = false;
  constructor(onTravel: () => void, onEndDay: () => void, onCancel: () => void, onRetrySave: () => void, onConstruction: () => void) {
    this.root.dataset.campaignHud = ''; this.root.setAttribute('aria-label', '战役时间与地点');
    this.root.style.cssText = 'position:fixed;top:160px;left:50%;transform:translateX(-50%);width:max-content;box-sizing:border-box;max-width:calc(100vw - 24px);color:#c6c6be;font:11px/1.5 sans-serif;z-index:30;text-align:center;pointer-events:auto';
    this.clock.dataset.campaignClock = '';
    // 顶部时间由 DayClockHud 唯一呈现，保留原读数作为无障碍和集成查询接口。
    this.clock.hidden = true;
    this.message.setAttribute('role', 'status'); this.message.style.cssText = 'color:#b9c9c2;font-size:12px';
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center';
    for (const button of [this.travel, this.endDay, this.construction, this.cancel, this.retry]) {
      button.type = 'button';
      button.style.cssText = 'padding:2px 6px;border:0;background:rgba(8,9,10,.65);color:inherit;cursor:pointer;font:inherit;white-space:nowrap';
      actions.append(button);
    }
    this.travel.dataset.campaignTravel = ''; this.endDay.dataset.campaignEndDay = ''; this.cancel.textContent = '取消';
    this.travel.onclick = () => { this.confirming = false; onTravel(); };
    this.endDay.onclick = () => {
      if (!this.confirming) this.confirming = true;
      else { this.confirming = false; onEndDay(); }
    };
    this.cancel.onclick = () => { this.confirming = false; onCancel(); };
    this.retry.dataset.campaignRetrySave = ''; this.retry.textContent = '重试自动保存'; this.retry.onclick = onRetrySave;
    this.construction.dataset.campaignConstruction = ''; this.construction.textContent = '营地建设'; this.construction.onclick = onConstruction;
    this.saveStatus.dataset.campaignSaveStatus = ''; this.saveStatus.setAttribute('role', 'status');
    this.saveStatus.style.cssText = 'font-size:11px;max-width:420px;white-space:normal';
    this.root.addEventListener('pointerdown', event => event.stopPropagation());
    this.root.append(this.clock, actions, this.message, this.saveStatus); document.body.append(this.root);
  }
  update(reading: CampaignClockReading, location: string, destination: string, blocked: string | null,
    canEnd: boolean, loading: boolean, ended: boolean, message: string, saveMessage: string, canRetry: boolean, canBuild: boolean, planning: boolean): void {
    const phase = { day: '白天', dusk: '黄昏', night: '夜间' }[reading.phase];
    this.clock.textContent = location + ' · 第 ' + reading.day + ' 天 · ' + String(reading.hour).padStart(2, '0') + ':' +
      String(reading.minute).padStart(2, '0') + ' ' + phase + (reading.paused ? ' · 已暂停' : '');
    this.travel.textContent = '前往' + destination; this.travel.disabled = !!blocked || loading || ended || reading.paused;
    this.travel.title = blocked ?? '';
    this.endDay.hidden = !canEnd && !this.confirming; this.endDay.disabled = !canEnd || loading || ended || reading.paused;
    this.endDay.textContent = this.confirming ? '确认推进至 18:00' : '结束白天';
    this.cancel.hidden = !loading && !this.confirming;
    for (const button of [this.travel, this.endDay]) button.style.opacity = button.disabled ? '.5' : '1';
    this.message.textContent = loading || ended ? message : this.confirming ? '黄昏准备时间仍会保留'
      : blocked || message || '从入口出发，探索后可返回';
    this.message.hidden = !loading && !ended && !this.confirming && !message.startsWith('切换未完成：');
    this.saveStatus.textContent = saveMessage; this.saveStatus.style.color = canRetry ? '#f1b390' : '#9aa99f';
    this.retry.hidden = !canRetry; this.retry.disabled = loading;
    this.construction.hidden = location !== '营地'; this.construction.disabled = !canBuild && !planning;
    this.construction.textContent = planning ? '完成建设' : '营地建设'; this.construction.style.opacity = this.construction.disabled ? '.5' : '1';
  }
  setClockLayout(clock: Rect): void {
    const narrow = window.innerWidth < 360;
    this.root.style.top = narrow ? '58px' : `${clock.y + clock.height + 4}px`;
    this.root.style.left = narrow ? 'auto' : '50%'; this.root.style.right = narrow ? '12px' : 'auto';
    this.root.style.transform = narrow ? 'none' : 'translateX(-50%)';
    this.root.style.maxWidth = narrow ? 'calc(100vw - 150px)' : 'calc(100vw - 24px)';
  }
  dispose(): void { this.root.remove(); }
}
