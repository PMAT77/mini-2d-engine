import type { Rect } from './HudTypes';

// 生成 PNG 原图的可见内容边界；SVG/Canvas 都用同一裁切，不改动素材本身。
const BOXES: Readonly<Record<string, readonly number[]>> = {
  grenade: [294, 160, 682, 934], 'smoke-grenade': [404, 140, 546, 998],
  'category-throwables': [308, 202, 730, 816], 'grenade-world': [356, 172, 604, 864],
  'smoke-grenade-world': [466, 212, 330, 808],
  'category-consumables': [272, 308, 724, 660], 'category-melee': [236, 216, 784, 828],
  'category-ranged': [92, 504, 1076, 360], glock: [16, 284, 1236, 744],
  smg: [40, 376, 1180, 540], unarmed: [152, 296, 952, 704], vaccine: [412, 284, 436, 716],
};
const images = new Map<string, HTMLImageElement>();
function box(url: string): readonly number[] { return BOXES[url.slice(url.lastIndexOf('/') + 1, -4)] ?? [0, 0, 1254, 1254]; }
export function inventoryIcon(url: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', box(url).join(' ')); svg.setAttribute('aria-hidden', 'true');
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  image.setAttribute('href', url); image.setAttribute('width', '1254'); image.setAttribute('height', '1254');
  svg.append(image); return svg;
}
export function drawInventoryIcon(ctx: CanvasRenderingContext2D, url: string, rect: Rect): void {
  if (typeof Image === 'undefined') return;
  let image = images.get(url);
  if (!image) { image = new Image(); image.src = url; images.set(url, image); }
  if (!image.complete || !image.naturalWidth) return;
  const [x, y, w, h] = box(url), scale = Math.min(rect.width / w, rect.height / h);
  ctx.drawImage(image, x, y, w, h, rect.x + (rect.width - w * scale) / 2,
    rect.y + (rect.height - h * scale) / 2, w * scale, h * scale);
}
