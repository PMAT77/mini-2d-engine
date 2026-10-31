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

test('Tab switches firearms once per press and not repeatedly while held', () => {
  const scene = makeScene();
  assert.equal(scene.player.getActiveWeaponSlot(), 'secondary');

  // 按下沿切换一次。
  step(scene, 1, keysDown('Tab'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');

  // 长按不连续切换：Tab 是下沿触发，不是“按住就切”。
  step(scene, 60, keysDown('Tab'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');

  // 松开再按，才允许下一次切换。
  step(scene, 1);
  step(scene, 1, keysDown('Tab'));
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

test('Tab restores the last firearm while empty-handed', () => {
  const scene = makeScene();
  step(scene, 1, keysDown('Tab'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary');

  step(scene, 1, keysDown('c'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'melee');

  step(scene, 1);
  step(scene, 1, keysDown('Tab'));
  assert.equal(scene.player.getActiveWeaponSlot(), 'primary', 'Tab re-equips the last firearm');

  // 再按一次仍然只在主副枪之间切换，不会回到空手。
  step(scene, 1);
  step(scene, 1, keysDown('Tab'));
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
