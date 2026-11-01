import { COMBAT_FEEDBACK as C } from '../combat/CombatFeedbackConfig';
import type { PlayerDamageApplied } from '../combat/PlayerDamage';

interface Glow { age: number; duration: number; peak: number; x: number; y: number; }

/** Nine bounded slots: eight directions and a non-directional status pulse. */
export class DamageFeedbackOverlay {
  private readonly glows = new Map<number, Glow>();
  push(event: PlayerDamageApplied): void {
    if (!(event.appliedAmount > 0)) return;
    const source = event.sourcePosition, target = event.targetPosition;
    const dx = source ? source.x - target.x : 0, dy = source ? source.y - target.y : 0;
    const directed = event.kind !== 'infection' && Math.hypot(dx, dy) > 1e-6;
    const slot = directed ? (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8 : 8;
    const angle = slot * Math.PI / 4;
    const infection = event.kind === 'infection';
    this.glows.set(slot, { age: 0, duration: infection ? C.infectionGlowSeconds : C.meleeGlowSeconds,
      peak: infection ? C.infectionGlowAlpha : directed ? C.meleeGlowAlpha : .22,
      x: directed ? Math.cos(angle) : 0, y: directed ? Math.sin(angle) : 0 });
  }
  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    for (const [slot, glow] of this.glows) { glow.age += delta; if (glow.age >= glow.duration) this.glows.delete(slot); }
  }
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.glows.size || width <= 0 || height <= 0) return;
    const strengths = [0, 0, 0, 0]; // left, right, top, bottom
    for (const glow of this.glows.values()) {
      const alpha = glow.peak * (1 - glow.age / glow.duration) ** 2;
      const weights = glow.x || glow.y ? [Math.max(0, -glow.x), Math.max(0, glow.x), Math.max(0, -glow.y), Math.max(0, glow.y)] : [1, 1, 1, 1];
      for (let i = 0; i < 4; i++) strengths[i] = Math.min(C.meleeGlowAlpha, 1 - (1 - strengths[i]) * (1 - alpha * weights[i]));
    }
    const depth = Math.min(width, height) * .23;
    const edges = [[0, 0, depth, 0], [width, 0, width - depth, 0], [0, 0, 0, depth], [0, height, 0, height - depth]];
    ctx.save();
    for (let i = 0; i < 4; i++) {
      if (strengths[i] <= .001) continue;
      const e = edges[i], gradient = ctx.createLinearGradient(e[0], e[1], e[2], e[3]);
      gradient.addColorStop(0, `rgba(225,16,26,${strengths[i]})`);
      gradient.addColorStop(.35, `rgba(190,5,18,${strengths[i] * .48})`);
      gradient.addColorStop(1, 'rgba(150,0,10,0)');
      ctx.fillStyle = gradient;
      if (i < 2) ctx.fillRect(i === 0 ? 0 : width - depth, 0, depth, height);
      else ctx.fillRect(0, i === 2 ? 0 : height - depth, width, depth);
    }
    ctx.restore();
  }
  snapshot() { return Array.from(this.glows.values(), g => ({ ...g })); }
  clear(): void { this.glows.clear(); }
}
