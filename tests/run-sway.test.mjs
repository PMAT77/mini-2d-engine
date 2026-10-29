import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap } = load('map/TileMap');
const { Player } = load('objects/Player');
const { parsePlayerConfig } = load('objects/PlayerConfig');
const empty = { isKeyDown: () => false };
const input = (...keys) => ({ isKeyDown: k => keys.includes(k) });
const mapOf = (w = 16, h = 12) => { const m = new TileMap(w, h, { generateWater: false }); m.tiles.forEach(row => row.fill('default')); return m; };
const wall = m => m.tiles.forEach(row => row[1] = 'wall');
const SIZE = 49;
const HEAD_R = SIZE * .265;
const HAND_R = SIZE * .085;
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);

/** Records arcs and scales; the mock ignores transforms, so arc coordinates stay in local space. */
function recorder() {
  const arcs = [], scales = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, rotate() {}, scale(x) { scales.push(x); },
    fillRect() {}, clearRect() {}, drawImage() {}, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, arc(x, y, r) { arcs.push({ x, y, r }); },
    fill() {}, stroke() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  return { ctx, arcs, scales };
}

const isHead = arc => Math.abs(arc.r - HEAD_R) < 1e-6;
const isHand = arc => Math.abs(arc.r - HAND_R) < 1e-6;
const frame = (p, rec) => {
  rec.arcs.length = 0;
  p.draw(rec.ctx, 0, 0);
  return { head: rec.arcs.filter(isHead), hands: rec.arcs.filter(isHand), arcs: rec.arcs.slice() };
};
const yRange = values => Math.max(...values) - Math.min(...values);

function runPlayer(x = 200, y = 200) {
  const p = new Player(x, y);
  const rec = recorder();
  p.wadingCanvas = { width: 0, height: 0, getContext: () => rec.ctx };
  return { p, rec };
}

test('running without aiming sways the head and swings both hands alternately front and back but never the body or collider', () => {
  const m = mapOf();
  const { p, rec } = runPlayer();
  const original = p.getCollider();
  const headY = [], leftX = [], rightX = [], leftY = [], rightY = [], bodyYs = [];
  for (let i = 0; i < 60; i++) {
    p.update(1 / 60, input('d'), m);
    const shot = frame(p, rec);
    assert.equal(shot.head.length, 1);
    assert.equal(shot.hands.length, 2);
    near(p.getCollider().bounds.width, original.bounds.width, 1e-6);
    near(p.getCollider().bounds.height, original.bounds.height, 1e-6);
    near(p.getCollider().parts[0].radius, 24.5);
    if (i >= 12) {
      headY.push(shot.head[0].y);
      leftX.push(shot.hands[0].x);
      rightX.push(shot.hands[1].x);
      leftY.push(shot.hands[0].y);
      rightY.push(shot.hands[1].y);
      for (const arc of shot.arcs.filter(a => a.r > HEAD_R + .5)) bodyYs.push(arc.y);
    }
  }
  assert.ok(yRange(headY) > .4, `head sway range was ${yRange(headY)}`);
  assert.ok(yRange(leftX) > .5, `left hand swing range was ${yRange(leftX)}`);
  assert.ok(yRange(rightX) > .5, `right hand swing range was ${yRange(rightX)}`);
  near(yRange(leftX.map((x, i) => x + rightX[i])), 0, 1e-9);
  near(yRange(leftY), 0);
  near(yRange(rightY), 0);
  assert.ok(bodyYs.every(y => y === 0), 'body must not sway');
});

test('running while aiming keeps only the head swaying', () => {
  const m = mapOf();
  const { p, rec } = runPlayer();
  const target = { x: p.x + 2000, y: p.y + p.size / 2 };
  const headY = [], leftX = [], rightX = [];
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60, input('d'), m, { target, fire: false, face: true });
    const shot = frame(p, rec);
    assert.equal(shot.head.length, 1);
    assert.equal(shot.hands.length, 2);
    if (i >= 60) {
      headY.push(shot.head[0].y);
      leftX.push(shot.hands[0].x);
      rightX.push(shot.hands[1].x);
    }
  }
  near(p.armLift, 1);
  assert.ok(yRange(headY) > .25, `head sway range was ${yRange(headY)}`);
  near(yRange(leftX), 0, 1e-9);
  near(yRange(rightX), 0, 1e-9);
  assert.ok(Math.abs(leftX[0] - rightX[0]) > 1, 'both hands must be measured at their aim pose');
});

test('idle breathing still works and produces no run sway', () => {
  const { p, rec } = runPlayer();
  p.applyConfig({ animation: { breathingAmplitude: 30 } });
  const headY = [], leftY = [], rightY = [];
  for (let i = 0; i < 240; i++) {
    p.update(1 / 60, empty);
    const shot = frame(p, rec);
    headY.push(shot.head[0].y);
    leftY.push(shot.hands[0].y);
    rightY.push(shot.hands[1].y);
  }
  near(yRange(headY), 0);
  near(yRange(leftY), 0);
  near(yRange(rightY), 0);
  assert.ok(Math.max(...rec.scales) > 1.29 && Math.min(...rec.scales) < 0.71);
});

test('pushing into a wall stops the sway even while the run key is held', () => {
  const m = mapOf();
  wall(m);
  const { p, rec } = runPlayer(100, 200);
  let maxHead = 0;
  for (let i = 0; i < 60; i++) {
    p.update(1 / 60, input('a'), m);
    const shot = frame(p, rec);
    if (i >= 40) maxHead = Math.max(maxHead, Math.abs(shot.head[0].y));
  }
  assert.ok(maxHead < 0.05, `blocked run still swayed the head by ${maxHead}`);
  near(p.getCollider().bounds.x, 100, .01);
});

test('run sway config accepts zero and rejects negative values', () => {
  const parsed = parsePlayerConfig({ animation: { runSwayAmplitude: 0, runSwaySpeed: 0 } });
  assert.equal(parsed.animation.runSwayAmplitude, 0);
  assert.equal(parsed.animation.runSwaySpeed, 0);
  assert.throws(() => parsePlayerConfig({ animation: { runSwayAmplitude: -1 } }), /无效配置值: animation\.runSwayAmplitude/);
  assert.throws(() => parsePlayerConfig({ animation: { runSwaySpeed: -1 } }), /无效配置值: animation\.runSwaySpeed/);

  const p = new Player(200, 200);
  p.applyConfig(parsed);
  const snapshot = p.getConfigSnapshot();
  assert.equal(snapshot.animation.runSwayAmplitude, 0);
  assert.equal(snapshot.animation.runSwaySpeed, 0);
});
