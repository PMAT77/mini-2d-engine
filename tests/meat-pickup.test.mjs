import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { MeatPickup } = load('objects/MeatPickup');
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');

globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
const idle = { isKeyDown: () => false, isBlocked: () => false };
const holdingE = { isKeyDown: key => key === 'e', isBlocked: () => false };
const ground = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

const makeScene = () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.loaded = true;
  scene.map = ground();
  // 单测只关心拾取流程本身，三层感知由 pickup.browser.mjs 覆盖。
  scene.perception = undefined;
  scene.player.x = 400;
  scene.player.y = 400;
  return scene;
};
const meatUnderPlayer = scene => {
  const half = scene.player.getSize() / 2;
  return new MeatPickup(scene.player.x + half - MeatPickup.SIZE / 2,
    scene.player.y + half - MeatPickup.SIZE / 2);
};

test('the chunk cannot be picked up until its fall animation lands', () => {
  const meat = new MeatPickup(100, 100);
  assert.equal(meat.isReady(), false);
  assert.equal(meat.isPickupReady(), false);
  meat.update(MeatPickup.FALL_SECONDS - 0.001);
  assert.equal(meat.isReady(), false);
  meat.update(0.002);
  assert.equal(meat.isReady(), true);
  assert.equal(meat.isPickupReady(), true);
  assert.deepEqual(meat.getPickupAnchor(), { x: 108, y: 108 });
});

test('a dropped chunk settles exactly once even if collection is requested twice', () => {
  const meat = new MeatPickup(100, 100);
  meat.update(1);
  assert.equal(meat.markCollected(), true);
  assert.equal(meat.markCollected(), false);
  assert.equal(meat.isCollected(), true);
  assert.equal(meat.isPickupReady(), false);
});

test('the scene only focuses the chunk after it lands and stays in range', () => {
  const scene = makeScene();
  const meat = meatUnderPlayer(scene);
  scene.meatPickups = [meat];

  scene.update(1 / 60, idle);
  assert.equal(scene.getPickupDebugState().candidateCount, 0, 'falling meat is not interactive');
  assert.equal(scene.getPickupDebugState().markerCount, 0, 'a falling chunk has no world marker yet');

  for (let frame = 0; frame < 20; frame++) scene.update(1 / 60, idle);
  let state = scene.getPickupDebugState();
  assert.equal(state.state, 'focused');
  assert.equal(state.candidateCount, 1);
  assert.equal(state.markerCount, 1);

  // 超出 70 世界像素后不再是候选，也没有 E 提示。
  scene.player.x += 120;
  scene.update(1 / 60, idle);
  state = scene.getPickupDebugState();
  assert.equal(state.candidateCount, 0);
  assert.equal(state.markerCount, 1, 'the marker still shows within discovery range');
});

test('holding E shows 50% after 0.25s and collects once after 0.5s', () => {
  const scene = makeScene();
  scene.player.takeDamage(20);
  const hurt = scene.player.getHealth();
  const meat = meatUnderPlayer(scene);
  scene.meatPickups = [meat];
  for (let frame = 0; frame < 20; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.getPickupDebugState().state, 'focused');

  for (let frame = 0; frame < 15; frame++) scene.update(1 / 60, holdingE);
  let state = scene.getPickupDebugState();
  assert.equal(state.state, 'holding');
  assert.ok(Math.abs(state.progress - 0.5) < 1e-6, `progress was ${state.progress}`);
  assert.equal(scene.player.getHealth(), hurt, 'halfway through does not heal');

  // 松开立即取消，进度清零。
  scene.update(1 / 60, idle);
  state = scene.getPickupDebugState();
  assert.equal(state.state, 'focused');
  assert.equal(state.progress, 0);
  assert.equal(scene.player.getHealth(), hurt);

  for (let frame = 0; frame < 30; frame++) scene.update(1 / 60, holdingE);
  assert.equal(scene.player.getHealth(), hurt + 5, 'a full 0.5s hold heals by five');
  assert.equal(scene.meatPickups.length, 0);
  assert.equal(scene.getPickupDebugState().candidateCount, 0);
  assert.ok(scene.floatingTexts.getTexts().some(text => text.text === 'HP+5'));
});

test('rolling, firing or switching weapons cancels the hold', () => {
  for (const interrupt of ['roll', 'shoot', 'switch']) {
    const scene = makeScene();
    const meat = meatUnderPlayer(scene);
    scene.meatPickups = [meat];
    const far = new MeatPickup(scene.player.x + 300, scene.player.y);
    scene.meatPickups.push(far);
    for (let frame = 0; frame < 20; frame++) scene.update(1 / 60, idle);
    for (let frame = 0; frame < 10; frame++) scene.update(1 / 60, holdingE);
    assert.ok(scene.getPickupDebugState().progress > 0, `${interrupt}: progress should have started`);

    let input = holdingE;
    if (interrupt === 'roll') scene.player.requestRoll(holdingE);
    if (interrupt === 'switch') input = { isKeyDown: key => key === 'e' || key === 'Tab', isBlocked: () => false };
    if (interrupt === 'shoot') {
      // 用指针开火路径触发 shotThisFrame，与真实鼠标左键走同一条回调。
      const canvas = {
        width: 1200, height: 800, offsetWidth: 1200, offsetHeight: 800,
        clientWidth: 1200, clientHeight: 800, clientLeft: 0, clientTop: 0,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
      };
      scene.game = { renderer: { ctx: { canvas }, width: 1200, height: 800 }, input: idle };
      scene.displayedView = { x: 0, y: 0, width: 1200, height: 800 };
      scene.viewportCache = { left: 0, top: 0, width: 1200, height: 800 };
      let consumed = false;
      input = {
        isKeyDown: key => key === 'e',
        isBlocked: () => false,
        consumePointerState: () => {
          if (consumed) return undefined;
          consumed = true;
          return { active: true, clientX: 425, clientY: 425, leftDown: true, leftPressed: true };
        },
      };
    }

    scene.update(1 / 60, input);
    const state = scene.getPickupDebugState();
    assert.equal(state.progress, 0, `${interrupt} should cancel progress`);
    assert.equal(scene.player.getHealth(), 100, `${interrupt} must not settle the pickup`);
    assert.equal(scene.meatPickups.length, 2);
  }
});
