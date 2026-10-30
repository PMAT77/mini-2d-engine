import { Input } from '../core/Input';
import { Player } from '../objects/Player';
import { PlayerConfig } from '../objects/PlayerConfig';
import { AudioConfig, cloneAudioConfig } from '../core/AudioConfig';
import { GraphicsConfig, cloneGraphicsConfig } from '../core/GraphicsConfig';
import {
  CONFIG_CONTROLS, ConfigControl, DEBUG_SECTIONS, DEBUG_TABS, DebugTabId, SectionId,
} from './debugSchema';

type DebugState = ReturnType<Player['getDebugState']>;

interface Field {
  input: HTMLInputElement;
  slider: HTMLInputElement;
  sliderMin: number;
  sliderMax: number;
  error: HTMLElement;
  effective: HTMLElement;
  /** 配置值保留原精度；状态值和换算值按 3 位小数显示。 */
  precise: boolean;
  read: (state: DebugState) => number;
  write: (value: number) => void;
  max?: (state: DebugState) => number | undefined;
  actual?: (state: DebugState) => number;
}

interface ColorField {
  input: HTMLInputElement;
  read: () => string;
  write: (value: string) => void;
}

export interface PlayerDebugPanelOptions {
  player: Player;
  input: Input;
  canvas: HTMLCanvasElement;
  getGraphics: () => GraphicsConfig;
  setGraphics: (config: GraphicsConfig) => void;
  getAudio: () => AudioConfig;
  setAudio: (config: AudioConfig) => void;
  initialPlayer?: PlayerConfig;
  initialGraphics?: GraphicsConfig;
  initialAudio?: AudioConfig;
  /** 当前视野模式不读取的分组（例如三层模式下的 fog），构建时直接跳过。 */
  hiddenSections?: SectionId[];
}

/** A scene-owned DOM overlay. No timers or keyboard listeners survive disposal. */
export class PlayerDebugPanel {
  private readonly player: Player;
  private readonly input: Input;
  private readonly canvas: HTMLCanvasElement;
  private readonly initialPlayer: PlayerConfig;
  private readonly initialGraphics: GraphicsConfig;
  private readonly initialAudio: AudioConfig;
  private readonly hiddenSections: Set<SectionId>;

  private root = document.createElement('div');
  private toggle = document.createElement('button');
  private overlay = document.createElement('div');
  private modal = document.createElement('div');
  private panel = document.createElement('aside');
  private panels: Partial<Record<DebugTabId, HTMLElement>> = {};
  private tabs: Partial<Record<DebugTabId, HTMLButtonElement>> = {};
  private sections: Partial<Record<SectionId, HTMLElement>> = {};
  private activeTab: DebugTabId = 'character';
  private open = false;
  private lastFocus?: Element;
  private dragged = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  private fields: Field[] = [];
  private colors: ColorField[] = [];
  private meters: { meter: HTMLProgressElement; text: HTMLElement; read: (state: DebugState) => [number, number] }[] = [];
  private checkboxes: { input: HTMLInputElement; read: () => boolean }[] = [];
  private selects: { select: HTMLSelectElement; read: () => string }[] = [];
  private sprintSpeed = document.createElement('output');
  private ammoStatus = document.createElement('span');
  private snapshot: PlayerConfig;
  private elapsed = 0;

