export type PlayerLifeState = 'alive' | 'dead';
export type PlayerDamageKind = 'melee' | 'infection' | 'script' | 'explosion';
export interface PlayerDamageEvent {
  amount: number; kind: PlayerDamageKind; sourceId?: string; attackId?: string;
  sourcePosition?: Readonly<{ x: number; y: number }>;
}
export interface PlayerDamageApplied extends Readonly<PlayerDamageEvent> {
  readonly sequence: number;
  readonly appliedAmount: number;
  readonly targetPosition: Readonly<{ x: number; y: number }>;
}
export interface PlayerDamageResult {
  appliedAmount: number; killed: boolean; blocked: boolean;
  /** 本次翻滚首次成功抵消近战时为 true，供场景播放一次提示。 */
  perfectDodge?: boolean;
}
export const MELEE_DAMAGE_GRACE_SECONDS = 0.35;

export function validatePlayerDamage(event: PlayerDamageEvent): void {
  if (!event || !Number.isFinite(event.amount) || event.amount < 0 ||
    !['melee', 'infection', 'script', 'explosion'].includes(event.kind) ||
    (event.sourcePosition !== undefined && (!event.sourcePosition || !Number.isFinite(event.sourcePosition.x) || !Number.isFinite(event.sourcePosition.y))))
    throw new Error('伤害必须是非负有限数值且来源有效，来源位置必须有效');
}
