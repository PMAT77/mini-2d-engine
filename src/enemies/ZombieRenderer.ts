import type { Bounds } from '../physics/Collider';
import type { LifeState } from '../combat/CombatTypes';
import type { ZombieKind } from './ZombieConfig';
import type { AttackPose } from './MeleeAttackController';
import { blendColorWithWhite } from '../utils/colorUtils';

export interface ZombiePose {
  x: number; y: number; size: number; facing: number; kind: ZombieKind;
  phase: number; speed: number; hit: number; flash: number; attack: Readonly<AttackPose>; life: LifeState;
}
export interface ZombiePart {
  kind: 'head' | 'torso' | 'arm' | 'leg'; x: number; y: number; angle: number;
  width: number; height: number; color: string;
}

export class ZombieRenderer {
  /** The same six posed parts are used for drawing and dismemberment. All coordinates are world-space. */
  static parts(p: ZombiePose): ZombiePart[] {
    const s = p.size, a = p.attack, runner = p.kind === 'runner';
    const stride = Math.sin(p.phase) * Math.min(1, p.speed / 60);
    const lean = (-.10 * a.coil + (runner ? .33 : .28) * a.strike) * a.weight;
    const twist = a.hand * (-.22 * a.coil + .40 * a.strike) * a.weight;
    const cos = Math.cos(p.facing), sin = Math.sin(p.facing), cx = p.x + s / 2, cy = p.y + s / 2;
    const sx = 1 + p.hit * .1, sy = 1 - p.hit * .1;
    const part = (kind: ZombiePart['kind'], x: number, y: number, w: number, h: number, angle: number, color: string): ZombiePart => ({
      kind, x: cx + x * s * sx * cos - y * s * sy * sin, y: cy + x * s * sx * sin + y * s * sy * cos,
      width: w * s * sx, height: h * s * sy, angle: p.facing + angle, color,
    });
    const skin = runner ? '#a9ae85' : '#94a67a', cloth = runner ? '#8a4444' : '#405e5a';
    const parts = [part('leg', -.19 + stride * .04, -.16, .38, .17, -.08 * stride, '#303a38'),
      part('leg', -.19 - stride * .04, .16, .38, .17, .08 * stride, '#303a38'),
      part('torso', .025 + lean, 0, .51, runner ? .5 : .62, twist, cloth)];
    for (const side of [-1, 1]) {
      const active = side === a.hand;
      const angle = active ? side * ((runner ? 1.05 : 1.55) * a.coil - (runner ? 1.10 : 1.90) * a.strike) * a.weight : -side * .16 * a.coil * a.weight;
      const length = .48 + (active ? .27 : .08) * a.strike * a.weight;
      parts.push(part('arm', .06 + lean + Math.cos(angle) * length / 2, side * .30 + Math.sin(angle) * length / 2 + stride * .025 * side,
        length, .13, angle, skin));
    }
    parts.push(part('head', .25 + lean, twist * .10, .46, .46, twist * .5, skin));
    return parts;
  }

  static bounds(p: ZombiePose): Bounds {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const part of this.parts(p)) {
      const c = Math.abs(Math.cos(part.angle)), s = Math.abs(Math.sin(part.angle));
      const w = (part.width * c + part.height * s) / 2 + 2, h = (part.width * s + part.height * c) / 2 + 2;
      left = Math.min(left, part.x - w); right = Math.max(right, part.x + w);
      top = Math.min(top, part.y - h); bottom = Math.max(bottom, part.y + h);
    }
    if (p.attack.trail > 0) {
      const r = p.size * 1.2, x = p.x + p.size / 2, y = p.y + p.size / 2;
      left = Math.min(left, x - r); right = Math.max(right, x + r); top = Math.min(top, y - r); bottom = Math.max(bottom, y + r);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  static drawPart(ctx: CanvasRenderingContext2D, part: ZombiePart, ox: number, oy: number, flash = 0, silhouette = false): void {
    ctx.save(); ctx.translate(part.x - ox, part.y - oy); ctx.rotate(part.angle);
    ctx.fillStyle = silhouette ? '#fff' : flash > 0 ? blendColorWithWhite(part.color, flash) : part.color;
    if (part.kind === 'head') { ctx.beginPath(); ctx.ellipse(0, 0, part.width / 2, part.height / 2, 0, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-part.width / 2, -part.height / 2, part.width, part.height);
    if (!silhouette && flash < 1 && part.kind === 'head') {
      ctx.fillStyle = blendColorWithWhite('#362922', flash);
      ctx.fillRect(part.width * .18, -part.height * .28, part.width * .15, part.height * .15);
      ctx.fillRect(part.width * .18, part.height * .13, part.width * .15, part.height * .15);
      ctx.fillStyle = blendColorWithWhite('#733b3d', flash); ctx.fillRect(part.width * .03, part.height * .31, part.width * .28, part.height * .12);
    }
    ctx.restore();
  }

  static draw(ctx: CanvasRenderingContext2D, p: ZombiePose, ox = 0, oy = 0, silhouette = false): void {
    if (p.life === 'removed') return;
    if (!silhouette && p.attack.trail > 0) {
      ctx.save(); ctx.translate(p.x + p.size / 2 - ox, p.y + p.size / 2 - oy); ctx.rotate(p.facing);
      ctx.globalAlpha *= p.attack.trail; ctx.strokeStyle = 'rgba(233,214,186,.65)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, p.size * 1.10, -.75, .75); ctx.stroke();
      ctx.strokeStyle = 'rgba(233,214,186,.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, p.size * .95, -.90, .90); ctx.stroke(); ctx.restore();
    }
    for (const part of this.parts(p)) this.drawPart(ctx, part, ox, oy, p.flash, silhouette);
  }

  static shadow(ctx: CanvasRenderingContext2D, p: ZombiePose, ox = 0, oy = 0): void {
    if (p.life === 'removed') return;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.beginPath();
    ctx.ellipse(p.x + p.size / 2 - ox, p.y + p.size / 2 + 3 - oy, p.size * .6, p.size * .4, p.facing, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
