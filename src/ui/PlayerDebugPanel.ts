import { Input } from '../core/Input';
import { LightSource } from '../core/LightSource';
import { ConeLight } from '../core/ConeLight';
import { Player } from '../objects/Player';
import { BulletWaterDrag, PlayerConfig } from '../objects/PlayerConfig';

type DebugState = ReturnType<Player['getDebugState']>;
type ConfigGroup = 'base' | 'shooting' | 'movement' | 'sprint';
interface Field {
  input: HTMLInputElement;
  error: HTMLElement;
  effective: HTMLElement;
  read: (config: PlayerConfig, state: DebugState) => number;
  write: (value: number) => void;
  max?: (state: DebugState) => number;
  actual?: (state: DebugState) => number;
}

/** A scene-owned DOM overlay. No timers or keyboard listeners survive disposal. */
export class PlayerDebugPanel {
  private root = document.createElement('div');
  private panel = document.createElement('aside');
  private toggle = document.createElement('button');
  private fields: Field[] = [];
  private meters: { meter: HTMLProgressElement; text: HTMLElement; read: (state: DebugState) => [number, number] }[] = [];
  private checkboxes: { input: HTMLInputElement; read: () => boolean }[] = [];
  private sprintSpeed = document.createElement('output');
  private ammoStatus = document.createElement('span');
  private elapsed = 0;
  private initialVisionRange: number;
  private initialFlashlight: { radius: number; intensity: number };

  constructor(private player: Player, private input: Input, private canvas: HTMLCanvasElement,
    private light: LightSource, private flashlight: ConeLight,
    private initialConfig: PlayerConfig = player.getConfigSnapshot(),
    private initialLight = { radius: light.getRadius(), intensity: light.getIntensity() }) {
    this.initialVisionRange = player.getVisionRange();
    this.initialFlashlight = { radius: flashlight.getRadius(), intensity: flashlight.getIntensity() };
    this.root.className = 'player-debug';
    this.root.dataset.playerDebug = '';
    this.toggle.type = 'button';
    this.toggle.className = 'debug-toggle';
    this.toggle.textContent = '调试 · F2';
    this.toggle.setAttribute('aria-controls', 'player-debug-panel');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.onclick = () => this.setOpen(this.panel.hidden);
    this.panel.id = 'player-debug-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', '角色属性调试');

    const header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = '角色调试';
    const close = this.button('收起', () => this.setOpen(false));
    close.setAttribute('aria-label', '收起调试面板');
    header.append(title, close);
    const content = document.createElement('div'); content.className = 'debug-content';
    this.panel.append(header, content);
    this.root.append(this.toggle, this.panel);

    const health = this.section(content, '生命');
    this.meter(health, '生命值', s => [s.health, this.player.getMaxHealth()], 'health');
    this.stateField(health, 'health', '当前血量', '', () => this.player.getMaxHealth());
    this.configField(health, 'base', 'maxHealth', '血量上限', '', 1, 1);
    health.append(this.button('血量回满', () => this.player.setDebugState({ health: this.player.getMaxHealth() })));

    const attack = this.section(content, '攻击');
    this.configField(attack, 'shooting', 'damage', '基础攻击力', '', 0.01, 1, undefined, s => s.effectiveDamage);
    this.configField(attack, 'shooting', 'fireRate', '射速', '发/秒', 0.01, 0.1, undefined, s => s.effectiveFireRate);
    this.configField(attack, 'shooting', 'bulletSpeed', '子弹速度', 'px/s', 0.01, 10, undefined, s => s.effectiveBulletSpeed);
    this.configField(attack, 'shooting', 'maxRange', '最大射程', 'px', 1, 50);

    const recoil = this.section(content, '弹道散布');
    this.configField(recoil, 'shooting', 'spreadHorizontal', '基础水平半角', '度', 0, 0.1);
    this.configField(recoil, 'shooting', 'spreadVertical', '基础垂直半角', '度', 0, 0.1);
    this.configField(recoil, 'shooting', 'maxSpreadHorizontal', '最大水平半角', '度', 0, 0.1);
    this.configField(recoil, 'shooting', 'maxSpreadVertical', '最大垂直半角', '度', 0, 0.1);
    this.configField(recoil, 'shooting', 'recoilPerShot', '每发累积强度', '', 0, 0.01, 1);
    this.configField(recoil, 'shooting', 'recoilRecoveryDelay', '恢复延迟', '秒', 0, 0.05);
    this.configField(recoil, 'shooting', 'recoilRecoveryDuration', '满强度恢复时长', '秒', 0.01, 0.1);

