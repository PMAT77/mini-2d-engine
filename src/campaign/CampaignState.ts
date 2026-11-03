import type { ReloadMode, WeaponSlot } from '../objects/Weapon';
import type { ConsumableId } from '../survival/ConsumableInventory';
import type { TileTypeId } from '../map/TileType';
import { getGameDay } from './GameClock';
import { WOOD_WALL } from '../structures/StructureDefinition';
import type { StructureState } from '../structures/StructureDefinition';
export const CAMPAIGN_SCHEMA_VERSION = 2;

export type LocationId = 'outpost' | 'residential';
export type FirearmSlot = 'primary' | 'secondary';
export type QuickBinding = WeaponSlot | ConsumableId;
export type QuickSlots = [QuickBinding | null, QuickBinding | null, QuickBinding | null, QuickBinding | null];
export interface Point { x: number; y: number; }
/** 与 Player 一致：世界像素左上角坐标；朝向由运行态适配器转换。 */
export interface Pose { position: Point; facing: number; }
export type EffectStat = 'maxSpeed' | 'damage' | 'fireRate' | 'bulletSpeed';

export interface PersistentFirearm {
  instanceId: string;
  definitionId: string;
  attributes: {
    damage: number;
    fireIntervalSeconds: number;
    bulletSpeed: number;
    knockbackImpulse: number;
    magazineCapacity: number;
    reloadSeconds: number;
  };
  magazineAmmo: number;
  chambered: boolean;
  /** null 保留现有的无限备弹语义，0 表示确实没有备弹。 */
  reserveAmmo: number | null;
}

export interface PersistentEffect {
  id: string;
  stat: EffectStat;
  value: number;
  isMultiplier: boolean;
  remainingSeconds: number | null;
}

export interface PersistentPlayerState {
  hp: number;
  baseMaxHp: number;
  infection: { infected: boolean; remainderSeconds: number };
  stamina: number;
  baseMaxStamina: number;
  exhausted: boolean;
  staminaRegenDelaySeconds: number;
  weapons: {
    primary: PersistentFirearm | null;
    secondary: PersistentFirearm | null;
    activeSlot: WeaponSlot;
    lastFirearmSlot: FirearmSlot;
  };
  consumables: Record<ConsumableId, number>;
  quickSlots: QuickSlots;
  gold: number;
  effects: PersistentEffect[];
  recovery: { rollCooldownSeconds: number; fireCooldownSeconds: number; meleeGraceSeconds: number };
  preferences: { autoReload: boolean; defaultReloadMode: ReloadMode; flashlightOn: boolean };
}

export type CurrentItem =
  | { kind: 'consumable'; itemId: ConsumableId; quantity: number }
  | { kind: 'firearm'; weapon: PersistentFirearm }
  | { kind: 'gold'; quantity: number }
  | { kind: 'effect'; stat: EffectStat | 'health'; value: number; isMultiplier: boolean; durationSeconds: number | null };
export interface GroundItemState { instanceId: string; position: Point; item: CurrentItem; }
export interface EnemyInstanceState { instanceId: string; kind: 'shambler' | 'runner'; pose: Pose; hp: number; }
export interface SpawnState {
  spawnId: string;
  generation: number;
  lastRefreshDay: number | null;
  /** null 是本代已取走/击杀，不能在载入时当作尚未初始化。 */
  occupant: { kind: 'enemy'; value: EnemyInstanceState | null } | { kind: 'loot'; value: GroundItemState | null };
}
export interface ContainerState {
  containerId: string; opened: boolean; generation: number; lastRefreshDay: number | null; contents: CurrentItem[];
}
export interface TerrainChange { col: number; row: number; tileTypeId: TileTypeId; hp: number; goldAlreadyIssued: number; }
export interface ExplorationState {
  cellSize: number; cols: number; rows: number;
  exploredCellIndices: number[];
  observedTiles: { col: number; row: number; tileTypeId: TileTypeId; damageStage: number }[];
}
export interface LocationState {
  locationId: LocationId;
  definitionVersion: string;
  seed: number;
  initialized: boolean;
  lastVisitedDay: number | null;
  spawns: Record<string, SpawnState>;
  containers: Record<string, ContainerState>;
  /** 仅动态生成/丢弃物品，自然投放的物品由 spawns 持有。 */
  groundItems: GroundItemState[];
  terrainChanges: TerrainChange[];
  exploration: ExplorationState | null;
  structures: StructureState[];
}
/** 只定义刷新契约；A2 不执行补货、补兵或时间推进。 */
export type RefreshPolicy =
  | { kind: 'once' }
  | { kind: 'daily-enemy'; populationCap: number }
  | { kind: 'periodic-resource'; intervalDays: number; refillCap: number };
