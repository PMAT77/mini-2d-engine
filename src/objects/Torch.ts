import { LightSource } from '../core/LightSource';
import { TileMap } from '../map/TileMap';
import { Vector2 } from '../math/Vector2';
import { rectangleCollider } from '../physics/Collider';

/** 永久的可穿行装饰：只绘制和发光，不注册碰撞体或生命值。 */
export class Torch {
  readonly light: LightSource;
  private time: number;

  constructor(readonly x: number, readonly y: number, phase = 0) {
    this.time = phase;
    this.light = new LightSource(new Vector2(x, y), 180, '#FFAD55', 1, 4);
    this.light.shadowTerrain = true;
  }

  static generate(map: TileMap, random: () => number = Math.random): Torch[] {
    const torches: Torch[] = [];
    // 每个 20×20 瓦片区域至多一支，约为原来四分之一的密度。
    const step = map.tileSize * 20;
    const width = map.width * map.tileSize, height = map.height * map.tileSize;
    for (let top = 0; top < height; top += step) for (let left = 0; left < width; left += step) {
      if (random() > 0.8) continue;
      const w = Math.min(step, width - left), h = Math.min(step, height - top);
      if (w < 50 || h < 50) continue;
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = left + 25 + random() * (w - 50), y = top + 25 + random() * (h - 50);
        const footprint = rectangleCollider(x - 14, y - 18, 28, 42);
        if (!map.isShapeWalkable(footprint) || map.getShapeSpeedFactor(footprint) < 1
          || torches.some(torch => Math.hypot(torch.x - x, torch.y - y) < 320)) continue;
        torches.push(new Torch(x, y, random() * Math.PI * 2));
        break;
      }
    }
    return torches;
  }

  update(delta: number): void {
    this.time += delta;
    // 两个慢周期叠出偶发阵风，平方包络让光源平滑起伏、归位。
    const gust = Math.max(0, (Math.sin(this.time * 0.9) + Math.sin(this.time * 1.7) * 0.35 - 0.6) / 0.75);
    this.light.getPosition().set(
      this.x + Math.sin(this.time * 3.1) * 3 * gust * gust,
      this.y + Math.sin(this.time * 2.3) * 1.5 * gust * gust,
    );
    this.light.setIntensity(0.95 + Math.sin(this.time * 7) * 0.035 + Math.sin(this.time * 13) * 0.015);
  }

  draw(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
    const x = this.x - cameraX, y = this.y - cameraY;
    if (x < -20 || y < -30 || x > ctx.canvas.width + 20 || y > ctx.canvas.height + 30) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 20, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#654029'; ctx.fillRect(x - 3, y + 3, 6, 18);
    ctx.fillStyle = '#A57743'; ctx.fillRect(x - 2, y + 3, 2, 17);
    ctx.fillStyle = '#36383D'; ctx.fillRect(x - 6, y + 2, 12, 5);
    const sway = Math.sin(this.time * 7) * 1.5;
    const height = 13 + Math.sin(this.time * 11) * 2;
    ctx.fillStyle = '#FF792B';
    ctx.beginPath(); ctx.moveTo(x, y + 5);
    ctx.bezierCurveTo(x - 11, y + 1, x - 5, y - 7, x + sway, y - height);
    ctx.bezierCurveTo(x + 2, y - 5, x + 10, y + 2, x, y + 5); ctx.fill();
    ctx.fillStyle = '#FFF0A4';
    ctx.beginPath(); ctx.moveTo(x, y + 4);
    ctx.quadraticCurveTo(x - 5, y + 1, x + sway / 2, y - 6);
    ctx.quadraticCurveTo(x + 5, y + 2, x, y + 4); ctx.fill();
    ctx.restore();
  }
}
