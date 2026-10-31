/** 音效配置：音量 0–1，master 作为全局倍率乘到所有播放上。 */
export interface AudioConfig {
  master: number;
  weapon: { secondaryVolume: number; primaryVolume: number; reloadVolume: number; switchVolume: number };
  footsteps: { waterVolume: number; dryVolume: number };
  pickups: { goldVolume: number; meatVolume: number };
  flashlight: { switchVolume: number };
  chicken: { stepVolume: number; cluckVolume: number; range: number; minAttenuation: number };
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  master: 1,
  weapon: { secondaryVolume: 0.6, primaryVolume: 0.55, reloadVolume: 0.5, switchVolume: 0.5 },
  footsteps: { waterVolume: 0.45, dryVolume: 0.45 },
  pickups: { goldVolume: 0.4, meatVolume: 0.5 },
  flashlight: { switchVolume: 0.5 },
  chicken: { stepVolume: 0.25, cluckVolume: 0.25, range: 450, minAttenuation: 0.08 },
};

export function cloneAudioConfig(config: AudioConfig = DEFAULT_AUDIO_CONFIG): AudioConfig {
  return {
    master: config.master,
    weapon: { ...config.weapon },
    footsteps: { ...config.footsteps },
    pickups: { ...config.pickups },
    flashlight: { ...config.flashlight },
    chicken: { ...config.chicken },
  };
}

const GROUPS = ["weapon", "footsteps", "pickups", "flashlight", "chicken"] as const;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function volume(value: unknown, path: string, max = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`无效配置值: audio.${path} 必须是 0–${max} 内的有限数值`);
  }
  return value;
}

function group(source: Record<string, unknown>, name: (typeof GROUPS)[number]): Record<string, unknown> {
  const value = source[name];
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`无效配置分组: audio.${name}`);
  return value;
}

function rejectUnknown(source: Record<string, unknown>, prefix: string, allowed: readonly string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new Error(`未知配置项: audio.${prefix}${key}`);
  }
}

export function parseAudioConfig(value: unknown): AudioConfig {
  if (!isObject(value)) throw new Error("音效配置必须是 JSON 对象");
  for (const key of Object.keys(value)) {
    if (key !== "master" && !GROUPS.includes(key as (typeof GROUPS)[number])) {
      throw new Error(`无效配置分组: audio.${key}`);
    }
  }
  const result = cloneAudioConfig();
  if (value.master !== undefined) result.master = volume(value.master, "master");

  const weapon = group(value, "weapon");
  rejectUnknown(weapon, "weapon.", ["secondaryVolume", "primaryVolume", "reloadVolume", "switchVolume"]);
  if (weapon.secondaryVolume !== undefined) result.weapon.secondaryVolume = volume(weapon.secondaryVolume, "weapon.secondaryVolume");
  if (weapon.primaryVolume !== undefined) result.weapon.primaryVolume = volume(weapon.primaryVolume, "weapon.primaryVolume");
  if (weapon.reloadVolume !== undefined) result.weapon.reloadVolume = volume(weapon.reloadVolume, "weapon.reloadVolume");
  if (weapon.switchVolume !== undefined) result.weapon.switchVolume = volume(weapon.switchVolume, "weapon.switchVolume");

  const footsteps = group(value, "footsteps");
  rejectUnknown(footsteps, "footsteps.", ["waterVolume", "dryVolume"]);
  if (footsteps.waterVolume !== undefined) result.footsteps.waterVolume = volume(footsteps.waterVolume, "footsteps.waterVolume");
  if (footsteps.dryVolume !== undefined) result.footsteps.dryVolume = volume(footsteps.dryVolume, "footsteps.dryVolume");

  const pickups = group(value, "pickups");
  rejectUnknown(pickups, "pickups.", ["goldVolume", "meatVolume"]);
  if (pickups.goldVolume !== undefined) result.pickups.goldVolume = volume(pickups.goldVolume, "pickups.goldVolume");
  if (pickups.meatVolume !== undefined) result.pickups.meatVolume = volume(pickups.meatVolume, "pickups.meatVolume");

  const flashlight = group(value, "flashlight");
  rejectUnknown(flashlight, "flashlight.", ["switchVolume"]);
  if (flashlight.switchVolume !== undefined) result.flashlight.switchVolume = volume(flashlight.switchVolume, "flashlight.switchVolume");

  const chicken = group(value, "chicken");
  rejectUnknown(chicken, "chicken.", ["stepVolume", "cluckVolume", "range", "minAttenuation"]);
  if (chicken.stepVolume !== undefined) result.chicken.stepVolume = volume(chicken.stepVolume, "chicken.stepVolume");
  if (chicken.cluckVolume !== undefined) result.chicken.cluckVolume = volume(chicken.cluckVolume, "chicken.cluckVolume");
  if (chicken.range !== undefined) result.chicken.range = volume(chicken.range, "chicken.range", 5000);
  if (chicken.minAttenuation !== undefined) result.chicken.minAttenuation = volume(chicken.minAttenuation, "chicken.minAttenuation");

  return result;
}
