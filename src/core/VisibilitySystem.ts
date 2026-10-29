import { LightingSystem } from './LightingSystem';
import type { TileMap } from '../map/TileMap';

export interface VisionState {
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly angle: number;
  readonly range: number;
}

/** Current line of sight only: lighting never reveals a hidden part of the world. */
export class VisibilitySystem {
  private canvas?: HTMLCanvasElement;

  initialize(width: number, height: number): void {
    this.canvas ??= document.createElement('canvas');
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  apply(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, vision: VisionState,
    map: TileMap, drawPlayerSilhouette: (mask: CanvasRenderingContext2D) => void): void {
    this.initialize(ctx.canvas.width, ctx.canvas.height);
    const canvas = this.canvas!, mask = canvas.getContext('2d')!;
    const { x, y, direction, angle, range } = vision;
    mask.setTransform(1, 0, 0, 1, 0, 0);
    mask.globalCompositeOperation = 'source-over';
    mask.clearRect(0, 0, canvas.width, canvas.height);
    mask.save();
    mask.translate(-cameraX, -cameraY);
    if (!map.blocksLightAt(x, y)) {
      const radial = mask.createRadialGradient(x, y, Math.max(0, range - 24), x, y, range);
      radial.addColorStop(0, 'white'); radial.addColorStop(1, 'rgba(255,255,255,0)');
      mask.fillStyle = radial;
      mask.beginPath(); mask.moveTo(x, y);
      mask.arc(x, y, range, direction - angle / 2, direction + angle / 2);
      mask.closePath(); mask.fill();
      const angular = mask.createConicGradient(direction - angle / 2, x, y);
      const turn = Math.PI * 2, feather = Math.min(angle / 2, Math.PI / 60);
      angular.addColorStop(0, 'rgba(255,255,255,0)');
      angular.addColorStop(feather / turn, 'white');
      angular.addColorStop((angle - feather) / turn, 'white');
      angular.addColorStop(angle / turn, 'rgba(255,255,255,0)');
      angular.addColorStop(1, 'rgba(255,255,255,0)');
      mask.globalCompositeOperation = 'destination-in'; mask.fillStyle = angular;
      mask.fillRect(cameraX, cameraY, canvas.width, canvas.height);
      mask.globalCompositeOperation = 'destination-out'; mask.fillStyle = 'black';
      // Do not protect all terrain tops here: a second wall behind the first is also hidden.
      LightingSystem.drawShadows(mask, map.getShadowEdges(x, y, range), x, y, range);
    }
    mask.restore();
    mask.globalCompositeOperation = 'destination-over';
    mask.fillStyle = '#080808'; mask.fillRect(0, 0, canvas.width, canvas.height);
    mask.globalCompositeOperation = 'source-over';
    drawPlayerSilhouette(mask);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(canvas, 0, 0); ctx.restore();
  }
}