    const waterDrag = this.section(content, '子弹水体阻力');
    for (const [key, label] of Object.entries({ shallow: '浅水减速', water: '普通水减速', deep: '深水减速', ultraDeep: '极深水减速' })) {
      const depth = key as keyof BulletWaterDrag;
      this.field(waterDrag, `bulletWaterDrag.${key}`, label, '%/秒', 0, 1, {
        read: config => config.bulletWaterDrag![depth]! * 100,
        write: value => this.player.applyConfig({ bulletWaterDrag: { [depth]: value / 100 } }),
      });
    }

    const movement = this.section(content, '移动');
    this.configField(movement, 'base', 'maxSpeed', '基础移速', 'px/s', 0, 10, undefined, s => s.effectiveSpeed);
    this.configField(movement, 'sprint', 'speedMultiplier', '快速移速倍率', '倍', 1, 0.1);
    const speed = document.createElement('p'); speed.className = 'debug-derived';
    speed.append('快速移速 ', this.sprintSpeed); movement.append(speed);
    this.configField(movement, 'movement', 'startSpeedRatio', '起步速度比例', '', 0, 0.05, 1);
    this.configField(movement, 'movement', 'startupDuration', '起步时长', '秒', 0, 0.01);
    this.configField(movement, 'movement', 'turnDamping', '转向阻尼', '秒', 0, 0.001);
    this.configField(movement, 'movement', 'stopDuration', '停止滑行时长', '秒', 0, 0.01);
    this.configField(movement, 'sprint', 'rampDuration', '冲刺升速时长', '秒', 0, 0.01);

    const stamina = this.section(content, '体力');
    this.meter(stamina, '体力值', s => [s.stamina, this.player.getMaxStamina()], 'stamina');
    this.stateField(stamina, 'stamina', '当前体力', '', () => this.player.getMaxStamina());
    this.configField(stamina, 'sprint', 'maxStamina', '体力上限', '', 0.01, 1);
    this.configField(stamina, 'sprint', 'drainPerSecond', '每秒消耗', '/秒', 0.01, 1);
    this.configField(stamina, 'sprint', 'regenPerSecond', '每秒恢复', '/秒', 0.01, 1);
    this.configField(stamina, 'sprint', 'regenDelay', '恢复延迟', '秒', 0, 0.1);
    this.configField(stamina, 'sprint', 'restartThreshold', '耗尽恢复门槛', '比例', 0.001, 0.05, 1);
    stamina.append(this.button('体力回满', () => this.player.setDebugState({ stamina: this.player.getMaxStamina() })));

    const ammo = this.section(content, '弹药与换弹');
    ammo.append(this.ammoStatus);
    this.meter(ammo, '弹匣余弹', s => [s.magazineAmmo, s.magazineSize], 'ammo');
    this.stateField(ammo, 'magazineAmmo', '弹匣余弹', '发', () => this.player.getMagazineSize());
    this.field(ammo, 'chambered', '膛内子弹', '发', 0, 1, {
      read: (_config, state) => state.chambered ? 1 : 0,
      write: value => this.player.setDebugState({ chambered: value !== 0 }),
      max: () => 1,
    });
    this.configField(ammo, 'shooting', 'magazineSize', '弹匣容量', '发', 1, 1);
    this.configField(ammo, 'shooting', 'reloadDuration', '换弹时长', '秒', 0.01, 0.1);
    this.checkbox(ammo, 'autoReload', '打空自动换弹', () => this.player.getAutoReload(),
      value => this.player.setAutoReload(value));
    this.meter(ammo, '换弹进度', s => [s.reloadProgress, 100], 'reload');
    this.stateField(ammo, 'reloadProgress', '换弹进度', '%', () => 100);
    ammo.append(
      this.button('打空弹匣', () => this.player.setDebugState({ magazineAmmo: 0, chambered: false })),
      this.button('立即换弹', () => this.player.requestReload()),
      this.button('补满弹匣', () => this.player.setDebugState({
        magazineAmmo: this.player.getMagazineSize(), chambered: true,
      })),
    );

