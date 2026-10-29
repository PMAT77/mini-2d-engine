import { LightSource } from "./LightSource";
import { solidPath } from "../map/SolidTerrain";
import type { ShadowEdge, TileMap, TileRect } from "../map/TileMap";

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
  samples: 4 | 8;
  x: number;
  y: number;
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

export class LightingSystem {
  private lightSources: LightSource[] = [];
  private terrainLight: TerrainLight | null = null;
  private terrainShadowCanvas: HTMLCanvasElement | null = null;
  private ambientLight = "rgba(0, 0, 0, 0.8)";
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private averageCanvas: HTMLCanvasElement | null = null;
  private shadowCaches = new WeakMap<LightSource, ShadowCache>();
  private previousLightRect = { x: 0, y: 0, width: 0, height: 0 };

  initialize(width: number, height: number): void {
    this.shadowCanvas ??= document.createElement("canvas");
    this.lightCanvas ??= document.createElement("canvas");
    for (const canvas of [this.shadowCanvas, this.lightCanvas]) {
      canvas.width = width;
      canvas.height = height;
    }
    this.shadowCtx = this.shadowCanvas.getContext("2d");
    this.lightCtx = this.lightCanvas.getContext("2d");
    this.previousLightRect = { x: 0, y: 0, width: 0, height: 0 };
  }

