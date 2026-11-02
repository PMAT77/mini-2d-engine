import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Camera } = load('core/Camera');
const { GameScene } = load('scenes/GameScene');
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('aim offset smooths independently of follow, recoil and damage at 30/60/144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    const c = new Camera(800, 600); c.x = 100; c.y = 200;
    for (let i = 0; i < fps; i++) c.updateAimOffset(90, -45, 1 / fps);
    near(c.getOffset().x, 100 + 90 * (1 - Math.exp(-10)));
    near(c.getOffset().y, 200 - 45 * (1 - Math.exp(-10)));
    assert.equal(c.x, 100); assert.equal(c.y, 200);
    const aimed = c.getOffset(); c.kickFromDamage(0);
    near(c.getOffset().x, aimed.x + 3);
    c.shake(8, .1, 0); c.follow(500, 500, .02);
    assert.notEqual(c.getOffset().x, aimed.x + 3, 'gun recoil adds to aim and damage');
    c.shake(0, 0); c.clearDamageKick();
    for (let i = 0; i < fps; i++) c.updateAimOffset(0, 0, 1 / fps);
    near(c.getOffset().x, 100 + (aimed.x - 100) * Math.exp(-10));
    c.clearAimOffset(); assert.deepEqual(c.getOffset(), { x: 100, y: 200 });
    c.updateAimOffset(90, 45, 1); c.reset(); assert.deepEqual(c.getOffset(), { x: 0, y: 0 });
    c.updateAimOffset(NaN, Infinity, .1); c.updateAimOffset(90, 45, NaN);
    assert.deepEqual(c.getOffset(), { x: 0, y: 0 });
  }
});

test('scene uses the unshifted player projection, a dead zone, smooth distance curve and a radial cap', () => {
  const scene = Object.create(GameScene.prototype), camera = new Camera(800, 600);
  camera.x = 100; camera.y = 200;
  scene.camera = camera;
  scene.player = { x: 475.5, y: 475.5, getSize: () => 49, isAlive: () => true };
  scene.viewportCache = { left: 2, top: 2, width: 800, height: 600 };
  const pointer = { active: true, rightDown: true, clientX: 402, clientY: 302 };
  const input = { getPointerState: () => pointer };
  const update = () => scene.updateAimCamera(1, input);
  const offset = () => ({ x: camera.getOffset().x - camera.x, y: camera.getOffset().y - camera.y });
  pointer.clientX += 23; update(); near(offset().x, 0);
  pointer.clientX = 402 + 147; update(); near(offset().x, 45 * (1 - Math.exp(-10)));
  pointer.clientX = 1000; update(); update(); near(offset().x, 90, .001);
  for (let i = 0; i < 50; i++) update(); near(offset().x, 90);
  assert.equal(camera.x, 100); assert.equal(camera.y, 200);
  pointer.clientX = -1000; pointer.clientY = -1000; update(); update();
  near(Math.hypot(offset().x, offset().y), 90, .001);
  pointer.rightDown = false; update(); update(); near(Math.hypot(offset().x, offset().y), 0, .001);
  pointer.rightDown = true; pointer.clientX = 1000; update();
  scene.player.isAlive = () => false; update(); assert.deepEqual(offset(), { x: 0, y: 0 });
});
