export type ThrowableId = 'grenade' | 'smokeGrenade';
export const THROWABLE_IDS: readonly ThrowableId[] = ['grenade', 'smokeGrenade'];
export function isThrowable(id: string | null | undefined): id is ThrowableId { return id === 'grenade' || id === 'smokeGrenade'; }
export const THROWABLE_CONFIG = Object.freeze({
  radius: 6, gravity: 1000, maxDistance: 450, releaseHeight: 20, step: 1 / 120,
  groundBounce: .35, wallBounce: .55, groundRetention: .65, friction: 4, waterFriction: 12,
  fuse: 4, blastRadius: 180, fullDamageRadius: 40, damage: 120, impulse: 500,
  smokeRadius: 180, smokeGrow: 1, smokeHold: 10, smokeFade: 3, smokeNear: 70,
  spawnCount: 2,
});
export const THROWABLE_ITEMS = Object.freeze({
  grenade: { name: '手雷', weight: .4, asset: 'grenade' },
  smokeGrenade: { name: '烟雾弹', weight: .3, asset: 'smoke-grenade' },
});
export function blastDamage(distance: number): number {
  const c = THROWABLE_CONFIG;
  return Math.max(0, c.damage * Math.min(1, (c.blastRadius - distance) / (c.blastRadius - c.fullDamageRadius)));
}
