import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileTypeId } = load('map/TileType');
const { ExplorationGrid } = load('vision/ExplorationGrid');
const { TerrainMemory } = load('vision/TerrainMemory');
const { MinimapTerrainCache } = load('minimap/MinimapTerrainCache');

const TILE_SIZE = 50;
const TILES = 40;
const WORLD = TILES * TILE_SIZE;

function createTerrain() {
  const tiles = Array.from({ length: TILES }, () => Array.from({ length: TILES }, () => TileTypeId.DEFAULT));
  return { tileSize: TILE_SIZE, width: TILES, height: TILES, tiles };
}

/** 只把数据交给小地图，不依赖真实游戏场景。 */
function createWorld(options = {}) {
  const terrain = options.terrain ?? createTerrain();
  const grid = new ExplorationGrid(WORLD, WORLD, 25);
  const memory = new TerrainMemory(terrain);
  for (const [col, row] of options.walls ?? []) terrain.tiles[row][col] = TileTypeId.WALL;
  for (const [col, row] of options.minerals ?? []) terrain.tiles[row][col] = TileTypeId.MINERAL;
  return { terrain, grid, memory };
}

const cellIndex = (grid, col, row) => row * grid.cols + col;

/** 把某个瓦片覆盖的 4 个探索格标记为已探索，返回格索引数组。 */
function exploreTile(grid, tileCol, tileRow) {
  const span = TILE_SIZE / grid.cellSize;
  const startCol = (tileCol * TILE_SIZE) / grid.cellSize;
  const startRow = (tileRow * TILE_SIZE) / grid.cellSize;
  const cells = [];
  for (let row = startRow; row < startRow + span; row++) {
    for (let col = startCol; col < startCol + span; col++) {
      grid.markCell(col, row);
      cells.push(cellIndex(grid, col, row));
    }
  }
  return cells;
}

function exploreCells(grid, startCol, startRow, count) {
  const cells = [];
  for (let row = startRow; row < startRow + count; row++) {
    for (let col = startCol; col < startCol + count; col++) {
      grid.markCell(col, row);
      cells.push(cellIndex(grid, col, row));
    }
  }
  return cells;
}

const cache = () => new MinimapTerrainCache();

function refresh(target, world, center, observed = new Set(), observedRevision = 0) {
  target.refresh({
    memory: world.memory,
    grid: world.grid,
    observed,
    water: world.water,
    centerX: center[0],
    centerY: center[1],
    worldRadius: 200,
  }, observedRevision);
}

test('未探索格一律 unknown，且不会因为缓存里存了地形就泄露', () => {
  const world = createWorld({ walls: [[4, 4]] });
  const terrainCache = cache();
  refresh(terrainCache, world, [500, 500]);
  assert.equal(terrainCache.stateAt(8, 8), 'unknown');
  assert.equal(terrainCache.terrainAt(8, 8), 'ground');
  assert.equal(terrainCache.stateAt(-1, -1), 'unknown');
  assert.equal(terrainCache.terrainAt(999, 999), 'ground');
});

test('已探索瓦片：墙体/矿物来自记忆快照，状态区分 observed 与 remembered', () => {
  const world = createWorld({ walls: [[4, 4]], minerals: [[9, 9]] });
  exploreTile(world.grid, 4, 4);
  const observedCells = new Set([cellIndex(world.grid, 8, 8)]);
  world.memory.capture(4, 4);
  exploreTile(world.grid, 9, 9);
  world.memory.capture(9, 9);

  const terrainCache = cache();
  refresh(terrainCache, world, [350, 350], observedCells);
  // 瓦片 4 覆盖世界 200..250 → 探索格 8、9。
  assert.equal(terrainCache.stateAt(8, 8), 'observed');
  assert.equal(terrainCache.terrainAt(8, 8), 'wall');
  // 同一块瓦片的其余格没有进入观察集合，只能是 remembered。
  assert.equal(terrainCache.stateAt(9, 9), 'remembered');
  // 矿物按记忆识别为可破坏地形。
  assert.equal(terrainCache.terrainAt(18, 18), 'mineral');
  assert.equal(terrainCache.stateAt(18, 18), 'remembered');
});

