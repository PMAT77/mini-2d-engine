import type { Bounds } from '../physics/Collider';
import type { LifeState } from '../combat/CombatTypes';
import type { ZombieKind } from './ZombieConfig';
export interface ZombiePose { x: number; y: number; size: number; facing: number; kind: ZombieKind; phase: number; speed: number; hit: number; attack: number; life: LifeState; }

export class ZombieRenderer {
  static bounds(p: ZombiePose): Bounds { const pad = p.size * .4; return { x: p.x - pad, y: p.y - pad, width: p.size + 2 * pad, height: p.size + 2 * pad }; }
  static draw(ctx: CanvasRenderingContext2D, p: ZombiePose, ox = 0, oy = 0, silhouette = false): void {
    if (p.life === 'removed') return;
    const s = p.size, stride = Math.sin(p.phase) * Math.min(1, p.speed / 60), runner = p.kind === 'runner';
    ctx.save(); ctx.translate(p.x + s / 2 - ox, p.y + s / 2 - oy); ctx.rotate(p.facing);
    ctx.scale(1 + p.hit * .1, 1 - p.hit * .1);
    const skin = silhouette ? '#fff' : runner ? '#a9ae85' : '#94a67a';
    const cloth = silhouette ? '#fff' : runner ? '#8a4444' : '#405e5a';
    const limb = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x * s, y * s, w * s, h * s); };
    limb(-.38 + stride * .04, -.24, .38, .17, silhouette ? '#fff' : '#303a38');
    limb(-.38 - stride * .04, .08, .38, .17, silhouette ? '#fff' : '#303a38');
    limb(-.23, runner ? -.25 : -.31, .51, runner ? .50 : .62, cloth);
    const reach = p.attack * .2;
    limb(.05 + reach, -.39 + stride * .035, .49, .13, skin);
    limb(.12 + reach, .25 - stride * .035, .44, .13, skin);
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(.25 * s, 0, .23 * s, 0, Math.PI * 2); ctx.fill();
    if (!silhouette) {
      limb(.35, -.13, .07, .07, '#362922'); limb(.35, .07, .07, .07, '#362922');
      limb(.25, .15, .13, .06, '#733b3d');
      if (runner) { limb(-.18, -.24, .14, .48, '#ad8c70'); }
    }
    ctx.restore();
  }
  static shadow(ctx: CanvasRenderingContext2D, p: ZombiePose, ox = 0, oy = 0): void {
    if (p.life === 'removed') return;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.beginPath();
    ctx.ellipse(p.x + p.size / 2 - ox, p.y + p.size / 2 + 3 - oy, p.size * .6, p.size * .4, p.facing, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
