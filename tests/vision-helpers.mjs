import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

/** 矩形挡光地图：只实现 SightMap 需要的两个查询，避免 Node 测试依赖 Canvas/TileMap。 */
export class FakeMap {
  constructor(rects = []) {
    this.rects = rects.map(rect => ({ ...rect }));
  }

  add(rect) {
    this.rects.push({ ...rect });
    return this;
  }

  clear() {
    this.rects.length = 0;
  }

  blocksLightAt(x, y) {
    return this.rects.some(rect => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
  }

  getBlockingPolygons() {
    return this.rects.map(rect => ({
      type: 'polygon',
      vertices: [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h },
        { x: rect.x, y: rect.y + rect.h }
      ],
      edges: [true, true, true, true],
      terrain: true
    }));
  }
}

export function makeTerrain(width = 40, height = 40, tileSize = 50) {
  return {
    tileSize,
    width,
    height,
    tiles: Array.from({ length: height }, () => Array(width).fill('default')),
    tileHp: Array.from({ length: height }, () => Array(width).fill(100))
  };
}

export function setTile(terrain, col, row, type, hp = 100) {
  terrain.tiles[row][col] = type;
  terrain.tileHp[row][col] = hp;
}

export function makeObserver(id = 'player', x = 0, y = 0, overrides = {}) {
  return {
    id,
    x,
    y,
    facing: 0,
    nearSenseRadius: 100,
    maxObservationRange: 450,
    ...overrides
  };
}

export function makeTarget(id, x, y, overrides = {}) {
  return {
    id,
    category: 'enemy',
    x,
    y,
    bounds: { x: x - 10, y: y - 10, width: 20, height: 20 },
    ...overrides
  };
}

export function makeLight(id, x, y, overrides = {}) {
  return {
    id,
    x,
    y,
    radius: 100,
    intensity: 1,
    active: true,
    revealsDetails: true,
    kind: 'torch',
    ...overrides
  };
}
