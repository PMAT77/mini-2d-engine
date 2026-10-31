import type { WeaponView } from "../objects/Weapon";

/**
 * 右侧武器 HUD 的装饰性美术资源。
 *
 * 这些图片只影响观感：加载失败、加载中或环境里没有 DOM 时，HUD 会退回矢量图形，
 * 因此不走 `AssetLoader.load()` 那条「任一资源失败即整批 reject」的必需资源通道。
 * 资源映射集中在这里，将来接入 weaponId 只需要在表里加条目、在映射函数里加分支。
 */

/** 源图里可见内容（alpha>16）的像素包围盒；运行时按它去掉透明边距，不扫描 alpha。 */
export interface WeaponHudContentBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WeaponHudSprite {
  readonly url: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** 缺省表示整张图都是可见内容（枪械素材已经裁剪过透明边距）。 */
  readonly contentBox?: WeaponHudContentBox;
}

const WEAPON_DIR = "/assets/images/weapons";

const SPRITE_DEFINITIONS = {
  smgTactical: {
    url: `${WEAPON_DIR}/smg-tactical.png`,
    sourceWidth: 512,
    sourceHeight: 229,
  },
  smgClassic: {
    url: `${WEAPON_DIR}/smg-classic.png`,
    sourceWidth: 512,
    sourceHeight: 225,
  },
  pistolGlock: {
    url: `${WEAPON_DIR}/pistol-glock.png`,
    sourceWidth: 512,
    sourceHeight: 316,
  },
  pistolRevolver: {
    url: `${WEAPON_DIR}/pistol-revolver.png`,
    sourceWidth: 512,
    sourceHeight: 286,
  },
  // 两张弹药图都是 887×1774，可见弹丸只占中间一小条；contentBox 直接把这段框出来，
  // 于是「按真实宽高比 contain」得到的是弹丸本身的比例，而不是整张画布的比例。
  ammoRifle: {
    url: `${WEAPON_DIR}/ammo-rifle-round.png`,
    sourceWidth: 887,
    sourceHeight: 1774,
    contentBox: { x: 259, y: 150, width: 369, height: 1511 },
  },
  ammoPistol: {
    url: `${WEAPON_DIR}/ammo-pistol-round.png`,
    sourceWidth: 887,
    sourceHeight: 1774,
    contentBox: { x: 202, y: 297, width: 484, height: 1234 },
  },
} as const;

export type WeaponHudSpriteId = keyof typeof SPRITE_DEFINITIONS;

export const WEAPON_HUD_SPRITES: Record<WeaponHudSpriteId, WeaponHudSprite> = SPRITE_DEFINITIONS;

export const WEAPON_HUD_SPRITE_IDS = Object.keys(WEAPON_HUD_SPRITES) as WeaponHudSpriteId[];

/** 可见内容在源图里的归一化矩形，原点左上，宽高为 0..1。 */
export function normalizeContentBox(sprite: WeaponHudSprite): WeaponHudContentBox {
  const box = sprite.contentBox;
  if (!box) return { x: 0, y: 0, width: 1, height: 1 };
  const { sourceWidth, sourceHeight } = sprite;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: box.x / sourceWidth,
    y: box.y / sourceHeight,
    width: box.width / sourceWidth,
    height: box.height / sourceHeight,
  };
}

/** 可见内容的宽高比（宽 / 高）。 */
export function spriteContentAspect(sprite: WeaponHudSprite): number {
  const box = sprite.contentBox;
  const width = box ? box.width : sprite.sourceWidth;
  const height = box ? box.height : sprite.sourceHeight;
  return height > 0 ? width / height : 1;
}

/**
 * 现阶段 `WeaponView` 没有 weaponId，只能按槽位映射；换素材只改这张表。
 * 空手/近战没有枪械图片。
 */
export function getWeaponSpriteForView(view: Pick<WeaponView, "slot" | "kind">): WeaponHudSpriteId | null {
  if (view.kind !== "firearm") return null;
  return view.slot === "primary" ? "smgTactical" : "pistolGlock";
}

/** 主武器用步枪弹、副武器用手枪弹；三枚图标是弹种装饰，与余弹数无关。 */
export function getAmmoSpriteForView(view: Pick<WeaponView, "slot" | "kind">): WeaponHudSpriteId | null {
  if (view.kind !== "firearm") return null;
  return view.slot === "primary" ? "ammoRifle" : "ammoPistol";
}

export type WeaponHudAssetStatus = "idle" | "loading" | "ready" | "failed" | "unsupported";

interface AssetEntry {
  status: WeaponHudAssetStatus;
  image: HTMLImageElement | null;
}

