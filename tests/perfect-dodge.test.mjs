import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { parsePlayerConfig } = load('objects/PlayerConfig');
const { PlayerSurvivalSystem } = load('survival/PlayerSurvivalSystem');
const { TileMap } = load('map/TileMap');
const { ActorCollisionWorld } = load('physics/ActorCollisionWorld');
const { EnemySystem } = load('enemies/EnemySystem');
const { ZOMBIE_CONFIG } = load('enemies/ZombieConfig');
const idle = { isKeyDown: () => false }, shift = { isKeyDown: key => key === 'Shift' };
const melee = { kind: 'melee', amount: 12 };
const advance = (p, seconds, fps = 60) => {
  for (let left = seconds; left > 1e-10;) {
    const dt = Math.min(left, 1 / fps); p.update(dt, idle); left -= dt;
  }
};

test('perfect dodge includes roll start, excludes the 150ms endpoint and agrees across FPS', () => {
  for (const fps of [30, 60, 144]) for (const age of [0, .15 - 1e-6, .15, .15 + 1e-6, .55]) {
    const p = new Player(200, 200); assert.equal(p.requestRoll(idle), true);
    advance(p, age, fps);
    const result = p.applyDamage(melee), expected = age < .15;
    assert.equal(result.perfectDodge === true, expected, `${fps} FPS, age ${age}`);
    assert.equal(result.blocked, expected);
    assert.equal(p.getHealth(), expected ? 100 : 88);
    assert.equal(p.getStamina(), expected ? 95 : 90);
    assert.equal(p.consumeDamageEvents().length, expected ? 0 : 1);
    assert.equal(p.getHitReactProgress(), expected ? 0 : 1);
  }
});

test('all attacks inside the window are blocked with one reward, and the next roll can earn again', () => {
  const p = new Player(200, 200); p.requestRoll(idle);
  const results = [p.applyDamage(melee)];
  for (let i = 0; i < 4; i++) { p.update(.03, idle); results.push(p.applyDamage(melee)); }
  assert.ok(results.every(r => r.blocked && r.appliedAmount === 0));
  assert.equal(results.filter(r => r.perfectDodge).length, 1);
  assert.equal(p.getHealth(), 100); assert.equal(p.getStamina(), 95);
  assert.equal(p.requestRoll(idle), false, 'failed roll cannot reopen the window or reset the reward');
  p.update(.78, idle); assert.equal(p.requestRoll(idle), true);
  const before = p.getStamina(); assert.equal(p.applyDamage(melee).perfectDodge, true);
  assert.equal(p.getStamina(), before + 5);
});

test('empty rolls and zero damage give no reward, and dodges never start the melee damage grace', () => {
  const p = new Player(200, 200); p.requestRoll(idle);
  assert.equal(p.applyDamage({ ...melee, amount: 0 }).perfectDodge, undefined);
  assert.equal(p.getStamina(), 90);
  assert.equal(p.applyDamage(melee).perfectDodge, true);
  p.update(.15, idle);
  assert.equal(p.applyDamage(melee).appliedAmount, 12, 'the end of the dodge has no extra invulnerability');
  const empty = new Player(200, 200); empty.requestRoll(idle); empty.update(.5, idle);
  assert.equal(empty.getStamina(), 90);
});

test('existing melee grace takes precedence and neither infection nor script damage can be dodged', () => {
  const p = new Player(200, 200); p.applyDamage(melee); p.consumeDamageEvents();
  p.advanceDamageTimers(.3); p.requestRoll(idle);
  assert.deepEqual(p.applyDamage(melee), { appliedAmount: 0, killed: false, blocked: true });
  assert.equal(p.getStamina(), 90);
  for (const kind of ['infection', 'script']) {
    const result = p.applyDamage({ kind, amount: 1 });
    assert.equal(result.appliedAmount, 1); assert.equal(result.perfectDodge, undefined);
  }
  assert.equal(p.getHealth(), 86);
  assert.deepEqual(p.consumeDamageEvents().map(e => e.kind), ['infection', 'script']);
  p.advanceDamageTimers(.05); p.update(.05, idle);
  assert.equal(p.applyDamage(melee).perfectDodge, true, 'grace did not consume the dodge reward');
});

test('reward clamps to capacity and leaves the normal regeneration delay intact', () => {
  const full = new Player(200, 200); full.applyConfig({ roll: { staminaCost: 0 } });
  full.requestRoll(idle); assert.equal(full.applyDamage(melee).perfectDodge, true); assert.equal(full.getStamina(), 100);
  const p = new Player(200, 200); p.requestRoll(idle); p.update(.1, idle); p.applyDamage(melee);
  p.update(.4, idle); assert.equal(p.getStamina(), 95, 'no normal regeneration during the roll');
  p.update(.6, idle); assert.equal(p.getStamina(), 95, 'reward does not shorten or reset the existing delay');
  p.update(.1, idle); assert.ok(Math.abs(p.getStamina() - 98.5) < 1e-8);
});

test('reward respects both the sprint exhaustion threshold and the required Shift release', () => {
  const p = new Player(200, 200); p.setDebugState({ stamina: 10 }); p.requestRoll(shift); p.applyDamage(melee);
  assert.equal(p.getStamina(), 5); assert.equal(p.getIsExhausted(), true);
  p.update(.5, shift); p.update(.9, shift);
  assert.ok(p.getStamina() >= 15); assert.equal(p.getIsExhausted(), true, 'holding Shift keeps the exhaustion lock');
  p.update(.01, idle); assert.equal(p.getIsExhausted(), false);
  const q = new Player(200, 200); q.applyConfig({ roll: { perfectDodgeStaminaReward: 20 } });
  q.setDebugState({ stamina: 10 }); q.requestRoll(shift); q.applyDamage(melee);
  assert.equal(q.getStamina(), 20); assert.equal(q.getIsExhausted(), true, 'a large reward cannot bypass Shift release');
});

