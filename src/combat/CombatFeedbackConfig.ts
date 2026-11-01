/** Presentation uses game time and its own random stream; none of these values affect damage. */
export const COMBAT_FEEDBACK = Object.freeze({
  flashHold: .06, flashFade: .08,
  meleeGlowSeconds: .45, meleeGlowAlpha: .55,
  infectionGlowSeconds: .25, infectionGlowAlpha: .12,
  damageKick: 3, damageKickSeconds: .10,
  fragmentsPerDeath: 6, maxFlyingFragments: 256, groundCellSize: 256,
});

export function hitFlashAlpha(age: number): number {
  return Math.max(0, Math.min(1, 1 - (age - COMBAT_FEEDBACK.flashHold) / COMBAT_FEEDBACK.flashFade));
}
