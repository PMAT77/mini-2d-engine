/** 画面配置：所有字段都有默认值，JSON 只需写想覆盖的部分。 */
export interface GraphicsConfig {
  camera: { zoom: number };
  ambient: { color: string; intensity: number };
  terrainLight: {
    color: string; intensity: number;
    /** 阴影长度 = tileSize × shadowScale。 */
    shadowScale: number;
    /** 阴影柔边 = tileSize × softnessScale。 */
    softnessScale: number;
  };
  playerLight: { color: string; radius: number; intensity: number; sourceRadius: number };
  flashlight: {
    color: string; range: number;
    /** 扇形总张角（度）；内部换算成弧度。 */
    angle: number;
    intensity: number; softness: number;
    innerRadius: number; innerFade: number;
  };
  fog: { range: number; feather: number };
  /** 三层视野遮蔽层的表现参数；不改变玩法规则。 */
  visibility: VisibilityConfig;
}

export interface VisibilityConfig {
  /** 遮蔽层相对世界画布的线性分辨率；0.5 即宽高各一半。 */
  maskScale: number;
  /** 探索记忆地形的整体亮度。 */
  memoryBrightness: number;
  /** 近身/照明孔洞边缘的柔化世界像素。 */
  edgeFeather: number;
  /** 未探索地形轮廓相对未知底色的对比度。 */
  outlineContrast: number;
}

export const DEFAULT_GRAPHICS_CONFIG: GraphicsConfig = {
  camera: { zoom: 1 },
  ambient: { color: "#D6E2F0", intensity: 0.35 },
  terrainLight: { color: "#B4C8E0", intensity: 0.06, shadowScale: 0.4, softnessScale: 0.04 },
  playerLight: { color: "#FFF4E8", radius: 100, intensity: 0.5, sourceRadius: 8 },
  flashlight: {
    color: "#FFF4E8", range: 400, angle: 120, intensity: 0.95, softness: 0.35,
    innerRadius: 30, innerFade: 16,
  },
  fog: { range: 400, feather: 120 },
  visibility: { maskScale: 0.5, memoryBrightness: 0.12, edgeFeather: 20, outlineContrast: 0.06 },
};

/** 配置是纯 JSON 结构；面板改一个字段时用它做可写快照。 */
export function cloneGraphicsConfig(config: GraphicsConfig = DEFAULT_GRAPHICS_CONFIG): GraphicsConfig {
  return {
    camera: { ...config.camera },
    ambient: { ...config.ambient },
    terrainLight: { ...config.terrainLight },
    playerLight: { ...config.playerLight },
    flashlight: { ...config.flashlight },
    fog: { ...config.fog },
    visibility: { ...config.visibility },
  };
}

const GROUPS = ["camera", "ambient", "terrainLight", "playerLight", "flashlight", "fog", "visibility"] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`无效配置值: graphics.${path} 必须是 ${min}–${max} 内的有限数值`);
  }
  return value;
}

function color(value: unknown, path: string): string {
  if (typeof value !== "string" || !HEX.test(value)) {
    throw new Error(`无效配置值: graphics.${path} 必须是 #RRGGBB 颜色`);
  }
  return value.toUpperCase();
}

function group(source: Record<string, unknown>, name: (typeof GROUPS)[number]): Record<string, unknown> {
  const value = source[name];
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`无效配置分组: graphics.${name}`);
  return value;
}

function rejectUnknown(source: Record<string, unknown>, prefix: string, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new Error(`未知配置项: graphics.${prefix}${key}`);
  }
}