test('dodge settings are snapshotted at roll start and windows cannot outlast the action', () => {
  const p = new Player(200, 200);
  p.applyConfig({ roll: { perfectDodgeWindow: .12, perfectDodgeStaminaReward: 3 } }); p.requestRoll(idle);
  p.applyConfig({ roll: { perfectDodgeWindow: .5, perfectDodgeStaminaReward: 30 } });
  p.update(.1, idle); p.applyDamage(melee); assert.equal(p.getStamina(), 93);
  p.update(.02, idle); assert.equal(p.applyDamage(melee).appliedAmount, 12);
  p.update(.8, idle); p.advanceDamageTimers(1); assert.equal(p.requestRoll(idle), true);
  p.update(.2, idle); assert.equal(p.applyDamage(melee).perfectDodge, true); assert.equal(p.getStamina(), 100);
  const short = new Player(200, 200); short.applyConfig({ roll: { duration: .05, perfectDodgeWindow: .5 } });
  short.requestRoll(idle); short.update(.05, idle); assert.equal(short.applyDamage(melee).appliedAmount, 12);
  const long = new Player(200, 200); long.requestRoll(idle); long.update(2, idle);
  assert.equal(long.applyDamage(melee).appliedAmount, 12, 'a long frame cannot leave a stale dodge window');
});

test('zero window disables dodging; zero reward preserves immunity and the first-success flag', () => {
  const off = new Player(200, 200); off.applyConfig({ roll: { perfectDodgeWindow: 0 } }); off.requestRoll(idle);
  assert.equal(off.applyDamage(melee).appliedAmount, 12);
  const free = new Player(200, 200); free.applyConfig({ roll: { perfectDodgeStaminaReward: 0 } }); free.requestRoll(idle);
  assert.equal(free.applyDamage(melee).perfectDodge, true); assert.equal(free.getStamina(), 90);
  assert.equal(free.applyDamage(melee).perfectDodge, false);
  for (const key of ['perfectDodgeWindow', 'perfectDodgeStaminaReward']) {
    for (const value of [-1, NaN, Infinity, '5']) assert.throws(() => parsePlayerConfig({ roll: { [key]: value } }), new RegExp(key));
    assert.equal(parsePlayerConfig({ roll: { [key]: 0 } }).roll[key], 0);
  }
});

test('death and life reset clear the dodge window and a fresh roll can reward again', () => {
  for (const kill of [false, true]) {
    const p = new Player(200, 200); p.requestRoll(idle); p.applyDamage(melee);
    if (kill) { p.takeDamage(100); assert.equal(p.applyDamage(melee).perfectDodge, undefined); }
    p.resetLifeState(); const before = p.getStamina();
    assert.equal(p.applyDamage(melee).appliedAmount, 12); assert.equal(p.getStamina(), before);
    p.advanceDamageTimers(1); p.update(1, idle); assert.equal(p.requestRoll(idle), true);
    assert.equal(p.applyDamage(melee).perfectDodge, true);
  }
});

test('perfect dodge cannot infect the player or consume the infection random stream', () => {
  const p = new Player(200, 200), survival = new PlayerSurvivalSystem(p);
  let rolls = 0; const random = () => { rolls++; return 0; };
  p.requestRoll(idle);
  for (let i = 0; i < 3; i++) assert.equal(survival.onMeleeDamage(p.applyDamage(melee), 1, random), false);
  assert.equal(rolls, 0); assert.equal(survival.snapshot().infected, false);
  p.update(.15, idle); assert.equal(survival.onMeleeDamage(p.applyDamage(melee), 1, random), true); assert.equal(rolls, 1);
});

test('real enemy settlement only rewards attacks that intersect the player with line of sight', () => {
  for (const scenario of ['hit', 'miss', 'wall']) {
    const map = new TileMap(16, 16, { seed: 7, generateWater: false }); map.tiles.forEach(row => row.fill('default'));
    const actors = new ActorCollisionWorld(map), enemies = new EnemySystem(map, actors, 3);
    const p = new Player(275 - 24.5, 225 - 24.5), z = enemies.add('shambler', { x: 225, y: 225 }, 0);
    actors.register('player', p);
    z.attack.start(0, 0);
    if (scenario === 'miss') p.x = 175 - 24.5;
    if (scenario === 'wall') map.tiles[4][5] = 'wall';
    map.invalidateNavigation(); p.requestRoll(idle);
    const body = p.getCollider();
    enemies.update(ZOMBIE_CONFIG.shambler.windup, { target: { ...body.pose, radius: body.radius, alive: true }, lights: [], playerNoises: [] });
    const results = []; enemies.settleAttacks(p, result => results.push(result));
    assert.equal(p.getHealth(), 100); assert.equal(p.getStamina(), scenario === 'hit' ? 95 : 90);
    assert.equal(results.filter(r => r.perfectDodge).length, scenario === 'hit' ? 1 : 0);
    enemies.settleAttacks(p, () => assert.fail('attacks must be consumed once'));
  }
});
