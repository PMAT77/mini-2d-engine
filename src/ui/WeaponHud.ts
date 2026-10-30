import type { ReloadMode, WeaponKind, WeaponView } from "../objects/Weapon";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 右下角武器卡片的所有尺寸，单位是逻辑像素（绘制前已按 dpr 缩放）。 */
export const WEAPON_HUD = {
  width: 336,
  height: 132,
  compactHeight: 92,
  margin: 24,
  smallMargin: 8,
  radius: 16,
  iconSize: 60,
  compactIconSize: 54,
  iconInset: 20,
  iconTop: 38,
  compactIconTop: 20,
  pillX: 96,
  pillWidth: 34,
  pillHeight: 22,
  textX: 138,
  rightEdge: 314,
  stripRight: 292,
  stripWidth: 96,
  stripTop: 88,
  chamberWidth: 12,
  chamberHeight: 28,
  slotHeight: 28,
  notch: 10,
  slotGap: 4,
  maxDiscreteSlots: 12,
  slotRadius: 2.5,
  ammoX: 96,
  ammoBaseline: 116,
  ammoMaxWidth: 96,
  nameBaseline: 54,
  compactNameBaseline: 48,
  hintBaseline: 76,
  compactHintBaseline: 70,
  nameMaxWidth: 120,
  nameFont: '600 15px "Microsoft YaHei", "PingFang SC", sans-serif',
  tagFont: '600 13px "Microsoft YaHei", "PingFang SC", sans-serif',
  hintFont: '600 11px "Microsoft YaHei", "PingFang SC", sans-serif',
  pillFont: '600 12px "Microsoft YaHei", "PingFang SC", sans-serif',
  ammoFont: '600 30px Consolas, "SF Mono", "Cascadia Mono", monospace',
} as const;

const INK = "#e8f4f8";
const MUTED = "#8fa6b4";
const BRASS = "#f0c674";
const CHAMBER = "#ffe6a3";
const AMBER = "#ffce6b";
const EMBER = "#f16b67";
const LOW = "#ff8a5c";

const PLATE = "rgba(12,18,26,0.8)";
const BORDER = "rgba(116,200,213,0.18)";
const ICON_SLOT_BORDER = "rgba(116,200,213,0.35)";
const PILL_BORDER = "rgba(116,200,213,0.28)";

/** 开火那一发的白闪时长（秒）。 */
const SHOT_FLASH_SECONDS = 0.09;
/** 换弹完成时的暖闪时长（秒）。 */
const REFILL_FLASH_SECONDS = 0.22;
/** 换弹开始时旧弹匣下落淡出的时长（秒）。 */
const DISCARD_SECONDS = 0.12;
/** 装填时每坐实一发白闪的时长（秒）。 */
const SEAT_FLASH_SECONDS = 0.09;

export interface WeaponHudLayout {
  card: Rect;
  icon: Rect;
  /** 槽位胶囊：主 / 副 / 近战 / 空手。 */
  pill: Rect;
  name: { x: number; baseline: number; maxWidth: number };
  tag: { right: number; baseline: number };
  hint: { x: number; baseline: number } | null;
  ammo: { x: number; baseline: number; maxWidth: number };
  /** 离散弹匣槽的排布；槽位 i=0 最左（贴弹匣底部）。 */
  mags: { right: number; y: number; height: number; slotWidth: number; gap: number; count: number };
  chamber: Rect;
  /** 容量超过 maxDiscreteSlots 时改用连续容量条，null 表示用离散槽。 */
  bar: Rect | null;
}

export interface SlotView {
  kind: "mag" | "chamber";
  /** 0-1，自下而上的填充比例。 */
  fill: number;
}

export type WeaponHudPhase = "normal" | "low" | "empty" | "reloading" | "melee" | "unarmed";