test('矿石被破坏但没再观察时，小地图保留最后已知状态', () => {
  const world = createWorld({ minerals: [[9, 9]] });
  exploreTile(world.grid, 9, 9);
  world.memory.capture(9, 9);
  const terrainCache = cache();
  refresh(terrainCache, world, [475, 475], new Set());
  assert.equal(terrainCache.terrainAt(18, 18), 'mineral');

  // 真实世界已经变成地面，但玩家不在场：记忆不该被刷新。
  world.terrain.tiles[9][9] = TileTypeId.DEFAULT;
  refresh(terrainCache, world, [475, 475], new Set());
  assert.equal(terrainCache.terrainAt(18, 18), 'mineral', '未观察的变化不泄露到记忆');

  // 玩家再次观察后才刷新。
  world.memory.capture(9, 9);
  refresh(terrainCache, world, [475, 475], new Set());
  assert.equal(terrainCache.terrainAt(18, 18), 'ground');
});

test('水体来自独立几何接口，只有已探索格才显示', () => {
  const world = createWorld();
  world.water = {
    getTypeAt: (x, y) => (x >= 300 && x < 400 && y >= 300 && y < 400 ? TileTypeId.WATER : undefined),
  };
  const terrainCache = cache();
  refresh(terrainCache, world, [500, 500], new Set());
  // 水体所在的探索格还没被探索：不能凭水体几何直接显示。
  assert.equal(terrainCache.stateAt(13, 13), 'unknown');
  assert.equal(terrainCache.terrainAt(13, 13), 'ground');

  exploreCells(world.grid, 12, 12, 3);
  refresh(terrainCache, world, [500, 500], new Set());
  assert.equal(terrainCache.stateAt(12, 12), 'remembered');
  assert.equal(terrainCache.terrainAt(12, 12), 'water');
});

test('离开观察窗口后亮色降级为 remembered，缓存不会长出幽灵亮区', () => {
  const world = createWorld({ walls: [[4, 4]] });
  const observed = new Set(exploreTile(world.grid, 4, 4));
  world.memory.capture(4, 4);
  const terrainCache = cache();
  refresh(terrainCache, world, [225, 225], observed);
  assert.equal(terrainCache.stateAt(8, 8), 'observed');

  // 玩家走远，新窗口不覆盖旧格：旧的当前观察必须降级。
  refresh(terrainCache, world, [1225, 1225], new Set(), 1);
  assert.equal(terrainCache.stateAt(8, 8), 'remembered');
});

test('瞬移时观察状态整体降级，记忆保留', () => {
  const world = createWorld({ walls: [[4, 4]] });
  const observed = new Set(exploreTile(world.grid, 4, 4));
  world.memory.capture(4, 4);
  const terrainCache = cache();
  refresh(terrainCache, world, [225, 225], observed);
  refresh(terrainCache, world, [1825, 1825], new Set(), 1);
  assert.equal(terrainCache.stateAt(8, 8), 'remembered');
  assert.equal(terrainCache.terrainAt(8, 8), 'wall');
});

test('needsRefresh 只在探索/记忆/观察/位置真正变化时为真', () => {
  const world = createWorld();
  const terrainCache = cache();
  const input = {
    memory: world.memory,
    grid: world.grid,
    observed: new Set(),
    centerX: 500,
    centerY: 500,
    worldRadius: 200,
  };
  assert.equal(terrainCache.needsRefresh(input, 0, 50), true, '还没扫过');
  terrainCache.refresh({ ...input, observed: new Set() }, 0);
  assert.equal(terrainCache.needsRefresh(input, 0, 50), false);
  assert.equal(terrainCache.needsRefresh({ ...input, centerX: 560 }, 0, 50), true);
  world.grid.markCell(3, 3);
  assert.equal(terrainCache.needsRefresh(input, 0, 50), true);
  terrainCache.refresh({ ...input, observed: new Set() }, 0);
  assert.equal(terrainCache.needsRefresh(input, 1, 50), true, '观察集合变化需要重扫');
});

test('换地图（新的内存/探索对象）会重建缓存，不沿用上一局地形', () => {
  const first = createWorld({ walls: [[4, 4]] });
  exploreTile(first.grid, 4, 4);
  first.memory.capture(4, 4);
  const terrainCache = cache();
  refresh(terrainCache, first, [225, 225]);
  assert.equal(terrainCache.terrainAt(8, 8), 'wall');

  const second = createWorld();
  refresh(terrainCache, second, [225, 225]);
  assert.equal(terrainCache.terrainAt(8, 8), 'ground');
});
