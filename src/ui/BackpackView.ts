import type { WeaponLoadoutView, WeaponSlot } from '../objects/Weapon';
import type { BackpackLoad } from './BackpackHud';
import { THROWABLE_CONFIG as TC, THROWABLE_ITEMS, THROWABLE_IDS, type ThrowableId } from '../throwables/ThrowableConfig';

export type BackpackCategory = 'melee' | 'ranged' | 'consumables' | 'throwables';
export type BackpackItemId = WeaponSlot | 'vaccine' | ThrowableId;
export const BACKPACK_CATEGORIES: readonly BackpackCategory[] = ['melee', 'ranged', 'consumables', 'throwables'];
export const BACKPACK_LABELS: Readonly<Record<BackpackCategory, string>> = { melee: '近战', ranged: '远程', consumables: '消耗物', throwables: '投掷物' };
export const BACKPACK_WEIGHTS = Object.freeze({ primary: 3.2, secondary: 0.9, melee: 0, vaccine: 0.1 });
export const BACKPACK_CAPACITY_KG = 30;
export const BACKPACK_ASSET_DIR = '/assets/images/ui/inventory';

export interface BackpackItemView {
  readonly id: BackpackItemId;
  readonly category: BackpackCategory;
  readonly icon: string;
  readonly name: string;
  readonly type: string;
  readonly quantity: number;
  readonly unitWeightKg: number;
  readonly equipped: boolean;
  readonly action: '装备' | '使用' | '握持';
  readonly disabledReason: string | null;
  readonly canDrop: boolean;
  readonly description: string;
  readonly properties: readonly { label: string; value: string }[];
}
export interface BackpackView {
  readonly items: readonly BackpackItemView[];
  readonly load: Readonly<BackpackLoad>;
  readonly quickSlots?: readonly (BackpackItemId | null)[];
  readonly actionsLocked?: boolean;
}

export function getBackpackLoad(vaccines: number, loadout?: WeaponLoadoutView, throwables: Partial<Record<ThrowableId, number>> = {}): BackpackLoad {
  return { weightKg: Math.round(((loadout?.primary.owned === false ? 0 : BACKPACK_WEIGHTS.primary)
      + (loadout?.secondary.owned === false ? 0 : BACKPACK_WEIGHTS.secondary) + vaccines * BACKPACK_WEIGHTS.vaccine
      + (throwables.grenade ?? 0) * THROWABLE_ITEMS.grenade.weight + (throwables.smokeGrenade ?? 0) * THROWABLE_ITEMS.smokeGrenade.weight) * 10) / 10,
    capacityKg: BACKPACK_CAPACITY_KG };
}

