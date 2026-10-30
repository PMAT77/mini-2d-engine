import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeMap, load, makeLight, makeObserver, makeTarget, makeTerrain, setTile } from './vision-helpers.mjs';

const { PerceptionSystem } = load('vision/PerceptionSystem');
const { createVisionRules } = load('vision/VisionRules');
const { MEMORY_TILE_ORDER } = load('vision/TerrainMemory');

const newSystem = (map, terrain = makeTerrain()) => new PerceptionSystem({ map, terrain, rules: createVisionRules() });

test('墙后近身不可见，墙外近身显示剪影', () => {
  const map = new FakeMap([{ x: 100, y: 0, w: 20, h: 300 }]);
  const system = newSystem(map);
  const observer = makeObserver('p', 50, 150);
  const near = makeTarget('near', 60, 80);
  const behind = makeTarget('behind', 130, 150);

  system.update(1 / 60, [observer], [], [near, behind]);

  assert.equal(system.getView('p', 'near').level, 'silhouette');
  assert.equal(system.getView('p', 'behind').level, 'hidden');
});

test('有效照明 dwell 后辨识，关灯后淡出再隐藏', () => {
  const map = new FakeMap();
  const system = newSystem(map);
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('lit', 200, 150);
  const light = makeLight('flashlight', 200, 100);

  system.update(0.05, [observer], [light], [target]);
  assert.equal(system.getView('p', 'lit').level, 'silhouette');

  system.update(0.1, [observer], [light], [target]);
  assert.equal(system.getView('p', 'lit').level, 'identified');

  const off = { ...light, active: false };
  system.update(0.1, [observer], [off], [target]);
  const fading = system.getView('p', 'lit');
  assert.equal(fading.level, 'identified');
  assert.ok(Math.abs(fading.alpha - 0.6) < 1e-6);

  system.update(0.2, [observer], [off], [target]);
  assert.equal(system.getView('p', 'lit').level, 'hidden');
});

test('墙遮挡是立即隐藏，不走淡出', () => {
  const map = new FakeMap();
  const system = newSystem(map);
  const observer = makeObserver('p', 50, 150);
  const target = makeTarget('t', 200, 150);
  const light = makeLight('l', 200, 100);

  system.update(0.05, [observer], [light], [target]);
  system.update(0.1, [observer], [light], [target]);
  assert.equal(system.getView('p', 't').level, 'identified');

  map.add({ x: 100, y: 0, w: 20, h: 300 });
  system.update(0.01, [observer], [light], [target]);
  assert.equal(system.getView('p', 't').level, 'hidden');
});

test('近距离目标在关灯后回落到剪影', () => {
  const map = new FakeMap();
  const system = newSystem(map);
  const observer = makeObserver('p', 60, 150);
  const target = makeTarget('t', 120, 150);
  const light = makeLight('l', 120, 100);

  system.update(0.05, [observer], [light], [target]);
  system.update(0.1, [observer], [light], [target]);
  assert.equal(system.getView('p', 't').level, 'identified');

  const off = { ...light, active: false };
  system.update(0.1, [observer], [off], [target]);
  assert.equal(system.getView('p', 't').level, 'identified');
  system.update(0.3, [observer], [off], [target]);
  assert.equal(system.getView('p', 't').level, 'silhouette');
});

test('多观察者共享光源但独立 LOS/辨识', () => {
  const map = new FakeMap([{ x: 100, y: 0, w: 20, h: 300 }]);
  const system = newSystem(map);
  const a = makeObserver('a', 50, 150);
  const b = makeObserver('b', 250, 150);
  const target = makeTarget('m', 200, 150);
  const light = makeLight('l', 200, 100);

  system.update(0.05, [a, b], [light], [target]);
  system.update(0.1, [a, b], [light], [target]);

  assert.equal(system.getView('a', 'm').level, 'hidden');
  assert.equal(system.getView('b', 'm').level, 'identified');
});

test('剔除半径包含最大观察范围与光源半径', () => {
  const system = newSystem(new FakeMap());
  const observer = makeObserver('p', 0, 0);
  system.update(0, [observer], [], []);
  assert.equal(system.getCullingRadius('p'), 514);

  const big = makeLight('big', 0, 0, { radius: 600 });
  system.update(0, [observer], [big], []);
  assert.equal(system.getCullingRadius('p'), 664);
});

test('探索记忆保留旧地形，重新观察才更新', () => {
  const terrain = makeTerrain();
  setTile(terrain, 1, 1, 'mineral', 100);
  const system = newSystem(new FakeMap(), terrain);
  const observer = makeObserver('p', 50, 50);
  const mineralIndex = MEMORY_TILE_ORDER.indexOf('mineral');

  system.update(0.3, [observer], [], []);
  assert.equal(system.getTerrainRecall('p', 50, 50), 'observed');
  const grid = system.getExplorationGrid('p');
  const memory = system.getTerrainMemory('p');
  assert.ok(grid);
  assert.ok(memory);
  assert.ok(grid.isExplored(50, 50));
  assert.equal(memory.get(1, 1).typeIndex, mineralIndex);

  setTile(terrain, 1, 1, 'default', 100);
  const far = makeObserver('p', 1200, 1200);
  system.update(0.3, [far], [], []);
  assert.equal(system.getTerrainRecall('p', 50, 50), 'remembered');
  assert.equal(memory.get(1, 1).typeIndex, mineralIndex);

  const back = makeObserver('p', 50, 50);
  system.update(0.3, [back], [], []);
  assert.equal(system.getTerrainRecall('p', 50, 50), 'observed');
  assert.equal(memory.get(1, 1).typeIndex, MEMORY_TILE_ORDER.indexOf('default'));
});

test('prune 与 removeObserver 清理状态', () => {
  const system = newSystem(new FakeMap());
  const observer = makeObserver('p', 50, 50);
  const target = makeTarget('t', 60, 60);
  system.update(0.1, [observer], [], [target]);
  assert.notEqual(system.getView('p', 't').level, 'hidden');

  system.prune(new Set());
  assert.equal(system.getView('p', 't').level, 'hidden');

  system.removeObserver('p');
  assert.equal(system.getView('p', 't').level, 'hidden');
  assert.equal(system.getExplorationGrid('p'), null);
  assert.equal(system.getTerrainMemory('p'), null);
});

test('canIdentify 点查询跟随最近一次 update 的光源', () => {
  const map = new FakeMap();
  const system = newSystem(map);
  const observer = makeObserver('p', 50, 150);
  const light = makeLight('l', 200, 100);

  system.update(0.01, [observer], [light], []);
  assert.equal(system.canIdentify('p', 200, 150), true);

  system.update(0.01, [observer], [], []);
  assert.equal(system.canIdentify('p', 200, 150), false);
});
