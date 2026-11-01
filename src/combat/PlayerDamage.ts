export type PlayerLifeState = 'alive' | 'dead';
export type PlayerDamageKind = 'melee' | 'infection' | 'script';
export interface PlayerDamageEvent { amount: number; kind: PlayerDamageKind; sourceId?: string; attackId?: string; }
export interface PlayerDamageResult { appliedAmount: number; killed: boolean; blocked: boolean; }
export const MELEE_DAMAGE_GRACE_SECONDS = 0.35;

export function validatePlayerDamage(event: PlayerDamageEvent): void {
  if (!event || !Number.isFinite(event.amount) || event.amount < 0 ||
    !['melee', 'infection', 'script'].includes(event.kind)) throw new Error('伤害必须是非负有限数值且来源有效');
}
