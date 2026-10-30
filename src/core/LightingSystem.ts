import { LightSource } from "./LightSource";
import type { ConeLight } from "./ConeLight";
import type { ShadowEdge, TileMap } from "../map/TileMap";

const TAU = Math.PI * 2;
const RGB_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

/** Gradient sprites are rendered at this multiple of their on-screen size. */
const LIGHT_SPRITE_SUPERSAMPLE = 2;
/** Hard ceiling so a very large light cannot allocate an absurdly big texture. */
const MAX_LIGHT_SPRITE_SIZE = 2048;
const MAX_LIGHT_SPRITES = 8;
/** Rebuilding every shadow emitter each frame was the dominant multi-light cost. */
const SOFT_SHADOW_BUILD_BUDGET = 8;

interface PixelRect { x: number; y: number; width: number; height: number }

/** Intersect with the canvas so a light near the edge never blits outside the buffer. */
function clampRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width), bottom = Math.min(height, rect.y + rect.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function unionRect(a: PixelRect, b: PixelRect): PixelRect {
  if (a.width <= 0) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Back-facing edges cast away from the light; the block surface stays visible. */
export function projectShadow(edge: ShadowEdge, x: number, y: number, radius: number, length?: number): number[] | null {
  const dx = edge.bx - edge.ax, dy = edge.by - edge.ay;
  if (radius <= 0 || ((edge.ax + edge.bx) / 2 - x) * dy - ((edge.ay + edge.by) / 2 - y) * dx <= 1e-8) return null;
  const aLength = Math.hypot(edge.ax - x, edge.ay - y);
  const bLength = Math.hypot(edge.bx - x, edge.by - y);
  if (aLength < 1e-8 || bLength < 1e-8) return null;
  const reach = length ?? radius * 2 + Math.hypot(dx, dy);
  return [edge.ax, edge.ay, edge.bx, edge.by,
    edge.bx + (edge.bx - x) / bLength * reach, edge.by + (edge.by - y) / bLength * reach,
    edge.ax + (edge.ax - x) / aLength * reach, edge.ay + (edge.ay - y) / aLength * reach];
}

/** Finite near-field inverse-square approximation, smoothly reaching zero at the range. */
export function lightFalloff(distance: number, radius: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0 || distance >= radius) return 0;
  const t = Math.max(0, distance) / radius;
  const edge = Math.max(0, (t - 0.75) / 0.25);
  return (1 - edge * edge * (3 - 2 * edge)) / (1 + (t / 0.6) ** 2);
}

/** Opposite pairs keep the emitter's centroid fixed; no frame-dependent random jitter. */
export function shadowSamples(radius: number, count: 4 | 8): { x: number; y: number }[] {
  if (radius === 0) return [{ x: 0, y: 0 }];
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count / 2; i++) {
    const angle = i * 2.399963229728653;
    const r = radius * Math.sqrt((i + 0.5) / (count / 2));
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    points.push({ x, y }, { x: -x, y: -y });
  }
  return points;
}

interface ShadowCache {
  canvas: HTMLCanvasElement;
  signature: string;
  /** Emitter position the cached raster was built from; small drift reuses it. */
  posX: number;
  posY: number;
  /** Position-independent inputs (edges, sampling) so geometry edits never wait on the budget. */
  geometryHash: number;
  /** Cheap numeric fingerprint of the exact inputs that produced the raster. */
  hash: number;
  samples: 4 | 8;
  x: number;
  y: number;
  /** World-space bbox of the projected penumbra; lets the composite blit only the dirty area. */
  bounds: PixelRect | null;
  builds: number;
  map: TileMap;
}

/** Screen-filling weak light with a fixed world-space origin and short terrain shadows. */
export interface TerrainLight {
  position: { x: number; y: number };
  color: string;
  intensity: number;
  shadowLength: number;
  softness: number;
}

interface LightSprite {
  canvas: HTMLCanvasElement;
  /** Radius in world pixels represented by the sprite's shorter side / 2. */
  radius: number;
}

const floatBits = new Float32Array(1);
const intBits = new Int32Array(floatBits.buffer);

/** Stable 32-bit fingerprint for a run of float values (geometry / sampling inputs). */
function hashFloat(hash: number, value: number): number {
  floatBits[0] = value;
  return (Math.imul(hash ^ intBits[0], 16777619) >>> 0);
}

export class LightingSystem {
  private lightSources: LightSource[] = [];
  private terrainLight: TerrainLight | null = null;
  private terrainShadowCanvas: HTMLCanvasElement | null = null;
  private ambientLight = "rgba(0, 0, 0, 0.8)";
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  /** Full-resolution scratch used only by point lights with hard shadows (sourceRadius 0). */
  private plainLightCanvas: HTMLCanvasElement | null = null;
  private plainLightCtx: CanvasRenderingContext2D | null = null;
  private accumCanvas: HTMLCanvasElement | null = null;
  private accumCtx: CanvasRenderingContext2D | null = null;
  private accumRect = { x: 0, y: 0, width: 0, height: 0 };
  private sampleCanvas: HTMLCanvasElement | null = null;
  private averageCanvas: HTMLCanvasElement | null = null;
  /** Half-resolution ground alpha mask; replaces a full-resolution Path2D clip each frame. */
  private groundMaskCanvas: HTMLCanvasElement | null = null;
  private groundMaskCtx: CanvasRenderingContext2D | null = null;
  private shadowCaches = new WeakMap<LightSource, ShadowCache>();
  private previousLightRect = { x: 0, y: 0, width: 0, height: 0 };
  /** Light scratch/accumulator resolution divisor; upscaled once during compositing. */
  private readonly lightDownscale = 2;
  /** Pre-analysed opaque equivalent of `black + ambientLight`; one fill per frame instead of two. */
  private ambientFill: string | null | undefined = undefined;
  private ambientProbe: HTMLCanvasElement | null = null;
  /** Gradient sprites keyed by color/radius/inner-cone parameters. */
  private lightSprites = new Map<string, LightSprite>();
  /** Rotation-invariant conic feather masks keyed by radius/angle/feather. */
  private coneFeatherMasks = new Map<string, HTMLCanvasElement>();
  private softShadowBuilds = 0;
  /** Debug-only: accumulate per-phase prepare timings. Never enabled by game code. */
  public profiling = false;
  public profileTimes: Record<string, number> = {};
  private markProfile(name: string, start: number): number {
    if (!this.profiling) return start;
    const now = performance.now();
    this.profileTimes[name] = (this.profileTimes[name] ?? 0) + (now - start);
    return now;
  }
  private spriteBuildsTotal = 0;
  private terrainBuildsTotal = 0;
  private stats = { lightsDrawn: 0, spriteRebuilds: 0, softShadowBuilds: 0, terrainShadowRasterizations: 0 };

