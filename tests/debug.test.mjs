import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');
const { parsePlayerConfig } = load('objects/PlayerConfig');
const { Input } = load('core/Input');
const idle = { isKeyDown: () => false };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('debug configuration keeps defaults, owns snapshots and rejects invalid patches atomically', () => {
  const player = new Player(0, 0);
  player.applyConfig({});
  assert.equal(player.getMaxHealth(), 100);
  assert.equal(player.getConfigSnapshot().shooting.damage, 10);
  const snapshot = player.getConfigSnapshot();
  snapshot.base.maxHealth = 999; snapshot.sprint.maxStamina = 999; snapshot.collider.center[0] = 1;
  assert.equal(player.getMaxHealth(), 100); assert.equal(player.getMaxStamina(), 100);
  assert.deepEqual(player.getConfigSnapshot().collider.center, [0, 0]);
  for (const patch of [{ base: { maxSpeed: 700, maxHealth: 0 } }, { shooting: { fireRate: 0.1, damage: -1 } }, { base: { maxHealth: Infinity } }]) {
    assert.throws(() => player.applyConfig(patch));
  }
  assert.equal(player.getMaxSpeed(), 400); assert.equal(player.getFireRate(), 0.2);
  const before = player.getDebugState();
  for (const patch of [{ health: 20, stamina: NaN }, { health: 20, unknown: 1 }, { overheatCooldownRemaining: 0.5 }, null, []]) {
    assert.throws(() => player.setDebugState(patch)); assert.deepEqual(player.getDebugState(), before);
  }
  assert.throws(() => parsePlayerConfig({ shooting: { damage: '20' } }));
});

test('configured damage affects new bullets, preserves explicit damage and stacks with existing boosts', () => {
  const player = new Player(0, 0), dir = new Vector2(1, 0);
  player.shoot(dir);
  assert.equal(player.getBullets()[0].getDamage(), 10);
  player.applyConfig({ shooting: { damage: 25, fireRate: 0.1 } });
  player.addModifier('damage', 0.5, 0, true);
  player.update(0.2, idle); player.shoot(dir);
  assert.equal(player.getBullets()[0].getDamage(), 10);
  assert.equal(player.getBullets()[1].getDamage(), 37.5);
  player.update(0.2, idle); player.shoot(dir, 6);
  assert.equal(player.getBullets()[2].getDamage(), 9);
  assert.equal(player.getConfigSnapshot().shooting.damage, 25);
  assert.equal(player.getDebugState().effectiveDamage, 37.5);
});

test('resource capacity edits preserve fractions and direct current-value edits clamp to capacity', () => {
  const player = new Player(0, 0);
  player.setDebugState({ health: 25, stamina: 40, heatPercentage: 30 });
  player.applyConfig({ base: { maxHealth: 200 }, sprint: { maxStamina: 150 }, shooting: { maxShootingTime: 7 } });
  near(player.getHealth(), 50); near(player.getStamina(), 60); near(player.getDebugState().heatPercentage, 30);
  player.setDebugState({ health: 999, stamina: 999 });
  assert.equal(player.getHealth(), 200); assert.equal(player.getStamina(), 150);
  player.setDebugState({ health: -1 }); assert.equal(player.getHealth(), 0);
  player.setDebugState({ heatPercentage: 100 }); player.update(0.25, idle);
  player.applyConfig({ shooting: { maxOverheatCooldownTime: 2 } });
  near(player.getDebugState().overheatCooldownRemaining, 1.5);
});

test('zero stamina exhausts, deliberate refill unlocks sprint and overheating can be triggered or cleared', () => {
  const player = new Player(0, 0);
  player.setDebugState({ stamina: 0 });
  assert.equal(player.getDebugState().exhausted, true);
  player.update(0.01, { isKeyDown: key => ['Shift', 'd'].includes(key) });
  assert.equal(player.getIsSprinting(), false);
  player.setDebugState({ stamina: 100 });
  assert.equal(player.getDebugState().exhausted, false);
  player.update(0.1, { isKeyDown: key => ['Shift', 'd'].includes(key) });
  assert.equal(player.getIsSprinting(), true);
  player.setDebugState({ heatPercentage: 100 });
  assert.equal(player.getIsOverheated(), true);
  assert.throws(() => player.setDebugState({ health: 12, heatPercentage: 50, overheatCooldownRemaining: 0.5 }));
  assert.equal(player.getHealth(), 100); assert.equal(player.getIsOverheated(), true);
  player.shoot(new Vector2(1, 0)); assert.equal(player.getBullets().length, 0);
  player.setDebugState({ overheatCooldownRemaining: 999 });
  assert.equal(player.getDebugState().overheatCooldownRemaining, 1);
  player.setDebugState({ overheatCooldownRemaining: 0 });
  assert.equal(player.getIsOverheated(), false); assert.equal(player.getHeatPercentage(), 0);
  player.shoot(new Vector2(1, 0)); assert.equal(player.getBullets().length, 1);
  player.setDebugState({ heatPercentage: 100 }); player.setDebugState({ heatPercentage: 25 });
  assert.equal(player.getIsOverheated(), false); near(player.getDebugState().heatPercentage, 25);
});

test('restoring a detached initial configuration refills resources without removing pickup modifiers', () => {
  const player = new Player(0, 0), initial = player.getConfigSnapshot();
  player.addModifier('maxSpeed', 0.5, 0, true); player.addModifier('damage', 1, 0, true);
  player.applyConfig({ base: { maxSpeed: 600, maxHealth: 50 }, shooting: { damage: 40 } });
  player.setDebugState({ health: 0, stamina: 0, heatPercentage: 100 });
  player.applyConfig(initial);
  player.setDebugState({ health: player.getMaxHealth(), stamina: player.getMaxStamina(), heatPercentage: 0 });
  assert.deepEqual(player.getConfigSnapshot(), initial);
  assert.equal(player.getHealth(), 100); assert.equal(player.getStamina(), 100);
  assert.equal(player.getIsOverheated(), false); assert.equal(player.getDebugState().exhausted, false);
  assert.equal(player.getMaxSpeed(), 600); assert.equal(player.getDebugState().effectiveDamage, 20);
});

test('keyboard ownership clears held movement and aim and ignores game keys until released by UI', t => {
  const events = {};
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  });
  globalThis.window = { addEventListener: (name, handler) => { events[name] = handler; } };
  globalThis.document = { addEventListener() {} };
  const input = new Input();
  const down = code => events.keydown({ code, preventDefault() {} });
  down('KeyD'); down('ArrowRight'); assert.equal(input.isKeyDown('d'), true);
  input.setBlocked(true); assert.equal(input.isKeyDown('d'), false);
  assert.equal(input.isKeyDown('ArrowRight'), false); assert.equal(input.getPointerState().active, false);
  down('KeyW'); down('ArrowUp'); assert.equal(input.isKeyDown('w'), false);
  input.setBlocked(false); assert.equal(input.isKeyDown('w'), false);
  down('KeyW'); assert.equal(input.isKeyDown('w'), true);
});
