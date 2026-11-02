import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './vision-helpers.mjs';
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');
const { hasLineOfSight } = load('vision/SightGeometry');
const { TerrainMemory } = load('vision/TerrainMemory');
const { PerceptionRenderer } = load('vision/PerceptionRenderer');
const { DEFAULT_VISION_RULES } = load('vision/VisionRules');
const { DEFAULT_GRAPHICS_CONFIG } = load('core/GraphicsConfig');
const { collectMineralMarkers } = load('minimap/MinimapMarkerSources');
const { circleCollider } = load('physics/Collider');
const { castCollider } = load('physics/Motion');

test('analytic actor sweeps stop fast circles and allow tangential or separating movement', () => {
  const obstacle = { collider: circleCollider(100, 100, 20), col: -1, row: -1 };
  const world = { getCollisionObstacles: () => [obstacle] };
  const hit = castCollider(world, circleCollider(0, 100, 10), { x: 200, y: 0 });
  assert.ok(Math.abs(hit.fraction - .35) < 1e-9);
  assert.deepEqual(hit.normal, { x: -1, y: 0 });
  assert.equal(castCollider(world, circleCollider(70, 100, 10), { x: -20, y: 0 }), null);
  assert.equal(castCollider(world, circleCollider(0, 70, 10), { x: 200, y: 0 }), null);
  assert.equal(castCollider(world, circleCollider(70, 100, 10), { x: 20, y: 0 }).fraction, 0);
});

test('grid LOS agrees with the polygon reference for random rays, boundaries and destroyed terrain', () => {
  for (const seed of [817, 424242]) {
    const random = seededRandom(seed), map = new TileMap(24, 24, { seed, generateWater: false });
    const reference = { blocksLightAt: map.blocksLightAt.bind(map), getBlockingPolygons: map.getBlockingPolygons.bind(map) };
    for (let i = 0; i < 6000; i++) {
      const ray = Array.from({ length: 4 }, () => i % 3 ? random() * 1200 : Math.floor(random() * 25) * 50);
      if (i % 7 === 0) ray[3] = ray[1];
      if (i % 11 === 0) ray[2] = ray[0];
      if (i % 127 === 0) map.tiles[Math.floor(random() * 24)][Math.floor(random() * 24)] = 'default';
      assert.equal(hasLineOfSight(map, ...ray), hasLineOfSight(reference, ...ray), `seed=${seed}, ray=${ray}`);
    }
  }
});

test('a long clear diagonal visits a linear number of cells instead of its whole bounding box', () => {
  const map = new TileMap(100, 100, { seed: 817, generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  let visits = 0;
  const get = map.solids.getCell.bind(map.solids);
  map.solids.getCell = (...args) => { visits++; return get(...args); };
  assert.equal(hasLineOfSight(map, 25, 25, 4975, 4975), true);
  assert.ok(visits <= 300, `visited ${visits} cells`);
  for (const ray of [[NaN, 1, 2, 3], [-1, 2, 5, 5], [5000, 5, 5, 5]]) assert.equal(hasLineOfSight(map, ...ray), false);
});

test('exploration keeps local topology/path identity until effective visible blocking changes', () => {
  const oldPath = globalThis.Path2D;
  globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
  try {
    const map = new TileMap(40, 40, { seed: 817, generateWater: false });
    map.tiles.forEach(row => row.fill('default')); map.tiles[3][3] = 'mineral';
    const memory = new TerrainMemory(map);
    const renderer = new PerceptionRenderer(map, map, DEFAULT_VISION_RULES, DEFAULT_GRAPHICS_CONFIG.visibility);
    const path = renderer.getTerrainPath(0, 0, 400, 300, memory), solids = renderer.terrainSolids;
    memory.capture(3, 3); memory.capture(0, 0); memory.capture(35, 35);
    assert.equal(renderer.getTerrainPath(0, 0, 400, 300, memory), path);
    map.tileHp[3][3] = 10; memory.capture(3, 3);
    assert.equal(renderer.getTerrainPath(0, 0, 400, 300, memory), path);
    map.tiles[3][3] = 'default';
    assert.equal(renderer.getTerrainPath(0, 0, 400, 300, memory), path, 'unobserved changes do not leak');
    memory.capture(3, 3);
    assert.notEqual(renderer.getTerrainPath(0, 0, 400, 300, memory), path);
    assert.equal(renderer.terrainSolids, solids);
    renderer.getTerrainPath(50, 0, 400, 300, memory);
    assert.equal(renderer.terrainSolids, solids, 'moving the viewport reuses local geometry');
  } finally { globalThis.Path2D = oldPath; }
});

test('mineral collection can restrict work to the minimap window without reading live terrain', () => {
  const map = new TileMap(100, 100, { seed: 817, generateWater: false });
  map.tiles.forEach(row => row.fill('mineral'));
  const memory = new TerrainMemory(map);
  for (let row = 0; row < 100; row++) for (let col = 0; col < 100; col++) memory.capture(col, row);
  assert.equal(collectMineralMarkers(memory).length, 10000);
  let reads = 0; const get = memory.get.bind(memory);
  memory.get = (...args) => { reads++; return get(...args); };
  map.tiles[4][4] = 'default';
  const out = collectMineralMarkers(memory, [], { x: 200, y: 200, width: 100, height: 100 });
  assert.equal(reads, 4); assert.equal(out.length, 4);
  assert.ok(out.some(marker => marker.id === 'mineral:4:4'));
});
