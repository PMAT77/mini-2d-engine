import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { PlayerPunchController, PUNCH_MOVES } = load('combat/PlayerPunchController');
const { Player } = load('objects/Player');
const { Input } = load('core/Input');
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { Chicken } = load('objects/Chicken');
const { circleCollider } = load('physics/Collider');
const { resolveFirstMeleeHit } = load('combat/HitTargetResolver');
const { computeKnockbackSpeed, createKnockbackProfile } = load('combat/KnockbackProfiles');
const { createPlayerRenderSnapshot } = load('objects/animation/PlayerVisualAdapter');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
const idle = { isKeyDown: () => false };
const aim = times => ({ target: { x: 900, y: 424.5 }, face: true, fire: false, punchPressTimes: times });

function run(times, fps = 60) {
  const controller = new PlayerPunchController(), hits = [], costs = [];
  let index = 0;
  for (let frame = 0; frame < fps * 2; frame++) {
    const presses = [];
    while (index < times.length && times[index] <= frame / fps * 1000 + 1e-8) presses.push(times[index++]);
    controller.update(1 / fps, presses, cost => { costs.push(cost); return true; });
    hits.push(...controller.consumeImpacts().map(event => event.moveId));
  }
  return { hits, costs, state: controller.snapshot() };
}

test('three rhythms branch per click with the same ordered impacts and stamina at 30/60/144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    for (const [times, hits, costs] of [
      [[0, 150, 300], ['jab', 'cross', 'leftHook'], [3, 4, 5]],
      [[0, 360, 510], ['jab', 'rightHook', 'uppercut'], [3, 4, 6]],
      [[0, 150, 510], ['jab', 'cross', 'heavyStraight'], [3, 4, 7]],
    ]) assert.deepEqual(run(times, fps), { hits, costs, state: null });
  }
});

test('240ms is fast, 550ms is still a pause, timeout and two pauses restart with a jab', () => {
  assert.deepEqual(run([0, 240, 480]).hits, ['jab', 'cross', 'leftHook']);
  assert.deepEqual(run([0, 240.01, 400]).hits, ['jab', 'rightHook', 'uppercut']);
  assert.deepEqual(run([0, 550, 700]).hits, ['jab', 'rightHook', 'uppercut']);
  assert.deepEqual(run([0, 550.01]).hits, ['jab', 'jab']);
  assert.deepEqual(run([0, 350, 700]).hits, ['jab', 'rightHook', 'jab']);
  assert.deepEqual(run([0]).hits, ['jab']);
  assert.deepEqual(run([0, 150]).hits, ['jab', 'cross']);
});

test('multiple clicks in a frame buffer two actions, never restart the first and reject clicks during the finisher', () => {
  const c = new PlayerPunchController(), costs = [], spend = cost => { costs.push(cost); return true; };
  c.update(0, [0, 80, 160, 170], spend);
  assert.deepEqual(c.snapshot(), { moveId: 'jab', progress: 0 });
  assert.deepEqual(costs, [3], 'queued attacks are not charged early');
  c.update(.5, [180], spend);
  assert.equal(c.snapshot().moveId, 'leftHook');
  assert.deepEqual(c.consumeImpacts().map(hit => hit.moveId), ['jab', 'cross']);
  c.update(1, [190], spend);
  assert.deepEqual(c.consumeImpacts().map(hit => hit.moveId), ['leftHook']);
  assert.deepEqual(costs, [3, 4, 5]);
  c.update(0, [1200], spend);
  assert.equal(c.snapshot().moveId, 'jab', 'a fresh click after recovery starts the next chain');
});

test('insufficient stamina discards queued actions without revoking a punch already landed in the same long frame', () => {
  const c = new PlayerPunchController(); let stamina = 3;
  c.update(0, [0, 80, 160], cost => { if (stamina < cost) return false; stamina -= cost; return true; });
  c.update(.8, [], () => false);
  assert.deepEqual(c.consumeImpacts().map(hit => hit.moveId), ['jab']);
  assert.equal(c.snapshot(), null);
  c.update(1, [], () => true); assert.deepEqual(c.consumeImpacts(), [], 'regenerating stamina cannot auto-start buffered punches');
});