  constructor(private readonly options: PlayerDebugPanelOptions) {
    this.player = options.player;
    this.input = options.input;
    this.canvas = options.canvas;
    this.initialPlayer = options.initialPlayer ?? this.player.getConfigSnapshot();
    this.initialGraphics = cloneGraphicsConfig(options.initialGraphics ?? options.getGraphics());
    this.initialAudio = cloneAudioConfig(options.initialAudio ?? options.getAudio());
    this.hiddenSections = new Set(options.hiddenSections ?? []);
    this.snapshot = this.player.getConfigSnapshot();

    this.root.className = 'player-debug';
    this.root.dataset.playerDebug = '';
    this.toggle.type = 'button';
    this.toggle.className = 'debug-toggle';
    this.toggle.textContent = '调试 · F2';
    this.toggle.setAttribute('aria-controls', 'player-debug-panel');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.onclick = () => {
      // 拖动结束时浏览器仍会补发一次 click，这里吞掉，避免松手顺手开合面板。
      if (this.dragged) { this.dragged = false; return; }
      this.setOpen(!this.open);
    };
    this.toggle.addEventListener('pointerdown', this.onTogglePointerDown);
    this.toggle.addEventListener('pointermove', this.onTogglePointerMove);
    this.toggle.addEventListener('pointerup', this.onTogglePointerUp);
    this.toggle.addEventListener('pointercancel', this.onTogglePointerUp);

    this.overlay.className = 'debug-overlay';
    this.overlay.hidden = true;
    this.modal.className = 'debug-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'debug-panel-title');
    this.panel.id = 'player-debug-panel';
    this.panel.setAttribute('aria-label', '角色属性调试');

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = 'debug-panel-title';
    title.textContent = '调试面板';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.setAttribute('aria-label', '关闭调试面板');
    close.onclick = () => this.setOpen(false);
    header.append(title, close);

    const tablist = document.createElement('div');
    tablist.className = 'debug-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', '调试分类');
    const content = document.createElement('div');
    content.className = 'debug-content';

    for (const tab of DEBUG_TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `debug-tab-${tab.id}`;
      button.className = 'debug-tab';
      button.textContent = tab.title;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `debug-panel-${tab.id}`);
      button.setAttribute('aria-selected', String(tab.id === this.activeTab));
      button.tabIndex = tab.id === this.activeTab ? 0 : -1;
      button.onclick = () => this.selectTab(tab.id, true);
      button.addEventListener('keydown', event => this.onTabKeyDown(event, tab.id));
      tablist.append(button);
      this.tabs[tab.id] = button;

