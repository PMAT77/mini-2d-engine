import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { Input } = load('core/Input');
const { EnemySystem, selectPlayerNoises } = load('enemies/EnemySystem');
const { TileMap } = load('map/TileMap');
const { ActorCollisionWorld } = load('physics/ActorCollisionWorld');
const { NoiseSystem } = load('core/NoiseSystem');
const { Player } = load('objects/Player');

test('frame input freezes keys and click edges; held repeat cannot reacquire ownership after pause', t => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document, events = {}, canvasEvents = {};
  globalThis.window = { addEventListener: (n, f) => events[n] = f };
  globalThis.document = { addEventListener() {} };
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
  const input = new Input({ style: {}, addEventListener: (n, f) => canvasEvents[n] = f }); input.setPointerEnabled(true);
  events.keydown({ code: 'KeyD', preventDefault() {} });
  canvasEvents.mousedown({ button: 0, clientX: 10, clientY: 20 }); events.mouseup({ button: 0 });
  const frame = input.captureFrame(); events.keyup({ code: 'KeyD' });
  assert.equal(frame.isKeyDown('d'), true); assert.equal(input.isKeyDown('d'), false);
  assert.equal(frame.consumePointerState().leftPressed, true); assert.equal(input.consumePointerState().leftPressed, false);
  input.setBlocked(true); input.setBlocked(false);
  events.keydown({ code: 'KeyV', repeat: true, preventDefault() {} }); assert.equal(input.isKeyDown('v'), false);
  events.keyup({ code: 'KeyV' }); events.keydown({ code: 'KeyV', repeat: false, preventDefault() {} }); assert.equal(input.isKeyDown('v'), true);
});

test('zombie noises use actual movement and stop at death, while never entering player-tracking stimuli', () => {
  const map = new TileMap(20, 20, { generateWater: false, seed: 2 }); map.tiles.forEach(r => r.fill('default')); map.invalidateNavigation();
  const bus = new NoiseSystem(8, 1024), actors = new ActorCollisionWorld(map), system = new EnemySystem(map, actors, 3, bus);
  const z = system.add('runner', { x: 225, y: 225 }, 0), target = { x: 275, y: 225, alive: true, radius: 24.5 };
  for (let i = 0; i < 20; i++) system.update(1/60, { target, lights: [], playerNoises: [] });
  assert.ok(bus.getEvents().some(e => e.kind === 'zombieAttack')); assert.equal(selectPlayerNoises(bus.getEvents()).length, 0);
  system.receiveHit(z, { damage: 100, point: z.getCenter(), direction: { x: 1, y: 0 }, impulse: 0, initialSpeed: 1, impactSpeed: 1, traveledDistance: 0, source: 'bullet' });
  const count = bus.getEvents().length;
  for (let i = 0; i < 600; i++) system.update(1/60, { target, lights: [], playerNoises: [] });
  assert.equal(bus.getEvents().length, count); assert.equal(actors.size, 0);
  system.dispose(); assert.equal(system.zombies.length, 0);
});

test('player death clears every weapon reload and direct active inputs; reset life removes protection', () => {
  const player = new Player(100, 100);
  player.setDebugState({ magazineAmmo: 0, chambered: false }); player.requestReload(); player.cycleFirearm(1);
  player.setDebugState({ magazineAmmo: 0, chambered: false }); player.requestReload();
  player.takeDamage(100);
  const loadout = player.getWeaponLoadoutView(); assert.equal(loadout.primary.isReloading, false); assert.equal(loadout.secondary.isReloading, false);
  player.resetLifeState(); assert.equal(player.applyDamage({ kind: 'melee', amount: 1 }).appliedAmount, 1);
});
