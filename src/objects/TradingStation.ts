import { rectangleCollider } from '../physics/Collider';

export const TRADING_STATION_ASSET = '/assets/images/world/trading-station.png';
export class TradingStation {
  private image?: HTMLImageElement;
  constructor(readonly id: string, readonly x: number, readonly y: number) {}
  getCollider() { return rectangleCollider(this.x - 22, this.y - 12, 44, 24); }
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (!this.image && typeof Image !== 'undefined') { this.image = new Image(); this.image.src = TRADING_STATION_ASSET; }
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(this.x - ox, this.y - oy, 29, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (this.image?.complete && this.image.naturalWidth) ctx.drawImage(this.image, this.x - ox - 38, this.y - oy - 76, 76, 84);
    ctx.restore();
  }
}
