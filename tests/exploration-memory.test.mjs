import test from 'node:test';
import assert from 'node:assert/strict';
import { load, makeTerrain, setTile } from './vision-helpers.mjs';

const { ExplorationGrid } = load('vision/ExplorationGrid');
const { TerrainMemory, MEMORY_TILE_ORDER, MEMORY_UNKNOWN_TILE } = load('vision/TerrainMemory');

test('ExplorationGrid 以 25px 格记录探索覆盖', () => {
  const grid = new ExplorationGrid(1000, 1000, 25);
  assert.equal(grid.cols, 40);
  assert.equal(grid.rows, 40);
  assert.equal(grid.exploredCount, 0);

  assert.equal(grid.isExplored(0, 0), false);
  assert.equal(grid.markExplored(10, 10), true);
  assert.equal(grid.markExplored(10, 10), false);
  assert.equal(grid.isExplored(10, 10), true);
  assert.equal(grid.isExplored(24.9, 24.9), true);
  assert.equal(grid.isExplored(25, 25), false);
  assert.equal(grid.revision, 1);
  assert.equal(grid.exploredCount, 1);

  grid.clear();
  assert.equal(grid.exploredCount, 0);
  assert.equal(grid.isExplored(10, 10), false);
  assert.equal(grid.isExplored(-1, 0), false);
  assert.equal(grid.isExplored(Number.NaN, 0), false);
});

test('ExplorationGrid 半瓦片裁剪：只覆盖被标记的 25px 格', () => {
  const grid = new ExplorationGrid(1000, 1000, 25);
  grid.markCell(2, 2);
  assert.equal(grid.isExplored(60, 60), true);
  assert.equal(grid.isExplored(90, 90), false);
  assert.equal(grid.markCell(2, 2), false);
});

test('TerrainMemory 记录瓦片类型与损伤档，未观察不编造', () => {
  const terrain = makeTerrain(4, 4, 50);
  setTile(terrain, 1, 1, 'wall', 100);
  const memory = new TerrainMemory(terrain);
  const wallIndex = MEMORY_TILE_ORDER.indexOf('wall');

  assert.equal(memory.get(0, 0), null);
  assert.equal(memory.isCaptured(1, 1), false);
  assert.equal(memory.capture(1, 1), true);
  assert.deepEqual(memory.get(1, 1), { typeIndex: wallIndex, damageStage: 0 });
  assert.equal(memory.capture(1, 1), false);

  setTile(terrain, 1, 1, 'wall', 40);
  assert.equal(memory.capture(1, 1), true);
  assert.equal(memory.get(1, 1).damageStage, 2);

  setTile(terrain, 1, 1, 'wall', 0);
  assert.equal(memory.capture(1, 1), true);
  assert.equal(memory.get(1, 1).damageStage, 3);

  setTile(terrain, 1, 1, 'default', 100);
  assert.equal(memory.capture(1, 1), true);
  assert.deepEqual(memory.get(1, 1), { typeIndex: 0, damageStage: 0 });
  assert.equal(memory.get(-1, 0), null);
  assert.equal(memory.capture(4, 0), false);
});

test('TerrainMemory 支持世界坐标捕获与水域类型', () => {
  const terrain = makeTerrain(4, 4, 50);
  setTile(terrain, 2, 2, 'water', 100);
  const memory = new TerrainMemory(terrain);

  assert.equal(memory.captureWorld(125, 125), true);
  assert.equal(memory.get(2, 2).typeIndex, MEMORY_TILE_ORDER.indexOf('water'));
  assert.equal(memory.captureWorld(9999, 9999), false);
});

test('记忆类型表稳定，未知类型不冒充地形', () => {
  assert.equal(MEMORY_TILE_ORDER.length, 12);
  assert.equal(MEMORY_TILE_ORDER[0], 'default');
  assert.equal(MEMORY_TILE_ORDER[1], 'water');
  assert.equal(MEMORY_UNKNOWN_TILE, 255);
});
