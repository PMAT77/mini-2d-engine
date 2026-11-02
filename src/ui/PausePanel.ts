import { showPanel } from './PanelMotion';

export class PausePanel {
  readonly root = document.createElement('div');
  constructor(resume: () => void) {
    this.root.className = 'pause-overlay'; this.root.hidden = true;
    this.root.innerHTML = '<section class="pause-panel" role="dialog" aria-modal="true" aria-label="游戏已暂停"><h2>游戏已暂停</h2><button type="button">继续游戏</button><p>ESC 返回游戏</p></section>';
    this.root.querySelector('button')!.onclick = resume;
    this.root.addEventListener('pointerdown', event => event.stopPropagation());
    document.body.append(this.root);
  }
  setOpen(open: boolean): void { showPanel(this.root, open); if (open) this.root.querySelector('button')!.focus(); }
  dispose(): void { this.root.remove(); }
}