test('input keeps every aimed press timestamp, never acquires a left-first chord, and clears on handoff', () => {
  const savedWindow = globalThis.window, savedDocument = globalThis.document;
  const events = {}, canvasEvents = {};
  globalThis.window = { addEventListener: (name, fn) => { events[name] = fn; } };
  globalThis.document = { hidden: false, addEventListener() {} };
  try {
    const input = new Input({ style: {}, addEventListener: (name, fn) => { canvasEvents[name] = fn; } });
    input.setPointerEnabled(true);
    const down = (button, timeStamp) => canvasEvents.mousedown({ button, timeStamp, defaultPrevented: false });
    down(0, 0); down(2, 1);
    assert.deepEqual(input.consumePointerState().aimFirePressTimes, []);
    events.mouseup({ button: 0 }); down(0, 80); events.mouseup({ button: 0 }); down(0, 160);
    const frame = input.captureFrame();
    assert.deepEqual(frame.consumePointerState().aimFirePressTimes, [80, 160]);
    assert.deepEqual(frame.consumePointerState().aimFirePressTimes, []);
    assert.deepEqual(input.consumePointerState().aimFirePressTimes, []);
    events.mouseup({ button: 2 }); down(2, 170);
    assert.equal(input.consumePointerState().aimInterrupted, true, 'a release survives immediate aim reacquisition');
    for (const clear of [() => input.clear(), () => canvasEvents.pointerleave(), () => events.blur(),
      () => input.setBlocked(true), () => events.mouseup({ button: 2 })]) {
      input.setBlocked(false); down(2, 200); down(0, 210); clear();
      assert.deepEqual(input.consumePointerState().aimFirePressTimes, []);
    }
  } finally { globalThis.window = savedWindow; globalThis.document = savedDocument; }
});

function player() {
  const p = new Player(400, 400); p.switchWeapon('melee'); p.currentRotation = Math.PI; p.weaponSwapTime = 0;
  return p;
}

test('empty hands use a bent-elbow guard and distinct punches while firearms and legs retain their own pose', () => {
  const p = player(); p.update(.1, idle, undefined, aim([]));
  const guard = p.getNormalPose();
  assert.ok(guard.leftHandX > .4 && guard.rightHandX > .3);
  assert.ok(guard.leftElbowY < guard.leftHandY && guard.rightElbowY > guard.rightHandY);
  const before = createPlayerRenderSnapshot(p);
  p.update(.096, idle, undefined, aim([0]));
  const action = createPlayerRenderSnapshot(p);
  assert.ok(action.world.world.handL.x > before.world.world.handL.x + .5);
  assert.equal(action.world.world.footL.x, before.world.world.footL.x);
  assert.equal(p.getBullets().length, 0);
  p.switchWeapon('secondary'); p.update(.1, idle, undefined, aim([100]));
  assert.equal(p.getPunchSnapshot(), null);
  assert.ok(p.getNormalPose().rightHandX > .5, 'firearm aiming still extends the shooting arm');
});

test('release, roll, equipment, blocked input and death cancel current hits and buffers with no stamina refund', () => {
  for (const cancel of [p => p.update(0, idle), p => p.requestRoll(idle), p => p.switchWeapon('primary'),
    p => { p.holdingThrowable = true; }, p => p.update(0, { ...idle, isBlocked: () => true }, undefined, aim([])),
    p => p.takeDamage(1000), p => p.resetLifeState()]) {
    const p = player(); p.update(0, idle, undefined, aim([0, 80, 160]));
    assert.equal(p.getStamina(), 97);
    cancel(p);
    assert.equal(p.getPunchSnapshot(), null);
    assert.deepEqual(p.consumePunchImpacts(), []);
    assert.ok(p.getStamina() <= 97);
  }
});

