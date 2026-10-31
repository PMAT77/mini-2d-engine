import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');
const { parsePlayerConfig } = load('objects/PlayerConfig');
const { DEFAULT_GRAPHICS_CONFIG, cloneGraphicsConfig, parseGraphicsConfig } = load('core/GraphicsConfig');
const { DEFAULT_AUDIO_CONFIG, cloneAudioConfig, parseAudioConfig } = load('core/AudioConfig');
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
  assert.equal(player.getMaxSpeed(), 200); assert.equal(player.getFireRate(), 0.2);
  const before = player.getDebugState();
  for (const patch of [{ health: 20, stamina: NaN }, { health: 20, unknown: 1 }, { chambered: 1 }, { reloadProgress: NaN }, null, []]) {
    assert.throws(() => player.setDebugState(patch)); assert.deepEqual(player.getDebugState(), before);
  }
  assert.throws(() => parsePlayerConfig({ shooting: { damage: '20' } }));
});

test('configured damage affects new bullets, preserves explicit damage and stacks with existing boosts', () => {
  const player = new Player(0, 0), dir = new Vector2(1, 0);
  player.shoot(dir);
  const first = player.getBullets().at(-1);
  assert.equal(first.getDamage(), 10);
  player.applyConfig({ shooting: { damage: 25, fireRate: 0.1 } });
  player.addModifier('damage', 0.5, 0, true);
  player.update(0.2, idle); player.shoot(dir);
  assert.equal(first.getDamage(), 10);
  assert.equal(player.getBullets().at(-1).getDamage(), 37.5);
  player.update(0.2, idle); player.shoot(dir, 6);
  assert.equal(player.getBullets().at(-1).getDamage(), 9);
  assert.equal(player.getConfigSnapshot().shooting.damage, 25);
  assert.equal(player.getDebugState().effectiveDamage, 37.5);
});

test('resource capacity edits preserve fractions and direct current-value edits clamp to capacity', () => {
  const player = new Player(0, 0);
  player.setDebugState({ health: 25, stamina: 40, magazineAmmo: 3, chambered: false, reloadProgress: 50 });
  player.applyConfig({ base: { maxHealth: 200 }, sprint: { maxStamina: 150 }, shooting: { reloadDuration: 4 } });
  near(player.getHealth(), 50); near(player.getStamina(), 60); near(player.getDebugState().reloadProgress, 50);
  player.setDebugState({ health: 999, stamina: 999 });
  assert.equal(player.getHealth(), 200); assert.equal(player.getStamina(), 150);
  player.setDebugState({ health: -1 }); assert.equal(player.getHealth(), 0);
  player.setDebugState({ magazineAmmo: 99 }); assert.equal(player.getMagazineAmmo(), 6);
  assert.equal(player.getIsReloading(), false);
  player.setDebugState({ magazineAmmo: 2 }); assert.equal(player.getMagazineAmmo(), 2);
  player.setDebugState({ chambered: false }); assert.equal(player.getChambered(), false);
});

test('zero stamina exhausts, deliberate refill unlocks sprint and an empty magazine blocks fire until reload', () => {
  const player = new Player(0, 0);
  player.setDebugState({ stamina: 0 });
  assert.equal(player.getDebugState().exhausted, true);
  player.update(0.01, { isKeyDown: key => ['Shift', 'd'].includes(key) });
  assert.equal(player.getIsSprinting(), false);
  player.setDebugState({ stamina: 100 });
  assert.equal(player.getDebugState().exhausted, false);
  player.update(0.1, { isKeyDown: key => ['Shift', 'd'].includes(key) });
  assert.equal(player.getIsSprinting(), true);
  player.setDebugState({ magazineAmmo: 0, chambered: false });
  assert.throws(() => player.setDebugState({ health: 12, chambered: 1 }));
  assert.equal(player.getHealth(), 100);
  player.shoot(new Vector2(1, 0)); assert.equal(player.getBullets().length, 0);
  // 自动换弹默认关闭：空弹匣时按开火没有弹药，只能按 R 或勾选调试开关。
  player.update(0.01, idle);
  assert.equal(player.getIsReloading(), false);
  player.setAutoReload(true);
  player.update(0.01, idle);
  assert.equal(player.getIsReloading(), true);
  player.shoot(new Vector2(1, 0)); assert.equal(player.getBullets().length, 0);
  player.setDebugState({ reloadProgress: 100 });
  assert.equal(player.getMagazineAmmo(), 6); assert.equal(player.getChambered(), true);
  assert.equal(player.getIsReloading(), false);
  player.update(0.01, idle);
  player.shoot(new Vector2(1, 0)); assert.equal(player.getBullets().length, 1);
  player.setDebugState({ magazineAmmo: 6, chambered: true });
  assert.equal(player.getIsReloading(), false);
});

