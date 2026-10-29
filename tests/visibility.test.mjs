import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const { LightSource } = load('core/LightSource');
const { ConeLight } = load('core/ConeLight');
const { Vector2 } = load('math/Vector2');
const idle = { isKeyDown: () => false };
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const player = () => {
  const p = new Player(250.5, 200.5);
  p.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
  return p;
};
const aim = (p, distance, fire = false, face = true) => ({ target: { x: p.x + 24.5 + distance, y: p.y + 24.5 }, fire, face });

test('fog radius defaults to 400 and aiming distance never changes it', () => {
  const samples = [];
  for (const distance of [10, 100, 450, 800, 4000]) {
    for (const face of [false, true]) {
      const p = player(); p.update(1, idle, undefined, aim(p, distance, true, face));
      const v = p.getVisionState(); near(v.range, 400);
      assert.deepEqual(Object.keys(v).sort(), ['direction', 'range', 'x', 'y']);
      samples.push(v);
    }
  }
  for (const v of samples) near(v.range, 400);
  const p = player(); p.update(.5, idle, undefined, aim(p, 800, true, true));
  p.update(.5, idle);
  near(p.getVisionState().range, 400);
});

test('the debug panel can resize the fog without touching the fixed flashlight cone', () => {
  const p = player();
  near(p.getVisionRange(), 400); near(p.getVisionState().range, 400);
  p.setVisionRange(650); near(p.getVisionRange(), 650); near(p.getVisionState().range, 650);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => p.setVisionRange(bad));
  near(p.getVisionState().range, 650);
  assert.deepEqual(Object.keys(p.getVisionState()).sort(), ['direction', 'range', 'x', 'y']);
});

test('arm lift and vision transitions agree at 30/60/144 FPS; vision follows actual body turning', () => {
  const samples = [];
  for (const fps of [30, 60, 144]) {
    const p = player(); p.applyConfig({ base: { rotationSpeed: 1 } });
    for (let i = 0; i < fps / 6; i++) p.update(1 / fps, idle, undefined, aim(p, 800));
    // Compare at an exact shared time after fractional final steps.
    const elapsed = Math.ceil(fps / 6) / fps;
    p.update(.2 - elapsed, idle, undefined, aim(p, 800));
    const v = p.getVisionState(); near(p.armLift, 1); near(v.direction, p.currentRotation - Math.PI);
    near(p.currentRotation, .2); near(v.range, 400); samples.push(v);
    p.update(.1, idle); near(p.armLift, 0);
  }
  for (const v of samples) near(v.range, 400);
  const p = player(); p.update(.05, idle, undefined, aim(p, 800)); near(p.armLift, .5);
  p.update(.05, idle); near(p.armLift, 0);
});

test('cone light feathers both radial edges and keeps a configurable angle and range', () => {
  const cone = new ConeLight(new Vector2(0, 0), 400, '#FFF4E8', .5, Math.PI * 2 / 3, .35);
  near(cone.getAngle(), Math.PI * 2 / 3); near(cone.getStartAngle(), -Math.PI / 3); near(cone.getEndAngle(), Math.PI / 3);
  near(cone.getFeather(), Math.PI * 2 / 3 * .35); near(cone.getEffectiveRadius(), 400);
  assert.equal(cone.shape, 'cone');
  cone.setDirection(Math.PI / 2); near(cone.getStartAngle(), Math.PI / 2 - Math.PI / 3);
  cone.setRadius(500); near(cone.getEffectiveRadius(), 500);
  for (const bad of [0, -1, NaN, Infinity, Math.PI * 2 + .1]) assert.throws(() => cone.setAngle(bad));
  for (const bad of [-.1, .6, NaN]) assert.throws(() => cone.setSoftness(bad));
  assert.throws(() => cone.setDirection(NaN));
  cone.setAngle(Math.PI); near(cone.getFeather(), Math.PI * .35);
  // 内圈让光束从持灯者身体之外开始，人物不会被自己的手电筒打亮。
  near(cone.innerVisibility(0), 1);
  cone.setInnerRadius(30, 16);
  near(cone.getInnerRadius(), 30); near(cone.innerVisibility(0), 0); near(cone.innerVisibility(30), 0);
  near(cone.innerVisibility(46), 1);
  assert.ok(cone.innerVisibility(38) > 0 && cone.innerVisibility(38) < 1);
  for (const bad of [-1, NaN, Infinity]) assert.throws(() => cone.setInnerRadius(bad));
  assert.throws(() => cone.setInnerRadius(30, 0));
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
  assert.ok(p.getMagazineAmmo() < p.getMagazineSize());
  p.update(0, idle, map); assert.equal(map.tileHp[4][6], 90);
});

test('light range scaling stays a rendering-only multiplier and preserves editable base settings', () => {
  const light = new LightSource(new Vector2(100, 100), 400);
  light.setRangeScale(2); near(light.getRadius(), 400); near(light.getEffectiveRadius(), 800);
  light.setRadius(600); near(light.getEffectiveRadius(), 1200);
  light.setRangeScale(1); near(light.getEffectiveRadius(), 600);
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => light.setRangeScale(value));
});