    const lighting = this.section(content, '角色微光');
    this.field(lighting, 'light.radius', '微光半径', 'px', 0, 25, {
      read: () => this.light.getRadius(), write: value => this.light.setRadius(value),
    });
    this.field(lighting, 'light.intensity', '微光强度', '', 0, 0.1, {
      read: () => this.light.getIntensity(), write: value => this.light.setIntensity(value), max: () => 2,
    });
    const flashNote = document.createElement('p'); flashNote.className = 'debug-derived';
    flashNote.textContent = '只照地面，不影响地形顶面';
    lighting.append(flashNote);

    const torch = this.section(content, '锥形手电筒');
    this.field(torch, 'flashlight.radius', '手电筒距离', 'px', 100, 25, {
      read: () => this.flashlight.getRadius(), write: value => this.flashlight.setRadius(value), max: () => 1600,
    });
    this.field(torch, 'flashlight.intensity', '手电筒强度', '', 0, 0.05, {
      read: () => this.flashlight.getIntensity(), write: value => this.flashlight.setIntensity(value), max: () => 2,
    });
    const torchNote = document.createElement('p'); torchNote.className = 'debug-derived';
    torchNote.textContent = '张角固定 120°，G 键开关';
    torch.append(torchNote);

    const fog = this.section(content, '战争迷雾');
    this.field(fog, 'vision.range', '迷雾半径', 'px', 100, 10, {
      read: () => this.player.getVisionRange(), write: value => this.player.setVisionRange(value), max: () => 1600,
    });
    const fogNote = document.createElement('p'); fogNote.className = 'debug-derived';
    fogNote.textContent = '只影响单位的可见范围；地形始终可见';
    fog.append(fogNote);

