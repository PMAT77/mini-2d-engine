export interface StructurePanelView { error: string | null; selected: string | null; canRepair: boolean; canRemove: boolean; }
export class StructurePanel {
  readonly root = document.createElement('section');
  col = 0; row = 0; rotation: 0 | 1 = 0;
  private opened = false;
  private confirming = false;
  private message = '';
  private readonly status = document.createElement('p');
  private readonly place = document.createElement('button');
  private readonly repair = document.createElement('button');
  private readonly remove = document.createElement('button');
  constructor(private readonly view: () => StructurePanelView, action: (action: 'build' | 'repair' | 'remove') => void,
    private readonly openChanged: (open: boolean) => void, startDrag: (event: PointerEvent) => void) {
    this.root.dataset.structurePanel = ''; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', '营地建设');
    this.root.style.cssText = 'display:none;position:fixed;right:12px;top:240px;width:280px;max-width:calc(100vw - 48px);max-height:calc(100vh - 265px);overflow:auto;padding:14px;border:1px solid #667b69;background:rgba(14,23,18,.97);color:#dce9df;z-index:1102;font:13px/1.6 sans-serif;box-shadow:0 8px 32px #0008';
    const title = document.createElement('strong'); title.textContent = '营地建设 · 木墙';
    const help = document.createElement('p'); help.textContent = '拖出下方木墙，松手按网格放置；也可在地图按住拖动预览。点击已有墙体进行管理。R 旋转，Esc 退出。规划暂停时间，当前建造与修理免费。';
    const wall = document.createElement('button'); wall.dataset.structureDrag = ''; wall.textContent = '▰ 木墙 · 按住拖到地图';
    wall.onpointerdown = startDrag; wall.onclick = event => { if (event.detail === 0) { this.message = '拖动到地图后松手放置；也可用方向键移动预览，再点击放置。'; this.refresh(); } };
    const rotate = document.createElement('button'); rotate.textContent = '旋转新木墙 · R'; rotate.onclick = () => this.rotate();
    this.place.textContent = '放置预览木墙'; this.repair.textContent = '修理至满耐久';
    this.place.dataset.structureBuild = ''; this.repair.dataset.structureRepair = ''; this.remove.dataset.structureRemove = '';
    this.performAction = action;
    this.place.onclick = () => this.perform('build'); this.repair.onclick = () => this.perform('repair');
    this.remove.onclick = () => { if (!this.confirming) { this.confirming = true; this.refresh(); } else this.perform('remove'); };
    const close = document.createElement('button'); close.textContent = '完成建设 · Esc'; close.onclick = () => this.setOpen(false);
    this.status.setAttribute('role', 'status');
    this.root.prepend(title, help); this.root.append(wall, rotate, this.place, this.repair, this.remove, this.status, close);
    this.root.querySelectorAll('button').forEach(button => {
      button.type = 'button'; button.style.cssText = 'padding:7px;border:1px solid #5f7c68;background:#263c2e;color:inherit;font:inherit;cursor:pointer';
    });
    wall.style.cssText += ';padding:12px;border:1px dashed #a8c6a6;background:#354d38;cursor:grab;touch-action:none;user-select:none';
    this.root.addEventListener('pointerdown', event => event.stopPropagation()); document.body.append(this.root);
  }
  isOpen(): boolean { return this.opened; }
  setOpen(open: boolean): void { if (open === this.opened) return; this.opened = open; this.root.style.display = open ? 'grid' : 'none'; this.openChanged(open); this.refresh(); }
  private readonly performAction: (action: 'build' | 'repair' | 'remove') => void;
  perform(name: 'build' | 'repair' | 'remove'): void {
    try { this.performAction(name); this.message = { build: '已建造木墙', repair: '已完成修理', remove: '已拆除建筑或清理残骸' }[name]; }
    catch (error) { this.message = error instanceof Error ? error.message : String(error); }
    this.confirming = false; this.refresh();
  }
  select(col: number, row: number): void {
    if (this.col === col && this.row === row) return;
    this.col = col; this.row = row; this.confirming = false; this.message = ''; this.refresh();
  }
  rotate(): void { this.rotation = this.rotation ? 0 : 1; this.confirming = false; this.message = ''; this.refresh(); }
  refresh(): void {
    if (!this.opened) return;
    const compact = window.innerWidth < 700;
    this.root.style.boxSizing = 'border-box'; this.root.style.gap = '4px';
    this.root.style.top = compact ? 'auto' : '240px'; this.root.style.bottom = compact ? '12px' : 'auto';
    this.root.style.width = compact ? 'calc(100vw - 24px)' : '310px'; this.root.style.maxWidth = 'calc(100vw - 24px)';
    this.root.style.maxHeight = compact ? '42vh' : 'calc(100vh - 265px)';
    this.root.style.gridTemplateColumns = compact ? 'repeat(2,minmax(0,1fr))' : '1fr';
    this.root.querySelectorAll('strong,p,button:last-child').forEach(element => { (element as HTMLElement).style.gridColumn = compact ? '1 / -1' : 'auto'; });
    const current = this.view(); this.place.disabled = !!current.error || !!current.selected;
    this.repair.disabled = !current.canRepair; this.remove.disabled = !current.canRemove;
    this.remove.textContent = this.confirming ? '确认拆除／清理' : '拆除／清理残骸';
    this.status.textContent = this.message || current.selected || current.error || '此位置可以放置木墙';
    for (const button of [this.place, this.repair, this.remove]) button.style.opacity = button.disabled ? '.45' : '1';
  }
  dispose(): void { this.root.remove(); }
}