  initialize(width: number, height: number): void {
    this.shadowCanvas ??= document.createElement("canvas");
    this.lightCanvas ??= document.createElement("canvas");
    this.accumCanvas ??= document.createElement("canvas");
    // Light falloff is a smooth low-frequency field, so the per-light scratch and the
    // ground-only accumulator run at half resolution and are upscaled once when they are
    // composited. The shadow canvas stays 1:1 because the tests and terrain silhouette
    // read it in camera pixels.
    this.shadowCanvas.width = width;
    this.shadowCanvas.height = height;
    for (const canvas of [this.lightCanvas, this.accumCanvas]) {
      canvas.width = Math.max(1, Math.ceil(width / this.lightDownscale));
      canvas.height = Math.max(1, Math.ceil(height / this.lightDownscale));
    }
    this.shadowCtx = this.shadowCanvas.getContext("2d");
    this.lightCtx = this.lightCanvas.getContext("2d");
    this.accumCtx = this.accumCanvas.getContext("2d");
    // Sized for the current buffers only: cache entries are radius-based and stay valid.
    this.previousLightRect = { x: 0, y: 0, width: 0, height: 0 };
    this.accumRect = { x: 0, y: 0, width: 0, height: 0 };
  }

  private ensurePlainLightCanvas(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.plainLightCanvas) {
      if (typeof document === "undefined") return null;
      this.plainLightCanvas = document.createElement("canvas");
      this.plainLightCtx = this.plainLightCanvas.getContext("2d");
    }
    if (this.plainLightCanvas.width !== width) this.plainLightCanvas.width = width;
    if (this.plainLightCanvas.height !== height) this.plainLightCanvas.height = height;
    return this.plainLightCtx;
  }

  addLightSource(light: LightSource): void { this.lightSources.push(light); }
  removeLightSource(light: LightSource): void {
    this.lightSources = this.lightSources.filter(source => source !== light);
    this.shadowCaches.delete(light);
  }
  clearAllLights(): void { this.lightSources = []; this.terrainLight = null; this.shadowCaches = new WeakMap(); }
  setAmbientLight(color: string): void { this.ambientLight = color; this.ambientFill = undefined; }
  setTerrainLight(light: TerrainLight | null): void {
    if (light && (![light.position.x, light.position.y, light.intensity, light.shadowLength, light.softness].every(Number.isFinite)
      || light.intensity < 0 || light.intensity > 1 || light.shadowLength < 0 || light.softness < 0
      || !/^#[a-f\d]{6}$/i.test(light.color))) throw new Error("地形光源需要有限坐标、六位十六进制颜色、0–1 强度和非负投影尺寸");
    this.terrainLight = light ? { ...light, position: { ...light.position } } : null;
  }
  getLightCount(): number { return this.lightSources.length + (this.terrainLight ? 1 : 0); }
  update(delta: number): void { this.lightSources.forEach(light => light.update(delta)); }

  /** Diagnostics for the F3 panel and performance tests. */
  getStats(): { lightsDrawn: number; spriteRebuilds: number; softShadowBuilds: number; terrainShadowRasterizations: number } {
    return { ...this.stats };
  }

  static drawShadows(ctx: CanvasRenderingContext2D, edges: ShadowEdge[], x: number, y: number, radius: number, length?: number): void {
    ctx.beginPath();
    let near: number[] = [], far: number[] = [];
    const flush = () => {
      if (!near.length) return;
      ctx.moveTo(near[0], near[1]);
      for (let i = 2; i < near.length; i += 2) ctx.lineTo(near[i], near[i + 1]);
      for (let i = far.length - 2; i >= 0; i -= 2) ctx.lineTo(far[i], far[i + 1]);
      ctx.closePath(); near = []; far = [];
    };
    for (const edge of edges) {
      const polygon = projectShadow(edge, x, y, radius, length);
      if (!polygon) continue;
      // Adjacent projected quads share their radial edge. Remove that edge before
      // rasterization: hundreds of overlapping arc quads make Canvas's union very costly.
      if (!near.length || Math.abs(near[near.length - 2] - polygon[0]) > 1e-7 || Math.abs(near[near.length - 1] - polygon[1]) > 1e-7
        || Math.abs(far[far.length - 2] - polygon[6]) > 1e-7 || Math.abs(far[far.length - 1] - polygon[7]) > 1e-7) {
        flush(); near.push(polygon[0], polygon[1]); far.push(polygon[6], polygon[7]);
      }
      near.push(polygon[2], polygon[3]); far.push(polygon[4], polygon[5]);
    }
    flush();
    // A single nonzero-winding fill takes the union before sample weights are applied.
    ctx.fill();
  }

  /** Bounding box of the projected shadow quads, so soft edges are blurred only where they exist. */
  private projectedShadowBounds(edges: ShadowEdge[], x: number, y: number, radius: number, length: number): PixelRect | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const edge of edges) {
      const polygon = projectShadow(edge, x, y, radius, length);
      if (!polygon) continue;
      for (let i = 0; i < polygon.length; i += 2) {
        const px = polygon[i], py = polygon[i + 1];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
    return maxX > minX && maxY > minY ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  }

  /** Protect full-resolution terrain tops after any shadow filtering. Context uses world coordinates. */
  private clipGround(ctx: CanvasRenderingContext2D, ground: Path2D): void {
    // The contour already contains the viewport rectangle plus every solid top, cached across
    // frames and invalidated by tile edits, so per-light polygon queries disappear.
    ctx.clip(ground, "evenodd");
  }

  /**
   * Half-resolution ground silhouette used as an alpha mask. Clipping a full-resolution
   * upscale through the contour forces a software path mask (several ms at 1080p), while
   * masking the already half-resolution accum buffer is a cheap `destination-in`.
   */
  private groundMask(ground: Path2D, cameraX: number, cameraY: number, rect: PixelRect): CanvasRenderingContext2D | null {
    const width = this.accumCanvas?.width ?? 0, height = this.accumCanvas?.height ?? 0;
    if (width <= 0 || height <= 0) return null;
    if (!this.groundMaskCanvas) {
      if (typeof document === "undefined") return null;
      this.groundMaskCanvas = document.createElement("canvas");
      this.groundMaskCtx = this.groundMaskCanvas.getContext("2d");
    }
    const canvas = this.groundMaskCanvas, ctx = this.groundMaskCtx!;
    const scale = this.lightDownscale;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    // The contour is world-space; map it into the half-resolution camera frame.
    ctx.setTransform(1 / scale, 0, 0, 1 / scale, -cameraX / scale, -cameraY / scale);
    ctx.fillStyle = "#fff";
    ctx.fill(ground, "evenodd");
    ctx.restore();
    return ctx;
  }

  /**
   * Terrain light is additive and illuminates the whole frame, terrain tops included.
   * Only its short shadows are clipped to the ground contour so wall/ore tops keep their
   * ambient brightness. It is composited from its own light buffer instead of the
   * ground-only accumulation buffer because that one is clipped when it is blitted.
   */
  private prepareTerrainLight(cameraX: number, cameraY: number, map: TileMap | undefined, ground: Path2D | undefined): void {
    const light = this.terrainLight;
    if (!light || light.intensity <= 0) return;
    const { width, height } = this.shadowCanvas!;
    // Add the terrain lift straight into the frame: a solid additive fill is far cheaper
    // than building a full-screen light layer and blitting it back over itself.
    const shadowCtx = this.shadowCtx!;
    shadowCtx.save();
    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.globalCompositeOperation = "lighter";
    shadowCtx.globalAlpha = light.intensity;
    shadowCtx.fillStyle = light.color;
    shadowCtx.fillRect(0, 0, width, height);
    shadowCtx.restore();
    if (map && light.shadowLength > 0) {
      const padding = Math.ceil(light.softness * 3) + 2;
      // Integer world alignment keeps subpixel camera motion from changing the raster phase.
      const x = Math.floor(cameraX) - padding, y = Math.floor(cameraY) - padding;
      this.terrainShadowCanvas ??= document.createElement("canvas");
      const canvas = this.terrainShadowCanvas;
      // Half-resolution mask: upscaled 2x bilinearly at composite time, which is visually
      // equivalent to the previous ~2px blur but avoids a full-screen `filter` pass.
      const bufferWidth = Math.ceil((width + padding * 2 + 1) / 2);
      const bufferHeight = Math.ceil((height + padding * 2 + 1) / 2);
      if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
      if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
      const shadow = canvas.getContext("2d")!;
      shadow.setTransform(1, 0, 0, 1, 0, 0);
      shadow.clearRect(0, 0, canvas.width, canvas.height);
      shadow.setTransform(0.5, 0, 0, 0.5, -x / 2, -y / 2);
      shadow.fillStyle = "black";
      const edges = map.getShadowEdges(cameraX + width / 2, cameraY + height / 2,
        Math.hypot(width, height) / 2 + light.shadowLength + padding);
      LightingSystem.drawShadows(shadow, edges, light.position.x, light.position.y, light.shadowLength, light.shadowLength);
      this.terrainBuildsTotal++;
      // Blur/subtract only the box that can contain projected geometry (plus blur spread).
      const spread = Math.ceil(light.softness * 3) + 2;
      const bounds = this.projectedShadowBounds(edges, light.position.x, light.position.y, light.shadowLength, light.shadowLength);
      if (bounds) {
        const sx = Math.max(0, Math.floor((bounds.x - x - spread) / 2));
        const sy = Math.max(0, Math.floor((bounds.y - y - spread) / 2));
        const ex = Math.min(canvas.width, Math.ceil((bounds.x + bounds.width - x + spread) / 2));
        const ey = Math.min(canvas.height, Math.ceil((bounds.y + bounds.height - y + spread) / 2));
        const ambient = this.ambientComposite();
        if (ex > sx && ey > sy && ambient) {
          // Re-tint the mask with the ambient colour, then draw it back over the terrain
          // lift with source-over: A*s + (A+T)*(1-s) = A + T*(1-s), i.e. exactly the
          // previous additive layer with its shadow subtracted. Terrain tops are skipped
          // by the ground clip, so they keep their full lift like before.
          shadow.save();
          // `source-in` is a whole-surface operator: fill the entire mask so its alpha
          // survives untouched and only the colour is replaced.
          shadow.setTransform(1, 0, 0, 1, 0, 0);
          shadow.globalCompositeOperation = "source-in";
          shadow.fillStyle = ambient;
          shadow.fillRect(0, 0, canvas.width, canvas.height);
          shadow.restore();
          shadowCtx.save();
          shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
          shadowCtx.globalCompositeOperation = "source-over";
          shadowCtx.globalAlpha = 1;
          // Shadows are authored in world space; the frame buffer is in camera space.
          shadowCtx.translate(-cameraX, -cameraY);
          if (ground) shadowCtx.clip(ground, "evenodd");
          shadowCtx.imageSmoothingEnabled = true;
          // Source is half resolution: map both rects back to world space (x2).
          shadowCtx.drawImage(canvas, sx, sy, ex - sx, ey - sy,
            x + sx * 2, y + sy * 2, (ex - sx) * 2, (ey - sy) * 2);
          shadowCtx.restore();
        }
      }
    }
  }

  /** Opaque equivalent of compositing the ambient colour over black, computed once per setting. */
  private ambientComposite(): string | null {
    if (this.ambientFill !== undefined) return this.ambientFill;
    let result: string | null = null;
    if (typeof document !== "undefined") {
      try {
        this.ambientProbe ??= document.createElement("canvas");
        this.ambientProbe.width = 1;
        this.ambientProbe.height = 1;
        const probe = this.ambientProbe.getContext("2d", { willReadFrequently: true });
        if (probe) {
          probe.fillStyle = "#000000";
          probe.fillRect(0, 0, 1, 1);
          probe.fillStyle = this.ambientLight;
          probe.fillRect(0, 0, 1, 1);
          const pixel = probe.getImageData(0, 0, 1, 1).data;
          result = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
        }
      } catch {
        result = null;
      }
    }
    this.ambientFill = result;
    return result;
  }

  /** Reusable 2x supersampled alpha profile for one colour/radius/cone configuration. */
  private lightSprite(light: LightSource, radius: number): LightSprite | null {
    const color = light.getColor();
    const cone = light.shape === "cone" ? light as ConeLight : undefined;
    const coneShape = cone
      ? `|${cone.getAngle().toFixed(4)}|${Math.min(cone.getFeather(), cone.getAngle() / 2 - 1e-6).toFixed(4)}`
      : "";
    const key = `${color}|${Math.round(radius * 100)}|${cone ? cone.getInnerRadius() : 0}|${cone ? cone.getInnerFade() : 0}${coneShape}`;
    const cached = this.lightSprites.get(key);
    if (cached) {
      // Refresh LRU position so shared torch sprites survive a scene with a spotlight.
      this.lightSprites.delete(key);
      this.lightSprites.set(key, cached);
      return cached;
    }
    if (typeof document === "undefined" || !Number.isFinite(radius) || radius <= 0) return null;
    const supersample = Math.min(LIGHT_SPRITE_SUPERSAMPLE, MAX_LIGHT_SPRITE_SIZE / (radius * 2));
    const spriteRadius = Math.max(1, Math.floor(radius * supersample));
    const size = spriteRadius * 2;
    // Bake at supersampled size, then downsample once into the shipped sprite. Drawing
    // the large sprite every frame would make the software rasteriser resample 4x the
    // pixels per light for no visible gain. Cone sprites are shipped at half resolution
    // because they are rotated every frame: the bilinear 2x upscale hides the difference
    // in a smooth gradient and cuts the rotation resample fourfold.
    const targetSize = Math.max(2, Math.ceil(cone ? radius : radius * 2));
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const buffer = document.createElement("canvas");
    buffer.width = size;
    buffer.height = size;
    const bufferCtx = buffer.getContext("2d");
    if (!bufferCtx) return null;
    const rgb = RGB_RE.exec(color);
    const rgbText = rgb
      ? `${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}`
      : "255, 255, 255";
    const gradient = bufferCtx.createRadialGradient(spriteRadius, spriteRadius, 0, spriteRadius, spriteRadius, spriteRadius);
    // Alpha carries the falloff only; intensity is applied with globalAlpha at draw time.
    const stops = 128;
    for (let i = 0; i <= stops; i++) {
      const distance = radius * i / stops;
      const inner = cone ? cone.innerVisibility(distance) : 1;
      gradient.addColorStop(i / stops, `rgba(${rgbText}, ${Math.min(1, lightFalloff(distance, radius) * inner)})`);
    }
    bufferCtx.fillStyle = gradient;
    bufferCtx.fillRect(0, 0, size, size);
    if (cone) {
      // Angular feather baked into the same sprite: rotate once per frame instead
      // of rasterising a conic gradient over the whole light box.
      const angle = cone.getAngle();
      const feather = Math.min(cone.getFeather(), angle / 2 - 1e-6);
      const conic = bufferCtx.createConicGradient(-angle / 2, spriteRadius, spriteRadius);
      const edge = Math.max(feather, 1e-4) / TAU;
      const inner = Math.max(edge, (angle - feather) / TAU);
      conic.addColorStop(0, "rgba(255,255,255,0)");
      conic.addColorStop(edge, "rgba(255,255,255,1)");
      conic.addColorStop(inner, "rgba(255,255,255,1)");
      conic.addColorStop(angle / TAU, "rgba(255,255,255,0)");
      conic.addColorStop(1, "rgba(255,255,255,0)");
      bufferCtx.globalCompositeOperation = "destination-in";
      bufferCtx.fillStyle = conic;
      bufferCtx.fillRect(0, 0, size, size);
      bufferCtx.globalCompositeOperation = "source-over";
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, 0, 0, size, size, 0, 0, targetSize, targetSize);
    const sprite: LightSprite = { canvas, radius };
    this.lightSprites.set(key, sprite);
    this.spriteBuildsTotal++;
    if (this.lightSprites.size > MAX_LIGHT_SPRITES) {
      const oldest = this.lightSprites.keys().next();
      if (!oldest.done) this.lightSprites.delete(oldest.value);
    }
    return sprite;
  }

  private softShadow(light: LightSource, map: TileMap, edges: ShadowEdge[]): ShadowCache | undefined {
    const pos = light.getPosition(), radius = light.getEffectiveRadius(), size = light.getSourceRadius();
    const previous = this.shadowCaches.get(light);
    let samples: 4 | 8 = previous?.samples ?? 8;
    if (edges.length > 256) samples = 4;
    else if (edges.length < 192) samples = 8;
    const points = shadowSamples(size, samples);
    const blocked = points.map(point => map.blocksLightAt(pos.x + point.x, pos.y + point.y));
    // Numeric fingerprint: the previous implementation built a multi-kilobyte string per light per frame.
    let geometryHash = 2166136261;
    geometryHash = hashFloat(geometryHash, radius);
    geometryHash = hashFloat(geometryHash, size);
    geometryHash = hashFloat(geometryHash, samples);
    for (let i = 0; i < blocked.length; i++) geometryHash = (Math.imul(geometryHash ^ (blocked[i] ? 1 : 0), 16777619) >>> 0);
    for (const edge of edges) {
      geometryHash = hashFloat(geometryHash, edge.ax);
      geometryHash = hashFloat(geometryHash, edge.ay);
      geometryHash = hashFloat(geometryHash, edge.bx);
      geometryHash = hashFloat(geometryHash, edge.by);
    }
    let hash = hashFloat(geometryHash, pos.x);
    hash = hashFloat(hash, pos.y);
    if (!edges.length && !blocked.some(Boolean)) {
      // Nothing can cast a shadow: hand back a 1x1 transparent cache instead of running
      // eight empty rasterizations (torches standing in the open would otherwise eat the budget).
      if (typeof document === "undefined") return undefined;
      const empty = previous ?? { canvas: document.createElement("canvas"), signature: "", posX: pos.x, posY: pos.y, geometryHash, hash, samples, x: 0, y: 0, bounds: null, builds: 0, map };
      if (empty.canvas.width !== 1) empty.canvas.width = 1;
      empty.canvas.height = 1;
      Object.assign(empty, { posX: pos.x, posY: pos.y, geometryHash, hash, samples, x: 0, y: 0, bounds: null, map });
      this.shadowCaches.set(light, empty);
      return empty;
    }
    if (previous?.map === map && previous.geometryHash === geometryHash && previous.hash === hash) return previous;
    // A moving torch blob would otherwise re-raster every sample every frame. Stale by one
    // frame is imperceptible at these speeds and the cache keeps its exact world geometry.
    // Geometry edits are never deferred: only sub-pixel position drift waits for the budget.
    // Torch gust only moves the emitter ~3px. Rebuilding the whole 8-sample penumbra for
    // that dwarfed every other lighting cost, so keep the previous penumbra anchored where
    // it was while the source wobbles inside a 4px radius. The light sprite still follows
    // the exact position; only the soft blob lags by a few pixels.
    if (size <= 8 && previous?.map === map && previous.geometryHash === geometryHash
      && Math.abs(pos.x - previous.posX) <= 4 && Math.abs(pos.y - previous.posY) <= 4) {
      return previous;
    }
    if (previous?.map === map && previous.geometryHash === geometryHash && this.softShadowBuilds >= SOFT_SHADOW_BUILD_BUDGET) return previous;
    // World-aligned half-resolution texels avoid camera-dependent phase changes.
    const x = Math.floor((pos.x - radius - 4) / 2) * 2;
    const y = Math.floor((pos.y - radius - 4) / 2) * 2;
    const width = Math.ceil((pos.x + radius + 4 - x) / 2);
    const height = Math.ceil((pos.y + radius + 4 - y) / 2);
    this.sampleCanvas ??= document.createElement("canvas");
    this.averageCanvas ??= document.createElement("canvas");
    const cache: ShadowCache = previous ?? { canvas: document.createElement("canvas"), signature: "", posX: pos.x, posY: pos.y, geometryHash: 0, hash: 0, samples, x, y, bounds: null, builds: 0, map };
    for (const canvas of [this.sampleCanvas, this.averageCanvas, cache.canvas]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    const average = this.averageCanvas.getContext("2d")!;
    average.setTransform(1, 0, 0, 1, 0, 0);
    average.globalCompositeOperation = "source-over";
    average.globalAlpha = 1;
    average.clearRect(0, 0, width, height);
    // Each sample layer is binary (fully blocked, or a union of shadow polygons), so
    // compositing it straight into the accumulator at 1/samples is equivalent to the old
    // "clear scratch -> draw -> drawImage scratch" loop, minus two full-buffer passes.
    // Additive accumulate: 8 fully-blocked samples must reach alpha 1, not 1-(7/8)^8.
    average.globalCompositeOperation = "lighter";
    average.globalAlpha = 1 / samples;
    average.fillStyle = "black";
    for (let i = 0; i < points.length; i++) {
      if (blocked[i]) {
        average.fillRect(0, 0, width, height);
      } else {
        average.setTransform(0.5, 0, 0, 0.5, -x / 2, -y / 2);
        LightingSystem.drawShadows(average, edges, pos.x + points[i].x, pos.y + points[i].y, radius + size);
        average.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    average.globalAlpha = 1;
    const output = cache.canvas.getContext("2d")!;
    output.setTransform(1, 0, 0, 1, 0, 0);
    output.globalAlpha = 1;
    output.globalCompositeOperation = "source-over";
    output.clearRect(0, 0, width, height);
    // The mask is authored at half resolution and upscaled 2x with bilinear filtering when
    // composited; that resampling already produces the soft penumbra. An extra `filter =
    // blur(1px)` pass costs ~0.8ms *per light per frame* on this canvas backend because the
    // filter pass has a fixed full-layer cost, so let the 2x upscale do the softening.
    output.drawImage(this.averageCanvas, 0, 0);
    this.softShadowBuilds++;
    this.stats.softShadowBuilds++;
    // Projected penumbra bbox (the sampled emitters move within +-size, and the hard
    // shadow length defaults to radius*2+edge): composite only this region instead of
    // upscaling the whole half-res buffer with destination-out.
    // A blocked emitter sample darkens the *entire* layer, not just the projected
    // polygons, so any blocked sample forces the full-buffer composite.
    const anyBlocked = blocked.some(Boolean);
    const raw = anyBlocked ? null : this.projectedShadowBounds(edges, pos.x, pos.y, radius + size, radius * 2 + size);
    const bounds = raw
      ? { x: raw.x - size - 2, y: raw.y - size - 2, width: raw.width + (size + 2) * 2, height: raw.height + (size + 2) * 2 }
      : null;
    Object.assign(cache, { signature: "", posX: pos.x, posY: pos.y, geometryHash, hash, samples, x, y, bounds, builds: cache.builds + 1, map });
    this.shadowCaches.set(light, cache);
    return cache;
  }

  prepareLightingMask(cameraX: number, cameraY: number, map?: TileMap): void {
    if (!this.shadowCanvas || !this.shadowCtx || !this.lightCanvas || !this.lightCtx || !this.accumCanvas || !this.accumCtx) return;
    const ctx = this.shadowCtx, lightCtx = this.lightCtx, accum = this.accumCtx;
    const { width, height } = this.shadowCanvas;
    let mark = this.profiling ? performance.now() : 0;

    // Ambient is opaque after black; a single fill replaces the previous two full-screen passes.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const ambientFill = this.ambientComposite();
    if (ambientFill) {
      ctx.fillStyle = ambientFill;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = this.ambientLight;
      ctx.fillRect(0, 0, width, height);
    }
    mark = this.markProfile("ambient", mark);

    const ground = map?.getGroundContour(cameraX, cameraY, width, height);

    const staleAccum = this.accumRect;
    if (staleAccum.width > 0) {
      accum.setTransform(1, 0, 0, 1, 0, 0);
      accum.clearRect(staleAccum.x, staleAccum.y, staleAccum.width, staleAccum.height);
    }
    this.accumRect = { x: 0, y: 0, width: 0, height: 0 };
    accum.setTransform(1, 0, 0, 1, 0, 0);
    accum.globalCompositeOperation = "source-over";
    accum.globalAlpha = 1;
    mark = this.markProfile("accumClear", mark);

    const spriteBuildsBefore = this.spriteBuildsTotal;
    const terrainRasterizationsBefore = this.terrainBuildsTotal;
    this.prepareTerrainLight(cameraX, cameraY, map, ground);
    mark = this.markProfile("terrainLight", mark);

    // Every light paints into the same scratch buffer, so start from a clean one and
    // clear each light's own box after it has been blitted.
    lightCtx.setTransform(1, 0, 0, 1, 0, 0);
    lightCtx.globalCompositeOperation = "source-over";
    lightCtx.globalAlpha = 1;
    lightCtx.filter = "none";
    const lightScale = this.lightDownscale;
    const lightWidth = this.lightCanvas.width, lightHeight = this.lightCanvas.height;
    lightCtx.clearRect(0, 0, lightWidth, lightHeight);
    this.previousLightRect = { x: 0, y: 0, width: 0, height: 0 };
    this.softShadowBuilds = 0;
    let lightsDrawn = 0;

    for (const light of this.lightSources) {
      const pos = light.getPosition(), radius = light.getEffectiveRadius();
      if (!light.isLightActive() || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(light.getIntensity()) || light.getIntensity() <= 0) continue;
      if (pos.x + radius < cameraX || pos.y + radius < cameraY || pos.x - radius > cameraX + width || pos.y - radius > cameraY + height) continue;
      if (light.getSourceRadius() === 0 && map?.blocksLightAt(pos.x, pos.y)) continue;
      const left = Math.floor(pos.x - radius - cameraX), top = Math.floor(pos.y - radius - cameraY);
      this.previousLightRect = { x: left, y: top, width: Math.ceil(pos.x + radius - cameraX) - left, height: Math.ceil(pos.y + radius - cameraY) - top };
      const localRect = clampRect(this.previousLightRect, width, height);
      if (!localRect) continue;
      // Camera-space rect -> half-resolution scratch rect (floor/ceil keeps light edges).
      const sx = Math.max(0, Math.floor(localRect.x / lightScale));
      const sy = Math.max(0, Math.floor(localRect.y / lightScale));
      const ex = Math.min(lightWidth, Math.ceil((localRect.x + localRect.width) / lightScale));
      const ey = Math.min(lightHeight, Math.ceil((localRect.y + localRect.height) / lightScale));
      if (ex <= sx || ey <= sy) continue;
      const scratchRect = { x: sx, y: sy, width: ex - sx, height: ey - sy };

      const intensity = light.getIntensity();
      const sprite = this.lightSprite(light, radius);
      let edges: ShadowEdge[] = [];
      if (map) edges = map.getShadowEdges(pos.x, pos.y, radius + light.getSourceRadius());
      mark = this.markProfile("edges", mark);
      // A zero-size emitter casts a mathematical (aliased) edge. Half resolution would turn
      // that 1px step into a 3px ramp, so those lights keep the full-resolution scratch.
      // Cones are excluded: their rim is a radial fade, not a step, and the sprite path
      // already carries the angular feather, so the half-resolution blit cannot alias.
      const plain = this.ensurePlainLightCanvas(width, height);
      const hardShadow = plain !== null && sprite !== null && light.shape !== "cone" && light.getSourceRadius() === 0 && edges.length > 0;

      if (hardShadow) {
        const full = plain!;
        full.setTransform(1, 0, 0, 1, 0, 0);
        full.globalCompositeOperation = "source-over";
        full.globalAlpha = 1;
        full.clearRect(localRect.x, localRect.y, localRect.width, localRect.height);
        const drawPlain = (): void => {
          if (light.shape === "cone") {
            full.translate(pos.x - cameraX, pos.y - cameraY);
            full.rotate((light as ConeLight).getDirection());
            full.drawImage(sprite!.canvas, -radius, -radius, radius * 2, radius * 2);
            full.setTransform(1, 0, 0, 1, 0, 0);
          } else {
            full.drawImage(sprite!.canvas, pos.x - radius - cameraX, pos.y - radius - cameraY, radius * 2, radius * 2);
          }
        };
        full.globalAlpha = Math.min(1, intensity);
        drawPlain();
        if (intensity > 1) {
          full.globalCompositeOperation = "lighter";
          full.globalAlpha = intensity - 1;
          drawPlain();
          full.globalCompositeOperation = "source-over";
        }
        full.globalAlpha = 1;
        full.save();
        full.translate(-cameraX, -cameraY);
        if (!light.shadowTerrain && !light.groundOnly && ground) this.clipGround(full, ground);
        full.globalCompositeOperation = "destination-out";
        full.fillStyle = "black";
        LightingSystem.drawShadows(full, edges, pos.x, pos.y, radius);
        full.restore();
        mark = this.markProfile("shadowComposite", mark);
        full.setTransform(1, 0, 0, 1, 0, 0);
        if (map && light.groundOnly) {
          accum.setTransform(1, 0, 0, 1, 0, 0);
          accum.globalCompositeOperation = "lighter";
          accum.drawImage(this.plainLightCanvas!, localRect.x, localRect.y, localRect.width, localRect.height,
            scratchRect.x, scratchRect.y, scratchRect.width, scratchRect.height);
          this.accumRect = unionRect(this.accumRect, scratchRect);
        } else {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.drawImage(this.plainLightCanvas!, localRect.x, localRect.y, localRect.width, localRect.height,
            localRect.x, localRect.y, localRect.width, localRect.height);
          ctx.restore();
        }
        mark = this.markProfile("blit", mark);
        full.setTransform(1, 0, 0, 1, 0, 0);
        full.globalCompositeOperation = "source-over";
        full.clearRect(localRect.x, localRect.y, localRect.width, localRect.height);
        mark = this.markProfile("clear", mark);
        lightsDrawn++;
        continue;
      }

      lightCtx.setTransform(1 / lightScale, 0, 0, 1 / lightScale, 0, 0);
      lightCtx.globalCompositeOperation = "source-over";
      if (sprite) {
        // Exact fractional placement keeps the falloff centre on the light, not on a
        // rounded pixel; the sprite itself is 2x so downscaling stays smooth.
        const cone = light.shape === "cone" ? light as ConeLight : undefined;
        const drawSprite = (): void => {
          if (cone) {
            // Stay in the half-resolution frame: translate/rotate in camera pixels, then
            // the sprite's radius*2 box scales by 1/lightScale like the point lights.
            lightCtx.translate(pos.x - cameraX, pos.y - cameraY);
            lightCtx.rotate(cone.getDirection());
            lightCtx.drawImage(sprite.canvas, -radius, -radius, radius * 2, radius * 2);
            lightCtx.setTransform(1 / lightScale, 0, 0, 1 / lightScale, 0, 0);
          } else {
            lightCtx.drawImage(sprite.canvas, pos.x - radius - cameraX, pos.y - radius - cameraY, radius * 2, radius * 2);
          }
        };
        lightCtx.globalAlpha = Math.min(1, intensity);
        drawSprite();
        if (intensity > 1) {
          // Equivalent to clamping `intensity * profile` at 1: add the remainder back only where it can brighten.
          lightCtx.globalCompositeOperation = "lighter";
          lightCtx.globalAlpha = intensity - 1;
          drawSprite();
          lightCtx.globalCompositeOperation = "source-over";
        }
      } else {
        const rgb = RGB_RE.exec(light.getColor());
        const color = rgb ? `${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}` : "255, 255, 255";
        lightCtx.translate(-cameraX, -cameraY);
        const gradient = lightCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
        const cone = light.shape === "cone" ? light as ConeLight : undefined;
        const stops = cone ? 96 : 32;
        for (let i = 0; i <= stops; i++) {
          const distance = radius * i / stops;
          const inner = cone ? cone.innerVisibility(distance) : 1;
          gradient.addColorStop(i / stops, `rgba(${color}, ${Math.min(1, intensity * lightFalloff(distance, radius) * inner)})`);
        }
        lightCtx.fillStyle = gradient;
        lightCtx.fillRect(pos.x - radius, pos.y - radius, radius * 2, radius * 2);
        lightCtx.setTransform(1 / lightScale, 0, 0, 1 / lightScale, 0, 0);
      }
      lightCtx.globalAlpha = 1;

      if (!sprite && light.shape === "cone") this.featherCone(light as ConeLight, cameraX, cameraY, localRect);
      mark = this.markProfile("sprite", mark);

      const soft = map && light.getSourceRadius() > 0 ? this.softShadow(light, map, edges) : undefined;
      mark = this.markProfile("soft", mark);
      if (map) {
        lightCtx.save();
        // Shadows are authored in world space; restore the translated frame the
        // gradient path would have left in place.
        lightCtx.translate(-cameraX, -cameraY);
        // Ground-only lights are clipped once, when the whole accumulation buffer is
        // composited; clipping every such light here was a redundant full-path clip.
        if (!light.shadowTerrain && !light.groundOnly && ground) this.clipGround(lightCtx, ground);
        lightCtx.globalCompositeOperation = "destination-out";
        lightCtx.fillStyle = "black";
        if (soft) {
          const b = soft.bounds;
          if (b) {
            // Only the projected penumbra needs subtracting; the rest of the light box is open.
            const sx = Math.max(0, Math.floor((b.x - soft.x) / 2) - 1);
            const sy = Math.max(0, Math.floor((b.y - soft.y) / 2) - 1);
            const ex = Math.min(soft.canvas.width, Math.ceil((b.x + b.width - soft.x) / 2) + 1);
            const ey = Math.min(soft.canvas.height, Math.ceil((b.y + b.height - soft.y) / 2) + 1);
            if (ex > sx && ey > sy) {
              lightCtx.drawImage(soft.canvas, sx, sy, ex - sx, ey - sy,
                soft.x + sx * 2, soft.y + sy * 2, (ex - sx) * 2, (ey - sy) * 2);
            }
          } else if (soft.canvas.width > 1) {
            lightCtx.drawImage(soft.canvas, soft.x, soft.y, soft.canvas.width * 2, soft.canvas.height * 2);
          }
        } else if (light.getSourceRadius() === 0) LightingSystem.drawShadows(lightCtx, edges, pos.x, pos.y, radius);
        lightCtx.restore();
      }
      mark = this.markProfile("shadowComposite", mark);

      lightCtx.setTransform(1, 0, 0, 1, 0, 0);
      if (map && light.groundOnly) {
        // 单位光只照亮地面和水域：有高度的地形顶面保持环境光，不会被单位光提亮或压暗。
        accum.setTransform(1, 0, 0, 1, 0, 0);
        accum.globalCompositeOperation = "lighter";
        accum.drawImage(this.lightCanvas, scratchRect.x, scratchRect.y, scratchRect.width, scratchRect.height,
          scratchRect.x, scratchRect.y, scratchRect.width, scratchRect.height);
        this.accumRect = unionRect(this.accumRect, scratchRect);
      } else {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // Half-res scratch -> full-res shadow canvas; bilinear smoothing is enough for the
        // smooth falloff and keeps each light's blit independent of its neighbours.
        ctx.drawImage(this.lightCanvas, scratchRect.x, scratchRect.y, scratchRect.width, scratchRect.height,
          scratchRect.x * lightScale, scratchRect.y * lightScale,
          scratchRect.width * lightScale, scratchRect.height * lightScale);
        ctx.restore();
      }
      mark = this.markProfile("blit", mark);
      // The scratch buffer is cleared per light instead of tracking a single stale box:
      // lights after the first frame no longer depend on a full-screen terrain-light paint.
      lightCtx.setTransform(1, 0, 0, 1, 0, 0);
      lightCtx.globalCompositeOperation = "source-over";
      lightCtx.clearRect(scratchRect.x, scratchRect.y, scratchRect.width, scratchRect.height);
      mark = this.markProfile("clear", mark);
      lightsDrawn++;
    }

    // Addition commutes with the ground clip, so the whole ground-only pass costs one mask.
    const dirty = this.accumRect;
    if (dirty.width > 0) {
      if (ground) {
        // Mask the half-resolution accumulation before it is upscaled: clipping the
        // full-resolution blit through the contour costs several ms at 1080p, while a
        // `destination-in` on the small buffer is a fraction of that.
        const mask = this.groundMask(ground, cameraX, cameraY, dirty);
        if (mask) {
          accum.save();
          accum.setTransform(1, 0, 0, 1, 0, 0);
          // `destination-in` composites over the whole surface, so restrict it to the
          // dirty rectangle or the mask's stale pixels would erase lights outside it.
          accum.beginPath();
          accum.rect(dirty.x, dirty.y, dirty.width, dirty.height);
          accum.clip();
          accum.globalCompositeOperation = "destination-in";
          accum.drawImage(this.groundMaskCanvas!, dirty.x, dirty.y, dirty.width, dirty.height,
            dirty.x, dirty.y, dirty.width, dirty.height);
          accum.restore();
        }
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      if (ground && !this.groundMaskCanvas) {
        // Fallback for environments without an offscreen canvas: full-resolution clip.
        // The contour is world-space: clip through it, then return to camera space for the blit.
        ctx.translate(-cameraX, -cameraY);
        ctx.clip(ground, "evenodd");
        ctx.translate(cameraX, cameraY);
      }
      ctx.drawImage(this.accumCanvas, dirty.x, dirty.y, dirty.width, dirty.height,
        dirty.x * lightScale, dirty.y * lightScale, dirty.width * lightScale, dirty.height * lightScale);
      ctx.restore();
    }
    this.markProfile("final", mark);
    ctx.globalCompositeOperation = "source-over";
    this.stats = {
      lightsDrawn,
      spriteRebuilds: this.spriteBuildsTotal - spriteBuildsBefore,
      softShadowBuilds: this.softShadowBuilds,
      terrainShadowRasterizations: this.terrainBuildsTotal - terrainRasterizationsBefore,
    };
  }

  /**
   * Cut the circular gradient down to the cone and feather both radial edges so the
   * flashlight fades into the ambient light instead of ending on a hard line.
   * Only the light's own box is touched: everything outside the radial fill is transparent.
   */
  private featherCone(light: ConeLight, cameraX: number, cameraY: number, rect: PixelRect): void {
    const ctx = this.lightCtx!, pos = light.getPosition();
    const angle = light.getAngle();
    const feather = Math.min(light.getFeather(), angle / 2 - 1e-6);
    const radius = Math.max(1, Math.ceil(light.getEffectiveRadius()));
    if (typeof document === "undefined") {
      const conic = ctx.createConicGradient(light.getStartAngle(), pos.x - cameraX, pos.y - cameraY);
      const edge = Math.max(feather, 1e-4) / TAU;
      const inner = Math.max(edge, (angle - feather) / TAU);
      conic.addColorStop(0, "rgba(255,255,255,0)");
      conic.addColorStop(edge, "rgba(255,255,255,1)");
      conic.addColorStop(inner, "rgba(255,255,255,1)");
      conic.addColorStop(angle / TAU, "rgba(255,255,255,0)");
      conic.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = conic;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
      return;
    }

    // The mask is rotation-invariant: build it once facing +x, then rotate it to
    // the current aim. Rasterising a conic gradient every frame costs far more
    // than one rotated blit, and the 2x feather hides the resampling.
    const key = `${radius}|${angle.toFixed(4)}|${feather.toFixed(4)}`;
    let mask = this.coneFeatherMasks.get(key);
    if (mask) {
      this.coneFeatherMasks.delete(key);
      this.coneFeatherMasks.set(key, mask);
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = radius * 2;
      const maskCtx = canvas.getContext("2d");
      if (!maskCtx) return;
      const conic = maskCtx.createConicGradient(-angle / 2, radius, radius);
      const edge = Math.max(feather, 1e-4) / TAU;
      const inner = Math.max(edge, (angle - feather) / TAU);
      conic.addColorStop(0, "rgba(255,255,255,0)");
      conic.addColorStop(edge, "rgba(255,255,255,1)");
      conic.addColorStop(inner, "rgba(255,255,255,1)");
      conic.addColorStop(angle / TAU, "rgba(255,255,255,0)");
      conic.addColorStop(1, "rgba(255,255,255,0)");
      maskCtx.fillStyle = conic;
      maskCtx.fillRect(0, 0, canvas.width, canvas.height);
      mask = canvas;
      this.coneFeatherMasks.set(key, mask);
      if (this.coneFeatherMasks.size > 3) {
        const oldest = this.coneFeatherMasks.keys().next().value as string | undefined;
        if (oldest !== undefined) this.coneFeatherMasks.delete(oldest);
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.translate(pos.x - cameraX, pos.y - cameraY);
    ctx.rotate(light.getDirection());
    ctx.drawImage(mask, -radius, -radius);
    ctx.restore();
  }

  applyLighting(ctx: CanvasRenderingContext2D): void {
    if (!this.shadowCanvas) return;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.shadowCanvas, 0, 0);
    ctx.restore();
  }
}
