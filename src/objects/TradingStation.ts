import { rectangleCollider } from '../physics/Collider';
import { appendDirectionalShadow, type DirectionalLight } from '../core/DirectionalShadow';

export const TRADING_STATION_ASSET = '/assets/images/world/trading-station.png';
export class TradingStation {
  private image?: HTMLImageElement;
  constructor(readonly id: string, readonly x: number, readonly y: number) {}
  getCollider() { return rectangleCollider(this.x - 22, this.y - 12, 44, 24); }
  drawSunShadow(ctx: CanvasRenderingContext2D, ox: number, oy: number, light: DirectionalLight): void {
    if (light.intensity <= 0) return;
    const x = this.x - ox, y = this.y - oy;
    ctx.save(); ctx.globalAlpha *= light.shadowOpacity * Math.min(.48, light.intensity * 1.1); ctx.fillStyle = '#263544'; ctx.beginPath();
    appendDirectionalShadow(ctx, { ax: x + 22, ay: y - 12, bx: x + 22, by: y + 12 }, light.direction, light.shadowLength * 1.2);
    appendDirectionalShadow(ctx, { ax: x + 22, ay: y + 12, bx: x - 22, by: y + 12 }, light.direction, light.shadowLength * 1.2);
    ctx.fill(); ctx.restore();
  }
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (!this.image && typeof Image !== 'undefined') { this.image = new Image(); this.image.src = TRADING_STATION_ASSET; }
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(this.x - ox, this.y - oy, 29, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (this.image?.complete && this.image.naturalWidth) ctx.drawImage(this.image, this.x - ox - 38, this.y - oy - 76, 76, 84);
    ctx.restore();
  }
}
