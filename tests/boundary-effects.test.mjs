import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const {
  BoundaryRippleSystem, findBoundaryContacts, BOUNDARY_CONTACT_RANGE,
  BOUNDARY_MAX_COUNT, BOUNDARY_LIFE,
} = load('objects/BoundaryRippleSystem');
const {
  MapBoundaryOverlay, getOutsideViewportRegions, getWatermarkPlacements,
  MAP_BOUNDARY_WATERMARK_MAX,
} = load('map/MapBoundaryOverlay');
const { Player } = load('objects/Player');

const input = (...keys) => ({ isKeyDown: key => keys.includes(key) });
const leftPush = { x: -1, y: 0 };

/** 记录型 2D 上下文，足以跑完波纹和罩层的绘制分支。 */
const makeContext = () => {
  const calls = {
    save: 0, restore: 0, clip: 0, clipRule: undefined,
    fillRect: 0, arcs: 0, strokes: 0, texts: [],
  };
  const ctx = {
    canvas: { width: 800, height: 600 },
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
    font: "", textAlign: "", textBaseline: "",
    save() { calls.save++; },
    restore() { calls.restore++; },
    beginPath() {},
    rect() {},
    clip(rule) { calls.clip++; calls.clipRule = rule; },
    fillRect() { calls.fillRect++; },
    translate() {},
    rotate() {},
    fillText(text) { calls.texts.push(text); },
    arc() { calls.arcs++; },
    moveTo() {},
    lineTo() {},
    stroke() { calls.strokes++; },
  };
  return { ctx, calls };
};

test('boundary contacts hug every edge and both sides of a corner', () => {
  const size = 5000;
  const body = { x: 0, y: 100, width: 49, height: 49 };
  assert.deepEqual(findBoundaryContacts(body, size, size), [
    { edge: "left", x: 0, y: 124.5, nx: 1, ny: 0 },
  ]);

  const away = { x: 200, y: 200, width: 49, height: 49 };
  assert.deepEqual(findBoundaryContacts(away, size, size), []);

  const near = { x: 0, y: 100, width: 49, height: 49 };
  assert.equal(findBoundaryContacts(near, size, size, BOUNDARY_CONTACT_RANGE + 1).length, 1);
  assert.deepEqual(findBoundaryContacts({ ...near, x: 5 }, size, size), []);

  const corner = findBoundaryContacts({ x: 0, y: 0, width: 49, height: 49 }, size, size);
  assert.deepEqual(corner.map(contact => contact.edge).sort(), ["left", "top"]);
  for (const contact of corner) {
    assert.ok(Number.isFinite(contact.x) && Number.isFinite(contact.y));
  }

  const rightAndBottom = findBoundaryContacts(
    { x: size - 49, y: size - 49, width: 49, height: 49 }, size, size,
  );
  assert.deepEqual(rightAndBottom.map(contact => contact.edge).sort(), ["bottom", "right"]);

  assert.deepEqual(findBoundaryContacts(body, 0, size), []);
  assert.deepEqual(findBoundaryContacts({ x: NaN, y: 0, width: 49, height: 49 }, size, size), []);
});

test('pushing into a boundary spawns one ripple per cooldown and only when pressing in', () => {
  const size = 5000;
  const body = { x: 0, y: 100, width: 49, height: 49 };
  const ripples = new BoundaryRippleSystem(() => 0.5);

  ripples.update(1 / 60, body, leftPush, size, size);
  assert.equal(ripples.getActiveCount(), 1);
  assert.equal(ripples.getRipples()[0].edge, "left");
  assert.equal(ripples.getRipples()[0].x, 0);
  assert.ok(ripples.getRipples()[0].radius < ripples.getRipples()[0].maxRadius);

  ripples.update(1 / 60, body, leftPush, size, size);
  assert.equal(ripples.getActiveCount(), 1, "cooldown suppresses the next frame");
  ripples.update(0.2, body, leftPush, size, size);
  assert.equal(ripples.getActiveCount(), 2, "cooldown expires and spawns again");

  const idle = new BoundaryRippleSystem(() => 0.5);
  idle.update(0.2, body, { x: 0, y: 1 }, size, size);
  idle.update(0.2, body, { x: 1, y: 0 }, size, size);
  idle.update(0.2, body, { x: 0, y: 0 }, size, size);
  assert.equal(idle.getActiveCount(), 0, "papering along or leaving the edge is silent");

  // 斜向贴角可以同时触发两条边。
  const corner = new BoundaryRippleSystem(() => 0.5);
  corner.update(1 / 60, { x: 0, y: 0, width: 49, height: 49 },
    { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }, size, size);
  assert.deepEqual(corner.getRipples().map(r => r.edge).sort(), ["left", "top"]);

  // 离开边界后旧波纹自然过期。
  const far = { x: 800, y: 800, width: 49, height: 49 };
  ripples.update(BOUNDARY_LIFE + 0.05, far, { x: 1, y: 0 }, size, size);
  assert.equal(ripples.getActiveCount(), 0);
  assert.equal(BOUNDARY_MAX_COUNT, 32);
});