test('restoring a detached initial configuration refills resources without removing pickup modifiers', () => {
  const player = new Player(0, 0), initial = player.getConfigSnapshot();
  player.addModifier('maxSpeed', 0.5, 0, true); player.addModifier('damage', 1, 0, true);
  player.applyConfig({ base: { maxSpeed: 600, maxHealth: 50 }, shooting: { damage: 40 } });
  player.setDebugState({ health: 0, stamina: 0, magazineAmmo: 0, chambered: false });
  player.applyConfig(initial);
  player.setDebugState({ health: player.getMaxHealth(), stamina: player.getMaxStamina(),
    magazineAmmo: player.getMagazineSize(), chambered: true });
  assert.deepEqual(player.getConfigSnapshot(), initial);
  assert.equal(player.getHealth(), 100); assert.equal(player.getStamina(), 100);
  assert.equal(player.getIsReloading(), false); assert.equal(player.getDebugState().exhausted, false);
  assert.equal(player.getMaxSpeed(), 300); assert.equal(player.getDebugState().effectiveDamage, 20);
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

test('graphics and audio configs merge defaults and reject invalid fields', () => {
  assert.deepEqual(parseGraphicsConfig({}), DEFAULT_GRAPHICS_CONFIG);
  assert.deepEqual(parseGraphicsConfig({}).camera, { zoom: 1 });
  const partial = parseGraphicsConfig({ camera: { zoom: 1.2 }, ambient: { color: '#aabbcc' } });
  assert.equal(partial.camera.zoom, 1.2);
  assert.equal(partial.ambient.color, '#AABBCC', 'colors are normalized');
  assert.equal(partial.playerLight.radius, 100, 'untouched fields keep their defaults');
  for (const bad of [
    { camera: { zoom: 0.2 } }, { camera: { zoom: 3 } }, { unknown: {} },
    { ambient: { color: '#fff' } }, { flashlight: { angle: 0 } }, { flashlight: { angle: 181 } },
    { flashlight: { softness: 0.9 } }, { fog: { range: 0 } },
  ]) assert.throws(() => parseGraphicsConfig(bad), JSON.stringify(bad));
  assert.throws(() => parseGraphicsConfig({ camera: { foo: 1 } }));
  assert.throws(() => parseGraphicsConfig(null));

  assert.deepEqual(parseAudioConfig({}), DEFAULT_AUDIO_CONFIG);
  const quiet = parseAudioConfig({ master: 0, chicken: { range: 800 } });
  assert.equal(quiet.master, 0);
  assert.equal(quiet.chicken.range, 800);
  assert.equal(quiet.weapon.primaryVolume, 0.55, 'untouched volumes keep their defaults');
  for (const bad of [{ master: -0.1 }, { master: 1.1 }, { unknown: 1 }, { chicken: { range: -1 } }, { chicken: { minAttenuation: 2 } }]) {
    assert.throws(() => parseAudioConfig(bad), JSON.stringify(bad));
  }

  const graphics = cloneGraphicsConfig();
  graphics.camera.zoom = 1.5;
  assert.equal(DEFAULT_GRAPHICS_CONFIG.camera.zoom, 1, 'clone does not alias defaults');
  const audio = cloneAudioConfig();
  audio.master = 0.3;
  assert.equal(DEFAULT_AUDIO_CONFIG.master, 1);
});
