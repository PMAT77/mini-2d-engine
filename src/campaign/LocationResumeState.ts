import { campaignFields } from './CampaignState';
import type { PersistentPlayerState, Point } from './CampaignState';
import type { WeaponSlot } from '../objects/Weapon';
import type { ThrowableBody } from '../throwables/ThrowablePhysics';
import { THROWABLE_CONFIG as C } from '../throwables/ThrowableConfig';

export interface HeldGrenadeState { fuse: number; target: Point; returnWeapon: WeaponSlot; }
export interface LocationResumeState {
  heldGrenade: HeldGrenadeState | null;
  bodies: Omit<ThrowableBody, 'dead'>[];
  lastThrowableId: number;
  stepRemainder: number;
}
export function emptyLocationResume(): LocationResumeState {
  return { heldGrenade: null, bodies: [], lastThrowableId: 0, stepRemainder: 0 };
}
function number(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('投掷物恢复数值无效');
  return value;
}
function integer(value: unknown): number {
  const result = number(value, 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(result)) throw new Error('投掷物实例序号无效');
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('投掷物恢复标记无效');
  return value;
}
/** 只白名单化已有物理数值，不序列化控制器、回调或渲染缓存。 */
export function parseLocationResume(value: unknown, player: PersistentPlayerState): LocationResumeState {
  const data = campaignFields(value, 'runtime', ['heldGrenade', 'bodies', 'lastThrowableId', 'stepRemainder']);
  const lastThrowableId = integer(data.lastThrowableId), stepRemainder = number(data.stepRemainder, 0, C.step);
  let heldGrenade: HeldGrenadeState | null = null;
  if (data.heldGrenade !== null) {
    const held = campaignFields(data.heldGrenade, 'heldGrenade', ['fuse', 'target', 'returnWeapon']);
    const target = campaignFields(held.target, 'target', ['x', 'y']);
    if (player.hp <= 0 || player.consumables.grenade < 1 || !['primary', 'secondary', 'melee'].includes(held.returnWeapon as string))
      throw new Error('手持手雷与玩家库存或生命状态不一致');
    heldGrenade = { fuse: number(held.fuse, 0, C.fuse), target: { x: number(target.x), y: number(target.y) }, returnWeapon: held.returnWeapon as WeaponSlot };
  }
  if (!Array.isArray(data.bodies)) throw new Error('投掷物恢复列表无效');
  const ids = new Set<number>();
  const bodies = data.bodies.map(value => {
    const b = campaignFields(value, 'throwable', ['id', 'kind', 'x', 'y', 'vx', 'vy', 'z', 'vz', 'rotation', 'fuse', 'landed', 'resting', 'smokeAge']);
    const id = integer(b.id);
    if (!id || ids.has(id) || id > lastThrowableId || !['grenade', 'smokeGrenade'].includes(b.kind as string)) throw new Error('投掷物身份无效');
    ids.add(id);
    const body = { id, kind: b.kind as ThrowableBody['kind'], x: number(b.x), y: number(b.y), vx: number(b.vx), vy: number(b.vy),
      z: number(b.z, 0), vz: number(b.vz), rotation: number(b.rotation), fuse: number(b.fuse, 0, C.fuse),
      landed: boolean(b.landed), resting: boolean(b.resting), smokeAge: number(b.smokeAge, -1, C.smokeGrow + C.smokeHold + C.smokeFade) };
    if ((body.kind === 'grenade' && (body.fuse <= 0 || body.smokeAge !== -1))
      || (body.kind === 'smokeGrenade' && ((body.smokeAge !== -1 && body.smokeAge < 0) || body.landed !== (body.smokeAge >= 0)
        || body.smokeAge >= C.smokeGrow + C.smokeHold + C.smokeFade))
      || (body.resting && (!body.landed || body.z !== 0 || body.vx !== 0 || body.vy !== 0 || body.vz !== 0)))
      throw new Error('投掷物阶段无效');
    return body;
  });
  return { heldGrenade, bodies, lastThrowableId, stepRemainder };
}
