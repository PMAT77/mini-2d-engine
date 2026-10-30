import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Chicken } = load('objects/Chicken');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');
const idleInput = { isKeyDown: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const dryMap = (width = 60, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const centerOf = chicken => ({ x: chicken.x + Chicken.SIZE / 2, y: chicken.y + Chicken.SIZE / 2 });

const impact = (overrides = {}) => Object.freeze({
  damage: 10,
  point: Object.freeze({ x: 0, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
  impulse: 280,
  impactSpeed: 2600,
  initialSpeed: 2600,
  traveledDistance: 120,
  source: "bullet",
  ...overrides,
});

test('a lethal hit enters dying, keeps the corpse perceivable, and stops accepting damage', () => {
  const map = dryMap();
  const chicken = new Chicken(300, 300, seededRandom(1));
  const healthBefore = chicken.getHealth();
  const rotationBefore = chicken.currentRotation;

  assert.equal(chicken.receiveHit(impact({ damage: healthBefore }), map), "killed");
  assert.equal(chicken.getLifeState(), "dying");
  assert.equal(chicken.isAlive(), false);
  assert.equal(chicken.isDamageable(), false);
  assert.equal(chicken.isRenderable(), true);
  assert.equal(chicken.isPerceptionTarget(), true);
  assert.equal(chicken.currentRotation, rotationBefore, 'hit pose must not rewrite the collision rotation');
  assert.equal(chicken.getVelocity().length(), 0, 'normal movement velocity is cleared on death');
  assert.ok(chicken.getKnockbackSpeed() > 0, 'knockback owns a separate velocity');

  assert.equal(chicken.receiveHit(impact(), map), "ignored");
  assert.equal(chicken.takeDamage(10), false);
  assert.equal(chicken.hitTestSegment(300, 300, 400, 300, 5), null, 'corpses are not hittable');
});

test('a knocked-back corpse slides on dry ground and emits one death event with final coordinates', () => {
  const map = dryMap();
  const chicken = new Chicken(300, 300, seededRandom(2));
  let steps = 0;
  chicken.setOnStepCallback(() => { steps++; });
  const start = centerOf(chicken);

  chicken.receiveHit(impact(), map);
  assert.ok(chicken.getHitReactionPose().intensity > 0);

  for (let frame = 0; frame < 60; frame++) chicken.update(1 / 60, idleInput, map);

  assert.equal(chicken.getLifeState(), "removed");
  assert.equal(steps, 0, 'a sliding corpse does not report footsteps');
  assert.equal(chicken.getKnockbackSpeed(), 0);
  const finished = chicken.consumeDeathFinished();
  assert.ok(finished, 'death finished event must be produced');
  assert.ok(finished.x > start.x + 25, `corpse should slide right, dx=${finished.x - start.x}`);
  const final = centerOf(chicken);
  assert.ok(Math.abs(finished.x - final.x) < 1e-9 && Math.abs(finished.y - final.y) < 1e-9);
  assert.equal(chicken.consumeDeathFinished(), null, 'the event is consumable exactly once');

  chicken.update(1 / 60, idleInput, map);
  assert.equal(chicken.consumeDeathFinished(), null, 'removed corpses never emit again');
});

test('the hit pose leans and squashes without touching the world transform', () => {
  const map = dryMap();
  const chicken = new Chicken(300, 300, seededRandom(3));
  chicken.receiveHit(impact(), map);
  const pose = chicken.getHitReactionPose();
  assert.equal(pose.dying, true);
  assert.ok(pose.intensity > 0 && pose.intensity <= 1);
  assert.ok(Math.abs(pose.localLeanRadians) > 0);
  assert.ok(pose.squash > 0);
  assert.equal(pose.ageSeconds, 0);

  const before = { x: chicken.x, y: chicken.y, rotation: chicken.currentRotation };
  chicken.update(1 / 60, idleInput, map);
  assert.equal(chicken.currentRotation, before.rotation, 'pose rotation is local only');
  assert.ok(chicken.getHitReactionPose().intensity < pose.intensity, 'pose intensity decays over time');
});

test('a corpse without a world still finishes in place after the minimum visible time', () => {
  const map = dryMap();
  const chicken = new Chicken(300, 300, seededRandom(4));
  const start = centerOf(chicken);
  assert.equal(chicken.receiveHit(impact()), "killed");
  assert.equal(chicken.getLifeState(), "dying");
  assert.equal(chicken.getKnockbackSpeed(), 0);

  chicken.update(0.1, idleInput, map);
  assert.equal(chicken.getLifeState(), "dying", 'minimum visible time keeps the corpse on screen');
  chicken.update(0.1, idleInput, map);
  assert.equal(chicken.getLifeState(), "removed");
  const finished = chicken.consumeDeathFinished();
  assert.ok(finished);
  assert.ok(Math.abs(finished.x - start.x) < 1e-9 && Math.abs(finished.y - start.y) < 1e-9);
});

test('non-lethal hits damage without killing and the corpse never blocks walls', () => {
  const map = dryMap();
  const chicken = new Chicken(300, 300, seededRandom(5));
  assert.equal(chicken.receiveHit(impact({ damage: 0.4 }), map), "damaged");
  assert.equal(chicken.getLifeState(), "alive");
  assert.ok(chicken.getHealth() > 0);
  assert.ok(chicken.getKnockbackSpeed() > 0, 'damaged targets still slide');
  assert.equal(chicken.receiveHit(impact({ damage: 0 }), map), "ignored");

  for (let frame = 0; frame < 90; frame++) chicken.update(1 / 60, idleInput, map);
  assert.equal(chicken.getKnockbackSpeed(), 0, 'knockback decays back to rest');

  // 墙边滑行只能停在碰撞体表面，不能穿墙。
  const walled = dryMap();
  for (let row = 0; row < walled.height; row++) walled.tiles[row][15] = 'wall';
  const against = new Chicken(700, 300, seededRandom(6));
  against.receiveHit(impact(), walled);
  for (let frame = 0; frame < 40; frame++) against.update(1 / 60, idleInput, walled);
  assert.ok(walled.queryShape(against.getCollider()).every(contact => contact.depth <= 0.02),
    'the sliding body must not penetrate the wall');
  assert.ok(centerOf(against).x <= 750 - Chicken.SIZE / 2 + 0.75, 'corpse stops at the wall face');
});