/** 缩小后的弹药纹理，按「逻辑尺寸 × DPR」缓存，避免每帧重新缩放。 */
export interface WeaponAmmoTexture {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const MAX_TEXTURES = 24;

/**
 * 可选装饰资源的加载与缓存。
 *
 * 约定：每个资源只创建一个 `Image` 和一个加载任务；失败只记录状态，不抛异常；
 * 没有 DOM（Node 单测）时直接标记为 unsupported，调用方一律走矢量回退。
 */
export class WeaponHudAssets {
  private readonly entries = new Map<WeaponHudSpriteId, AssetEntry>();
  private readonly textures = new Map<string, WeaponAmmoTexture>();
  private imageBuilds = 0;
  private textureBuilds = 0;

  /** 非阻断预加载：不返回 Promise，也不参与场景启动的成败判定。 */
  preload(ids: readonly WeaponHudSpriteId[] = WEAPON_HUD_SPRITE_IDS): void {
    for (const id of ids) this.ensure(id);
  }

  /** 幂等：同一资源重复调用不会重复创建 Image。 */
  ensure(id: WeaponHudSpriteId): void {
    if (this.entries.has(id)) return;
    const sprite = WEAPON_HUD_SPRITES[id];
    if (!sprite) return;
    const entry: AssetEntry = { status: "loading", image: null };
    this.entries.set(id, entry);
    if (typeof Image === "undefined") {
      entry.status = "unsupported";
      return;
    }
    this.imageBuilds += 1;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      entry.image = image;
      entry.status = "ready";
      // 图片就绪后旧纹理已经无效，直接丢弃，下一帧按新图重建。
      this.textures.clear();
    };
    image.onerror = () => {
      entry.image = null;
      entry.status = "failed";
    };
    image.src = sprite.url;
  }

  getImage(id: WeaponHudSpriteId): HTMLImageElement | null {
    this.ensure(id);
    const entry = this.entries.get(id);
    return entry && entry.status === "ready" ? entry.image : null;
  }

  getStatus(id: WeaponHudSpriteId): WeaponHudAssetStatus {
    return this.entries.get(id)?.status ?? "idle";
  }

  /** 全部资源都结束尝试（就绪或失败）时返回 true；测试用它等一个确定状态。 */
  isSettled(ids: readonly WeaponHudSpriteId[] = WEAPON_HUD_SPRITE_IDS): boolean {
    return ids.every(id => {
      const status = this.entries.get(id)?.status;
      return status === "ready" || status === "failed" || status === "unsupported";
    });
  }

  /** 可见内容已经裁好的弹药纹理；没有图片或没有 DOM 时返回 null（由调用方画矢量弹）。 */
  getAmmoTexture(id: WeaponHudSpriteId, width: number, height: number, dpr: number): WeaponAmmoTexture | null {
    this.ensure(id);
    const image = this.getImage(id);
    if (!image || typeof document === "undefined") return null;
    if (!(width > 0) || !(height > 0)) return null;
    const sprite = WEAPON_HUD_SPRITES[id];
    if (!sprite) return null;
    const ratio = Math.min(2, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
    const key = `${id}|${Math.round(width * 20)}|${Math.round(height * 20)}|${ratio.toFixed(2)}`;
    const cached = this.textures.get(key);
    if (cached) return cached;

    const canvasWidth = Math.max(2, Math.round(width * ratio));
    const canvasHeight = Math.max(2, Math.round(height * ratio));
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const box = sprite.contentBox;
      if (box) {
        ctx.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, canvasWidth, canvasHeight);
      } else {
        ctx.drawImage(image, 0, 0, sprite.sourceWidth, sprite.sourceHeight, 0, 0, canvasWidth, canvasHeight);
      }
    } catch {
      return null;
    }

    const texture: WeaponAmmoTexture = { canvas, width, height };
    this.textureBuilds += 1;
    this.textures.set(key, texture);
    if (this.textures.size > MAX_TEXTURES) {
      const oldest = this.textures.keys().next().value;
      if (oldest !== undefined) this.textures.delete(oldest);
    }
    return texture;
  }

  stats(): { imageBuilds: number; textureBuilds: number; textures: number } {
    return {
      imageBuilds: this.imageBuilds,
      textureBuilds: this.textureBuilds,
      textures: this.textures.size,
    };
  }

  /** 清空加载与纹理缓存；测试模拟资源故障、热重载换图时使用。 */
  reset(): void {
    this.entries.clear();
    this.textures.clear();
  }
}

/** 场景与 HUD 共用同一份缓存，重新进入场景不会重复下载。 */
export const weaponHudAssets = new WeaponHudAssets();

/** 场景进入时调用：只触发加载，不阻塞主循环。 */
export function preloadWeaponHudAssets(): void {
  weaponHudAssets.preload();
}
