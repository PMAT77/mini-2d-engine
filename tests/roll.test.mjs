import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { TileMap } = load('map/TileMap');
const { parsePlayerConfig, DEFAULT_ROLL } = load('objects/PlayerConfig');
const input = (...keys) => ({ isKeyDown: key => keys.includes(key), fire: keys.includes('MouseLeft') });
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);
const advance = (p, seconds, keys = input(), map, fps = 60) => {
  for (let left = seconds; left > 1e-9;) {
    const delta = Math.min(left, 1 / fps);
    p.update(delta, keys, map); left -= delta;
  }
};
const mapOf = () => {
  const map = new TileMap(40, 24, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

test('Space roll starts, locks its direction and falls back to body facing', () => {
  const p = new Player(0, 0);
  assert.equal(p.isRolling(), false);
  assert.equal(p.requestRoll(input('d')), true);
  assert.equal(p.isRolling(), true);
  near(p.getRollProgress(), 0);
  advance(p, 0.1);
  assert.ok(p.x > 1 && p.y === 0);
  assert.ok(p.getRollProgress() > 0.25 && p.getRollProgress() < 0.4);

  const still = new Player(0, 0);
  assert.equal(still.requestRoll(input()), true);
  advance(still, 0.1);
  assert.ok(still.x < -1, `facing roll moved ${still.x}`);
  near(still.y, 0);
});

test('default roll covers about 120px and stays frame-rate independent', () => {
  const distances = [];
  for (const fps of [30, 60, 144]) {
    const p = new Player(0, 0);
    assert.equal(p.requestRoll(input('d')), true);
    advance(p, 0.35, input(), undefined, fps);
    assert.equal(p.isRolling(), false);
    distances.push(p.x);
    assert.ok(Math.abs(p.x - 120) < 1, `${fps}fps rolled ${p.x}px`);
    near(p.getVelocity().length(), 0);
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.1, distances.join(', '));
});

test('roll direction stays locked when the stick reverses mid-roll', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  advance(p, 0.15, input('a'));
  assert.ok(p.x > 0);
  near(p.y, 0);
  assert.equal(p.requestRoll(input('a')), false);
});

test('roll cooldown blocks re-entry until the action and cooldown both end', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  assert.equal(p.requestRoll(input('d')), false);
  advance(p, 0.3);
  assert.equal(p.isRolling(), false);
  assert.ok(p.getRollCooldownRemaining() > 0.3);
  assert.equal(p.requestRoll(input('d')), false);
  advance(p, 0.45);
  assert.equal(p.requestRoll(input('d')), true);
});

test('roll spends stamina immediately, pauses regeneration and can exhaust the sprint lock', () => {
  const p = new Player(0, 0);
  assert.equal(p.requestRoll(input('d')), true);
  near(p.getStamina(), 80);
  advance(p, 0.2);
  near(p.getStamina(), 80); // no regen while rolling
  advance(p, 0.2);
  near(p.getStamina(), 80); // regen delay not elapsed yet

  const empty = new Player(0, 0);
  empty.setDebugState({ stamina: 20 });
  assert.equal(empty.requestRoll(input('d')), true);
  near(empty.getStamina(), 0);
  assert.equal(empty.getDebugState().exhausted, true);
  advance(empty, 0.1, input('d', 'Shift'));
  assert.equal(empty.getIsSprinting(), false);
});

test('rolling with too little stamina is ignored without cost or cooldown', () => {
  const p = new Player(0, 0);
  p.setDebugState({ stamina: 19 });
  assert.equal(p.requestRoll(input('d')), false);
  near(p.getRollCooldownRemaining(), 0);
  assert.equal(p.isRolling(), false);
  assert.ok(p.getStamina() >= 19);
  advance(p, 0.1, input('d'));
  assert.ok(p.x < 25, `ignored roll should only walk: ${p.x}`);
});

test('roll stays collision constrained and cannot cross a wall', () => {
  const map = mapOf(); map.tiles.forEach(row => { row[10] = 'wall'; });
  const p = new Player(449, 200);
  assert.equal(p.requestRoll(input('d')), true);
  advance(p, 0.35, input(), map);
  assert.equal(p.isRolling(), false);
  assert.ok(p.x > 449, 'roll should reach the wall');
  assert.ok(p.getCollider().bounds.x + p.getCollider().bounds.width <= 500.011);
  assert.ok(map.queryShape(p.getCollider()).every(c => c.depth <= 0.011));
});

test('roll config is validated, snapshotted and applied', () => {
  assert.equal(parsePlayerConfig({ roll: { cooldown: 0, staminaCost: 0 } }).roll.cooldown, 0);
  assert.throws(() => parsePlayerConfig({ roll: { duration: 0 } }), /roll\.duration/);
  assert.throws(() => parsePlayerConfig({ roll: { speedMultiplier: 1 } }), /roll\.speedMultiplier/);
  assert.throws(() => parsePlayerConfig({ roll: { staminaCost: -1 } }), /roll\.staminaCost/);
  assert.throws(() => parsePlayerConfig({ roll: { cooldown: -1 } }), /roll\.cooldown/);
  assert.throws(() => parsePlayerConfig({ roll: { unknown: 1 } }), /未知配置项: roll\.unknown/);

  const p = new Player(0, 0);
  assert.deepEqual(p.getConfigSnapshot().roll, DEFAULT_ROLL);
  p.applyConfig({ roll: { duration: 0.2, staminaCost: 10 } });
  assert.equal(p.getConfigSnapshot().roll.duration, 0.2);
  assert.equal(p.getConfigSnapshot().roll.staminaCost, 10);
  assert.equal(p.requestRoll(input('d')), true);
  near(p.getStamina(), 90);
  advance(p, 0.3);
  assert.ok(p.x > 75 && p.x < 85, `shortened roll moved ${p.x}px`);
});
