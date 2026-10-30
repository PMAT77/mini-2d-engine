import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');

const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b} (±${epsilon})`);
const idleInput = { isKeyDown: () => false };
const step = (player, seconds) => player.update(seconds, idleInput);

test('R defaults to a full-magazine reload that discards the remaining rounds', () => {
  const player = new Player(200.5, 200.5);
  assert.equal(player.getDefaultReloadMode(), 'reload');
  assert.equal(player.getReloadMode(), null);

  // 打掉 3 发后弹匣还剩 3 发；换弹仍然整匣丢弃并重装。
  for (let i = 0; i < 3; i += 1) {
    player.shoot(new Vector2(1, 0));
    step(player, 0.25);
  }
  assert.equal(player.getWeaponView().magazineAmmo, 3);
  player.requestReload();
  assert.equal(player.getReloadMode(), 'reload');
  assert.equal(player.getWeaponView().isReloading, true);
  near(player.getReloadProgress(), 0);
  step(player, 1.4);
  assert.equal(player.getWeaponView().magazineAmmo, 6);
  assert.equal(player.getWeaponView().chambered, true);
  assert.equal(player.getReloadMode(), null);
});

test('loading tops up a partial magazine, keeps its rounds and the chambered state', () => {
  const player = new Player(200.5, 200.5);
  player.setDefaultReloadMode('load');
  for (let i = 0; i < 3; i += 1) {
    player.shoot(new Vector2(1, 0));
    step(player, 0.25);
  }
  assert.equal(player.getWeaponView().magazineAmmo, 3);
  assert.equal(player.getWeaponView().chambered, true);

  player.requestReload();
  assert.equal(player.getReloadMode(), 'load');
  const view = player.getWeaponView();
  assert.equal(view.isReloading, true);
  // 装填 3 发：1.4 * 1.5 * 3 / 6 = 1.05 秒。
  const total = 1.05;
  step(player, total / 3);
  // 装填途中保留原来的 3 发，逐发补进弹匣，膛内那发不退出。
  assert.equal(player.getWeaponView().magazineAmmo, 4);
  assert.equal(player.getWeaponView().chambered, true);
  step(player, total);
  assert.equal(player.getWeaponView().magazineAmmo, 6);
  assert.equal(player.getWeaponView().chambered, true);
  assert.equal(player.getWeaponView().isReloading, false);
});

test('loading an already full magazine is a no-op', () => {
  const player = new Player(200.5, 200.5);
  player.setDefaultReloadMode('load');
  player.requestReload();
  assert.equal(player.getWeaponView().isReloading, false);
  assert.equal(player.getReloadMode(), null);
});

test('a full reload discards partial rounds instead of topping them up', () => {
  const player = new Player(200.5, 200.5);
  player.shoot(new Vector2(1, 0));
  player.shoot(new Vector2(1, 0));
  assert.equal(player.getWeaponView().magazineAmmo, 5);
  player.requestReload('reload');
  step(player, 1.4);
  assert.equal(player.getWeaponView().magazineAmmo, 6);
});

test('reload callbacks report which mode started', () => {
  const player = new Player(200.5, 200.5);
  const modes = [];
  player.setOnReloadCallback(mode => modes.push(mode));

  player.shoot(new Vector2(1, 0));
  player.requestReload('load');
  step(player, 2);
  // 装填完成后弹匣满，先打一发才能再触发换弹。
  step(player, 0.25);
  player.shoot(new Vector2(1, 0));
  player.requestReload('reload');

  assert.deepEqual(modes, ['load', 'reload']);
});

test('the default reload mode is validated and drives the R key', () => {
  const player = new Player(200.5, 200.5);
  player.setDefaultReloadMode('load');
  assert.equal(player.getDefaultReloadMode(), 'load');
  player.shoot(new Vector2(1, 0));
  step(player, 0.25);
  player.requestReload();
  assert.equal(player.getReloadMode(), 'load');

  player.setDefaultReloadMode('reload');
  step(player, 2);
  player.shoot(new Vector2(1, 0));
  player.requestReload();
  assert.equal(player.getReloadMode(), 'reload');

  assert.throws(() => player.setDefaultReloadMode('快速'), /无效补弹方式/);
});

test('a loading progress is frozen while another slot is active', () => {
  const player = new Player(200.5, 200.5);
  player.shoot(new Vector2(1, 0));
  player.requestReload('load');
  const before = player.getWeaponView().reloadProgress;
  step(player, 0.1);
  const halfway = player.getWeaponView().reloadProgress;
  assert.ok(halfway > before);

  player.cycleFirearm(1);
  step(player, 1);
  player.cycleFirearm(-1);
  near(player.getWeaponView().reloadProgress, halfway);
  step(player, 2);
  assert.equal(player.getWeaponView().magazineAmmo, 6);
});