  addLightSource(light: LightSource): void { this.lightSources.push(light); }
  removeLightSource(light: LightSource): void {
    this.lightSources = this.lightSources.filter(source => source !== light);
    this.shadowCaches.delete(light);
  }
  clearAllLights(): void { this.lightSources = []; this.terrainLight = null; this.shadowCaches = new WeakMap(); }
  setAmbientLight(color: string): void { this.ambientLight = color; }
  setTerrainLight(light: TerrainLight | null): void {
    if (light && (![light.position.x, light.position.y, light.intensity, light.shadowLength, light.softness].every(Number.isFinite)
      || light.intensity < 0 || light.intensity > 1 || light.shadowLength < 0 || light.softness < 0
      || !/^#[a-f\d]{6}$/i.test(light.color))) throw new Error("地形光源需要有限坐标、六位十六进制颜色、0–1 强度和非负投影尺寸");
    this.terrainLight = light ? { ...light, position: { ...light.position } } : null;
  }
  getLightCount(): number { return this.lightSources.length + (this.terrainLight ? 1 : 0); }
  update(delta: number): void { this.lightSources.forEach(light => light.update(delta)); }

  private shadowPath(ctx: CanvasRenderingContext2D, edges: ShadowEdge[], x: number, y: number, radius: number, length?: number): void {
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

  /** Protect full-resolution terrain tops after any shadow filtering. Context uses world coordinates. */
  private clipGround(ctx: CanvasRenderingContext2D, map: TileMap, cameraX: number, cameraY: number, bounds?: TileRect): void {
    const { width, height } = this.shadowCanvas!;
    const area = bounds ?? { x: cameraX, y: cameraY, width, height };
    ctx.beginPath();
    ctx.rect(cameraX, cameraY, width, height);
    solidPath(ctx, map.getBlockingPolygons(area.x, area.y, area.width, area.height), 0, 0);
    ctx.clip("evenodd");
  }

  private prepareTerrainLight(cameraX: number, cameraY: number, map?: TileMap): void {
    const light = this.terrainLight;
    if (!light || light.intensity === 0) return;
    const ctx = this.lightCtx!, { width, height } = this.lightCanvas!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    this.previousLightRect = { x: 0, y: 0, width, height };
    ctx.globalAlpha = light.intensity;
    ctx.fillStyle = light.color;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    if (map && light.shadowLength > 0) {
      const padding = Math.ceil(light.softness * 3) + 2;
      // Integer world alignment keeps subpixel camera motion from changing the raster phase.
      const x = Math.floor(cameraX) - padding, y = Math.floor(cameraY) - padding;
      this.terrainShadowCanvas ??= document.createElement("canvas");
      const canvas = this.terrainShadowCanvas;
      const bufferWidth = width + padding * 2 + 1, bufferHeight = height + padding * 2 + 1;
      if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
      if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
      const shadow = canvas.getContext("2d")!;
      shadow.setTransform(1, 0, 0, 1, 0, 0);
      shadow.clearRect(0, 0, canvas.width, canvas.height);
      shadow.translate(-x, -y);
      shadow.fillStyle = "black";
      const edges = map.getShadowEdges(cameraX + width / 2, cameraY + height / 2,
        Math.hypot(width, height) / 2 + light.shadowLength + padding);
      // This light deliberately enters from outside the map; point-light containment is unchanged.
      this.shadowPath(shadow, edges, light.position.x, light.position.y, light.shadowLength, light.shadowLength);
      ctx.save();
      ctx.translate(-cameraX, -cameraY);
      this.clipGround(ctx, map, cameraX, cameraY);
      ctx.globalCompositeOperation = "destination-out";
      ctx.filter = `blur(${light.softness}px)`;
      ctx.drawImage(canvas, x, y);
      ctx.restore();
    }
    this.shadowCtx!.globalCompositeOperation = "lighter";
    this.shadowCtx!.drawImage(this.lightCanvas!, 0, 0);
  }

  private softShadow(light: LightSource, map: TileMap, edges: ShadowEdge[]): ShadowCache | undefined {
    const pos = light.getPosition(), radius = light.getRadius(), size = light.getSourceRadius();
    const previous = this.shadowCaches.get(light);
    let samples: 4 | 8 = previous?.samples ?? 8;
    if (edges.length > 256) samples = 4;
    else if (edges.length < 192) samples = 8;
    const points = shadowSamples(size, samples);
    const blocked = points.map(point => map.blocksLightAt(pos.x + point.x, pos.y + point.y));
    if (!edges.length && !blocked.some(Boolean)) { this.shadowCaches.delete(light); return; }
    // Read the actual contour, rather than requiring callers to mark public tile arrays dirty.
    const signature = [pos.x, pos.y, radius, size, samples, ...blocked,
      ...edges.map(edge => `${edge.ax},${edge.ay},${edge.bx},${edge.by}`)].join("|");
    if (previous?.map === map && previous.signature === signature) return previous;
    // World-aligned half-resolution texels avoid camera-dependent phase changes.
    const x = Math.floor((pos.x - radius - 4) / 2) * 2;
    const y = Math.floor((pos.y - radius - 4) / 2) * 2;
    const width = Math.ceil((pos.x + radius + 4 - x) / 2);
    const height = Math.ceil((pos.y + radius + 4 - y) / 2);
    this.sampleCanvas ??= document.createElement("canvas");
    this.averageCanvas ??= document.createElement("canvas");
    const cache: ShadowCache = previous ?? { canvas: document.createElement("canvas"), signature: "", samples, x, y, builds: 0, map };
    for (const canvas of [this.sampleCanvas, this.averageCanvas, cache.canvas]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    const sample = this.sampleCanvas.getContext("2d")!;
    const average = this.averageCanvas.getContext("2d")!;
    average.clearRect(0, 0, width, height);
    average.globalCompositeOperation = "lighter";
    average.globalAlpha = 1 / samples;
    for (let i = 0; i < points.length; i++) {
      sample.setTransform(1, 0, 0, 1, 0, 0);
      sample.clearRect(0, 0, width, height);
      sample.fillStyle = "black";
      if (blocked[i]) sample.fillRect(0, 0, width, height);
      else {
        sample.setTransform(0.5, 0, 0, 0.5, -x / 2, -y / 2);
        this.shadowPath(sample, edges, pos.x + points[i].x, pos.y + points[i].y, radius + size);
      }
      average.drawImage(this.sampleCanvas, 0, 0);
    }
    const output = cache.canvas.getContext("2d")!;
    output.clearRect(0, 0, width, height);
    output.save();
    output.filter = "blur(1px)";
    output.drawImage(this.averageCanvas, 0, 0);
    output.restore();
    Object.assign(cache, { signature, samples, x, y, builds: cache.builds + 1, map });
    this.shadowCaches.set(light, cache);
    return cache;
  }

  prepareLightingMask(cameraX: number, cameraY: number, map?: TileMap): void {
    if (!this.shadowCanvas || !this.shadowCtx || !this.lightCanvas || !this.lightCtx) return;
    const ctx = this.shadowCtx, lightCtx = this.lightCtx;
    const { width, height } = this.shadowCanvas;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = this.ambientLight;
    ctx.fillRect(0, 0, width, height);
    this.prepareTerrainLight(cameraX, cameraY, map);

    for (const light of this.lightSources) {
      const pos = light.getPosition(), radius = light.getRadius();
      if (!light.isLightActive() || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(light.getIntensity()) || light.getIntensity() <= 0) continue;
      if (pos.x + radius < cameraX || pos.y + radius < cameraY || pos.x - radius > cameraX + width || pos.y - radius > cameraY + height) continue;
      if (light.getSourceRadius() === 0 && map?.blocksLightAt(pos.x, pos.y)) continue;
      lightCtx.setTransform(1, 0, 0, 1, 0, 0);
      lightCtx.globalCompositeOperation = "source-over";
      const old = this.previousLightRect;
      lightCtx.clearRect(old.x, old.y, old.width, old.height);
      const left = Math.floor(pos.x - radius - cameraX), top = Math.floor(pos.y - radius - cameraY);
      this.previousLightRect = { x: left, y: top, width: Math.ceil(pos.x + radius - cameraX) - left, height: Math.ceil(pos.y + radius - cameraY) - top };
      lightCtx.translate(-cameraX, -cameraY);
      const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(light.getColor());
      const color = rgb ? `${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}` : "255, 255, 255";
      const gradient = lightCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
      for (let i = 0; i <= 32; i++) {
        gradient.addColorStop(i / 32, `rgba(${color}, ${Math.min(1, light.getIntensity() * lightFalloff(radius * i / 32, radius))})`);
      }
      lightCtx.fillStyle = gradient;
      lightCtx.fillRect(pos.x - radius, pos.y - radius, radius * 2, radius * 2);

      if (map) {
        const edges = map.getShadowEdges(pos.x, pos.y, radius + light.getSourceRadius());
        const soft = light.getSourceRadius() > 0 ? this.softShadow(light, map, edges) : undefined;
        lightCtx.save();
        if (!light.shadowTerrain) this.clipGround(lightCtx, map, cameraX, cameraY, {
          x: Math.max(cameraX, pos.x - radius), y: Math.max(cameraY, pos.y - radius),
          width: Math.min(cameraX + width, pos.x + radius) - Math.max(cameraX, pos.x - radius),
          height: Math.min(cameraY + height, pos.y + radius) - Math.max(cameraY, pos.y - radius),
        });
        lightCtx.globalCompositeOperation = "destination-out";
        lightCtx.fillStyle = "black";
        if (soft) lightCtx.drawImage(soft.canvas, soft.x, soft.y, soft.canvas.width * 2, soft.canvas.height * 2);
        else if (light.getSourceRadius() === 0) this.shadowPath(lightCtx, edges, pos.x, pos.y, radius);
        lightCtx.restore();
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(this.lightCanvas, 0, 0);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  applyLighting(ctx: CanvasRenderingContext2D): void {
    if (!this.shadowCanvas) return;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.shadowCanvas, 0, 0);
    ctx.restore();
  }
}
