import { LightSource } from '../core/LightSource';
import { TileMap } from '../map/TileMap';
import { TileTypeId } from '../map/TileType';
import { Vector2 } from '../math/Vector2';
import { rectangleCollider } from '../physics/Collider';

/** 永久的可穿行装饰：只绘制和发光，不注册碰撞体或生命值。 */
export class Torch {
  readonly light: LightSource;
  private time: number;

  constructor(readonly x: number, readonly y: number, phase = 0) {
    this.time = phase;
    this.light = new LightSource(new Vector2(x, y), 180, '#FFAD55', 1, 4);
    this.light.groundOnly = true;
  }

  /** 只贴着墙放：以瓦片计，2 格内必须有墙体，火把才不会孤零零立在旷野。 */
  private static nearWall(map: TileMap, x: number, y: number, radius = 2): boolean {
    const col = Math.floor(x / map.tileSize), row = Math.floor(y / map.tileSize);
    for (let r = Math.max(0, row - radius); r <= Math.min(map.height - 1, row + radius); r++) {
      for (let c = Math.max(0, col - radius); c <= Math.min(map.width - 1, col + radius); c++) {
        if (map.tiles[r][c] === TileTypeId.WALL) return true;
      }
    }
    return false;
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
        if (!Torch.nearWall(map, x, y) || !map.isShapeWalkable(footprint) || map.getShapeSpeedFactor(footprint) < 1
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
    if (x < -20 || y < -25 || x > ctx.canvas.width + 20 || y > ctx.canvas.height + 25) return;
    ctx.save();

    // 俯视阴影紧贴脚下，不再向侧面拖出侧视火炬的长影。
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath(); ctx.ellipse(x + 1, y + 8, 8, 3, 0, 0, Math.PI * 2); ctx.fill();

    // 从上往下只能看到火焰下方一小截木柄和顶部铁箍，看不到长木杆。
    ctx.fillStyle = '#654029'; ctx.fillRect(x - 3, y + 1, 6, 8);
    ctx.fillStyle = '#A57743'; ctx.fillRect(x - 3, y + 1, 2, 8);
    ctx.fillStyle = '#36383D';
    ctx.beginPath(); ctx.ellipse(x, y + 1, 4.5, 1.8, 0, 0, Math.PI * 2); ctx.fill();

    // 火焰俯视是一团短圆火苗：轮廓没有向上的尖，避免再出现侧视的高火舌。
    const sway = Math.sin(this.time * 7) * 1.2;
    const breathe = 1 + Math.sin(this.time * 11) * 0.05;
    ctx.translate(x + sway * 0.25, y - 1);
    ctx.scale(breathe, breathe);
    const glow = ctx.createRadialGradient(sway * 0.2, 1, 0.5, 0, 1, 8.5);
    glow.addColorStop(0, '#FFF3C4');
    glow.addColorStop(0.32, '#FFD36A');
    glow.addColorStop(0.62, '#FF9A35');
    glow.addColorStop(0.86, '#F0641D');
    glow.addColorStop(1, '#D24610');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(-6.8, -2.5);
    ctx.bezierCurveTo(-7.6, -5.6, -5.6, -7.4, -3.4, -6.8);
    ctx.bezierCurveTo(-2, -8.2, 0.4, -8.4, 1.8, -7);
    ctx.bezierCurveTo(4.2, -7.8, 6.4, -5.8, 6.5, -3.4);
    ctx.bezierCurveTo(8.4, -1.2, 8, 2.2, 5.6, 4.2);
    ctx.bezierCurveTo(3, 6.2, -2.8, 6.4, -5.4, 4.4);
    ctx.bezierCurveTo(-7.8, 2.2, -8.2, -0.4, -6.8, -2.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
