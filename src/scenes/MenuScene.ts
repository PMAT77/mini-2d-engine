import { Input } from "../core/Input";
import { Scene } from "../core/Scene";
import { GameScene } from "./GameScene";
import { LoadingScene } from "./LoadingScene";
import { LocationManager } from '../campaign/LocationManager';
import { SaveRepository, CampaignSaveError } from '../campaign/SaveRepository';
import { CAMPAIGN_DEFINITION_VERSION } from '../campaign/LocationDefinitions';

export class MenuScene extends Scene {
  private starting = false;
  private confirmingNew = false;
  private hasSave = false;
  private canContinue = false;
  private saves?: SaveRepository;
  private root?: HTMLElement;
  private status?: HTMLElement;
  private continueButton?: HTMLButtonElement;
  private newButton?: HTMLButtonElement;
  constructor(private waitForEnterRelease = false) { super(); }

  onEnter(): void {
    this.game.campaign?.dispose(); this.game.campaign = undefined;
    this.starting = false;
    this.root = document.createElement('section'); this.root.dataset.campaignMenu = '';
    this.root.setAttribute('aria-label', '战役主菜单');
    this.root.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);width:420px;max-width:calc(100vw - 32px);display:grid;gap:12px;text-align:center;color:#e6eee9;font:16px/1.5 sans-serif;z-index:30';
    const add = (label: string, action: () => void) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.style.cssText = 'padding:10px 18px;border:1px solid #42564b;background:#111a16;color:inherit;font:inherit;cursor:pointer';
      button.onclick = () => { this.game.input.clear(); action(); }; this.root!.append(button); return button;
    };
    this.continueButton = add('C · 继续战役', () => { void this.begin(true); }); this.continueButton.dataset.continueCampaign = '';
    this.newButton = add('N · 新建据点战役', () => { void this.begin(false); }); this.newButton.dataset.newCampaign = '';
    add('Enter · 自由测试', () => this.sandbox());
    this.status = document.createElement('p'); this.status.setAttribute('role', 'status'); this.status.style.margin = '0';
    this.root.append(this.status); document.body.append(this.root);
    try {
      this.saves = new SaveRepository(window.localStorage, CAMPAIGN_DEFINITION_VERSION);
      const saved = this.saves.read(); this.hasSave = saved.exists; this.canContinue = saved.candidates.length > 0;
      this.status.textContent = saved.recovered ? '检测到损坏的自动档，继续时将恢复上一份有效档。' : saved.exists ? '继续最近一次有效自动存档' : '开始一场持续生存战役';
    } catch (error) {
      this.hasSave = true;
      if (error instanceof CampaignSaveError && error.kind === 'storage') this.saves = undefined;
      this.status.textContent = error instanceof Error ? error.message : '本地存档不可用';
    }
    this.updateButtons();
  }
  private updateButtons(): void {
    this.root?.querySelectorAll('button').forEach(button => { button.disabled = this.starting; });
    if (this.continueButton) this.continueButton.disabled = this.starting || !this.canContinue;
    if (this.newButton) {
      this.newButton.disabled = this.starting || !this.saves;
      this.newButton.textContent = this.confirmingNew ? '确认开始新战役（替换当前战役）' : 'N · 新建据点战役';
    }
    this.root?.querySelectorAll('button').forEach(button => { button.style.opacity = button.disabled ? '.45' : '1'; });
  }
  private async begin(resume: boolean): Promise<void> {
    if (this.starting || !this.saves || (resume && !this.canContinue)) return;
    if (!resume && this.hasSave && !this.confirmingNew) {
      this.confirmingNew = true;
      this.status!.textContent = '新战役将替换当前战役。再次点击或按 N 确认，Esc 取消。';
      this.updateButtons(); return;
    }
    this.starting = true; this.updateButtons(); this.status!.textContent = resume ? '正在恢复战役…' : '正在创建并保存战役…';
    try { await LocationManager.start(this.game, this.saves, resume); }
    catch (error) {
      this.starting = false; this.confirmingNew = false;
      this.status!.textContent = error instanceof Error ? error.message : '启动失败，原存档已保留';
      this.updateButtons();
    }
  }
  private sandbox(): void {
    if (this.starting) return;
    this.starting = true;
    const target = new GameScene();
    this.game.sceneManager.changeScene(new LoadingScene(progress => target.load(progress), target), 0);
  }
  onSuspend(): void { if (this.root) this.root.hidden = true; }
  onResume(): void { if (this.root) this.root.hidden = false; }
  onExit(): void { this.root?.remove(); this.root = undefined; }
  update(_delta: number, input: Input): void {
    if (this.waitForEnterRelease) { if (!input.isKeyDown('Enter')) this.waitForEnterRelease = false; return; }
    if (this.starting) return;
    if (input.isKeyDown('Escape')) {
      input.clear(); this.confirmingNew = false; this.status!.textContent = '已取消新建战役'; this.updateButtons();
    } else if (input.isKeyDown('n') || input.isKeyDown('c')) {
      const resume = input.isKeyDown('c'); input.clear(); void this.begin(resume);
    } else if (input.isKeyDown('Enter')) { input.clear(); this.sandbox(); }
  }
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
