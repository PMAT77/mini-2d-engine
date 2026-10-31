import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  markerDotPosition,
  secondaryMarkerIndices,
  placePickupPrompt,
  roundedRectOutline,
  MARKER_GAP,
  MARKER_HALO_RADIUS,
  PROMPT_SCREEN_MARGIN,
} = load('ui/PickupLayout');

// 提示只有键帽，没有文字，所以内容宽度等于键帽尺寸。
const base = {
  anchorX: 500,
  anchorY: 400,
  halfWidth: 7,
  halfHeight: 7,
  contentWidth: 24,
  contentHeight: 24,
  viewportWidth: 1100,
  viewportHeight: 800,
};
const place = overrides => placePickupPrompt({ ...base, ...overrides });

test('the dot sits just above the visible top of the item', () => {
  assert.deepEqual(markerDotPosition(100, 100, 8), { x: 100, y: 100 - 8 - MARKER_GAP });
  assert.equal(MARKER_GAP, 8);
});

test('dense markers keep the target as the primary dot and weaken the others', () => {
  const dots = [{ x: 0, y: 0 }, { x: 6, y: 3 }, { x: 40, y: 0 }];
  assert.deepEqual([...secondaryMarkerIndices(dots, 0, 12)], [1]);
  // 目标不在第一位时也要优先保留。
  const targeted = [{ x: 2, y: 0 }, { x: 4, y: 1 }, { x: 50, y: 0 }];
  const secondary = secondaryMarkerIndices(targeted, 1, 12);
  assert.equal(secondary.has(1), false, 'the target marker always stays primary');
  assert.equal(secondary.has(0), true, 'the overlapping marker is weakened');
  assert.equal(secondary.has(2), false);
});

test('the prompt sits to the right of the item by default', () => {
  const placement = place();
  assert.equal(placement.side, 'right');
  assert.equal(placement.box.x, 500 + 7 + 10);
  assert.equal(placement.box.y, 400 - 24 / 2);
});

test('approaching from the right puts the prompt above the item', () => {
  const placement = place({ preferAbove: true });
  assert.equal(placement.side, 'above');
  assert.equal(placement.box.x, 500 - 24 / 2);
  const dotY = 400 - 7 - MARKER_GAP;
  assert.ok(placement.box.y + placement.box.height <= dotY - MARKER_HALO_RADIUS,
    'the prompt stays above the highlight dot halo');
  assert.ok(placement.box.y >= PROMPT_SCREEN_MARGIN);
});

test('the right-side prompt is clamped inside the viewport', () => {
  const placement = place({ anchorX: 1060 });
  assert.equal(placement.side, 'right');
  assert.ok(placement.box.x >= PROMPT_SCREEN_MARGIN);
  assert.ok(placement.box.x + placement.box.width <= 1100 - PROMPT_SCREEN_MARGIN);
});

test('the above prompt is clamped inside the viewport near the top-left corner', () => {
  const placement = place({
    anchorX: 10,
    anchorY: 20,
    preferAbove: true,
    viewportWidth: 100,
    viewportHeight: 100,
  });
  assert.equal(placement.side, 'above');
  assert.ok(placement.box.x >= PROMPT_SCREEN_MARGIN);
  assert.ok(placement.box.y >= PROMPT_SCREEN_MARGIN);
});

test('the rounded rectangle outline is continuous and quarters land on edge midpoints', () => {
  const size = 28;
  const radius = 8;
  const outline = roundedRectOutline(size, size, radius);
  const expectedLength = 2 * (size + size) - 8 * radius + 2 * Math.PI * radius;
  assert.ok(Math.abs(outline.length - expectedLength) < 0.01,
    `outline length ${outline.length} should be ${expectedLength}`);

  const half = size / 2;
  const first = outline.points[0];
  assert.ok(Math.abs(first.x) < 0.01 && Math.abs(first.y + half) < 0.01,
    'the path starts at the top midpoint');

  const pointAtDistance = distance => outline.points.reduce((best, point) =>
    Math.abs(point.distance - distance) < Math.abs(best.distance - distance) ? point : best);
  const quarter = pointAtDistance(outline.length / 4);
  const threeQuarters = pointAtDistance((outline.length * 3) / 4);
  assert.ok(Math.abs(quarter.x - half) < 1.2 && Math.abs(quarter.y) < 1.2,
    `the quarter point should sit on the right edge, got ${quarter.x},${quarter.y}`);
  assert.ok(Math.abs(threeQuarters.x + half) < 1.2 && Math.abs(threeQuarters.y) < 1.2,
    `the three-quarter point should sit on the left edge, got ${threeQuarters.x},${threeQuarters.y}`);

  for (let index = 1; index < outline.points.length; index += 1) {
    assert.ok(outline.points[index].distance > outline.points[index - 1].distance,
      'sampled distances must keep increasing');
  }
  const last = outline.points.at(-1);
  assert.ok(Math.abs(last.x) < 0.01 && Math.abs(last.y + half) < 0.01,
    'the full path closes back at the top midpoint');
});