export type CampaignLifecycle =
  | { kind: 'playing' }
  | { kind: 'recovering'; resolutionId: string; deathLocationId: LocationId; deathWorldMinute: number; raidId: string | null }
  | { kind: 'failed'; reason: 'core-destroyed'; worldMinute: number };
export interface CampaignState {
  schemaVersion: 2;
  definitionVersion: string;
  campaignId: string;
  worldSeed: number;
  /** 0 = 第 1 生存日 06:00；只有战役时钟协调入口能推进。 */
  worldMinute: number;
  revision: number;
  nextInstanceSequence: number;
  lifecycle: CampaignLifecycle;
  presence: Pose & { locationId: LocationId };
  player: PersistentPlayerState;
  locations: Record<LocationId, LocationState>;
  resolvedRaidIds: string[];
  statistics: { kills: number; expeditions: number };
}
export interface NewCampaignInput {
  campaignId?: string;
  worldSeed?: number;
  definitionVersion: string;
  player: PersistentPlayerState;
  outpostSpawn: Pose;
}
export interface CurrentLocationCheckpoint {
  locationId: LocationId;
  player: PersistentPlayerState;
  pose: Pose;
  location: LocationState;
  reason: { kind: 'checkpoint' } | { kind: 'player-death'; resolutionId: string };
  nextInstanceSequence?: number;
}

const LOCATION_IDS: readonly LocationId[] = ['outpost', 'residential'];
const WEAPON_SLOTS: readonly WeaponSlot[] = ['primary', 'secondary', 'melee'];
const CONSUMABLE_IDS: readonly ConsumableId[] = ['vaccine', 'grenade', 'smokeGrenade'];
const EFFECT_STATS: readonly EffectStat[] = ['maxSpeed', 'damage', 'fireRate', 'bulletSpeed'];
// 类型检查确保与 TileTypeId 同步；仅 type import，避免经 TileType 加载 PickupItem/Player。
const TILE_IDS: Record<TileTypeId, true> = {
  default: true, water: true, shallow_water: true, deep_water: true, ultra_deep_water: true,
  wall: true, mineral: true, health_mineral: true, speed_mineral: true, fire_rate_mineral: true,
  bullet_speed_mineral: true, damage_mineral: true,
};