test('boundary ripples draw two arcs plus the contact flash, and cull off screen', () => {
  const size = 5000;
  const ripples = new BoundaryRippleSystem(() => 0.5);
  ripples.update(1 / 60, { x: 0, y: 100, width: 49, height: 49 }, leftPush, size, size);

  const { ctx, calls } = makeContext();
  ripples.draw(ctx, 0, 0, 800, 600);
  assert.equal(calls.arcs, 2);
  assert.ok(calls.strokes >= 3, "two arcs and the flash line");
  assert.equal(calls.save, 1);
  assert.equal(calls.restore, 1);

  const before = calls.arcs;
  ripples.draw(ctx, -10000, -10000, 800, 600);
  assert.equal(calls.arcs, before, "off-screen ripples do not draw");
});

test('outside viewport regions cover exactly the non-map area', () => {
  const covering = getOutsideViewportRegions(5000, 5000, 500, 500, 800, 600);
  assert.deepEqual(covering, []);

  const middle = getOutsideViewportRegions(100, 100, -200, -150, 800, 600);
  assert.deepEqual(middle, [
    { x: 0, y: 0, width: 200, height: 600 },
    { x: 300, y: 0, width: 500, height: 600 },
    { x: 0, y: 0, width: 800, height: 150 },
    { x: 0, y: 250, width: 800, height: 350 },
  ]);

  const offMap = getOutsideViewportRegions(100, 100, 1000, 1000, 800, 600);
  assert.deepEqual(offMap, [{ x: 0, y: 0, width: 800, height: 600 }]);
  assert.deepEqual(getOutsideViewportRegions(0, 100, 0, 0, 800, 600), []);
});

test('watermark placements stay outside the map and respect the cap', () => {
  const mapRect = { x: 200, y: 150, width: 100, height: 100 };
  const points = getWatermarkPlacements(800, 600, mapRect, 50);
  assert.ok(points.length > 0 && points.length <= MAP_BOUNDARY_WATERMARK_MAX);
  for (const point of points) {
    assert.ok(point.x >= 0 && point.x < 800 && point.y >= 0 && point.y < 600);
    const inside = point.x >= mapRect.x && point.x <= mapRect.x + mapRect.width
      && point.y >= mapRect.y && point.y <= mapRect.y + mapRect.height;
    assert.equal(inside, false);
  }
  const wide = getWatermarkPlacements(800, 600, { x: 0, y: 0, width: 800, height: 600 }, 50);
  assert.deepEqual(wide, []);
  assert.deepEqual(getWatermarkPlacements(800, 600, mapRect, 0), []);
});

test('overlay draws only watermark text outside the map and skips when covered', () => {
  const main = makeContext();
  const overlay = new MapBoundaryOverlay();
  overlay.draw(main.ctx, -200, -150, 100, 100, 1, 1);
  assert.equal(main.calls.clip, 1);
  assert.equal(main.calls.clipRule, "evenodd");
  assert.equal(main.calls.fillRect, 0, "no veil, tint or rim layers");
  assert.ok(main.calls.texts.every(text => text === "无法通行"));
  assert.ok(main.calls.texts.length > 0);
  assert.equal(overlay.getLastWatermarkCount(), main.calls.texts.length);
  assert.equal(main.calls.save, main.calls.restore);

  const covered = makeContext();
  overlay.draw(covered.ctx, 0, 0, 5000, 5000, 1, 1);
  assert.equal(covered.calls.clip, 0);
  assert.equal(covered.calls.fillRect, 0);
  assert.equal(covered.calls.texts.length, 0);
  assert.equal(overlay.getLastWatermarkCount(), 0);
});

test('player move intent is the raw normalized WASD direction', () => {
  const player = new Player(100, 100);
  const up = player.getMoveIntent(input("w"));
  assert.equal(up.x, 0);
  assert.equal(up.y, -1);
  const both = player.getMoveIntent(input("w", "d"));
  assert.ok(Math.abs(Math.hypot(both.x, both.y) - 1) < 1e-9);
  assert.ok(both.x > 0 && both.y < 0);
  const cancelled = player.getMoveIntent(input("a", "d"));
  assert.equal(cancelled.x, 0);
  assert.equal(cancelled.y, 0);
});