/** 只投影现有槽位与疫苗计数，不持有第二份背包状态。 */
export function createBackpackView(loadout: WeaponLoadoutView, vaccines: number, vaccineReason: string | null,
  quickSlots: readonly (BackpackItemId | null)[] = [], throwables: Partial<Record<ThrowableId, number>> = {},
  held: ThrowableId | null = null, locked = false): BackpackView {
  const items: BackpackItemView[] = (['melee', 'primary', 'secondary'] as const).filter(id => loadout[id].owned !== false).map(id => ({
    id, category: id === 'melee' ? 'melee' : 'ranged',
    icon: `${BACKPACK_ASSET_DIR}/${id === 'melee' ? 'unarmed' : id === 'primary' ? 'smg' : 'glock'}.png`,
    name: loadout[id].name, type: id === 'melee' ? '徒手' : id === 'primary' ? '冲锋枪' : '手枪',
    quantity: 1, unitWeightKg: BACKPACK_WEIGHTS[id], equipped: loadout.activeSlot === id, action: '装备',
    disabledReason: loadout.activeSlot === id ? '已装备' : null,
    canDrop: id !== 'melee',
    description: id === 'melee' ? '右键抱架，点击左键出拳；按点击节奏衔接连招。' : id === 'primary' ? '适合连续射击的紧凑型冲锋枪。' : '便于携带的半自动手枪。',
    properties: id === 'melee' ? [{ label: '重量', value: '0.0 kg' }] : [
      { label: '重量', value: `${BACKPACK_WEIGHTS[id].toFixed(1)} kg` },
      { label: '攻击力', value: loadout[id].stats?.damage.toFixed(1) ?? '—' },
      { label: '射速', value: loadout[id].stats ? `${loadout[id].stats!.roundsPerMinute.toFixed(0)} 发/分` : '—' },
      { label: '弹速', value: loadout[id].stats ? `${loadout[id].stats!.bulletSpeed.toFixed(0)} px/s` : '—' },
      { label: '弹匣', value: `${loadout[id].magazineAmmo} / ${loadout[id].magazineSize}` },
      { label: '换弹', value: loadout[id].stats ? `${loadout[id].stats!.reloadSeconds.toFixed(1)} s` : '—' },
    ],
  }));
  if (vaccines > 0) items.push({ id: 'vaccine', category: 'consumables', icon: `${BACKPACK_ASSET_DIR}/vaccine.png`,
    name: '疫苗', type: '医疗 · 治疗感染', quantity: vaccines, unitWeightKg: BACKPACK_WEIGHTS.vaccine,
    equipped: false, action: '使用', disabledReason: vaccineReason, canDrop: true,
    description: '治疗感染。使用后消耗一支，不恢复生命值。',
    properties: [{ label: '单件重量', value: '0.1 kg' }, { label: '数量', value: String(vaccines) },
      { label: '总重', value: `${(vaccines * BACKPACK_WEIGHTS.vaccine).toFixed(1)} kg` }, { label: '效果', value: '解除感染' }] });
  for (const id of THROWABLE_IDS) {
    const quantity = throwables[id] ?? 0, item = THROWABLE_ITEMS[id];
    if (!quantity) continue;
    items.push({ id, category: 'throwables', icon: `${BACKPACK_ASSET_DIR}/${item.asset}.png`, name: item.name,
      type: id === 'grenade' ? '投掷物 · 爆炸' : '投掷物 · 视野遮挡', quantity, unitWeightKg: item.weight,
      equipped: held === id, action: '握持', disabledReason: held === id ? '已握持' : null, canDrop: true,
      description: id === 'grenade' ? '右键瞄准，按住左键启动引信，松开投掷。拉环后不可取消，会伤及自身。' : '右键瞄准，按下并松开左键投掷。落地排烟，遮挡双方视野。',
      properties: [{ label: '单件重量', value: `${item.weight.toFixed(1)} kg` }, { label: '数量', value: String(quantity) },
        { label: '投掷距离', value: `${TC.maxDistance} px` }, ...(id === 'grenade' ? [
          { label: '攻击力', value: `${TC.damage}（随距离衰减）` }, { label: '爆炸半径', value: `${TC.blastRadius} px` }, { label: '引信', value: `${TC.fuse} s` },
        ] : [{ label: '烟雾半径', value: `${TC.smokeRadius} px` }, { label: '持续时间', value: '14 s（1 / 10 / 3）' }])],
    });
  }
  return { items: items.map(item => ({ ...item, equipped: held ? item.id === held : item.equipped,
    ...(locked ? { disabledReason: '手雷已拉环，请先投出', canDrop: false } : {}) })), load: getBackpackLoad(vaccines, loadout, throwables), quickSlots, actionsLocked: locked };
}

export type QuickSlotItemView = Pick<BackpackItemView, 'id' | 'icon' | 'name' | 'quantity' | 'category'> & { available?: boolean };
/** Binding identity survives depletion; these zero-count entries never appear in the backpack list. */
export function createQuickSlotViews(loadout: WeaponLoadoutView, vaccines: number, counts: Partial<Record<ThrowableId, number>>,
  bindings: readonly (BackpackItemId | null)[]): (QuickSlotItemView | null)[] {
  const catalog = createBackpackView({ ...loadout, primary: { ...loadout.primary, owned: true }, secondary: { ...loadout.secondary, owned: true } },
    Math.max(1, vaccines), null, [], { grenade: Math.max(1, counts.grenade ?? 0), smokeGrenade: Math.max(1, counts.smokeGrenade ?? 0) }).items;
  return bindings.map(id => {
    const item = catalog.find(item => item.id === id); if (!item) return null;
    const quantity = item.id === 'vaccine' ? vaccines : item.id === 'grenade' || item.id === 'smokeGrenade' ? counts[item.id] ?? 0 : loadout[item.id].owned === false ? 0 : 1;
    return { id: item.id, icon: item.icon, name: item.name, category: item.category, quantity, available: quantity > 0 };
  });
}