/** Validate the whole file before applying any field, so a bad file cannot half-update the scene. */
export function parseGraphicsConfig(value: unknown): GraphicsConfig {
  if (!isObject(value)) throw new Error("画面配置必须是 JSON 对象");
  for (const key of Object.keys(value)) {
    if (!GROUPS.includes(key as (typeof GROUPS)[number])) throw new Error(`无效配置分组: graphics.${key}`);
  }
  const result = cloneGraphicsConfig();

  const camera = group(value, "camera");
  rejectUnknown(camera, "camera.", ["zoom"]);
  if (camera.zoom !== undefined) result.camera.zoom = number(camera.zoom, "camera.zoom", 0.5, 2);

  const ambient = group(value, "ambient");
  rejectUnknown(ambient, "ambient.", ["color", "intensity"]);
  if (ambient.color !== undefined) result.ambient.color = color(ambient.color, "ambient.color");
  if (ambient.intensity !== undefined) result.ambient.intensity = number(ambient.intensity, "ambient.intensity", 0, 2);

  const terrain = group(value, "terrainLight");
  rejectUnknown(terrain, "terrainLight.", ["color", "intensity", "shadowScale", "softnessScale"]);
  if (terrain.color !== undefined) result.terrainLight.color = color(terrain.color, "terrainLight.color");
  if (terrain.intensity !== undefined) result.terrainLight.intensity = number(terrain.intensity, "terrainLight.intensity", 0, 2);
  if (terrain.shadowScale !== undefined) result.terrainLight.shadowScale = number(terrain.shadowScale, "terrainLight.shadowScale", 0, 2);
  if (terrain.softnessScale !== undefined) result.terrainLight.softnessScale = number(terrain.softnessScale, "terrainLight.softnessScale", 0, 2);

  const playerLight = group(value, "playerLight");
  rejectUnknown(playerLight, "playerLight.", ["color", "radius", "intensity", "sourceRadius"]);
  if (playerLight.color !== undefined) result.playerLight.color = color(playerLight.color, "playerLight.color");
  if (playerLight.radius !== undefined) result.playerLight.radius = number(playerLight.radius, "playerLight.radius", 0, 2000);
  if (playerLight.intensity !== undefined) result.playerLight.intensity = number(playerLight.intensity, "playerLight.intensity", 0, 2);
  if (playerLight.sourceRadius !== undefined) result.playerLight.sourceRadius = number(playerLight.sourceRadius, "playerLight.sourceRadius", 0, 500);

  const flashlight = group(value, "flashlight");
  rejectUnknown(flashlight, "flashlight.",
    ["color", "range", "angle", "intensity", "softness", "innerRadius", "innerFade"]);
  if (flashlight.color !== undefined) result.flashlight.color = color(flashlight.color, "flashlight.color");
  if (flashlight.range !== undefined) result.flashlight.range = number(flashlight.range, "flashlight.range", 1, 2000);
  if (flashlight.angle !== undefined) result.flashlight.angle = number(flashlight.angle, "flashlight.angle", 1, 180);
  if (flashlight.intensity !== undefined) result.flashlight.intensity = number(flashlight.intensity, "flashlight.intensity", 0, 2);
  if (flashlight.softness !== undefined) result.flashlight.softness = number(flashlight.softness, "flashlight.softness", 0, 0.5);
  if (flashlight.innerRadius !== undefined) result.flashlight.innerRadius = number(flashlight.innerRadius, "flashlight.innerRadius", 0, 1000);
  if (flashlight.innerFade !== undefined) result.flashlight.innerFade = number(flashlight.innerFade, "flashlight.innerFade", 0.1, 1000);

  const fog = group(value, "fog");
  rejectUnknown(fog, "fog.", ["range", "feather"]);
  if (fog.range !== undefined) result.fog.range = number(fog.range, "fog.range", 1, 2000);
  if (fog.feather !== undefined) result.fog.feather = number(fog.feather, "fog.feather", 0, 1000);

  const visibility = group(value, "visibility");
  rejectUnknown(visibility, "visibility.", ["maskScale", "memoryBrightness", "edgeFeather", "outlineContrast"]);
  if (visibility.maskScale !== undefined) result.visibility.maskScale = number(visibility.maskScale, "visibility.maskScale", 0.25, 1);
  if (visibility.memoryBrightness !== undefined) result.visibility.memoryBrightness = number(visibility.memoryBrightness, "visibility.memoryBrightness", 0, 1);
  if (visibility.edgeFeather !== undefined) result.visibility.edgeFeather = number(visibility.edgeFeather, "visibility.edgeFeather", 0, 64);
  if (visibility.outlineContrast !== undefined) result.visibility.outlineContrast = number(visibility.outlineContrast, "visibility.outlineContrast", 0, 0.5);

  return result;
}
