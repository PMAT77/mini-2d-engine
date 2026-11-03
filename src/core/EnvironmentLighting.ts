import { readGameTime, type DayPhase } from '../campaign/GameClock';

export interface EnvironmentPreset {
  ambientColor: string; ambientIntensity: number;
  sunColor: string; sunIntensity: number;
  shadowScale: number; shadowOpacity: number; softnessScale: number;
  edgeIntensity: number; waterHighlight: number; metalHighlight: number;
  hazeOpacity: number; artificialWeight: number;
}
export interface DayNightConfig {
  mode: 'auto' | 'manual';
  groundColor: string; wallColor: string;
  day: EnvironmentPreset; dusk: EnvironmentPreset; night: EnvironmentPreset;
}
/** Gameplay values are deliberately not editable through the graphics panel. */
export interface EnvironmentPerception { naturalRange: number; daylight: number; }
export interface EnvironmentState extends EnvironmentPreset, EnvironmentPerception {
  worldMinute: number; phase: DayPhase; sunDirection: { x: number; y: number };
}
export const DEFAULT_DAY_NIGHT: DayNightConfig = {
  mode: 'auto', groundColor: '#596057', wallColor: '#747870',
  day: { ambientColor: '#E9E5D9', ambientIntensity: .72, sunColor: '#FFE9CA', sunIntensity: .24,
    shadowScale: .65, shadowOpacity: .85, softnessScale: .08, edgeIntensity: .10,
    waterHighlight: .08, metalHighlight: .04, hazeOpacity: .015, artificialWeight: .30 },
  dusk: { ambientColor: '#91A4C4', ambientIntensity: .40, sunColor: '#FFB36B', sunIntensity: .38,
    shadowScale: 2.2, shadowOpacity: .95, softnessScale: .12, edgeIntensity: .18,
    waterHighlight: .12, metalHighlight: .07, hazeOpacity: .025, artificialWeight: .65 },
  night: { ambientColor: '#879FBE', ambientIntensity: .28, sunColor: '#FFB36B', sunIntensity: 0,
    shadowScale: 0, shadowOpacity: 0, softnessScale: .12, edgeIntensity: 0,
    waterHighlight: .04, metalHighlight: .03, hazeOpacity: .025, artificialWeight: 1 },
};
export function cloneDayNight(config: DayNightConfig = DEFAULT_DAY_NIGHT): DayNightConfig {
  return { ...config, day: { ...config.day }, dusk: { ...config.dusk }, night: { ...config.night } };
}
export const smoothstep = (value: number): number => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
function mixColor(a: string, b: string, t: number): string {
  const channel = (offset: number) => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - t) + parseInt(b.slice(offset, offset + 2), 16) * t).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}
function blend(a: EnvironmentPreset, b: EnvironmentPreset, t: number): EnvironmentPreset {
  const result = { ...a };
  for (const key of Object.keys(a) as (keyof EnvironmentPreset)[]) {
    if (key === 'ambientColor' || key === 'sunColor') result[key] = mixColor(a[key], b[key], t);
    else result[key] = a[key] + (b[key] - a[key]) * t;
  }
  return result;
}
/** worldMinute 0 = day 1, 06:00. All transitions derive from the saved clock, never wall time. */
export function sampleEnvironment(worldMinute: number, config: DayNightConfig = DEFAULT_DAY_NIGHT): EnvironmentState {
  const time = readGameTime(worldMinute), minute = worldMinute % 1440;
  const day = config.day, dusk = config.dusk, night = config.night;
  let preset: EnvironmentPreset, naturalRange: number, daylight: number;
  if (minute < 30) {
    const t = smoothstep(minute / 30);
    const dawn = blend(night, day, .5); dawn.sunIntensity = 0; dawn.shadowScale = day.shadowScale;
    preset = blend(dawn, day, t); naturalRange = 275 + 175 * t; daylight = .5 + .5 * t;
  } else if (minute < 630) {
    preset = { ...day }; naturalRange = 450; daylight = 1;
  } else if (minute < 720) {
    const t = smoothstep((minute - 630) / 90);
    preset = blend(day, dusk, t); naturalRange = 450 - 150 * t; daylight = 1 - .35 * t;
  } else if (minute < 780) {
    preset = { ...dusk }; const t = smoothstep((minute - 720) / 60);
    naturalRange = 300; daylight = .65 - .25 * t;
  } else if (minute < 840) {
    const t = smoothstep((minute - 780) / 60);
    preset = blend(dusk, night, t);
    // Keep low-sun shadows long while their energy fades; don't shrink them back into the wall.
    preset.shadowScale = dusk.shadowScale + .6 * t;
    naturalRange = 300 * (1 - t); daylight = .4 * (1 - t);
  } else if (minute < 1410) {
    preset = { ...night }; naturalRange = 0; daylight = 0;
  } else {
    const t = smoothstep((minute - 1410) / 30);
    const dawn = blend(night, day, .5); dawn.sunIntensity = 0; dawn.shadowScale = day.shadowScale;
    preset = blend(night, dawn, t); naturalRange = 275 * t; daylight = .5 * t;
  }
  // No solar energy/shadows before 06:00 or after 20:00, including custom night presets.
  if (time.phase === 'night') { preset.sunIntensity = 0; preset.shadowScale = 0; preset.edgeIntensity = 0; }
  return { ...preset, worldMinute, phase: time.phase, naturalRange, daylight, sunDirection: { x: .8, y: .6 } };
}

/** Radial daylight edge matches the renderer's 20px feather; identity still needs observer LOS. */
export function naturalLightStrength(environment: EnvironmentPerception | undefined, distance: number): number {
  if (!environment || !Number.isFinite(distance) || environment.naturalRange <= 0) return 0;
  return smoothstep((environment.naturalRange - distance) / 20);
}