function invalid(path: string, message: string): never { throw new Error('战役数据 ' + path + ': ' + message); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid(path, '必须是纯数据对象');
  if (Object.getOwnPropertySymbols(value).length) return invalid(path, '不支持 Symbol 字段');
  return value as Record<string, unknown>;
}
/** 入口拒绝未知或遗漏字段，防止把身份、时间或场景对象混进普通检查点。 */
export function campaignFields(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const data = object(value, path);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(data, key)) invalid(path + '.' + key, '缺少字段');
  for (const key of Object.keys(data)) if (!required.includes(key) && !optional.includes(key)) invalid(path + '.' + key, '未知字段');
  return data;
}
function finite(value: unknown, path: string, min = 0, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid(path, '数值越界或非有限数');
  return value;
}
function positive(value: unknown, path: string): number {
  const n = finite(value, path);
  if (n === 0) invalid(path, '必须大于 0');
  return n;
}
function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = finite(value, path, min, max);
  if (!Number.isSafeInteger(n)) invalid(path, '必须是安全整数');
  return n;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return invalid(path, '必须是布尔值');
  return value;
}
function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || /\s/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
    return invalid(path, '标识符无效');
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return invalid(path, '不支持的类型');
  return value as T;
}
function list<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(path, '必须是数组');
  return Array.from(value, (entry, i) => read(entry, path + '[' + i + ']'));
}
function unique<T extends string | number>(values: T[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path, '存在重复记录');
}
function dictionary<T>(value: unknown, path: string, read: (value: unknown, path: string, key: string) => T): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, entry] of Object.entries(object(value, path))) {
    identifier(key, path);
    result[key] = read(entry, path + '.' + key, key);
  }
  return result;
}
function point(value: unknown, path: string): Point {
  const p = campaignFields(value, path, ['x', 'y']);
  return { x: finite(p.x, path + '.x'), y: finite(p.y, path + '.y') };
}
function pose(value: unknown, path: string): Pose {
  const p = campaignFields(value, path, ['position', 'facing']);
  return { position: point(p.position, path + '.position'), facing: finite(p.facing, path + '.facing', -Infinity) };
}
function tileId(value: unknown, path: string): TileTypeId {
  const id = identifier(value, path);
  if (!Object.prototype.hasOwnProperty.call(TILE_IDS, id)) return invalid(path, '未知瓦片类型');
  return id as TileTypeId;
}
function instanceId(value: unknown, path: string, instances: Set<string>): string {
  const id = identifier(value, path);
  if (instances.has(id)) invalid(path, '实例被多个所有者持有: ' + id);
  instances.add(id);
  return id;
}
function firearm(value: unknown, path: string, instances: Set<string>): PersistentFirearm {
  const w = campaignFields(value, path, ['instanceId', 'definitionId', 'attributes', 'magazineAmmo', 'chambered', 'reserveAmmo']);
  const a = campaignFields(w.attributes, path + '.attributes',
    ['damage', 'fireIntervalSeconds', 'bulletSpeed', 'knockbackImpulse', 'magazineCapacity', 'reloadSeconds']);
  const capacity = integer(a.magazineCapacity, path + '.attributes.magazineCapacity', 1);
  return {
    instanceId: instanceId(w.instanceId, path + '.instanceId', instances),
    definitionId: identifier(w.definitionId, path + '.definitionId'),
    attributes: {
      damage: finite(a.damage, path + '.attributes.damage'),
      fireIntervalSeconds: positive(a.fireIntervalSeconds, path + '.attributes.fireIntervalSeconds'),
      bulletSpeed: positive(a.bulletSpeed, path + '.attributes.bulletSpeed'),
      knockbackImpulse: finite(a.knockbackImpulse, path + '.attributes.knockbackImpulse'),
      magazineCapacity: capacity, reloadSeconds: positive(a.reloadSeconds, path + '.attributes.reloadSeconds'),
    },
    magazineAmmo: integer(w.magazineAmmo, path + '.magazineAmmo', 0, capacity),
    chambered: boolean(w.chambered, path + '.chambered'),
    reserveAmmo: w.reserveAmmo === null ? null : integer(w.reserveAmmo, path + '.reserveAmmo'),
  };
}
function effectValues(data: Record<string, unknown>, path: string) {
  const value = finite(data.value, path + '.value', -Infinity);
  const isMultiplier = boolean(data.isMultiplier, path + '.isMultiplier');
  if (isMultiplier && value <= -1) invalid(path + '.value', '乘数增益必须大于 -1');
  return { value, isMultiplier };
}
function player(value: unknown, path: string, instances: Set<string>): PersistentPlayerState {
  const p = campaignFields(value, path, ['hp', 'baseMaxHp', 'infection', 'stamina', 'baseMaxStamina', 'exhausted',
    'staminaRegenDelaySeconds', 'weapons', 'consumables', 'quickSlots', 'gold', 'effects', 'recovery', 'preferences']);
  const maxHp = positive(p.baseMaxHp, path + '.baseMaxHp'), maxStamina = positive(p.baseMaxStamina, path + '.baseMaxStamina');
  const infection = campaignFields(p.infection, path + '.infection', ['infected', 'remainderSeconds']);
  const infected = boolean(infection.infected, path + '.infection.infected');
  const remainder = finite(infection.remainderSeconds, path + '.infection.remainderSeconds');
  if (remainder >= 1 || (!infected && remainder !== 0)) invalid(path + '.infection', '感染余量必须小于一秒，未感染时为 0');
  const w = campaignFields(p.weapons, path + '.weapons', ['primary', 'secondary', 'activeSlot', 'lastFirearmSlot']);
  const weapons = {
    primary: w.primary === null ? null : firearm(w.primary, path + '.weapons.primary', instances),
    secondary: w.secondary === null ? null : firearm(w.secondary, path + '.weapons.secondary', instances),
    activeSlot: choice(w.activeSlot, WEAPON_SLOTS, path + '.weapons.activeSlot'),
    lastFirearmSlot: choice(w.lastFirearmSlot, ['primary', 'secondary'] as const, path + '.weapons.lastFirearmSlot'),
  };
  if (weapons.activeSlot !== 'melee' && !weapons[weapons.activeSlot]) invalid(path + '.weapons.activeSlot', '不能装备空枪械槽');
  const counts = campaignFields(p.consumables, path + '.consumables', CONSUMABLE_IDS);
  const quickSlots = list(p.quickSlots, path + '.quickSlots', (v, key) =>
    v === null ? null : choice(v, [...WEAPON_SLOTS, ...CONSUMABLE_IDS], key));
  if (quickSlots.length !== 4) invalid(path + '.quickSlots', '必须恰好四格');
  unique(quickSlots.filter((v): v is QuickBinding => v !== null), path + '.quickSlots');
  const effects = list(p.effects, path + '.effects', (v, key): PersistentEffect => {
    const e = campaignFields(v, key, ['id', 'stat', 'value', 'isMultiplier', 'remainingSeconds']);
    return { id: identifier(e.id, key + '.id'), stat: choice(e.stat, EFFECT_STATS, key + '.stat'),
      ...effectValues(e, key), remainingSeconds: e.remainingSeconds === null ? null : positive(e.remainingSeconds, key + '.remainingSeconds') };
  });
  unique(effects.map(e => e.id), path + '.effects.id');
  unique(effects.map(e => e.stat), path + '.effects.stat');
  const r = campaignFields(p.recovery, path + '.recovery', ['rollCooldownSeconds', 'fireCooldownSeconds', 'meleeGraceSeconds']);
  const prefs = campaignFields(p.preferences, path + '.preferences', ['autoReload', 'defaultReloadMode', 'flashlightOn']);
  return {
    hp: finite(p.hp, path + '.hp', 0, maxHp), baseMaxHp: maxHp,
    infection: { infected, remainderSeconds: remainder },
    stamina: finite(p.stamina, path + '.stamina', 0, maxStamina), baseMaxStamina: maxStamina,
    exhausted: boolean(p.exhausted, path + '.exhausted'), staminaRegenDelaySeconds: finite(p.staminaRegenDelaySeconds, path + '.staminaRegenDelaySeconds'),
    weapons, consumables: { vaccine: integer(counts.vaccine, path + '.consumables.vaccine'),
      grenade: integer(counts.grenade, path + '.consumables.grenade'), smokeGrenade: integer(counts.smokeGrenade, path + '.consumables.smokeGrenade') },
    quickSlots: quickSlots as QuickSlots, gold: integer(p.gold, path + '.gold'), effects,
    recovery: { rollCooldownSeconds: finite(r.rollCooldownSeconds, path + '.recovery.rollCooldownSeconds'),
      fireCooldownSeconds: finite(r.fireCooldownSeconds, path + '.recovery.fireCooldownSeconds'),
      meleeGraceSeconds: finite(r.meleeGraceSeconds, path + '.recovery.meleeGraceSeconds') },
    preferences: { autoReload: boolean(prefs.autoReload, path + '.preferences.autoReload'),
      defaultReloadMode: choice(prefs.defaultReloadMode, ['reload', 'load'] as const, path + '.preferences.defaultReloadMode'),
      flashlightOn: boolean(prefs.flashlightOn, path + '.preferences.flashlightOn') },
  };
}
function item(value: unknown, path: string, instances: Set<string>): CurrentItem {
  const kind = choice(object(value, path).kind, ['consumable', 'firearm', 'gold', 'effect'] as const, path + '.kind');
  if (kind === 'firearm') {
    const data = campaignFields(value, path, ['kind', 'weapon']);
    return { kind, weapon: firearm(data.weapon, path + '.weapon', instances) };
  }
  if (kind === 'effect') {
    const data = campaignFields(value, path, ['kind', 'stat', 'value', 'isMultiplier', 'durationSeconds']);
    const stat = choice(data.stat, [...EFFECT_STATS, 'health'] as const, path + '.stat');
    const values = effectValues(data, path);
    if (stat === 'health' && (values.isMultiplier || values.value <= 0 || data.durationSeconds !== null))
      invalid(path, '回血道具必须是即时正数治疗');
    return { kind, stat, ...values, durationSeconds: data.durationSeconds === null ? null : positive(data.durationSeconds, path + '.durationSeconds') };
  }
  const data = campaignFields(value, path, kind === 'gold' ? ['kind', 'quantity'] : ['kind', 'itemId', 'quantity']);
  const quantity = integer(data.quantity, path + '.quantity', 1);
  return kind === 'gold' ? { kind, quantity } : { kind, quantity, itemId: choice(data.itemId, CONSUMABLE_IDS, path + '.itemId') };
}
function groundItem(value: unknown, path: string, instances: Set<string>): GroundItemState {
  const data = campaignFields(value, path, ['instanceId', 'position', 'item']);
  return { instanceId: instanceId(data.instanceId, path + '.instanceId', instances),
    position: point(data.position, path + '.position'), item: item(data.item, path + '.item', instances) };
}
function enemy(value: unknown, path: string, instances: Set<string>): EnemyInstanceState {
  const data = campaignFields(value, path, ['instanceId', 'kind', 'pose', 'hp']);
  return { instanceId: instanceId(data.instanceId, path + '.instanceId', instances),
    kind: choice(data.kind, ['shambler', 'runner'] as const, path + '.kind'),
    pose: pose(data.pose, path + '.pose'), hp: positive(data.hp, path + '.hp') };
}
function exploration(value: unknown, path: string): ExplorationState {
  const data = campaignFields(value, path, ['cellSize', 'cols', 'rows', 'exploredCellIndices', 'observedTiles']);
  const cols = integer(data.cols, path + '.cols', 1), rows = integer(data.rows, path + '.rows', 1);
  const count = integer(cols * rows, path + '.cellCount', 1);
  const cells = list(data.exploredCellIndices, path + '.exploredCellIndices', (v, key) => integer(v, key, 0, count - 1));
  unique(cells, path + '.exploredCellIndices');
  const tiles = list(data.observedTiles, path + '.observedTiles', (v, key) => {
    const t = campaignFields(v, key, ['col', 'row', 'tileTypeId', 'damageStage']);
    return { col: integer(t.col, key + '.col'), row: integer(t.row, key + '.row'),
      tileTypeId: tileId(t.tileTypeId, key + '.tileTypeId'), damageStage: integer(t.damageStage, key + '.damageStage', 0, 3) };
  });
  unique(tiles.map(t => t.col + ':' + t.row), path + '.observedTiles');
  return { cellSize: positive(data.cellSize, path + '.cellSize'), cols, rows, exploredCellIndices: cells, observedTiles: tiles };
}
function structure(value: unknown, path: string, instances: Set<string>): StructureState {
  const s = campaignFields(value, path, ['instanceId', 'definitionId', 'level', 'col', 'row', 'rotation', 'hp', 'status', 'observedHp']);
  const hp = finite(s.hp, path + '.hp', 0, WOOD_WALL.maxHp), status = choice(s.status, ['standing', 'destroyed'] as const, path + '.status');
  if ((status === 'standing') !== (hp > 0)) invalid(path, '建筑耐久与状态不一致');
  return { instanceId: instanceId(s.instanceId, path + '.instanceId', instances),
    definitionId: choice(s.definitionId, ['wood-wall'] as const, path + '.definitionId'), level: integer(s.level, path + '.level', 1, 1) as 1,
    col: integer(s.col, path + '.col'), row: integer(s.row, path + '.row'), rotation: integer(s.rotation, path + '.rotation', 0, 1) as 0 | 1, hp, status,
    observedHp: s.observedHp === null ? null : finite(s.observedHp, path + '.observedHp', 0, WOOD_WALL.maxHp) };
}
export function parseStructureState(value: unknown): StructureState { return structure(value, 'structure', new Set()); }
function location(value: unknown, path: string, day: number, instances: Set<string>, schema: number): LocationState {
  const data = campaignFields(value, path, ['locationId', 'definitionVersion', 'seed', 'initialized', 'lastVisitedDay',
    'spawns', 'containers', 'groundItems', 'terrainChanges', 'exploration', ...(schema === 2 ? ['structures'] : [])]);
  const date = (v: unknown, key: string) => v === null ? null : integer(v, key, 1, day);
  const spawns = dictionary(data.spawns, path + '.spawns', (v, key, id): SpawnState => {
    const s = campaignFields(v, key, ['spawnId', 'generation', 'lastRefreshDay', 'occupant']);
    if (identifier(s.spawnId, key + '.spawnId') !== id) invalid(key, '生成点 ID 与键不一致');
    const o = campaignFields(s.occupant, key + '.occupant', ['kind', 'value']);
    const kind = choice(o.kind, ['enemy', 'loot'] as const, key + '.occupant.kind');
    return { spawnId: id, generation: integer(s.generation, key + '.generation'),
      lastRefreshDay: date(s.lastRefreshDay, key + '.lastRefreshDay'),
      occupant: kind === 'enemy'
        ? { kind, value: o.value === null ? null : enemy(o.value, key + '.occupant.value', instances) }
        : { kind, value: o.value === null ? null : groundItem(o.value, key + '.occupant.value', instances) } };
  });
  const containers = dictionary(data.containers, path + '.containers', (v, key, id): ContainerState => {
    const c = campaignFields(v, key, ['containerId', 'opened', 'generation', 'lastRefreshDay', 'contents']);
    if (identifier(c.containerId, key + '.containerId') !== id) invalid(key, '容器 ID 与键不一致');
    return { containerId: id, opened: boolean(c.opened, key + '.opened'), generation: integer(c.generation, key + '.generation'),
      lastRefreshDay: date(c.lastRefreshDay, key + '.lastRefreshDay'), contents: list(c.contents, key + '.contents', (v, p) => item(v, p, instances)) };
  });
  const terrain = list(data.terrainChanges, path + '.terrainChanges', (v, key): TerrainChange => {
    const t = campaignFields(v, key, ['col', 'row', 'tileTypeId', 'hp', 'goldAlreadyIssued']);
    return { col: integer(t.col, key + '.col'), row: integer(t.row, key + '.row'),
      tileTypeId: tileId(t.tileTypeId, key + '.tileTypeId'), hp: finite(t.hp, key + '.hp'),
      goldAlreadyIssued: integer(t.goldAlreadyIssued, key + '.goldAlreadyIssued') };
  });
  unique(terrain.map(t => t.col + ':' + t.row), path + '.terrainChanges');
  const result: LocationState = {
    locationId: choice(data.locationId, LOCATION_IDS, path + '.locationId'),
    definitionVersion: identifier(data.definitionVersion, path + '.definitionVersion'),
    seed: integer(data.seed, path + '.seed', 0, 0xffffffff), initialized: boolean(data.initialized, path + '.initialized'),
    lastVisitedDay: date(data.lastVisitedDay, path + '.lastVisitedDay'), spawns, containers,
    groundItems: list(data.groundItems, path + '.groundItems', (v, key) => groundItem(v, key, instances)),
    terrainChanges: terrain, exploration: data.exploration === null ? null : exploration(data.exploration, path + '.exploration'),
    structures: schema === 1 ? [] : list(data.structures, path + '.structures', (v, key) => structure(v, key, instances)),
  };
  if (!result.initialized && (result.lastVisitedDay !== null || Object.keys(spawns).length || Object.keys(containers).length
    || result.groundItems.length || terrain.length || result.structures.length || result.exploration !== null)) invalid(path, '未初始化地点不能带有已生成的世界状态');
  unique(result.structures.map(s => s.col + ':' + s.row), path + '.structures');
  if (result.structures.length > 512) invalid(path + '.structures', '建筑数量超出当前上限');
  return result;
}
function lifecycle(value: unknown, path: string, worldMinute: number): CampaignLifecycle {
  const kind = choice(object(value, path).kind, ['playing', 'recovering', 'failed'] as const, path + '.kind');
  if (kind === 'playing') { campaignFields(value, path, ['kind']); return { kind }; }
  if (kind === 'failed') {
    const data = campaignFields(value, path, ['kind', 'reason', 'worldMinute']);
    return { kind, reason: choice(data.reason, ['core-destroyed'] as const, path + '.reason'),
      worldMinute: finite(data.worldMinute, path + '.worldMinute', 0, worldMinute) };
  }
  const data = campaignFields(value, path, ['kind', 'resolutionId', 'deathLocationId', 'deathWorldMinute', 'raidId']);
  return { kind, resolutionId: identifier(data.resolutionId, path + '.resolutionId'),
    deathLocationId: choice(data.deathLocationId, LOCATION_IDS, path + '.deathLocationId'),
    deathWorldMinute: finite(data.deathWorldMinute, path + '.deathWorldMinute', 0, worldMinute),
    raidId: data.raidId === null ? null : identifier(data.raidId, path + '.raidId') };
}

