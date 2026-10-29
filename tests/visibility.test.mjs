import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const { LightSource } = load('core/LightSource');
const { Vector2 } = load('math/Vector2');
const idle = { isKeyDown: () => false };
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const player = () => {
  const p = new Player(250.5, 200.5);
  p.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
  return p;
};
const aim = (p, distance, fire = false, face = true) => ({ target: { x: p.x + 24.5 + distance, y: p.y + 24.5 }, fire, face });

test('focus follows world distance, clamps at both ends, and recovers without exploration memory', () => {
  for (const [distance, degrees, range] of [[10, 120, 400], [100, 120, 400], [450, 82.5, 600], [800, 45, 800], [4000, 45, 800]]) {
    const p = player(); p.update(1, idle, undefined, aim(p, distance));
    const v = p.getVisionState(); near(v.angle * 180 / Math.PI, degrees); near(v.range, range);
    near(Math.cos(v.direction), 1); near(Math.sin(v.direction), 0);
    v.range = 1; near(p.getVisionState().range, range);
    p.update(1, idle); near(p.getVisionState().range, 400); near(p.getVisionState().angle, Math.PI * 2 / 3);
  }
  const p = player(); p.update(1, idle, undefined, aim(p, 800, true, false));
  near(p.getVisionState().range, 400); near(p.getVisionState().direction, -Math.PI);
});

test('arm lift and focus transitions agree at 30/60/144 FPS; vision follows actual body turning', () => {
  const samples = [];
  for (const fps of [30, 60, 144]) {
    const p = player(); p.applyConfig({ base: { rotationSpeed: 1 } });
    for (let i = 0; i < fps / 6; i++) p.update(1 / fps, idle, undefined, aim(p, 800));
    // Compare at an exact shared time after fractional final steps.
    const elapsed = Math.ceil(fps / 6) / fps;
    p.update(.2 - elapsed, idle, undefined, aim(p, 800));
    const v = p.getVisionState(); near(p.armLift, 1); near(v.direction, p.currentRotation - Math.PI);
    near(p.currentRotation, .2); samples.push(v);
    p.update(.1, idle); near(p.armLift, 0);
  }
  for (const v of samples) { near(v.range, samples[0].range); near(v.angle, samples[0].angle); }
  const p = player(); p.update(.05, idle, undefined, aim(p, 800)); near(p.armLift, .5);
  p.update(.05, idle); near(p.armLift, 0);
});

test('bullets start at the visible hand, preserve short endpoints, and arm geometry never alters the collider', () => {
  for (const offset of [[500, 0], [0, -500], [-500, 100], [1, 0]]) {
    const p = player(), body = p.getCollider();
    const target = { x: 275 + offset[0], y: 225 + offset[1] };
    p.shootAt(target);
    const b = p.getBullets()[0], muzzle = p.getMuzzlePosition(), pos = b.getPosition();
    near(pos.x + 5, muzzle.x); near(pos.y + 5, muzzle.y);
    assert.deepEqual(p.getCollider().bounds, body.bounds);
    b.update(10); near(b.getPosition().x + 5, target.x); near(b.getPosition().y + 5, target.y);
  }
});

test('body-to-hand sweep hits the first rounded obstacle once and cannot spawn beyond it', () => {
  const map = new TileMap(16, 16, { generateWater: false }); map.tiles.forEach(row => row.fill('default'));
  map.tiles[4][6] = 'mineral'; map.tileHp[4][6] = 100;
  map.tiles[4][7] = 'mineral'; map.tileHp[4][7] = 100;
  const p = player(); let shots = 0; p.setOnShootCallback(() => shots++);
  p.update(0, idle, map, aim(p, 500, true));
  assert.equal(shots, 1); assert.equal(p.getBullets().length, 0);
  assert.equal(map.tileHp[4][6], 90); assert.equal(map.tileHp[4][7], 100);
  assert.ok(p.getHeatPercentage() > 0);
  p.update(0, idle, map); assert.equal(map.tileHp[4][6], 90);
});

test('focused illumination scales rendering only and preserves editable base settings', () => {
  const light = new LightSource(new Vector2(100, 100), 400);
  light.setRangeScale(2); near(light.getRadius(), 400); near(light.getEffectiveRadius(), 800);
  light.setRadius(600); near(light.getEffectiveRadius(), 1200);
  light.setRangeScale(1); near(light.getEffectiveRadius(), 600);
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => light.setRangeScale(value));
});