    const footer = document.createElement('footer');
    const note = document.createElement('small'); note.textContent = '本次运行生效 · 刷新后还原';
    footer.append(this.button('恢复初始参数', () => {
      this.player.applyConfig(this.initialConfig);
      this.player.setDebugState({ health: this.player.getMaxHealth(), stamina: this.player.getMaxStamina(),
        magazineAmmo: this.player.getMagazineSize(), chambered: true });
      this.light.setRadius(this.initialLight.radius);
      this.light.setIntensity(this.initialLight.intensity);
      this.flashlight.setRadius(this.initialFlashlight.radius);
      this.flashlight.setIntensity(this.initialFlashlight.intensity);
      this.player.setVisionRange(this.initialVisionRange);
      this.player.setAutoReload(false);
      this.fields.forEach(field => this.clearError(field));
      this.refresh(true);
    }), note);
    this.panel.append(footer);
    this.root.addEventListener('focusin', this.blockInput);
    this.root.addEventListener('pointerdown', this.blockInput);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.body.append(this.root);
  }

  private button(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.onclick = () => { action(); this.refresh(); };
    return button;
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = title;
    section.append(heading); parent.append(section); return section;
  }

  private meter(parent: HTMLElement, label: string, read: (s: DebugState) => [number, number], name: string): void {
    const row = document.createElement('div'); row.className = `debug-meter debug-meter-${name}`;
    const meter = document.createElement('progress'); meter.setAttribute('aria-label', label);
    const text = document.createElement('output'); row.append(meter, text); parent.append(row);
    this.meters.push({ meter, text, read });
  }

  private configField(parent: HTMLElement, group: ConfigGroup, key: string, label: string, unit: string,
    min: number, step: number, max?: number, actual?: Field['actual']): void {
    this.field(parent, `${group}.${key}`, label, unit, min, step, {
      read: config => {
        const value = (config[group] as Record<string, number>)[key];
        return key === 'fireRate' ? 1 / value : value;
      },
      write: value => this.player.applyConfig({ [group]: { [key]: key === 'fireRate' ? 1 / value : value } }),
      max: max === undefined ? undefined : () => max, actual,
    });
  }

  private stateField(parent: HTMLElement, key: 'health' | 'stamina' | 'magazineAmmo' | 'reloadProgress',
    label: string, unit: string, max: Field['max']): void {
    this.field(parent, key, label, unit, 0, 'any', {
      read: (_config, state) => state[key], write: value => this.player.setDebugState({ [key]: value }), max,
    });
  }

  private field(parent: HTMLElement, id: string, label: string, unit: string, min: number, step: number | 'any',
    behavior: Pick<Field, 'read' | 'write' | 'max' | 'actual'>): void {
    const row = document.createElement('div'); row.className = 'debug-field';
    const name = document.createElement('label'); name.htmlFor = `debug-${id}`; name.textContent = label;
    const input = document.createElement('input'); input.type = 'number'; input.id = name.htmlFor;
    input.dataset.debugField = id; input.min = String(min); input.step = String(step);
    const suffix = document.createElement('span'); suffix.className = 'debug-unit'; suffix.textContent = unit;
    const error = document.createElement('span'); error.id = `debug-error-${id}`; error.className = 'debug-error';
    error.setAttribute('aria-live', 'polite');
    const effective = document.createElement('small'); effective.className = 'debug-effective';
    input.setAttribute('aria-describedby', error.id);
    const field: Field = { input, error, effective, ...behavior };
    let dirty = false;
    input.addEventListener('input', () => { dirty = true; });
    const commit = () => {
      if (!dirty) return;
      try {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) throw new Error('请输入有限数值');
        if (value < min || (field.max && value > field.max(this.player.getDebugState()))) {
          throw new Error(field.max ? `请输入 ${min}–${this.format(field.max(this.player.getDebugState()))}` : `最小值为 ${min}`);
        }
        field.write(value); dirty = false; this.clearError(field); this.refresh();
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : '数值无效';
        input.setAttribute('aria-invalid', 'true');
      }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
    });
    row.append(name, input, suffix, effective, error); parent.append(row); this.fields.push(field);
  }

  /** 调试开关：只影响运行时行为，不写进配置快照。 */
  private checkbox(parent: HTMLElement, id: string, label: string, read: () => boolean, write: (value: boolean) => void): void {
    const row = document.createElement('div'); row.className = 'debug-field debug-check';
    const name = document.createElement('label'); name.htmlFor = `debug-${id}`; name.textContent = label;
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = name.htmlFor;
    input.dataset.debugField = id;
    input.addEventListener('change', () => { write(input.checked); this.refresh(); });
    row.append(name, input); parent.append(row);
    this.checkboxes.push({ input, read });
  }

  private clearError(field: Field): void {
    field.error.textContent = ''; field.input.removeAttribute('aria-invalid');
  }

  private format(value: number): string { return Number(value.toFixed(3)).toString(); }

  private refresh(force = false): void {
    if (this.panel.hidden) return;
    const config = this.player.getConfigSnapshot(), state = this.player.getDebugState();
    for (const field of this.fields) {
      const base = field.read(config, state);
      if (force || (document.activeElement !== field.input && !field.error.textContent)) {
        // Config values retain their precision; only continuously changing resources are rounded.
        field.input.value = field.input.dataset.debugField!.includes('.') ? String(base) : this.format(base);
      }
      if (field.max) field.input.max = String(field.max(state));
      const actual = field.actual?.(state);
      field.effective.textContent = actual !== undefined && Math.abs(actual - base) > 0.0001 ? `实际 ${this.format(actual)}` : '';
    }
    for (const { meter, text, read } of this.meters) {
      const [value, max] = read(state); meter.max = max; meter.value = value;
      text.textContent = `${this.format(value)} / ${this.format(max)}`;
    }
    for (const { input, read } of this.checkboxes) input.checked = read();
    this.sprintSpeed.value = `${this.format(config.base!.maxSpeed! * config.sprint!.speedMultiplier!)} px/s`;
    if (Math.abs(state.effectiveSprintSpeed - config.base!.maxSpeed! * config.sprint!.speedMultiplier!) > 0.0001) {
      this.sprintSpeed.value += ` · 实际 ${this.format(state.effectiveSprintSpeed)}`;
    }
    this.ammoStatus.textContent = state.isReloading ? '换弹中'
      : state.magazineAmmo + (state.chambered ? 1 : 0) > 0 ? '可射击' : '弹匣已空';
    this.ammoStatus.className = state.isReloading ? 'debug-status reloading' : 'debug-status';
    this.root.dataset.exhausted = String(state.exhausted);
  }

  update(delta: number): void {
    if (this.panel.hidden) return;
    this.elapsed += delta;
    if (this.elapsed >= 0.1) { this.elapsed = 0; this.refresh(); }
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open; this.toggle.setAttribute('aria-expanded', String(open));
    if (open) { this.refresh(); this.toggle.focus(); }
    else {
      if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.input.setBlocked(false);
    }
  }

  private blockInput = (): void => this.input.setBlocked(true);
  private onPointerDown = (event: PointerEvent): void => {
    if (event.target === this.canvas) {
      if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.input.setBlocked(false);
    }
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'F2' || (event.key === 'Escape' && !this.panel.hidden)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) this.setOpen(event.key === 'F2' ? this.panel.hidden : false);
    }
  };

  dispose(): void {
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.remove();
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    this.input.setBlocked(false);
  }
}