/** 校验并构造完全独立的纯数据副本；所有实例在整场战役中只能出现一次。 */
export function parsePersistentPlayer(value: unknown): PersistentPlayerState {
  return player(value, 'player', new Set<string>());
}
export function parsePersistentFirearm(value: unknown): PersistentFirearm {
  return firearm(value, 'firearm', new Set<string>());
}
export function parseCampaignState(value: unknown): CampaignState {
  const data = campaignFields(value, 'campaign', ['schemaVersion', 'definitionVersion', 'campaignId', 'worldSeed',
    'worldMinute', 'revision', 'nextInstanceSequence', 'lifecycle', 'presence', 'player', 'locations', 'resolvedRaidIds', 'statistics']);
  if (data.schemaVersion !== 1 && data.schemaVersion !== 2) invalid('schemaVersion', '不支持的版本');
  const worldMinute = finite(data.worldMinute, 'worldMinute', 0, Number.MAX_SAFE_INTEGER);
  const day = getGameDay(worldMinute), instances = new Set<string>();
  const presence = campaignFields(data.presence, 'presence', ['locationId', 'position', 'facing']);
  const playerState = player(data.player, 'player', instances);
  const locations = campaignFields(data.locations, 'locations', LOCATION_IDS);
  const outpost = location(locations.outpost, 'locations.outpost', day, instances, data.schemaVersion);
  const residential = location(locations.residential, 'locations.residential', day, instances, data.schemaVersion);
  if (outpost.locationId !== 'outpost' || residential.locationId !== 'residential') invalid('locations', '地点 ID 与键不一致');
  const stateLifecycle = lifecycle(data.lifecycle, 'lifecycle', worldMinute);
  if ((stateLifecycle.kind === 'playing' && playerState.hp <= 0) || (stateLifecycle.kind === 'recovering' && playerState.hp !== 0))
    invalid('lifecycle', '生命值与生命周期不一致');
  const raids = list(data.resolvedRaidIds, 'resolvedRaidIds', identifier);
  unique(raids, 'resolvedRaidIds');
  const stats = campaignFields(data.statistics, 'statistics', ['kills', 'expeditions']);
  return {
    schemaVersion: 2, definitionVersion: identifier(data.definitionVersion, 'definitionVersion'),
    campaignId: identifier(data.campaignId, 'campaignId'), worldSeed: integer(data.worldSeed, 'worldSeed', 0, 0xffffffff),
    worldMinute, revision: integer(data.revision, 'revision'), nextInstanceSequence: integer(data.nextInstanceSequence, 'nextInstanceSequence'),
    lifecycle: stateLifecycle, presence: { locationId: choice(presence.locationId, LOCATION_IDS, 'presence.locationId'),
      position: point(presence.position, 'presence.position'), facing: finite(presence.facing, 'presence.facing', -Infinity) },
    player: playerState, locations: { outpost, residential }, resolvedRaidIds: raids,
    statistics: { kills: integer(stats.kills, 'statistics.kills'), expeditions: integer(stats.expeditions, 'statistics.expeditions') },
  };
}
