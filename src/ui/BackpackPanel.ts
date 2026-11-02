import { showPanel, revealContent, crossfadeContent } from './PanelMotion';
import { BACKPACK_ASSET_DIR, BACKPACK_CATEGORIES, BACKPACK_LABELS,
  type BackpackCategory, type BackpackItemId, type BackpackItemView, type BackpackView } from './BackpackView';
import { inventoryIcon } from './InventoryIcons';
import { drawBrush } from './WeaponBrushTexture';

interface BackpackPanelOptions {
  canOpen(): boolean;
  onPause(): void;
  getView(): BackpackView;
  onAction(id: BackpackItemId): string | null;
  onDrop(id: BackpackItemId): string | null;
  onBind(id: BackpackItemId, slot: number): string | null;
  onOpenChange(open: boolean): void;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BackpackPanel {
  private readonly root = element('div', 'backpack-overlay');
  private readonly panel = element('aside', 'backpack-panel');
  private readonly header = element('header', 'backpack-header');
  private readonly brush = element('canvas', 'backpack-header-brush');
  private readonly tabs = element('nav', 'backpack-tabs');
  private readonly list = element('div', 'backpack-list');
  private readonly load = element('span', 'backpack-load');
  private readonly message = element('p', 'backpack-message');
  private readonly details = element('div', 'backpack-details');
  private readonly menu = element('div', 'backpack-menu');
  private readonly selected = new Map<BackpackCategory, BackpackItemId>();
  private readonly brushObserver: ResizeObserver;
  private category: BackpackCategory = 'ranged';
  private open = false;
  private view?: BackpackView;
  private revision = '';
  private lastFocus?: Element;
  private suppressClickUntil = 0;
  private drag?: { id: BackpackItemId; pointer: number; x: number; y: number; source: HTMLElement; ghost?: HTMLElement };

  constructor(private readonly options: BackpackPanelOptions) {
    this.root.dataset.backpack = ''; this.root.hidden = true;
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'backpack-title');
    this.brush.setAttribute('aria-hidden', 'true');
    const title = element('h2', '', '背包'); title.id = 'backpack-title';
    const close = element('button', 'backpack-close', '×'); close.type = 'button';
    close.setAttribute('aria-label', '关闭背包'); close.onclick = () => this.setOpen(false);
    this.header.append(this.brush, title, close);
    this.tabs.setAttribute('aria-label', '物品类型');
    this.list.setAttribute('role', 'listbox'); this.list.setAttribute('aria-label', '背包物品'); this.list.tabIndex = 0;
    const columns = element('div', 'backpack-columns');
    columns.innerHTML = '<span>物品</span><span><i class="backpack-stack" aria-hidden="true"></i>数量</span><span><i class="backpack-weight" aria-hidden="true"></i>kg / 件</span>';
    const footer = element('footer', 'backpack-footer');
    this.message.setAttribute('role', 'status');
    footer.append(this.details, this.message, this.load,
      element('p', 'backpack-hint', '右键 操作 / 放入快捷栏　拖出背包 丢弃　Tab 关闭 / ESC 暂停'));
    this.menu.setAttribute('role', 'menu'); this.menu.setAttribute('aria-label', '物品操作'); this.menu.hidden = true;
    this.panel.append(this.header, this.tabs, columns, this.list, footer);
    this.root.append(this.panel, this.menu);
    this.root.oncontextmenu = event => event.preventDefault();
    document.body.append(this.root);
    this.brushObserver = new ResizeObserver(() => this.paintHeader()); this.brushObserver.observe(this.header);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.addEventListener('pointermove', this.onPointerMove, true);
    document.addEventListener('pointerup', this.onPointerUp, true);
    document.addEventListener('pointercancel', this.onPointerCancel, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  isOpen(): boolean { return this.open; }
  setOpen(open: boolean): void {
    if (this.open === open || (open && !this.options.canOpen())) return;
    this.cancelDrag(); this.closeMenu();
    this.open = open; showPanel(this.root, open);
    if (open) this.lastFocus = document.activeElement ?? undefined;
    this.options.onOpenChange(open);
    if (open) { this.refresh(true); this.list.focus(); this.paintHeader(); }
    else {
      if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      if (this.lastFocus instanceof HTMLElement && this.lastFocus.isConnected) this.lastFocus.focus();
      this.lastFocus = undefined;
    }
  }
  refresh(force = false): void {
    if (!this.open) return;
    const view = this.options.getView(), revision = JSON.stringify(view);
    if (!force && revision === this.revision) return;
    this.view = view;
    if (this.drag) return;
    this.closeMenu(); this.revision = revision; this.render();
  }
  private paintHeader(): void {
    if (!this.open) return;
    const rect = this.brush.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    this.brush.width = Math.ceil(rect.width * dpr); this.brush.height = Math.ceil(rect.height * dpr);
    const ctx = this.brush.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr);
    drawBrush(ctx, { x: 0, y: 0, width: rect.width, height: rect.height }, { alpha: .88, dpr, variant: 2 });
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, rect.width, rect.height);
  }
  private items(): readonly BackpackItemView[] { return this.view?.items.filter(item => item.category === this.category) ?? []; }
  private selectedItem(): BackpackItemView | undefined { return this.items().find(item => item.id === this.selected.get(this.category)); }
  private render(): void {
    if (!this.view) return;
    const focusInList = this.list.contains(document.activeElement);
    this.tabs.replaceChildren(element('kbd', 'backpack-key', 'Q'));
    for (const category of BACKPACK_CATEGORIES) {
      const tab = element('button', 'backpack-tab'); tab.type = 'button'; tab.dataset.category = category;
      tab.setAttribute('aria-pressed', String(category === this.category));
      tab.append(inventoryIcon(BACKPACK_ASSET_DIR + '/category-' + category + '.png'), element('span', '', BACKPACK_LABELS[category]));
      tab.onclick = () => this.changeCategory(category); this.tabs.append(tab);
    }
    this.tabs.append(element('kbd', 'backpack-key', 'E'));
    const scrollTop = this.list.scrollTop;
    this.list.replaceChildren();
    const items = this.items();
    let selected = this.selectedItem();
    if (!selected) { selected = items[0]; if (selected) this.selected.set(this.category, selected.id); }
    this.list.setAttribute('aria-label', BACKPACK_LABELS[this.category] + '物品');
    for (const item of items) {
      const row = element('button', 'backpack-row'); row.type = 'button'; row.dataset.itemId = item.id;
      row.id = 'backpack-item-' + item.id; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(item.id === selected?.id)); row.tabIndex = -1;
      const imageBox = element('span', 'backpack-image'); imageBox.append(inventoryIcon(item.icon));
      const description = element('span', 'backpack-description');
      description.append(element('span', 'backpack-name', item.name), element('span', 'backpack-type', item.type));
      if (item.equipped) description.append(element('span', 'backpack-equipped', item.action === '握持' ? '已握持' : '已装备'));
      const slots = this.view.quickSlots?.map((id, index) => id === item.id ? String(index + 1) : '').filter(Boolean) ?? [];
      if (slots.length) description.append(element('span', 'backpack-binding', '快捷栏 ' + slots.join(' / ')));
      row.append(imageBox, description, element('span', 'backpack-quantity', item.id === 'melee' ? '—' : String(item.quantity)),
        element('span', 'backpack-unit-weight', item.unitWeightKg.toFixed(1)));
      row.onclick = () => {
        if (performance.now() < this.suppressClickUntil) return;
        this.closeMenu(); this.selected.set(this.category, item.id); this.render(); this.list.focus();
      };
      row.oncontextmenu = event => {
        event.preventDefault(); event.stopPropagation(); this.openMenu(item.id, event.clientX, event.clientY);
      };
      row.onpointerdown = event => {
        if (event.button !== 0 || event.pointerType !== 'mouse' || !item.canDrop) return;
        this.closeMenu();
        this.drag = { id: item.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, source: row };
        row.setPointerCapture(event.pointerId);
      };
      this.list.append(row);
    }
    if (!items.length) this.list.append(element('p', 'backpack-empty', '暂无' + BACKPACK_LABELS[this.category] + '物品'));
    this.list.scrollTop = scrollTop;
    if (selected) this.list.setAttribute('aria-activedescendant', 'backpack-item-' + selected.id);
    else this.list.removeAttribute('aria-activedescendant');
    if (focusInList) this.list.focus();
    this.renderDetails(selected);
    this.load.textContent = '携带 ' + this.view.load.weightKg.toFixed(1) + ' / ' + this.view.load.capacityKg + ' kg';
  }
  private renderDetails(item?: BackpackItemView): void {
    this.details.replaceChildren();
    if (item) {
      this.details.append(element('h3', '', item.name), element('p', 'backpack-description-text', item.description));
      const properties = element('dl', 'backpack-properties');
      for (const property of item.properties) {
        const pair = element('div', '');
        pair.append(element('dt', '', property.label), element('dd', '', property.value)); properties.append(pair);
      }
      this.details.append(properties);
    }
    this.message.textContent = item?.disabledReason ?? (item ? '右键查看物品操作' : '拾取物品后可在此查看');
  }
  private changeCategory(category: BackpackCategory): void {
    this.cancelDrag(); this.closeMenu(); this.category = category; this.list.scrollTop = 0; crossfadeContent(this.list, () => this.render()); this.list.focus();
  }
  private activate(): void {
    const item = this.selectedItem(); if (!item || item.disabledReason) return;
    this.complete(this.options.onAction(item.id));
  }
  private complete(message: string | null): void {
    this.cancelDrag(); this.closeMenu(); this.refresh(true);
    if (message) this.message.textContent = message;
    this.list.focus();
  }
  private openMenu(id: BackpackItemId, x: number, y: number): void {
    this.cancelDrag(); this.selected.set(this.category, id); this.render();
    const item = this.selectedItem(); if (!item) return;
    this.menu.replaceChildren();
    const add = (text: string, handler: () => void, disabled = false, action?: string) => {
      const button = element('button', 'backpack-menu-item', text); button.type = 'button';
      button.setAttribute('role', 'menuitem'); button.disabled = disabled;
      if (action) button.dataset.action = action;
      button.onclick = handler; this.menu.append(button); return button;
    };
    const action = add(item.action, () => this.activate(), !!item.disabledReason, 'activate'); action.title = item.disabledReason ?? '';
    add(item.id === 'vaccine' ? '丢弃 1 支' : '丢弃', () => this.complete(this.options.onDrop(item.id)), !item.canDrop, 'drop');
    this.menu.append(element('span', 'backpack-menu-label', '放入快捷栏'));
    for (let slot = 0; slot < 4; slot++) {
      const bound = this.view?.items.find(entry => entry.id === this.view?.quickSlots?.[slot]);
      const button = add(String(slot + 1) + '　' + (bound?.name ?? '空'), () => this.complete(this.options.onBind(item.id, slot)), this.view?.actionsLocked === true);
      button.dataset.bindSlot = String(slot);
    }
    this.menu.hidden = false; revealContent(this.menu);
    const bounds = this.menu.getBoundingClientRect();
    this.menu.style.left = Math.max(8, Math.min(x, innerWidth - bounds.width - 8)) + 'px';
    this.menu.style.top = Math.max(8, Math.min(y, innerHeight - bounds.height - 8)) + 'px';
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  private closeMenu(): void { this.menu.hidden = true; }
  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.open) return;
    if (!this.panel.contains(event.target as Node) && !this.menu.contains(event.target as Node)) {
      event.preventDefault(); event.stopImmediatePropagation(); this.setOpen(false); return;
    }
    if (!this.menu.contains(event.target as Node)) this.closeMenu();
  };
  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    event.preventDefault();
    const item = this.items().find(entry => entry.id === drag.id); if (!item) { this.cancelDrag(); return; }
    if (!drag.ghost) {
      this.selected.set(this.category, item.id); this.renderDetails(item);
      this.list.querySelectorAll<HTMLElement>('.backpack-row').forEach(row => row.setAttribute('aria-selected', String(row.dataset.itemId === item.id)));
      drag.ghost = element('div', 'backpack-drag-ghost'); drag.ghost.append(inventoryIcon(item.icon), element('span', '', ''));
      this.root.append(drag.ghost);
    }
    const outside = this.outsidePanel(event.clientX, event.clientY);
    drag.ghost.classList.toggle('outside', outside);
    drag.ghost.style.left = Math.max(8, Math.min(event.clientX + 16, innerWidth - 180)) + 'px';
    drag.ghost.style.top = Math.max(8, Math.min(event.clientY + 12, innerHeight - 100)) + 'px';
    drag.ghost.querySelector('span')!.textContent = outside ? '松开丢弃 ×1' : '移出背包以丢弃';
  };
  private outsidePanel(x: number, y: number): boolean {
    const rect = this.panel.getBoundingClientRect();
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
  }
  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
    const moved = !!drag.ghost, id = drag.id;
    const drop = moved && event.clientX >= 0 && event.clientX < innerWidth && event.clientY >= 0 && event.clientY < innerHeight
      && this.outsidePanel(event.clientX, event.clientY);
    this.cancelDrag();
    if (moved) {
      event.preventDefault(); this.suppressClickUntil = performance.now() + 150;
      if (drop) this.complete(this.options.onDrop(id));
      else { this.refresh(true); this.list.focus(); }
    }
  };
  private cancelDrag(): void {
    const drag = this.drag; this.drag = undefined;
    if (!drag) return;
    drag.ghost?.remove();
    if (drag.source.hasPointerCapture(drag.pointer)) drag.source.releasePointerCapture(drag.pointer);
  }
  private onPointerCancel = (): void => this.cancelDrag();
  private onBlur = (): void => { this.cancelDrag(); this.closeMenu(); };
  private onVisibilityChange = (): void => { if (document.hidden) this.onBlur(); };
  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.code || event.key;
    if (!this.open && (event.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (key === 'Tab') {
      if (!this.open && !this.options.canOpen()) return;
      event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) this.setOpen(!this.open); return;
    }
    if (!this.open || key === 'F2') return;
    event.stopImmediatePropagation();
    if (key === 'Escape') { event.preventDefault(); if (!event.repeat) this.options.onPause(); return; }
    if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const item = this.selectedItem(), rect = this.list.getBoundingClientRect();
      if (item && !event.repeat) this.openMenu(item.id, rect.left + 180, rect.top + 30);
      return;
    }
    if (!this.menu.hidden && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter' || key === 'NumpadEnter')) {
      event.preventDefault();
      const controls = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (key === 'Enter' || key === 'NumpadEnter') { if (!event.repeat) controls[index]?.click(); }
      else controls[(index + (key === 'ArrowUp' ? -1 : 1) + controls.length) % controls.length]?.focus();
      return;
    }
    if (key === 'KeyQ' || key === 'KeyE') {
      event.preventDefault();
      if (!event.repeat) this.changeCategory(BACKPACK_CATEGORIES[(BACKPACK_CATEGORIES.indexOf(this.category) + (key === 'KeyQ' ? BACKPACK_CATEGORIES.length - 1 : 1)) % BACKPACK_CATEGORIES.length]);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault(); const items = this.items();
      const index = items.findIndex(item => item.id === this.selected.get(this.category));
      const next = items[Math.max(0, Math.min(items.length - 1, index + (key === 'ArrowUp' ? -1 : 1)))];
      if (next) { this.selected.set(this.category, next.id); this.render();
        this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
    } else if (key === 'Enter' || key === 'NumpadEnter') {
      event.preventDefault(); if (!event.repeat) this.activate();
    }
  };
  dispose(): void {
    this.setOpen(false); this.brushObserver.disconnect();
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.removeEventListener('pointermove', this.onPointerMove, true);
    document.removeEventListener('pointerup', this.onPointerUp, true);
    document.removeEventListener('pointercancel', this.onPointerCancel, true);
    window.removeEventListener('blur', this.onBlur); document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.root.remove();
  }
}