test('sector targeting includes target radius once, chooses one nearest visible target and ignores the rear', () => {
  const entry = (id, x, y, radius = 10) => ({ id, target: { isDamageable: () => true, getCollider: () => circleCollider(x, y, radius) } });
  const origin = { x: 0, y: 0 }, query = entries => resolveFirstMeleeHit(origin, 0, 64, Math.PI * 35 / 180, entries, () => false);
  const far = entry('edge', 74, 0), near = entry('near', 48, 0), rear = entry('rear', -30, 0);
  assert.equal(query([far]).entry.id, 'edge');
  assert.equal(query([entry('outside', 74.01, 0)]), null);
  assert.equal(query([rear]), null);
  assert.equal(query([far, near]).entry.id, 'near');
  assert.equal(resolveFirstMeleeHit(origin, 0, 64, Math.PI / 4, [near], () => true), null);
});

function fixture() {
  const map = new TileMap(24, 20, { seed: 42, generateWater: false });
  map.tiles.forEach(row => row.fill('default')); map.invalidateNavigation();
  const scene = new GameScene({ map, seed: 42, chickenCount: 0, playerSpawn: { x: 400, y: 400 },
    encounters: { shambler: 0, runner: 0, vaccines: 0, grenades: 0, smokeGrenades: 0, tradingStations: 0 } });
  scene.player.switchWeapon('melee'); scene.player.currentRotation = Math.PI;
  return { scene, map, p: scene.player, add: (x = 484.5, y = 424.5) => scene.getEnemySystem().add('runner', { x, y }, 0) };
}

test('scene punches apply modified body damage once, real knockback and ordinary kill score without bullets', () => {
  const { scene, p, add } = fixture(), z = add();
  p.addModifier('damage', 1, 0, true);
  p.update(.1, idle, undefined, aim([0])); scene.settlePlayerPunches();
  assert.equal(z.getHealth(), 24, '8 damage with the existing 2x boost, without a head multiplier');
  scene.settlePlayerPunches(); assert.equal(z.getHealth(), 24);
  const x = z.x; z.update(.1, idle); assert.ok(z.x > x, 'zero projectile speed still delivers melee impulse');
  // Move the hurt zombie back into range before the heavy finisher.
  z.x = 462.5; z.y = 402.5;
  p.update(.1, idle, undefined, aim([150])); scene.settlePlayerPunches();
  p.update(.25, idle, undefined, aim([500])); scene.settlePlayerPunches();
  p.update(.5, idle, undefined, aim([])); scene.settlePlayerPunches();
  assert.equal(z.isAlive(), false);
  assert.ok(scene.getCombatScoreState().score > 0);
  assert.equal(scene.getCombatScoreState().goldKills, 0, 'melee finishers do not award headshot quality');
  assert.equal(p.getBullets().length, 0);
});

test('walls and static obstacles block fists, and chickens share the same hit pipeline', () => {
  const { scene, map, p, add } = fixture(), z = add();
  map.setStaticObstacles([circleCollider(454, 424.5, 5)]);
  p.update(.1, idle, undefined, aim([0])); scene.settlePlayerPunches(); assert.equal(z.getHealth(), 40);
  map.setStaticObstacles([]); p.cancelPunch();
  map.tiles[8][9] = 'wall'; map.invalidateNavigation();
  p.update(.1, idle, undefined, aim([500])); scene.settlePlayerPunches(); assert.equal(z.getHealth(), 40, 'terrain walls also block fists');
  map.tiles[8][9] = 'default'; map.invalidateNavigation(); p.cancelPunch();
  const chicken = new Chicken(450, 410); scene.chickens = [chicken];
  const health = chicken.getHealth();
  p.update(.1, idle, undefined, aim([1000])); scene.settlePlayerPunches();
  assert.equal(chicken.getHealth(), Math.max(0, health - 8)); assert.equal(z.getHealth(), 40, 'one punch cannot hit a second target');
  const profile = createKnockbackProfile();
  assert.equal(computeKnockbackSpeed({ source: 'melee', impulse: 100, impactSpeed: 0, initialSpeed: 0 }, profile), 100);
});
