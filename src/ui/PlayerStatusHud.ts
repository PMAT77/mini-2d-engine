import type { SurvivalSnapshot } from '../survival/PlayerSurvivalSystem';
import type { Rect } from './HudTypes';
export function getPlayerStatusHudRect(width: number, height: number, weaponArea: Rect): Rect {
  const narrow = width < 650, w = Math.max(0, Math.min(narrow ? width - 24 : 260, width - 24)), h = narrow ? 28 : 48;
  return { x: Math.max(12, width - w - 22), y: Math.max(8, Math.min(height - h - 12, narrow ? height - h - 12 : weaponArea.y + weaponArea.height + 10)), width: w, height: h };
}
/** Read-only status presentation: state and mutations belong to survival. */
export class PlayerStatusHud {
  draw(ctx: CanvasRenderingContext2D, status: SurvivalSnapshot, width: number, height: number, weaponArea: Rect): void {
    const r = getPlayerStatusHudRect(width, height, weaponArea), narrow = width < 650;
    ctx.save(); ctx.fillStyle = 'rgba(9,19,21,.82)'; ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '12px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = status.infected ? '#ed998d' : '#b6d6c6';
    const infection = status.infected ? '感染中 · 1 HP/s' : '未感染';
    if (narrow) ctx.fillText(`${infection}  ·  疫苗 ${status.vaccines}  ·  V 治疗`, r.x + 10, r.y + 14, Math.max(0, r.width - 20));
    else {
      ctx.fillText(infection, r.x + 12, r.y + 13);
      ctx.fillStyle = '#d1e6e3'; ctx.fillText(`疫苗 ${status.vaccines}     [V] 治疗感染`, r.x + 12, r.y + 34);
    }
    ctx.restore();
  }
}
