import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { Input } = load('core/Input');
const { TileMap } = load('map/TileMap');
const { ParticleSystem } = load('objects/ParticleSystem');
const { parsePlayerConfig, DEFAULT_MOVEMENT, DEFAULT_SPRINT } = load('objects/PlayerConfig');
const { readFileSync } = await import('node:fs');
const input = (...keys) => ({ isKeyDown: key => keys.includes(key), fire: keys.includes('MouseLeft') });
const mouseAim = p => ({ target: { x: p.x + 24.5, y: p.y - 975.5 }, fire: true, face: false });
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);
const advance = (p, seconds, keys = input(), map, fps = 60) => {
  for (let left = seconds; left > 1e-9;) {
    const delta = Math.min(left, 1 / fps);
    p.update(delta, keys, map, keys.fire ? mouseAim(p) : undefined); left -= delta;
  }
};
const mapOf = () => {
  const map = new TileMap(40, 24, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

test('start has immediate 70% speed, cubic ease-out, and full speed at 80ms', () => {
  const p = new Player(0, 0);
  p.update(0.000001, input('d')); near(p.getVelocity().length(), 280, 0.01);
  p.update(0.039999, input('d')); near(p.getVelocity().length(), 385);
  p.update(0.04, input('d')); near(p.getVelocity().length(), 400);
  advance(p, 0.25);
  near(p.getVelocity().length(), 0);
  p.update(0.000001, input('d')); near(p.getVelocity().length(), 280, 0.01);
});

test('release retains momentum before easing to rest within 200ms, with FPS-independent travel and immediate new input', () => {
  const tails = [];
  for (const fps of [30, 60, 144]) {
    const p = new Player(0, 0);
    advance(p, 0.2, input('d'), undefined, fps);
    const x = p.x;
    p.update(0.02, input());
    assert.ok(p.x > x); assert.ok(p.getVelocity().x > 200 && p.getVelocity().x < 400);
    advance(p, 0.03, input(), undefined, fps);
    near(p.getVelocity().x, 337.5);
    advance(p, 0.15, input(), undefined, fps);
    near(p.getVelocity().length(), 0);
    tails.push(p.x - x);
    assert.ok(p.x - x > 38 && p.x - x < 42);
    const stopped = p.x;
    advance(p, 0.2); near(p.x, stopped);
  }
  assert.ok(Math.max(...tails) - Math.min(...tails) < 0.1, tails.join(', '));
  const p = new Player(0, 0);
  advance(p, 0.2, input('d', 'Shift'));
  const stamina = p.getStamina();
  p.update(0.02, input('Shift'));
  near(p.getStamina(), stamina); assert.equal(p.getIsSprinting(), false);
  const x = p.x;
  p.update(0.01, input('a')); assert.ok(p.getVelocity().x < 0); assert.ok(p.x < x);
  p.applyConfig({ movement: { stopDuration: 0 } });
  const y = p.x;
  p.update(0.01, input()); near(p.getVelocity().length(), 0); near(p.x, y);
});

test('stopping tail remains collision constrained and cannot coast through a wall', () => {
  const map = mapOf(); map.tiles.forEach(row => { row[10] = 'wall'; });
  const p = new Player(200, 200);
  advance(p, 0.1, input('d', 'Shift'), map);
  p.x = 449;
  advance(p, 0.1, input(), map);
  assert.ok(p.x > 449 && p.getCollider().bounds.x + p.getCollider().bounds.width <= 500.011);
  near(p.getVelocity().length(), 0);
  assert.ok(map.queryShape(p.getCollider()).every(c => c.depth <= 0.011));
});

test('tap distance follows press duration and repeated taps cannot inherit a sustained braking tail', () => {
  for (const fps of [30, 60, 144]) {
    let previous = 0;
    for (const duration of [0.01, 0.02, 0.04, 0.08, 0.2]) {
      const p = new Player(0, 0);
      advance(p, duration, input('d'), undefined, fps);
      const heldDistance = p.x;
      advance(p, duration, input(), undefined, fps);
      near(p.getVelocity().length(), 0);
      assert.ok(p.x > previous, `${duration}s must move farther than a shorter tap`);
      assert.ok(p.x - heldDistance <= 400 * duration / 2 + 0.1, 'coasting cannot exceed the press-duration budget');
      if (duration <= 0.02) assert.ok(p.x < 12, `quick tap moved ${p.x}px`);
      if (duration === 0.04) assert.ok(p.x < 25, `40ms tap moved ${p.x}px`);
      previous = p.x;
    }
    const p = new Player(0, 0);
    advance(p, 0.3, input('d'), undefined, fps);
    advance(p, 0.01, input(), undefined, fps);
    const x = p.x;
    for (let i = 0; i < 5; i++) {
      advance(p, 0.02, input('d'), undefined, fps);
      advance(p, 0.01, input(), undefined, fps);
    }
    advance(p, 0.2, input(), undefined, fps);
    assert.ok(p.x - x < 60, 'rapid taps reset their own braking budget');
    near(p.getVelocity().length(), 0);
  }
});

test('turns have tiny damping without losing speed, while reversals and zero damping respond instantly', () => {
  const p = new Player(0, 0);
  p.update(0.04, input('d'));
  p.update(0.01, input('w')); assert.ok(p.getVelocity().x > 0); assert.ok(p.getVelocity().y < 0);
  assert.ok(p.getVelocity().length() > 385);
  p.update(0.05, input('w')); assert.ok(Math.abs(p.getVelocity().x) < 5); assert.ok(p.getVelocity().y < -399);
  p.update(0.1, input('d'));
  const x = p.x;
  p.update(1 / 60, input('a')); near(p.getVelocity().x, -400); near(p.getVelocity().y, 0); assert.ok(p.x < x);
  p.applyConfig({ movement: { turnDamping: 0 } });
  p.update(0.01, input('w')); near(p.getVelocity().x, 0); near(p.getVelocity().y, -400);
});

test('diagonals have equal speed and 30/60/144 FPS keep matching travel and stamina', () => {
  const positions = [];
  const turns = [];
  const sprintPositions = [];
  for (const fps of [30, 60, 144]) {
    const p = new Player(0, 0), diagonal = new Player(0, 0);
    advance(p, 1, input('d'), undefined, fps);
    advance(diagonal, 1, input('d', 'w'), undefined, fps);
    near(Math.hypot(diagonal.x, diagonal.y), p.x, 0.01);
    positions.push(p.x);
    advance(p, 0.1, input('w'), undefined, fps);
    turns.push([p.x, p.y]);
    const runner = new Player(0, 0);
    advance(runner, 4, input('d', 'Shift'), undefined, fps);
    sprintPositions.push(runner.x);
    near(runner.getStamina(), 0); assert.equal(runner.getIsSprinting(), false);
    assert.ok(runner.getVelocity().length() <= 400.00001);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < 0.1, positions.join(', '));
  near(positions[0], 397.6, 0.2);
  for (const [x, y] of turns) { near(x, turns[0][0], 0.1); near(y, turns[0][1], 0.1); }
  assert.ok(Math.max(...sprintPositions) - Math.min(...sprintPositions) < 0.2, sprintPositions.join(', '));
});

test('Shift smoothly reaches sprint speed in 160ms without changing base speed or shooting', () => {
  const p = new Player(0, 0);
  advance(p, 0.1, input('d'));
  p.update(0.04, input('d', 'Shift', 'MouseLeft'), undefined, mouseAim(p)); near(p.getVelocity().length(), 437.5);
  p.update(0.04, input('d', 'Shift', 'MouseLeft'), undefined, mouseAim(p)); near(p.getVelocity().length(), 520);
  p.update(0.08, input('d', 'Shift', 'MouseLeft'), undefined, mouseAim(p)); near(p.getVelocity().length(), 640);
  advance(p, 0.34, input('d', 'Shift', 'MouseLeft'));
  near(p.getMaxSpeed(), 400); near(p.getVelocity().length(), 640);
  near(p.getStamina(), 87.5); assert.equal(p.getIsSprinting(), true);
  assert.ok(p.getBullets().length >= 2); assert.ok(p.getHeatPercentage() > 0);
  p.update(1 / 60, input('d')); near(p.getVelocity().length(), 400); assert.equal(p.getIsSprinting(), false);
  p.update(0.01, input('d', 'Shift')); assert.ok(p.getVelocity().length() > 400 && p.getVelocity().length() < 405);
});

test('sprint ramp survives turns and reversals, and can be configured to respond instantly', () => {
  const p = new Player(0, 0);
  advance(p, 0.1, input('d'));
  p.update(0.08, input('d', 'Shift')); near(p.getVelocity().length(), 520);
  p.update(0.04, input('w', 'Shift')); near(p.getVelocity().length(), 602.5);
  p.update(0.04, input('a', 'Shift')); near(p.getVelocity().x, -640); near(p.getVelocity().y, 0);
  p.update(0.01, input('d'));
  p.applyConfig({ sprint: { rampDuration: 0 } });
  p.update(0.01, input('d', 'Shift')); near(p.getVelocity().length(), 640);
});

test('recovery delay crosses frame boundaries precisely and recovers while walking/shooting', () => {
  const p = new Player(0, 0);
  advance(p, 1, input('d', 'Shift')); near(p.getStamina(), 75);
  advance(p, 0.59, input('d', 'MouseLeft')); near(p.getStamina(), 75);
  p.update(0.11, input('d', 'MouseLeft'), undefined, mouseAim(p)); near(p.getStamina(), 78.5);
  advance(p, 3, input('Shift')); near(p.getStamina(), 100); assert.equal(p.getIsSprinting(), false);
});

test('exhaustion requires a release after depletion and at least 15% recovery', () => {
  const p = new Player(0, 0);
  advance(p, 4, input('d', 'Shift')); near(p.getStamina(), 0);
  advance(p, 4, input('d', 'Shift')); near(p.getStamina(), 100); assert.equal(p.getIsSprinting(), false);
  p.update(1 / 60, input('d')); p.update(1 / 60, input('d', 'Shift')); assert.equal(p.getIsSprinting(), true);
  const q = new Player(0, 0);
  advance(q, 4, input('d', 'Shift'));
  q.update(0.01, input('d')); // Releasing before recovery also satisfies the release condition.
  advance(q, 0.9, input('d', 'Shift')); assert.equal(q.getIsSprinting(), false); assert.ok(q.getStamina() < 15);
  advance(q, 0.2, input('d', 'Shift')); assert.equal(q.getIsSprinting(), true);
});

test('partially depleted stamina splits a long frame instead of granting free sprint time', () => {
  const p = new Player(0, 0);
  p.applyConfig({ sprint: { maxStamina: 5, rampDuration: 0 } });
  advance(p, 0.1, input('d'));
  const x = p.x;
  p.update(0.3, input('d', 'Shift'));
  near(p.x - x, 640 * 0.2 + 400 * 0.1, 0.001);
  near(p.getStamina(), 0); near(p.getVelocity().length(), 400); assert.equal(p.getIsSprinting(), false);
});

test('standing and blocked sprint never drain stamina; sliding does, and high speeds cannot cross a wall', () => {
  const m = mapOf(); m.tiles.forEach(row => { row[10] = 'wall'; });
  const p = new Player(200, 200);
  p.setCollider({ type: 'circle', radius: 0.5 });
  advance(p, 1, input('Shift'), m); near(p.getStamina(), 100);
  advance(p, 0.75, input('d', 'Shift'), m);
  assert.ok(p.getCollider().bounds.x + p.getCollider().bounds.width <= 500.011);
  const stamina = p.getStamina(), x = p.x;
  advance(p, 0.3, input('d', 'Shift'), m); assert.ok(p.getStamina() >= stamina); near(p.x, x, 0.001);
  const beforeSlide = p.getStamina();
  const y = p.y;
  advance(p, 0.1, input('d', 's', 'Shift'), m); assert.ok(p.y > y); assert.ok(p.getStamina() < beforeSlide);
  p.x = 100; p.y = 200; p.addModifier('maxSpeed', 4, 0, true);
  p.update(0.25, input('d', 'Shift'), m);
  assert.ok(p.getCollider().bounds.x + p.getCollider().bounds.width <= 500.011);
  assert.ok(m.queryShape(p.getCollider()).every(c => c.depth <= 0.011));
});

test('sprint multiplies speed buffs and coverage-based water slowdown', () => {
  const m = mapOf(); m.tiles.forEach(row => row.fill('water'));
  const p = new Player(200, 200); p.addModifier('maxSpeed', 0.5, 0, true);
  advance(p, 0.2, input('d', 'Shift'), m);
  near(p.getMaxSpeed(), 600); near(p.getVelocity().length(), 480);
});

test('sprint trail follows distance, stays sparse, and disappears when stationary', () => {
  const particles = new ParticleSystem(), p = new Player(0, 0, undefined, particles);
  advance(p, 0.5, input('d', 'Shift'));
  const count = particles.getPerformanceStats().activeParticles;
  assert.ok(count > 0 && count <= 14);
  advance(p, 0.2, input('Shift')); assert.equal(particles.getPerformanceStats().activeParticles, count);
  particles.update(0.2); assert.equal(particles.getPerformanceStats().activeParticles, 0);
});

test('movement/sprint configuration validates atomically, supports old fields and preserves stamina fraction', () => {
  const json = parsePlayerConfig(JSON.parse(readFileSync('public/configs/playerConfig.json', 'utf8')));
  assert.deepEqual(json.movement, DEFAULT_MOVEMENT); assert.deepEqual(json.sprint, DEFAULT_SPRINT);
  const p = new Player(0, 0);
  advance(p, 1, input('d', 'Shift')); p.applyConfig({ sprint: { maxStamina: 200 } }); near(p.getStamina(), 150);
  p.applyConfig({ base: { accel: 1, decel: 1, nonlinearFactor: 0 } });
  p.update(0.1, input()); p.update(0.08, input('d')); near(p.getVelocity().length(), 400);
  p.applyConfig({ movement: { startupDuration: 0 } }); p.update(0.01, input('d')); near(p.getVelocity().length(), 400);
  for (const config of [
    { movement: { startSpeedRatio: 1.1 } }, { movement: { startupDuration: -1 } },
    { movement: { turnDamping: -1 } },
    { movement: { stopDuration: -1 } }, { movement: { stopDuration: Infinity } },
    { sprint: { restartThreshold: 0 } }, { sprint: { restartThreshold: 1.1 } },
    { sprint: { maxStamina: 0 } }, { sprint: { speedMultiplier: 1 } },
    { sprint: { drainPerSecond: NaN } }, { sprint: { regenPerSecond: Infinity } },
    { sprint: { regenDelay: -1 } }, { movement: { unknown: 1 } },
    { sprint: { rampDuration: -1 } }, { sprint: { rampDuration: Infinity } },
  ]) assert.throws(() => p.applyConfig({ base: { maxSpeed: 999 }, ...config }));
  near(p.getMaxSpeed(), 400);
});

test('physical keys survive Shift case changes, either Shift works, and focus loss clears input', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const win = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  globalThis.window = win; globalThis.document = doc;
  const emit = (type, code, key) => {
    const event = new Event(type, { cancelable: true }); Object.assign(event, { code, key }); win.dispatchEvent(event);
  };
  try {
    const keys = new Input();
    emit('keydown', 'KeyW', 'w'); emit('keydown', 'ShiftLeft', 'Shift'); emit('keydown', 'KeyW', 'W');
    assert.ok(keys.isKeyDown('w')); assert.ok(keys.isKeyDown('W')); assert.ok(keys.isKeyDown('KeyW'));
    emit('keydown', 'ShiftRight', 'Shift'); emit('keyup', 'ShiftLeft', 'Shift'); assert.ok(keys.isKeyDown('Shift'));
    emit('keyup', 'KeyW', 'W'); assert.ok(keys.isKeyUp('w'));
    emit('keydown', 'KeyD', 'D'); emit('keyup', 'ShiftRight', 'Shift'); emit('keyup', 'KeyD', 'd'); assert.ok(keys.isKeyUp('d'));
    emit('keydown', 'ShiftRight', 'Shift'); emit('keydown', 'KeyD', 'D'); win.dispatchEvent(new Event('blur'));
    assert.ok(keys.isKeyUp('Shift')); assert.ok(keys.isKeyUp('d'));
    emit('keydown', 'KeyW', 'w'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.ok(keys.isKeyUp('w'));
    emit('keydown', 'NumpadEnter', 'Enter'); assert.ok(keys.isKeyDown('Enter'));
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});
