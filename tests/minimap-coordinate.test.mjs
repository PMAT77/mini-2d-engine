import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  DEFAULT_MINIMAP_CONFIG,
  DEFAULT_MINIMAP_PALETTE,
  createMinimapConfig,
  computeMinimapLayout,
  worldToMinimap,
  isInsideMinimap,
  computeGoldHudRect,
  minimapCellColor,
} = load('minimap/MinimapConfig');

const LARGE = { width: 1920, height: 1080 };

test('默认布局：左上角 160px 圆盘，中心与缩放正确', () => {
  const config = createMinimapConfig();
  const layout = computeMinimapLayout(config, LARGE.width, LARGE.height);
  assert.equal(layout.left, 20);
  assert.equal(layout.top, 20);
  assert.equal(layout.diameter, 160);
  assert.equal(layout.radius, 80);
  assert.equal(layout.centerX, 100);
  assert.equal(layout.centerY, 100);
  assert.equal(layout.worldRadius, 1200);
  assert.equal(layout.scale, 80 / 1200);
  assert.equal(layout.goldRow, 194);
  assert.equal(config.diameter, DEFAULT_MINIMAP_CONFIG.diameter);
});

test('世界坐标 → 小地图坐标：玩家恒在圆心，四个方向都对', () => {
  const layout = computeMinimapLayout(createMinimapConfig(), LARGE.width, LARGE.height);
  const px = 2500;
  const py = 2500;
  assert.deepEqual(worldToMinimap(layout, px, py, px, py), { x: 100, y: 100 });
  // 东：世界 x 增大 → 地图 x 增大。
  assert.deepEqual(worldToMinimap(layout, px, py, px + 600, py), { x: 140, y: 100 });
  // 西。
  assert.deepEqual(worldToMinimap(layout, px, py, px - 600, py), { x: 60, y: 100 });
  // 北（世界 y 减小）→ 地图 y 减小：北向固定，地图整体不跟随朝向旋转。
  assert.deepEqual(worldToMinimap(layout, px, py, px, py - 600), { x: 100, y: 60 });
  // 南。
  assert.deepEqual(worldToMinimap(layout, px, py, px, py + 600), { x: 100, y: 140 });
});

test('坐标变换与相机无关：同一世界点在同一玩家位置下结果恒定', () => {
  const layout = computeMinimapLayout(createMinimapConfig(), LARGE.width, LARGE.height);
  const first = worldToMinimap(layout, 1000, 1000, 1600, 400);
  const second = worldToMinimap(layout, 1000, 1000, 1600, 400);
  assert.deepEqual(first, second);
  // 不同的玩家位置会平移整张地图，但相对关系不变。
  const moved = worldToMinimap(layout, 1200, 1000, 1600, 400);
  assert.equal(moved.y, first.y);
  assert.ok(moved.x < first.x);
});

test('圆形边界：显示半径之外标记不进入地图', () => {
  const layout = computeMinimapLayout(createMinimapConfig(), LARGE.width, LARGE.height);
  const px = 2500;
  const py = 2500;
  assert.equal(isInsideMinimap(layout, px, py, px + 1100, py), true);
  assert.equal(isInsideMinimap(layout, px, py, px + 1201, py), false);
  // padding 把标记限制在描边内侧，避免压到圆环。
  assert.equal(isInsideMinimap(layout, px, py, px + 1150, py, 5), false);
  assert.equal(isInsideMinimap(layout, px, py, px + 1100, py, 5), true);
});

test('小屏幕按可用空间收缩，黄金行紧跟圆盘下缘', () => {
  const config = createMinimapConfig();
  const layout = computeMinimapLayout(config, 400, 400);
  assert.equal(layout.diameter, 112);
  assert.equal(layout.radius, 56);
  assert.equal(layout.centerX, 76);
  assert.equal(layout.centerY, 76);
  assert.equal(layout.goldRow, 20 + 112 + config.goldGap);
});

test('黄金 HUD 不再压住小地图：图标与文字在小地图下方', () => {
  const config = createMinimapConfig();
  const layout = computeMinimapLayout(config, LARGE.width, LARGE.height);
  const gold = computeGoldHudRect(layout, config);
  assert.equal(gold.iconX, layout.left);
  assert.equal(gold.iconY, layout.goldRow);
  assert.equal(gold.iconSize, 12);
  assert.ok(gold.iconY >= layout.top + layout.diameter, '黄金图标在小地图圆盘下方');
  assert.equal(gold.textX, layout.left + gold.iconSize + 10);
  assert.equal(gold.textY, layout.goldRow + gold.iconSize / 2);
  assert.equal(gold.font, '18px sans-serif');
});

test('非法配置直接报错，不会悄悄画出错误尺寸', () => {
  assert.throws(() => createMinimapConfig({ diameter: 0 }), /小地图参数 diameter/);
  assert.throws(() => createMinimapConfig({ worldRadius: Number.NaN }), /小地图参数 worldRadius/);
  assert.throws(() => createMinimapConfig({ refreshInterval: -1 }), /小地图参数 refreshInterval/);
});

test('三种认知状态使用各自颜色，未探索不泄露地形色', () => {
  const palette = DEFAULT_MINIMAP_PALETTE;
  assert.equal(minimapCellColor(palette, 'wall', 'unknown'), palette.unknown);
  assert.equal(minimapCellColor(palette, 'water', 'remembered'), palette.terrain.water.remembered);
  assert.equal(minimapCellColor(palette, 'wall', 'observed'), palette.terrain.wall.observed);
  assert.notEqual(palette.terrain.wall.observed, palette.terrain.wall.remembered);
  assert.equal(palette.unknown, '#080D12');
});