export interface WeaponHudStatus {
  phase: WeaponHudPhase;
  /** 当前补弹方式；phase 不是 reloading 时为 null。 */
  reloadMode: ReloadMode | null;
  /** 膛内 + 弹匣的可用总弹数。 */
  roundsReady: number;
  magazineSize: number;
  magazineAmmo: number;
  reloadProgress: number;
  ammoText: string;
  tagText: string;
  pillText: string;
  hintText: string;
  showAmmo: boolean;
  slots: SlotView[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeSize(size: number): number {
  if (!Number.isFinite(size)) return 1;
  return Math.max(1, Math.floor(size));
}

function normalizeAmmo(ammo: number, size: number): number {
  if (!Number.isFinite(ammo)) return 0;
  return Math.max(0, Math.min(size, Math.floor(ammo)));
}

/** 右下角卡片布局；compact 用于近战/空手（卡片变矮、不显示弹药）。 */
export function getWeaponHudLayout(viewWidth: number, viewHeight: number, compact = false, magazineSize = 6): WeaponHudLayout {
  const cardWidth = WEAPON_HUD.width;
  const cardHeight = compact ? WEAPON_HUD.compactHeight : WEAPON_HUD.height;
  const margin = viewWidth >= cardWidth + 2 * WEAPON_HUD.margin && viewHeight >= cardHeight + 2 * WEAPON_HUD.margin
    ? WEAPON_HUD.margin
    : WEAPON_HUD.smallMargin;
  const x = Math.max(0, viewWidth - margin - cardWidth);
  const y = Math.max(0, viewHeight - margin - cardHeight);

  const slotCount = normalizeSize(magazineSize);
  const slotArea = WEAPON_HUD.stripWidth;
  const gap = WEAPON_HUD.slotGap;
  // 12 槽时约 4.3px 宽，6 发手枪是 12.67px；30 发则退化为连续条。
  const slotWidth = Math.max(2, Math.min(14, (slotArea - (slotCount - 1) * gap) / slotCount));
  const iconSize = compact ? WEAPON_HUD.compactIconSize : WEAPON_HUD.iconSize;
  const iconTop = compact ? WEAPON_HUD.compactIconTop : WEAPON_HUD.iconTop;

  return {
    card: { x, y, width: cardWidth, height: cardHeight },
    icon: { x: x + WEAPON_HUD.iconInset, y: y + iconTop, width: iconSize, height: iconSize },
    pill: {
      x: x + WEAPON_HUD.pillX,
      y: y + (compact ? (cardHeight - WEAPON_HUD.pillHeight) / 2 : WEAPON_HUD.iconTop),
      width: WEAPON_HUD.pillWidth,
      height: WEAPON_HUD.pillHeight,
    },
    name: {
      x: x + WEAPON_HUD.textX,
      baseline: y + (compact ? WEAPON_HUD.compactNameBaseline : WEAPON_HUD.nameBaseline),
      maxWidth: WEAPON_HUD.nameMaxWidth,
    },
    tag: {
      right: x + WEAPON_HUD.rightEdge,
      baseline: y + (compact ? WEAPON_HUD.compactNameBaseline : WEAPON_HUD.nameBaseline),
    },
    hint: {
      x: x + WEAPON_HUD.textX,
      baseline: y + (compact ? WEAPON_HUD.compactHintBaseline : WEAPON_HUD.hintBaseline),
    },
    ammo: { x: x + WEAPON_HUD.ammoX, baseline: y + WEAPON_HUD.ammoBaseline, maxWidth: WEAPON_HUD.ammoMaxWidth },
    mags: {
      right: x + WEAPON_HUD.stripRight,
      y: y + WEAPON_HUD.stripTop,
      height: WEAPON_HUD.slotHeight,
      slotWidth,
      gap,
      count: slotCount,
    },
    chamber: {
      x: x + WEAPON_HUD.stripRight + WEAPON_HUD.notch,
      y: y + WEAPON_HUD.stripTop,
      width: WEAPON_HUD.chamberWidth,
      height: WEAPON_HUD.chamberHeight,
    },
    bar: slotCount > WEAPON_HUD.maxDiscreteSlots
      ? { x: x + WEAPON_HUD.stripRight - slotArea, y: y + WEAPON_HUD.stripTop, width: slotArea, height: WEAPON_HUD.slotHeight }
      : null,
  };
}

/** 由当前武器快照得到 HUD 状态；纯函数，不接触 canvas。 */
export function getWeaponHudStatus(view: WeaponView): WeaponHudStatus {
  const size = normalizeSize(view.magazineSize);
  const pillText = view.slot === "primary" ? "主" : view.slot === "secondary" ? "副" : view.kind === "empty" ? "空手" : "近战";

  if (view.kind === "empty" || view.kind === "melee") {
    const empty = view.kind === "empty";
    return {
      phase: empty ? "unarmed" : "melee",
      reloadMode: null,
      roundsReady: 0,
      magazineSize: 0,
      magazineAmmo: 0,
      reloadProgress: 0,
      ammoText: "",
      tagText: empty ? "空手" : "近战",
      pillText,
      hintText: empty ? "Q/E 拔枪" : "Q/E 切换 · C 收刀",
      showAmmo: false,
      slots: [],
    };
  }

  const ammo = normalizeAmmo(view.magazineAmmo, size);
  const chambered = view.chambered === true;
  const roundsReady = ammo + (chambered ? 1 : 0);
  const capacity = size + 1;
  // 7 发容量（6+1）时阈值是 2 发，与「余 1-2 发就该换弹」的手感一致。
  const lowThreshold = Math.ceil(capacity * 0.25);
  const progress = clamp01(view.reloadProgress);
  const phase: WeaponHudPhase = view.isReloading
    ? "reloading"
    : roundsReady === 0
      ? "empty"
      : roundsReady <= lowThreshold
        ? "low"
        : "normal";

  const slots: SlotView[] = [];
  const loadMode = view.isReloading && view.reloadMode === "load";
  const missing = Math.max(0, size - ammo);
  const seated = loadMode ? Math.floor(progress * missing) : 0;
  if (size <= WEAPON_HUD.maxDiscreteSlots) {
    for (let i = 0; i < size; i++) {
      let fill: number;
      if (view.isReloading && !loadMode) {
        // 换弹：整匣丢弃后从左到右重新填满，i=size 的膛内槽最后填。
        fill = clamp01(progress * capacity - i);
      } else if (loadMode) {
        // 装填：已装的弹保持亮起，从第一个空槽开始逐发坐实。
        fill = i < ammo ? 1
          : i < ammo + seated ? 1
            : i === ammo + seated ? clamp01(progress * missing - seated)
              : 0;
      } else {
        fill = i < ammo ? 1 : 0;
      }
      slots.push({ kind: "mag", fill });
    }
  }
  slots.push({
    kind: "chamber",
    fill: view.isReloading && !loadMode ? clamp01(progress * capacity - size) : chambered ? 1 : 0,
  });

  const reserve = view.reserveAmmo;
  const tagText = phase === "reloading"
    ? (loadMode ? "装填中" : "换弹中")
    : phase === "empty"
      ? "R 换弹"
      : `备弹 ${reserve === null ? "∞" : Math.max(0, Math.floor(reserve))}`;

  return {
    phase,
    reloadMode: view.isReloading ? view.reloadMode ?? "reload" : null,
    roundsReady,
    magazineSize: size,
    magazineAmmo: ammo,
    reloadProgress: progress,
    ammoText: `${ammo}/${size}`,
    tagText,
    pillText,
    hintText: "Q/E 切换 · C 收枪",
    showAmmo: true,
    slots,
  };
}

/** 右下角武器 HUD：缓存上一帧弹药推断槽位闪烁，不读取玩家内部状态。 */
export class WeaponHud {
  private previous: WeaponView | null = null;
  /** 剩余白闪时间（秒）。 */
  private shotFlashTimer = 0;
  /** 白闪槽位：-1 表示膛内，>=0 表示弹匣槽下标。 */
  private shotFlashSlot = -1;
  private refillFlashTimer = 0;
  /** 换弹开始时旧弹匣下落淡出的剩余时间。 */
  private discardTimer = 0;
  private discardAmmo = 0;
  private discardChambered = false;
  /** 装填时新坐实一发的白闪。 */
  private seatFlashTimer = 0;
  private seatFlashSlot = -1;
  /** 上一帧已经坐实的发数，用来判断“新装进一发”的瞬间。 */
  private lastSeated = -1;
  private lastStatus: WeaponHudStatus | null = null;

  update(delta: number, view: WeaponView): void {
    const step = Math.max(0, delta);
    this.shotFlashTimer = Math.max(0, this.shotFlashTimer - step);
    this.refillFlashTimer = Math.max(0, this.refillFlashTimer - step);
    this.discardTimer = Math.max(0, this.discardTimer - step);
    this.seatFlashTimer = Math.max(0, this.seatFlashTimer - step);

    const prev = this.previous;
    // 切枪时槽位变了，不把上一把枪的余弹差当作这一把开火，也不延续补弹动效。
    if (prev && prev.slot !== view.slot) {
      this.discardTimer = 0;
      this.seatFlashTimer = 0;
      this.lastSeated = -1;
    }
    if (prev && prev.slot === view.slot && prev.kind === "firearm" && view.kind === "firearm") {
      if (!view.isReloading && !prev.isReloading) {
        if (prev.chambered && !view.chambered) {
          // 最后一发在膛内被打掉：闪膛内槽。
          this.shotFlashSlot = -1;
          this.shotFlashTimer = SHOT_FLASH_SECONDS;
        } else if (view.magazineAmmo < prev.magazineAmmo) {
          // 弹匣出货：打完的是 magazineAmmo 这一格（填充自左向右）。
          const size = normalizeSize(view.magazineSize);
          this.shotFlashSlot = Math.max(0, Math.min(size - 1, normalizeAmmo(view.magazineAmmo, size)));
          this.shotFlashTimer = SHOT_FLASH_SECONDS;
        }
      }
      if (prev.isReloading && !view.isReloading && (view.magazineAmmo > 0 || view.chambered)) {
        this.refillFlashTimer = REFILL_FLASH_SECONDS;
      }
      // 换弹开始的瞬间记录旧弹匣，用于整匣下落淡出。
      if (!prev.isReloading && view.isReloading && view.reloadMode === "reload") {
        this.discardTimer = DISCARD_SECONDS;
        this.discardAmmo = normalizeAmmo(prev.magazineAmmo, normalizeSize(view.magazineSize));
        this.discardChambered = prev.chambered;
      }
      // 装填时按“已坐实发数”变化点亮新弹。
      if (view.isReloading && view.reloadMode === "load") {
        const size = normalizeSize(view.magazineSize);
        const ammo = normalizeAmmo(view.magazineAmmo, size);
        const missing = Math.max(0, size - ammo);
        const seated = Math.floor(clamp01(view.reloadProgress) * missing);
        if (prev.isReloading && prev.reloadMode === "load" && seated > this.lastSeated && seated > 0) {
          this.seatFlashSlot = Math.min(size - 1, ammo + seated - 1);
          this.seatFlashTimer = SEAT_FLASH_SECONDS;
        }
        this.lastSeated = seated;
      } else {
        this.lastSeated = -1;
      }
    }
    // 拷贝一份，避免玩家之后改写同一个对象影响比较。
    this.previous = { ...view };
  }

  getLastStatus(): WeaponHudStatus | null {
    return this.lastStatus;
  }

  draw(ctx: CanvasRenderingContext2D, view: WeaponView, viewWidth: number, viewHeight: number): void {
    const status = getWeaponHudStatus(view);
    this.lastStatus = status;
    const layout = getWeaponHudLayout(viewWidth, viewHeight, !status.showAmmo, status.magazineSize);

    ctx.save();
    this.drawCard(ctx, layout);
    this.drawIcon(ctx, status.phase, view.slot, layout.icon);
    // 空手/近战用名称和标签表达，不再重复画槽位胶囊。
    if (status.showAmmo) this.drawPill(ctx, layout, status);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = WEAPON_HUD.nameFont;
    ctx.fillStyle = INK;
    ctx.fillText(view.name, layout.name.x, layout.name.baseline, layout.name.maxWidth);

    ctx.textAlign = "right";
    ctx.font = WEAPON_HUD.tagFont;
    ctx.fillStyle = status.phase === "reloading" || status.phase === "empty" ? AMBER : MUTED;
    ctx.fillText(status.tagText, layout.tag.right, layout.tag.baseline);

    if (layout.hint) {
      ctx.textAlign = "left";
      ctx.font = WEAPON_HUD.hintFont;
      ctx.fillStyle = MUTED;
      ctx.fillText(status.hintText, layout.hint.x, layout.hint.baseline);
    }

    if (status.showAmmo) {
      this.drawAmmo(ctx, layout, status);
      this.drawRounds(ctx, layout, status);
    }
    ctx.restore();
  }

  private drawCard(ctx: CanvasRenderingContext2D, layout: WeaponHudLayout): void {
    const { card, icon } = layout;
    ctx.beginPath();
    ctx.roundRect(card.x + 0.5, card.y + 0.5, card.width - 1, card.height - 1, WEAPON_HUD.radius);
    ctx.fillStyle = PLATE;
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(icon.x + 0.5, icon.y + 0.5, icon.width - 1, icon.height - 1, 9);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = ICON_SLOT_BORDER;
    ctx.stroke();
  }

  private drawPill(ctx: CanvasRenderingContext2D, layout: WeaponHudLayout, status: WeaponHudStatus): void {
    const { pill } = layout;
    ctx.beginPath();
    ctx.roundRect(pill.x, pill.y, pill.width, pill.height, pill.height / 2);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = PILL_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = WEAPON_HUD.pillFont;
    ctx.fillStyle = status.phase === "unarmed" ? MUTED : INK;
    ctx.fillText(status.pillText, pill.x + pill.width / 2, pill.y + pill.height / 2 + 0.5);
  }

  private drawAmmo(ctx: CanvasRenderingContext2D, layout: WeaponHudLayout, status: WeaponHudStatus): void {
    const color = status.phase === "empty" ? EMBER : status.phase === "low" ? LOW : INK;
    ctx.save();
    if (status.phase === "reloading") ctx.globalAlpha = 0.7;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = WEAPON_HUD.ammoFont;
    ctx.fillStyle = color;
    ctx.fillText(status.ammoText, layout.ammo.x, layout.ammo.baseline, layout.ammo.maxWidth);
    ctx.restore();
  }

  private drawRounds(ctx: CanvasRenderingContext2D, layout: WeaponHudLayout, status: WeaponHudStatus): void {
    const reloading = status.phase === "reloading";
    const loadMode = reloading && status.reloadMode === "load";
    const low = !reloading && (status.phase === "low" || status.phase === "empty");
    const fillColor = reloading ? (loadMode ? BRASS : AMBER) : low ? LOW : BRASS;
    const size = Math.max(1, status.magazineSize);
    const missing = Math.max(0, size - status.magazineAmmo);
    // 连续条：换弹是从零扫满，装填是在现有余弹上补齐。
    const barFill = reloading
      ? loadMode ? (status.magazineAmmo + status.reloadProgress * missing) / size : status.reloadProgress
      : status.magazineAmmo / size;

    if (layout.bar) {
      this.drawSlot(ctx, layout.bar, 3, barFill, fillColor);
      if (loadMode) {
        this.drawBarTicks(ctx, layout.bar, size);
        if (barFill > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          ctx.fillRect(layout.bar.x + layout.bar.width * barFill - 1, layout.bar.y + 3, 2, layout.bar.height - 6);
        }
      }
    } else {
      for (let i = 0; i < status.slots.length; i++) {
        const slot = status.slots[i];
        if (slot.kind === "chamber") {
          this.drawSlot(ctx, layout.chamber, 2, slot.fill, reloading && !loadMode ? AMBER : CHAMBER);
          continue;
        }
        this.drawSlot(ctx, this.magSlotRect(layout, i), WEAPON_HUD.slotRadius, slot.fill, fillColor);
      }
    }

    // 膛内那发永远单独一个高亮小槽，不跟弹匣混在一起数。
    if (layout.bar) {
      const chamberSlot = status.slots[status.slots.length - 1];
      if (chamberSlot) this.drawSlot(ctx, layout.chamber, 2, chamberSlot.fill, reloading && !loadMode ? AMBER : CHAMBER);
    }

    // 换弹开始：旧弹匣整体下沉淡出，和装填“逐发坐实”区分开。
    if (reloading && !loadMode && this.discardTimer > 0) {
      const t = 1 - this.discardTimer / DISCARD_SECONDS;
      const alpha = Math.max(0, 1 - t) * 0.9;
      const dy = 10 * t;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, dy);
      if (layout.bar) {
        if (this.discardAmmo > 0) {
          ctx.fillStyle = BRASS;
          const width = layout.bar.width * Math.min(1, this.discardAmmo / Math.max(1, status.magazineSize));
          ctx.fillRect(layout.bar.x, layout.bar.y, width, layout.bar.height);
        }
        if (this.discardChambered) {
          ctx.fillStyle = CHAMBER;
          ctx.fillRect(layout.chamber.x, layout.chamber.y, layout.chamber.width, layout.chamber.height);
        }
      } else {
        for (let i = 0; i < this.discardAmmo && i < layout.mags.count; i++) {
          const rect = this.magSlotRect(layout, i);
          ctx.fillStyle = BRASS;
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
        if (this.discardChambered) {
          ctx.fillStyle = CHAMBER;
          ctx.fillRect(layout.chamber.x, layout.chamber.y, layout.chamber.width, layout.chamber.height);
        }
      }
      ctx.restore();
    }

    // 装填新坐实的一发闪一下白，强调“一发一发压进去”。
    if (loadMode && this.seatFlashTimer > 0 && this.seatFlashSlot >= 0 && !layout.bar) {
      const t = this.seatFlashTimer / SEAT_FLASH_SECONDS;
      this.overlay(ctx, this.magSlotRect(layout, this.seatFlashSlot),
        `rgba(255,255,255,${(0.5 * t).toFixed(3)})`, WEAPON_HUD.slotRadius);
    }

    const flash = this.shotFlashTimer > 0 ? this.shotFlashTimer / SHOT_FLASH_SECONDS : 0;
    if (flash > 0) {
      const rect = layout.bar
        ? layout.bar
        : this.shotFlashSlot === -1
          ? layout.chamber
          : this.magSlotRect(layout, this.shotFlashSlot);
      this.overlay(ctx, rect, `rgba(255,255,255,${(0.55 * flash).toFixed(3)})`, 2);
    }

    if (this.refillFlashTimer > 0) {
      const t = this.refillFlashTimer / REFILL_FLASH_SECONDS;
      const left = layout.bar ? layout.bar.x : layout.mags.right - (layout.mags.count * layout.mags.slotWidth + (layout.mags.count - 1) * layout.mags.gap);
      this.overlay(ctx, {
        x: left - 3,
        y: layout.chamber.y - 3,
        width: layout.chamber.x + layout.chamber.width - left + 6,
        height: layout.chamber.height + 6,
      }, `rgba(255,206,107,${(0.2 * t).toFixed(3)})`, 4);
    }
  }

  /** 连续条上的刻度：每 5 发一格，装填时能看出“一发一发”在推进。 */
  private drawBarTicks(ctx: CanvasRenderingContext2D, bar: Rect, size: number): void {
    const step = Math.max(1, Math.round(size / 6));
    ctx.save();
    ctx.fillStyle = "rgba(12,18,26,0.35)";
    for (let round = step; round < size; round += step) {
      ctx.fillRect(bar.x + bar.width * round / size - 0.5, bar.y + 3, 1, bar.height - 6);
    }
    ctx.restore();
  }

  private magSlotRect(layout: WeaponHudLayout, index: number): Rect {
    // index 0 是最左一格：换弹从弹匣底部（左）往膛口（右）装填，开火则先打最右一格。
    const { right, y, height, slotWidth, gap, count } = layout.mags;
    const left = right - count * slotWidth - (count - 1) * gap;
    return { x: left + index * (slotWidth + gap), y, width: slotWidth, height };
  }

  private drawSlot(ctx: CanvasRenderingContext2D, rect: Rect, radius: number, fill: number, color: string): void {
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();

    const amount = clamp01(fill);
    if (amount > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
      ctx.clip();
      ctx.fillStyle = color;
      const height = Math.max(1, rect.height * amount);
      ctx.fillRect(rect.x, rect.y + rect.height - height, rect.width, height);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private overlay(ctx: CanvasRenderingContext2D, rect: Rect, color: string, radius: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  private drawIcon(ctx: CanvasRenderingContext2D, phase: WeaponHudPhase, slot: WeaponView["slot"], box: Rect): void {
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.scale(box.width / 36, box.height / 36);
    ctx.fillStyle = "#dbeaf0";
    ctx.strokeStyle = "#dbeaf0";
    if (phase === "unarmed") {
      this.drawFistIcon(ctx);
    } else if (phase === "melee") {
      this.drawKnifeIcon(ctx);
    } else if (slot === "primary") {
      this.drawSmgIcon(ctx);
    } else {
      this.drawPistolIcon(ctx);
    }
    ctx.restore();
  }

  private drawPistolIcon(ctx: CanvasRenderingContext2D): void {
    // 侧视手枪，枪口朝右：套筒、前后准星、握把、扳机护圈、扳机。
    ctx.beginPath();
    ctx.roundRect(4, 10, 28, 7, 2);
    ctx.fill();
    ctx.fillRect(26.5, 7.5, 2.5, 3);
    ctx.fillRect(5, 7.5, 2.5, 3);

    ctx.beginPath();
    ctx.moveTo(21, 17);
    ctx.lineTo(29, 17);
    ctx.lineTo(26, 31);
    ctx.lineTo(18.5, 31);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(11.5, 17.5);
    ctx.lineTo(11.5, 20.5);
    ctx.arc(15.5, 20.5, 4, 0, Math.PI);
    ctx.lineTo(19.5, 17.5);
    ctx.stroke();
    ctx.fillRect(14.6, 18.2, 1.8, 3.6);
  }

  private drawSmgIcon(ctx: CanvasRenderingContext2D): void {
    // 侧视冲锋枪，枪口朝右：长机匣、枪管、前握把、弧形弹匣、枪托。
    ctx.beginPath();
    ctx.roundRect(6, 11, 22, 7, 1.5);
    ctx.fill();
    ctx.fillRect(28, 13, 6, 3);
    ctx.fillRect(3, 12, 4, 5);
    // 枪管下的前握把
    ctx.beginPath();
    ctx.roundRect(20, 18, 4, 7, 1);
    ctx.fill();
    // 弹匣
    ctx.save();
    ctx.translate(13, 18);
    ctx.rotate(0.18);
    ctx.beginPath();
    ctx.roundRect(-2.5, 0, 5, 11, 1);
    ctx.fill();
    ctx.restore();
    // 后握把
    ctx.beginPath();
    ctx.moveTo(9, 18);
    ctx.lineTo(13, 18);
    ctx.lineTo(11, 27);
    ctx.lineTo(7.5, 27);
    ctx.closePath();
    ctx.fill();
    // 准星
    ctx.fillRect(26, 8.5, 1.8, 2.5);
  }

  private drawFistIcon(ctx: CanvasRenderingContext2D): void {
    // 空手：握拳的手背与四指关节。
    ctx.beginPath();
    ctx.roundRect(9, 15, 17, 12, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(16, 10, 12, 7, 3);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(14, 18); ctx.lineTo(14, 24);
    ctx.moveTo(18, 18); ctx.lineTo(18, 24);
    ctx.moveTo(22, 18); ctx.lineTo(22, 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(6, 19, 5, 8, 2);
    ctx.fill();
  }

  private drawKnifeIcon(ctx: CanvasRenderingContext2D): void {
    // 斜置短刀：刀身、护手、握柄。
    ctx.beginPath();
    ctx.moveTo(8.5, 26.5);
    ctx.lineTo(24, 8);
    ctx.lineTo(27.5, 11.5);
    ctx.lineTo(11.5, 29.5);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6.5, 24.5);
    ctx.lineTo(13, 31);
    ctx.stroke();
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(8, 28.5);
    ctx.lineTo(4.5, 32);
    ctx.stroke();
  }
}