      const panel = document.createElement('div');
      panel.id = `debug-panel-${tab.id}`;
      panel.className = 'debug-tabpanel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.hidden = tab.id !== this.activeTab;
      content.append(panel);
      this.panels[tab.id] = panel;
    }

    this.panel.append(header, tablist, content);
    this.modal.append(this.panel);
    this.overlay.append(this.modal);

    for (const section of DEBUG_SECTIONS) {
      if (this.hiddenSections.has(section.id)) continue;
      this.buildSection(section.id, section.title, section.note);
    }

    const footer = document.createElement('footer');
    const note = document.createElement('small');
    note.textContent = '本次运行生效 · 刷新后还原';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '恢复初始参数';
    reset.onclick = () => this.reset();
    footer.append(reset, note);
    this.panel.append(footer);
    this.root.append(this.toggle, this.overlay);

    this.root.addEventListener('focusin', this.blockInput);
    this.root.addEventListener('pointerdown', this.blockInput);
    this.overlay.addEventListener('pointerdown', event => {
      if (event.target === this.overlay) this.setOpen(false);
    });
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.body.append(this.root);
  }

  private selectTab(tab: DebugTabId, focus: boolean): void {
    this.activeTab = tab;
    for (const { id } of DEBUG_TABS) {
      const active = id === tab;
      this.tabs[id]?.setAttribute('aria-selected', String(active));
      if (this.tabs[id]) this.tabs[id]!.tabIndex = active ? 0 : -1;
      if (this.panels[id]) this.panels[id]!.hidden = !active;
    }
    if (focus) this.tabs[tab]?.focus();
  }

  private onTabKeyDown(event: KeyboardEvent, tab: DebugTabId): void {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = DEBUG_TABS.findIndex(entry => entry.id === tab);
    const next = step === -99 ? 0 : step === 99 ? DEBUG_TABS.length - 1 : (current + step + DEBUG_TABS.length) % DEBUG_TABS.length;
    this.selectTab(DEBUG_TABS[next].id, true);
  }

  private buildSection(id: SectionId, title: string, note?: string): void {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    this.panels[DEBUG_SECTIONS.find(entry => entry.id === id)!.tab]!.append(section);
    this.sections[id] = section;

    this.addExtras(id, section, true);
    for (const control of CONFIG_CONTROLS) {
      if (control.section !== id) continue;
      if (control.kind === 'select') this.addSelectControl(section, control);
      else if (control.kind === 'color') this.addColorControl(section, control);
      else this.addNumberControl(section, control);
    }
    this.addExtras(id, section, false);

    if (note) {
      const paragraph = document.createElement('p');
      paragraph.className = 'debug-derived';
      paragraph.textContent = note;
      section.append(paragraph);
    }
  }

  /** 每个分区前后各留一个运行时插槽：状态条、按钮不参与配置表。 */
  private addExtras(id: SectionId, section: HTMLElement, before: boolean): void {
    if (before) {
      if (id === 'life') this.meter(section, '生命值', s => [s.health, this.player.getMaxHealth()], 'health');
      if (id === 'stamina') this.meter(section, '体力值', s => [s.stamina, this.player.getMaxStamina()], 'stamina');
      if (id === 'ammo') {
        section.append(this.ammoStatus);
        this.meter(section, '弹匣余弹', s => [s.magazineAmmo, s.magazineSize], 'ammo');
      }
      return;
    }

    if (id === 'life') {
      this.stateField(section, 'health', '当前血量', '', () => this.player.getMaxHealth());
      section.append(this.button('血量回满', () => this.player.setDebugState({ health: this.player.getMaxHealth() })));
    }
    if (id === 'stamina') {
      this.stateField(section, 'stamina', '当前体力', '', () => this.player.getMaxStamina());
      section.append(this.button('体力回满', () => this.player.setDebugState({ stamina: this.player.getMaxStamina() }), 'debug-button-block'));
    }
    if (id === 'movement') {
      const speed = document.createElement('p');
      speed.className = 'debug-derived';
      speed.append('快速移速 ', this.sprintSpeed);
      section.append(speed);
    }
    if (id === 'ammo') {
      this.stateField(section, 'magazineAmmo', '弹匣余弹', '发', () => this.player.getMagazineSize());
      this.numberRow(section, {
        id: 'chambered', label: '膛内子弹', unit: '发', min: 0, step: 1, max: () => 1,
        sliderMin: 0, sliderMax: 1, precise: false,
        read: state => state.chambered ? 1 : 0,
        write: value => this.player.setDebugState({ chambered: value !== 0 }),
      });
      this.checkbox(section, 'autoReload', '打空自动换弹', () => this.player.getAutoReload(),
        value => this.player.setAutoReload(value));
      this.select(section, 'reload.defaultMode', 'R 键行为', [
        { value: 'reload', label: '换弹（整匣丢弃）' },
        { value: 'load', label: '装填（补齐弹匣）' },
      ], () => this.player.getDefaultReloadMode(),
      value => this.player.setDefaultReloadMode(value === 'load' ? 'load' : 'reload'));
      this.meter(section, '换弹进度', s => [s.reloadProgress, 100], 'reload');
      this.stateField(section, 'reloadProgress', '换弹进度', '%', () => 100);
      const ammoActions = document.createElement('div');
      ammoActions.className = 'debug-button-row';
      ammoActions.append(
        this.button('打空弹匣', () => this.player.setDebugState({ magazineAmmo: 0, chambered: false })),
        this.button('立即换弹', () => this.player.requestReload('reload')),
        this.button('立即装填', () => this.player.requestReload('load')),
        this.button('补满弹匣', () => this.player.setDebugState({
          magazineAmmo: this.player.getMagazineSize(), chambered: true,
        })),
      );
      section.append(ammoActions);
    }
  }

  private button(text: string, action: () => void, className?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (className) button.className = className;
    button.onclick = () => { action(); this.refresh(); };
    return button;
  }

  private addNumberControl(parent: HTMLElement, control: ConfigControl): void {
    const scale = control.scale ?? 1;
    const reciprocal = control.reciprocal === true;
    const min = control.min ?? 0;
    const max = control.max ?? min + (control.step ?? 1) * 100;
    const sliderMin = reciprocal ? 1 / max : min * scale;
    const sliderMax = reciprocal ? 1 / min : max * scale;
    const sliderStep = reciprocal ? 0.1 : (control.step ?? 1) * scale;
    this.numberRow(parent, {
      id: this.controlId(control),
      label: control.label, unit: control.unit,
      min: sliderMin, step: sliderStep, max: () => sliderMax,
      sliderMin, sliderMax,
      precise: !reciprocal && scale === 1,
      read: () => {
        const raw = this.readRaw(control) as number;
        return reciprocal ? 1 / raw : raw * scale;
      },
      write: value => this.writeRaw(control, reciprocal ? 1 / value : value / scale),
      actual: this.actualReader(control),
    });
  }

  private addColorControl(parent: HTMLElement, control: ConfigControl): void {
    const row = document.createElement('div');
    row.className = 'debug-field debug-color';
    const label = document.createElement('label');
    label.htmlFor = `debug-${this.controlId(control)}`;
    label.textContent = control.label;
    const input = document.createElement('input');
    input.type = 'color';
    input.id = label.htmlFor;
    input.dataset.debugField = this.controlId(control);
    const suffix = document.createElement('span');
    suffix.className = 'debug-unit';
    row.append(label, input, suffix);
    parent.append(row);

    const field: ColorField = {
      input,
      read: () => this.readRaw(control) as unknown as string,
      write: value => this.writeRaw(control, value),
    };
    input.addEventListener('change', () => { field.write(input.value); this.refresh(); });
    this.colors.push(field);
  }

  private addSelectControl(parent: HTMLElement, control: ConfigControl): void {
    const row = document.createElement('div');
    row.className = 'debug-field debug-select';
    const label = document.createElement('label');
    label.htmlFor = `debug-${this.controlId(control)}`;
    label.textContent = control.label;
    const select = document.createElement('select');
    select.id = label.htmlFor;
    select.dataset.debugField = this.controlId(control);
    for (const option of control.options ?? []) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.addEventListener('change', () => {
      this.writeRaw(control, select.value as unknown as number);
      this.refresh();
    });
    row.append(label, select);
    parent.append(row);
    this.selects.push({
      select,
      read: () => String(this.readRaw(control)),
    });
  }

  private actualReader(control: ConfigControl): Field['actual'] {
    if (control.domain !== 'player') return undefined;
    const group = this.resolveGroup(control);
    const readers: Record<string, (state: DebugState) => number> = {
      'base.maxSpeed': state => state.effectiveSpeed,
      'shooting.damage': state => state.effectiveDamage,
      'primaryShooting.damage': state => state.effectiveDamage,
      'shooting.fireRate': state => state.effectiveFireRate,
      'primaryShooting.fireRate': state => state.effectiveFireRate,
      'shooting.bulletSpeed': state => state.effectiveBulletSpeed,
      'primaryShooting.bulletSpeed': state => state.effectiveBulletSpeed,
    };
    return readers[`${group}.${control.key}`];
  }

  private controlId(control: ConfigControl): string {
    const group = this.resolveGroup(control);
    if (control.domain === 'player') return `${group}.${control.key}`;
    return `${control.domain}.${control.group ? `${control.group}.` : ''}${control.key}`;
  }

  /** activeFirearm 跟随手上的枪；空手回落到上一把枪。 */
  private resolveGroup(control: ConfigControl): string {
    if (control.domain === 'player' && control.group === 'activeFirearm') return this.weaponGroup();
    return control.group;
  }

  private weaponGroup(): 'shooting' | 'primaryShooting' {
    const slot = this.player.getActiveWeaponSlot();
    const firearm = slot === 'melee' ? this.player.getLastFirearmSlot() : slot;
    return firearm === 'primary' ? 'primaryShooting' : 'shooting';
  }

  private readRaw(control: ConfigControl): number | string {
    if (control.domain === 'player') {
      const group = (this.snapshot as unknown as Record<string, Record<string, number | string>>)[this.resolveGroup(control)];
      return group?.[control.key] ?? 0;
    }
    if (control.domain === 'graphics') {
      return (this.options.getGraphics() as unknown as Record<string, Record<string, number | string>>)[control.group][control.key];
    }
    const audio = this.options.getAudio() as unknown as Record<string, unknown>;
    return control.group ? (audio[control.group] as Record<string, number>)[control.key] : audio.master as number;
  }

  private writeRaw(control: ConfigControl, value: number | string): void {
    if (control.domain === 'player') {
      this.player.applyConfig({
        [this.resolveGroup(control)]: { [control.key]: value },
      } as PlayerConfig);
      return;
    }
    if (control.domain === 'graphics') {
      const next = cloneGraphicsConfig(this.options.getGraphics());
      (next as unknown as Record<string, Record<string, number | string>>)[control.group][control.key] = value;
      this.options.setGraphics(next);
      return;
    }
    const next = cloneAudioConfig(this.options.getAudio());
    if (control.group) {
      (next as unknown as Record<string, Record<string, number>>)[control.group][control.key] = value as number;
    } else {
      next.master = value as number;
    }
    this.options.setAudio(next);
  }

  private numberRow(parent: HTMLElement, options: {
    id: string; label: string; unit: string; min: number; step: number | 'any'; max: () => number | undefined;
    sliderMin: number; sliderMax: number;
    precise: boolean; read: (state: DebugState) => number; write: (value: number) => void;
    actual?: (state: DebugState) => number;
  }): void {
    const row = document.createElement('div');
    row.className = 'debug-field';
    const label = document.createElement('label');
    label.htmlFor = `debug-${options.id}`;
    label.textContent = options.label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'debug-range';
    slider.dataset.debugSlider = options.id;
    slider.setAttribute('aria-label', `${options.label} 滑条`);
    slider.min = String(options.sliderMin);
    slider.max = String(options.sliderMax);
    slider.step = String(options.step);
    const input = document.createElement('input');
    input.type = 'number';
    input.id = label.htmlFor;
    input.dataset.debugField = options.id;
    input.min = String(options.min);
    input.step = String(options.step);
    const suffix = document.createElement('span');
    suffix.className = 'debug-unit';
    suffix.textContent = options.unit;
    const error = document.createElement('span');
    error.id = `debug-error-${options.id}`;
    error.className = 'debug-error';
    error.setAttribute('aria-live', 'polite');
    const effective = document.createElement('small');
    effective.className = 'debug-effective';
    input.setAttribute('aria-describedby', error.id);
    const field: Field = {
      input, slider, sliderMin: options.sliderMin, sliderMax: options.sliderMax,
      error, effective, precise: options.precise,
      read: options.read, write: options.write, max: options.max, actual: options.actual,
    };

    let dirty = false;
    const syncSlider = () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      const max = field.max?.(this.player.getDebugState()) ?? field.sliderMax;
      slider.value = String(Math.min(max, Math.max(field.sliderMin, value)));
    };
    input.addEventListener('input', () => { dirty = true; syncSlider(); });
    const commit = () => {
      if (!dirty) return;
      try {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) throw new Error('请输入有限数值');
        const max = field.max?.(this.player.getDebugState());
        if (value < options.min || (max !== undefined && value > max)) {
          throw new Error(max !== undefined ? `请输入 ${this.format(options.min)}–${this.format(max)}` : `最小值为 ${this.format(options.min)}`);
        }
        field.write(value);
        dirty = false;
        this.clearError(field);
        this.refresh();
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : '数值无效';
        input.setAttribute('aria-invalid', 'true');
        slider.setAttribute('aria-invalid', 'true');
      }
    };
    slider.addEventListener('input', () => {
      input.value = slider.value;
      dirty = true;
      commit();
    });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    row.append(label, slider, input, suffix, effective, error);
    parent.append(row);
    this.fields.push(field);
  }

  private stateField(parent: HTMLElement, key: 'health' | 'stamina' | 'magazineAmmo' | 'reloadProgress',
    label: string, unit: string, max: () => number): void {
    this.numberRow(parent, {
      id: key, label, unit, min: 0, step: 1, max,
      sliderMin: 0, sliderMax: max(),
      precise: false,
      read: state => state[key],
      write: value => this.player.setDebugState({ [key]: value }),
    });
  }

  private meter(parent: HTMLElement, label: string, read: (state: DebugState) => [number, number], name: string): void {
    const row = document.createElement('div');
    row.className = `debug-meter debug-meter-${name}`;
    const meter = document.createElement('progress');
    meter.setAttribute('aria-label', label);
    const text = document.createElement('output');
    row.append(meter, text);
    parent.append(row);
    this.meters.push({ meter, text, read });
  }

  /** 调试开关：只影响运行时行为，不写进配置快照。 */
  private checkbox(parent: HTMLElement, id: string, label: string, read: () => boolean, write: (value: boolean) => void): void {
    const row = document.createElement('div');
    row.className = 'debug-field debug-check';
    const name = document.createElement('label');
    name.htmlFor = `debug-${id}`;
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = name.htmlFor;
    input.dataset.debugField = id;
    input.addEventListener('change', () => { write(input.checked); this.refresh(); });
    row.append(name, input);
    parent.append(row);
    this.checkboxes.push({ input, read });
  }

  /** 调试下拉：只影响运行时行为，不写进配置快照。 */
  private select(parent: HTMLElement, id: string, label: string,
    options: { value: string; label: string }[], read: () => string, write: (value: string) => void): void {
    const row = document.createElement('div');
    row.className = 'debug-field debug-select';
    const name = document.createElement('label');
    name.htmlFor = `debug-${id}`;
    name.textContent = label;
    const select = document.createElement('select');
    select.id = name.htmlFor;
    select.dataset.debugField = id;
    for (const option of options) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.addEventListener('change', () => { write(select.value); this.refresh(); });
    row.append(name, select);
    parent.append(row);
    this.selects.push({ select, read });
  }

  private clearError(field: Field): void {
    field.error.textContent = '';
    field.input.removeAttribute('aria-invalid');
    field.slider.removeAttribute('aria-invalid');
  }

  private format(value: number): string {
    return Number(value.toFixed(3)).toString();
  }

  private refresh(force = false): void {
    if (!this.open) return;
    const config = this.player.getConfigSnapshot();
    const state = this.player.getDebugState();
    const graphics = this.options.getGraphics();
    const audio = this.options.getAudio();
    this.snapshot = config;

    for (const field of this.fields) {
      const value = field.read(state);
      const max = field.max?.(state);
      if (max !== undefined) {
        field.input.max = String(max);
        field.slider.max = String(max);
      }
      if (force || (document.activeElement !== field.input && !field.error.textContent)) {
        field.input.value = field.precise ? String(value) : this.format(value);
      }
      if (force || document.activeElement !== field.slider) {
        const upper = max ?? field.sliderMax;
        field.slider.value = String(Math.min(upper, Math.max(field.sliderMin, value)));
      }
      const actual = field.actual?.(state);
      field.effective.textContent = actual !== undefined && Math.abs(actual - value) > 0.0001
        ? `实际 ${this.format(actual)}` : '';
    }
    for (const field of this.colors) {
      if (force || document.activeElement !== field.input) field.input.value = field.read().toLowerCase();
    }
    for (const { meter, text, read } of this.meters) {
      const [value, max] = read(state);
      meter.max = max;
      meter.value = value;
      text.textContent = `${this.format(value)} / ${this.format(max)}`;
    }
    for (const { input, read } of this.checkboxes) input.checked = read();
    for (const { select, read } of this.selects) select.value = read();
    this.sprintSpeed.value = `${this.format(config.base!.maxSpeed! * config.sprint!.speedMultiplier!)} px/s`;
    if (Math.abs(state.effectiveSprintSpeed - config.base!.maxSpeed! * config.sprint!.speedMultiplier!) > 0.0001) {
      this.sprintSpeed.value += ` · 实际 ${this.format(state.effectiveSprintSpeed)}`;
    }
    const slot = this.player.getActiveWeaponSlot();
    const label = slot === 'primary' ? '冲锋枪' : slot === 'secondary' ? '格洛克手枪' : '空手';
    this.ammoStatus.textContent = `${label} · ${state.isReloading ? (state.reloadMode === 'load' ? '装填中' : '换弹中')
      : state.magazineAmmo + (state.chambered ? 1 : 0) > 0 ? '可射击' : '弹匣已空'}`;
    this.ammoStatus.className = state.isReloading ? 'debug-status reloading' : 'debug-status';
    this.root.dataset.exhausted = String(state.exhausted);
    // 颜色和音效没有派生值，这里只确保引用被使用，避免快照被优化掉。
    void graphics;
    void audio;
  }

  update(delta: number): void {
    if (!this.open) return;
    this.elapsed += delta;
    if (this.elapsed >= 0.1) {
      this.elapsed = 0;
      this.refresh();
    }
  }

  private reset(): void {
    this.player.applyConfig(this.initialPlayer);
    this.player.setDebugState({
      health: this.player.getMaxHealth(), stamina: this.player.getMaxStamina(),
      magazineAmmo: this.player.getMagazineSize(), chambered: true,
    });
    this.player.setAutoReload(false);
    this.player.setDefaultReloadMode('reload');
    this.options.setGraphics(this.initialGraphics);
    this.options.setAudio(this.initialAudio);
    this.fields.forEach(field => this.clearError(field));
    this.refresh(true);
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.overlay.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      this.lastFocus = document.activeElement ?? undefined;
      this.refresh(true);
      this.tabs[this.activeTab]?.focus();
      this.input.setBlocked(true);
    } else {
      if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.input.setBlocked(false);
      if (this.lastFocus instanceof HTMLElement && document.contains(this.lastFocus)) this.lastFocus.focus();
      this.lastFocus = undefined;
    }
  }

  private blockInput = (event: Event): void => {
    if (this.modal.contains(event.target as Node)) this.input.setBlocked(true);
  };
  private onPointerDown = (event: PointerEvent): void => {
    if (event.target === this.canvas) {
      if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.input.setBlocked(false);
    }
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    const toggleKey = event.key === 'F2';
    const closeKey = event.key === 'Escape' && this.open;
    if (toggleKey || closeKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.setOpen(toggleKey ? !this.open : false);
      return;
    }
    if (!this.open || event.key !== 'Tab') return;
    const focusables = Array.from(this.modal.querySelectorAll<HTMLElement>(
      'button, input, select, [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.closest('[hidden]'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  private onTogglePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragged = false;
    this.dragOriginX = event.clientX;
    this.dragOriginY = event.clientY;
    this.toggle.setPointerCapture(event.pointerId);
  };
  private onTogglePointerMove = (event: PointerEvent): void => {
    if (!this.toggle.hasPointerCapture(event.pointerId)) return;
    if (!this.dragged) {
      if (Math.hypot(event.clientX - this.dragOriginX, event.clientY - this.dragOriginY) < 4) return;
      const rect = this.toggle.getBoundingClientRect();
      // 真正开始拖动才把 right 定位换算成 left/top，普通点击仍贴着右边。
      this.dragOffsetX = event.clientX - rect.left;
      this.dragOffsetY = event.clientY - rect.top;
      this.toggle.style.left = `${rect.left}px`;
      this.toggle.style.top = `${rect.top}px`;
      this.toggle.style.right = 'auto';
      this.toggle.classList.add('dragging');
      this.dragged = true;
    }
    const maxLeft = Math.max(0, window.innerWidth - this.toggle.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - this.toggle.offsetHeight);
    const left = Math.min(maxLeft, Math.max(0, event.clientX - this.dragOffsetX));
    const top = Math.min(maxTop, Math.max(0, event.clientY - this.dragOffsetY));
    this.toggle.style.left = `${left}px`;
    this.toggle.style.top = `${top}px`;
  };
  private onTogglePointerUp = (event: PointerEvent): void => {
    if (this.toggle.hasPointerCapture(event.pointerId)) this.toggle.releasePointerCapture(event.pointerId);
    this.toggle.classList.remove('dragging');
  };

  dispose(): void {
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.remove();
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    this.input.setBlocked(false);
  }
}
