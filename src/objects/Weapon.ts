/** 武器槽位：主武器背在背上，副武器挂在腰间，近战槽当前为空手。 */
export type WeaponSlot = "primary" | "secondary" | "melee";

/** 枪械显示弹匣/膛内状态，近战显示刀具，空手不显示弹药。 */
export type WeaponKind = "firearm" | "melee" | "empty";

/** 补弹方式：换弹整匣丢弃重装，装填只补齐现有弹匣。 */
export type ReloadMode = "reload" | "load";

/** HUD 渲染所需的当前武器快照。 */
export interface WeaponView {
  slot: WeaponSlot;
  /** 武器名，例如「格洛克手枪」「冲锋枪」「空手」。 */
  name: string;
  kind: WeaponKind;
  /** 弹匣内余弹（不含膛内那一发）。 */
  magazineAmmo: number;
  /** 弹匣容量（不含膛内那一发）。 */
  magazineSize: number;
  /** 膛内是否还有一发。 */
  chambered: boolean;
  /** 备用弹药；null 表示无限（当前版本没有有限备弹系统）。 */
  reserveAmmo: number | null;
  isReloading: boolean;
  /** 当前补弹方式；未补弹时为 null。 */
  reloadMode: ReloadMode | null;
  /** 换弹进度（0-1）；未换弹时为 0。 */
  reloadProgress: number;
}
