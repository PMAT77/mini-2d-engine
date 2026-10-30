/** 准星外观（CSS 像素）：与原 Canvas 绘制版本保持一致的臂长、线宽与描边。 */
const ARM_LENGTH = 7;
const ARM_THICKNESS = 1.5;
const OUTLINE_WIDTH = 1;
const DOT_SIZE = 2;
const OUTLINE_COLOR = '#101820';
const IDLE_COLOR = '#d8faff';
const TARGET_COLOR = '#ff3b30';
/** body 上的标记类：对局内隐藏系统指针（见 index.html），只留准星。 */
const HIDE_CURSOR_CLASS = 'crosshair-active';

/** 存活的准星图层数：场景切换时新旧图层可能短暂并存，最后一个销毁才恢复指针。 */
let activeLayers = 0;

function retainHiddenCursor(): void {
  activeLayers += 1;
  document.body.classList.add(HIDE_CURSOR_CLASS);
}

function releaseHiddenCursor(): void {
  activeLayers = Math.max(0, activeLayers - 1);
  if (activeLayers === 0) document.body.classList.remove(HIDE_CURSOR_CLASS);
}

/**
 * 准星独立图层。
 *
 * 位置在 pointermove 里同步写进 transform，交给合成器搬运已有图层，
 * 不再等待下一帧世界渲染；世界帧再慢，准星也只跟随指针。
 * 外观（张开间距、是否压在活鸡上）仍由场景按帧更新，这部分只是细节变化。
 */
export class CrosshairOverlay {
  private readonly root: HTMLDivElement;
  private readonly arms: HTMLDivElement[];
  private readonly dot: HTMLDivElement;
  private x = Number.NaN;
  private y = Number.NaN;
  private gap = Number.NaN;
  private target = false;
  private visible = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.dataset.crosshair = 'root';
    this.root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;'
      + 'pointer-events:none;z-index:5;display:none;will-change:transform;';
    this.arms = [this.createArm(true), this.createArm(true), this.createArm(false), this.createArm(false)];
    this.dot = document.createElement('div');
    this.dot.dataset.crosshair = 'dot';
    this.dot.style.cssText = `position:absolute;left:0;top:0;width:${DOT_SIZE}px;height:${DOT_SIZE}px;`
      + `background:${IDLE_COLOR};transform:translate3d(${-DOT_SIZE / 2}px,${-DOT_SIZE / 2}px,0);`;
    this.root.append(...this.arms, this.dot);
    document.body.appendChild(this.root);
    // 指针只在准星图层存在期间隐藏：回到菜单或场景退出时系统指针自动恢复。
    retainHiddenCursor();
  }

  /** 指针位置（client 坐标）。对齐设备像素，细线不会被合成器重采样糊掉。 */
  setPosition(clientX: number, clientY: number): void {
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(clientX * dpr) / dpr;
    const y = Math.round(clientY * dpr) / dpr;
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.root.style.transform = `translate3d(${x}px,${y}px,0)`;
    this.setVisible(true);
  }

  /** gap：四臂与中心的距离；target：中心是否压在活鸡上（准星转红）。 */
  setAppearance(gap: number, target: boolean): void {
    const next = Math.round(gap * 10) / 10;
    if (next === this.gap && target === this.target) return;
    this.gap = next;
    this.target = target;
    const half = ARM_THICKNESS / 2;
    const tip = -(next + ARM_LENGTH);
    this.arms[0].style.transform = `translate3d(${tip}px,${-half}px,0)`;
    this.arms[1].style.transform = `translate3d(${next}px,${-half}px,0)`;
    this.arms[2].style.transform = `translate3d(${-half}px,${tip}px,0)`;
    this.arms[3].style.transform = `translate3d(${-half}px,${next}px,0)`;
    const color = target ? TARGET_COLOR : IDLE_COLOR;
    for (const arm of this.arms) arm.style.backgroundColor = color;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
    releaseHiddenCursor();
  }

  private createArm(horizontal: boolean): HTMLDivElement {
    const arm = document.createElement('div');
    arm.dataset.crosshair = 'arm';
    arm.style.cssText = 'position:absolute;left:0;top:0;'
      + (horizontal
        ? `width:${ARM_LENGTH}px;height:${ARM_THICKNESS}px;`
        : `width:${ARM_THICKNESS}px;height:${ARM_LENGTH}px;`)
      + `background:${IDLE_COLOR};box-shadow:0 0 0 ${OUTLINE_WIDTH}px ${OUTLINE_COLOR};`;
    return arm;
  }
}
