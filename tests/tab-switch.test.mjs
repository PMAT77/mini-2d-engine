import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { Input } = load('core/Input');

globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const ground = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

const makeScene = () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.loaded = true;
  scene.map = ground();
  // 键位绑定与拾取无关，这里不需要三层感知。
  scene.perception = undefined;
  scene.player.x = 400;
  scene.player.y = 400;
  return scene;
};

const keysDown = (...codes) => ({
  isKeyDown: key => codes.includes(key),
  isBlocked: () => false,
});

const step = (scene, frames, input = keysDown()) => {
  for (let frame = 0; frame < frames; frame++) scene.update(1 / 60, input);
};

const wheelInput = (direction, ...keys) => ({ ...keysDown(...keys), consumeWheelDirection() {
  const sample = direction; direction = 0; return sample;
} });

test('wheel switches firearms once per frame, restores empty hands and respects dropped weapons', () => {
  const scene = makeScene(), scroll = wheelInput(1);
  step(scene, 1, scroll);
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');
  step(scene, 30, scroll);
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary', 'wheel is consumed once');
  step(scene, 1, wheelInput(-1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary', 'either direction switches');
  step(scene, 1, wheelInput(1, 'Tab'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary', 'only wheel switches the weapon; Tab belongs to the backpack');
  step(scene, 1, keysDown('c'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'melee');
  step(scene, 1, wheelInput(-1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary', 'restores last firearm');
  scene.player.dropWeapon('secondary');
  step(scene, 1, wheelInput(1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');
  assert.equal(scene.weaponSwitchedThisFrame, false, 'only one firearm makes no false switch signal');
  scene.player.dropWeapon('primary');
  step(scene, 1, wheelInput(-1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'melee', 'does not reacquire a dropped weapon');
});

test('wheel cancels consumable use before completion, blocks simultaneous V and respects UI, pause and death', () => {
  const scene = makeScene(); scene.survival.inventory.addVaccines(); scene.survival.infection.infect();
  scene.quickSlotBindings[1] = 'vaccine';
  scene.quickItemUse = { slot: 1, elapsed: .999, inputReset: undefined };
  step(scene, 1, wheelInput(1, 'v'));
  assert.equal(scene.quickItemUse, undefined);
  assert.equal(scene.survival.inventory.getVaccines(), 1, 'switching does not finish or start a vaccine use');
  assert.equal(scene.survival.infection.isInfected(), true);
  assert.equal(scene.weaponSwitchedThisFrame, true, 'wheel is available to pickup interruption');
  const blocked = wheelInput(-1); blocked.isBlocked = () => true;
  step(scene, 1, blocked); assert.equal(scene.player.getActiveWeaponSlot(), 'primary');
  scene.paused = true; step(scene, 1, wheelInput(-1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');
  scene.paused = false; scene.player.takeDamage(1000); step(scene, 1, wheelInput(-1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');
});

test('canvas wheel input owns only vertical game scrolling and clears buffered scroll on every input handoff', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const events = {}, canvasEvents = {}, documentEvents = {}, options = {};
  globalThis.window = { addEventListener: (name, fn) => { events[name] = fn; } };
  globalThis.document = { hidden: false, addEventListener: (name, fn) => { documentEvents[name] = fn; } };
  const canvas = { style: {}, addEventListener(name, fn, option) { canvasEvents[name] = fn; options[name] = option; } };
  try {
    const input = new Input(canvas);
    const wheel = (deltaY, extra = {}) => {
      let prevented = false;
      canvasEvents.wheel({ deltaY, defaultPrevented: false, preventDefault() { prevented = true; }, ...extra });
      return prevented;
    };
    assert.deepEqual(options.wheel, { passive: false });
    assert.equal(wheel(100), false, 'menus do not own wheel input');
    input.setPointerEnabled(true);
    for (const [delta, extra] of [[0, { deltaX: 100 }], [NaN, {}], [100, { ctrlKey: true }],
      [100, { metaKey: true }], [100, { defaultPrevented: true }]]) assert.equal(wheel(delta, extra), false);
    assert.equal(input.consumeWheelDirection(), 0);
    assert.equal(wheel(100), true); wheel(100); wheel(-50);
    const frame = input.captureFrame();
    assert.equal(input.consumeWheelDirection(), 0, 'original input hands wheel ownership to the captured frame');
    assert.equal(frame.consumeWheelDirection(), -1, 'one frame coalesces the latest direction');
    assert.equal(frame.consumeWheelDirection(), 0);
    for (const clear of [() => input.clear(), () => events.blur(), () => events.pointercancel(),
      () => canvasEvents.pointerleave(), () => { document.hidden = true; documentEvents.visibilitychange(); },
      () => input.setBlocked(true), () => input.setPointerEnabled(false)]) {
      document.hidden = false; input.setBlocked(false); input.setPointerEnabled(true);
      wheel(100); clear(); assert.equal(input.consumeWheelDirection(), 0, 'handoff cannot replay old scroll');
    }
    input.setPointerEnabled(true); input.setBlocked(true);
    assert.equal(wheel(100), false); input.setBlocked(false); assert.equal(input.consumeWheelDirection(), 0);
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('Tab and B never switch firearms, including a held Tab', () => {
  const scene = makeScene();
  step(scene, 1, keysDown('Tab'));
  step(scene, 60, keysDown('Tab'));
  step(scene, 1, keysDown('b'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary');
});

test('E and Q no longer switch firearms', () => {
  const scene = makeScene();
  step(scene, 1, keysDown('e'));
  step(scene, 30, keysDown('e'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary', 'E belongs to interaction now');

  step(scene, 1);
  step(scene, 1, keysDown('q'));
  step(scene, 30, keysDown('q'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary', 'Q is intentionally unbound');
});

test('Tab does not draw a gun while empty-handed; C and wheel still restore the last gun', () => {
  const scene = makeScene();
  step(scene, 1, keysDown('c'));
  step(scene, 1, keysDown('Tab'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'melee');
  step(scene, 1, wheelInput(1));
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary');
  step(scene, 1, keysDown('c'));
  step(scene, 1);
  step(scene, 1, keysDown('c'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary');
});

test('Tab is only swallowed by Input while the game owns the keyboard', () => {
  const events = {};
  const previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener: (name, handler) => { events[name] = handler; },
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
  };
  globalThis.document = { addEventListener() {} };
  try {
    const input = new Input();
    input.setCapturedKeys(['Tab']);
    let tabPrevented = 0;
    let ePrevented = 0;
    const press = (code, onPrevent) => events.keydown({
      code,
      defaultPrevented: false,
      preventDefault: onPrevent,
    });

    press('Tab', () => { tabPrevented++; });
    assert.equal(tabPrevented, 1, 'Tab is preventDefault-ed during gameplay');
    assert.equal(input.isKeyDown('Tab'), true);

    press('KeyE', () => { ePrevented++; });
    assert.equal(ePrevented, 0, 'E keeps its normal browser behaviour');
    assert.equal(input.isKeyDown('e'), true);

    // 调试面板打开时 UI 接管键盘：Tab 必须保留浏览器焦点导航。
    input.setBlocked(true);
    press('Tab', () => { tabPrevented++; });
    assert.equal(tabPrevented, 1, 'blocked input never swallows Tab');
    // 失焦/场景退出必须清空按住状态。
    events.blur();
    assert.equal(input.isKeyDown('e'), false);
    assert.equal(input.isKeyDown('Tab'), false);
  } finally {
    globalThis.window = previousWindow;
  }
});
