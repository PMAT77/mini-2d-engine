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

const base = {
  anchorX: 500,
  anchorY: 400,
  halfWidth: 7,
  halfHeight: 7,
  contentWidth: 54,
  contentHeight: 26,
  markers: [],
  targetMarker: { x: 500, y: 400 - 7 - MARKER_GAP },
  viewportWidth: 1100,
  viewportHeight: 800,
  previousSide: null,
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

test('the prompt prefers the right side by default and clears the item edge', () => {
  const placement = place();
  assert.equal(placement.side, 'right');
  assert.equal(placement.box.x, 500 + 7 + 10);
  assert.equal(placement.box.y, 400 - 13);
});

test('a still valid previous side is kept to avoid left/right flicker', () => {
  const placement = place({ previousSide: 'left' });
  assert.equal(placement.side, 'left');
  assert.equal(placement.box.x, 500 - 7 - 10 - 54);
});

test('the prompt flips to the left near the right screen edge', () => {
  const placement = place({ anchorX: 1060 });
  assert.equal(placement.side, 'left');
  assert.ok(placement.box.x >= PROMPT_SCREEN_MARGIN);
  assert.ok(placement.box.x + placement.box.width <= 1100 - PROMPT_SCREEN_MARGIN);
});

test('both horizontal sides blocked falls back above the dot, not over it', () => {
  const placement = place({
    anchorX: 50,
    anchorY: 90,
    halfWidth: 6,
    halfHeight: 6,
    targetMarker: { x: 50, y: 90 - 6 - MARKER_GAP },
    viewportWidth: 100,
    viewportHeight: 100,
  });
  assert.equal(placement.side, 'above');
  const dotY = 90 - 6 - MARKER_GAP;
  assert.ok(placement.box.y + placement.box.height <= dotY - MARKER_HALO_RADIUS,
    'the prompt must not cover the marker halo');
});

test('a nearby foreign marker blocks the preferred side', () => {
  const placement = place({ markers: [{ x: 545, y: 400 }] });
  assert.equal(placement.side, 'left');
});

test('reserved HUD areas push the prompt away instead of drawing underneath it', () => {
  const placement = place({
    obstacles: [{ x: 515, y: 380, width: 60, height: 40 }],
  });
  assert.notEqual(placement.side, 'right', 'the right side is reserved by the HUD');
  const box = placement.box;
  const obstacle = { x: 515, y: 380, width: 60, height: 40 };
  const overlaps = box.x < obstacle.x + obstacle.width
    && box.x + box.width > obstacle.x
    && box.y < obstacle.y + obstacle.height
    && box.y + box.height > obstacle.y;
  assert.equal(overlaps, false, 'the chosen prompt box avoids the HUD obstacle');
});

test('when nothing fits, the prompt is clamped inside the viewport', () => {
  const placement = place({
    anchorX: 20,
    anchorY: 20,
    viewportWidth: 40,
    viewportHeight: 40,
  });
  assert.ok(placement.box.x >= PROMPT_SCREEN_MARGIN);
  assert.ok(placement.box.y >= PROMPT_SCREEN_MARGIN);
});

test('the rounded rectangle outline is continuous and quarters land on edge midpoints', () => {
  const outline = roundedRectOutline(33, 33, 8);
  const expectedLength = 2 * (33 + 33) - 8 * 8 + 2 * Math.PI * 8;
  assert.ok(Math.abs(outline.length - expectedLength) < 0.01,
    `outline length ${outline.length} should be ${expectedLength}`);

  const first = outline.points[0];
  assert.ok(Math.abs(first.x) < 0.01 && Math.abs(first.y + 16.5) < 0.01,
    'the path starts at the top midpoint');

  const pointAtDistance = distance => outline.points.reduce((best, point) =>
    Math.abs(point.distance - distance) < Math.abs(best.distance - distance) ? point : best);
  const quarter = pointAtDistance(outline.length / 4);
  const threeQuarters = pointAtDistance((outline.length * 3) / 4);
  assert.ok(Math.abs(quarter.x - 16.5) < 1.2 && Math.abs(quarter.y) < 1.2,
    `the quarter point should sit on the right edge, got ${quarter.x},${quarter.y}`);
  assert.ok(Math.abs(threeQuarters.x + 16.5) < 1.2 && Math.abs(threeQuarters.y) < 1.2,
    `the three-quarter point should sit on the left edge, got ${threeQuarters.x},${threeQuarters.y}`);

  for (let index = 1; index < outline.points.length; index += 1) {
    assert.ok(outline.points[index].distance > outline.points[index - 1].distance,
      'sampled distances must keep increasing');
  }
  const last = outline.points.at(-1);
  assert.ok(Math.abs(last.x) < 0.01 && Math.abs(last.y + 16.5) < 0.01,
    'the full path closes back at the top midpoint');
});
