import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileTypeId } = load('map/TileType');
const { TerrainMemory } = load('vision/TerrainMemory');
const { computeMinimapLayout, createMinimapConfig } = load('minimap/MinimapConfig');
const {
  MINIMAP_MAX_VISIBLE_MARKERS,
  MINIMAP_MARKER_PRIORITY,
  entityMarkerId,
  mineralMarkerId,
  selectVisibleMarkers,
  MinimapMarkerStore,
} = load('minimap/MinimapMarkerStore');
const { collectMineralMarkers } = load('minimap/MinimapMarkerSources');

const layout = computeMinimapLayout(createMinimapConfig(), 1920, 1080);
const PLAYER = { x: 1000, y: 1000 };
/** 把屏幕像素换成世界像素，断言按“屏幕上看起来多近”表达，避免被缩放参数影响。 */
const cssToWorld = css => css / layout.scale;

function marker(type, x, y, overrides = {}) {
  return {
    id: `${type}:${x}:${y}`,
    type,
    x,
    y,
    priority: MINIMAP_MARKER_PRIORITY[type],
    visible: true,
    state: 'default',
    ...overrides,
  };
}

const select = (markers, options = {}) =>
  selectVisibleMarkers(markers, layout, PLAYER.x, PLAYER.y, {
    padding: 5,
    clusterDistance: 9,
    ...options,
  });

test('visible 为假或超出圆形的标记不会进入小地图', () => {
  const markers = [
    marker('gold', PLAYER.x + 100, PLAYER.y),
    marker('gold', PLAYER.x + 400, PLAYER.y, { visible: false }),
    marker('gold', PLAYER.x + 5000, PLAYER.y),
    marker('mineral', PLAYER.x, PLAYER.y + 4000),
  ];
  const visible = select(markers);
  assert.deepEqual(visible.map(m => m.id), [`gold:${PLAYER.x + 100}:${PLAYER.y}`]);
});

test('优先级排序：任务目标高于资源，同类按稳定 id 排序', () => {
  const markers = [
    marker('gold', PLAYER.x + 200, PLAYER.y),
    marker('mineral', PLAYER.x - 200, PLAYER.y),
    marker('objective', PLAYER.x, PLAYER.y + 200),
    marker('meat', PLAYER.x, PLAYER.y - 200),
  ];
  const visible = select(markers);
  assert.deepEqual(visible.map(m => m.type), ['objective', 'mineral', 'gold', 'meat']);
});

test('相邻普通物资聚合成一个，不会重叠闪烁；任务点豁免聚合', () => {
  const clustered = select([
    marker('gold', PLAYER.x, PLAYER.y),
    marker('gold', PLAYER.x + cssToWorld(4), PLAYER.y),
    marker('gold', PLAYER.x + cssToWorld(7), PLAYER.y + cssToWorld(3)),
  ]);
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].type, 'gold');

  const objectives = select([
    marker('objective', PLAYER.x, PLAYER.y),
    marker('objective', PLAYER.x + cssToWorld(4), PLAYER.y),
  ]);
  assert.equal(objectives.length, 2, '任务目标始终保留，不被物资挤掉');
});

test('数量上限生效，避免一屏塞满普通资源', () => {
  const markers = [];
  const ringWorld = (layout.contentRadius - 12) / layout.scale;
  for (let i = 0; i < MINIMAP_MAX_VISIBLE_MARKERS + 12; i++) {
    const angle = (i / (MINIMAP_MAX_VISIBLE_MARKERS + 12)) * Math.PI * 2;
    markers.push(marker('gold', PLAYER.x + Math.cos(angle) * ringWorld, PLAYER.y + Math.sin(angle) * ringWorld));
  }
  const visible = select(markers, { clusterDistance: 0 });
  assert.equal(visible.length, MINIMAP_MAX_VISIBLE_MARKERS);
});

test('MarkerStore 按 id 复用对象：位置更新时不会重复创建，离场后立即移除', () => {
  const store = new MinimapMarkerStore();
  store.replace([
    { id: 'gold:p1', type: 'gold', x: 10, y: 10, visible: true },
    { id: mineralMarkerId(3, 4), type: 'mineral', x: 20, y: 20, visible: true },
  ]);
  const first = store.get('gold:p1');
  assert.equal(store.size, 2);

  store.replace([{ id: 'gold:p1', type: 'gold', x: 30, y: 40, visible: false }]);
  const same = store.get('gold:p1');
  assert.equal(same, first, '同一 id 复用同一个对象');
  assert.equal(same.x, 30);
  assert.equal(same.visible, false);
  assert.equal(store.get(mineralMarkerId(3, 4)), undefined, '消失的资源不留幽灵标记');
  assert.equal(store.size, 1);
});

test('MarkerStore 用授权后的 visible 过滤，而不是对象存在与否', () => {
  const store = new MinimapMarkerStore();
  store.replace([
    { id: entityMarkerId('gold', 'p1'), type: 'gold', x: PLAYER.x + 100, y: PLAYER.y, visible: true },
    { id: entityMarkerId('gold', 'p2'), type: 'gold', x: PLAYER.x + 200, y: PLAYER.y, visible: false },
  ]);
  const visible = store.visibleIn(layout, PLAYER.x, PLAYER.y, { padding: 5, clusterDistance: 0 });
  assert.deepEqual(visible.map(m => m.id), [entityMarkerId('gold', 'p1')]);
});

test('矿物标记只来自记忆快照：可破坏瓦片才生成，墙与普通地面不生成', () => {
  const tiles = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => TileTypeId.DEFAULT));
  const tileHp = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 100));
  const terrain = { tileSize: 50, width: 8, height: 8, tiles, tileHp };
  const memory = new TerrainMemory(terrain);
  tiles[1][1] = TileTypeId.WALL;
  memory.capture(1, 1);
  tiles[2][2] = TileTypeId.MINERAL;
  tileHp[2][2] = 40;
  memory.capture(2, 2);
  memory.capture(3, 3);

  const markers = collectMineralMarkers(memory);
  assert.equal(markers.length, 1);
  const [mineral] = markers;
  assert.equal(mineral.id, mineralMarkerId(2, 2));
  assert.equal(mineral.type, 'mineral');
  assert.equal(mineral.x, 2 * 50 + 25);
  assert.equal(mineral.y, 2 * 50 + 25);
  assert.equal(mineral.visible, true);
  assert.equal(mineral.state, 'damaged', '受损的矿石保留破损状态');
});

test('记忆里没有的瓦片不会产生矿物标记', () => {
  const tiles = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => TileTypeId.MINERAL));
  const terrain = { tileSize: 50, width: 4, height: 4, tiles };
  const memory = new TerrainMemory(terrain);
  assert.deepEqual(collectMineralMarkers(memory), []);
  memory.capture(1, 2);
  assert.equal(collectMineralMarkers(memory).length, 1);
});
