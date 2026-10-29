import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { Torch } = load('objects/Torch');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');
const { rectangleCollider } = load('physics/Collider');
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

test('torch light sways occasionally, returns smoothly, and follows elapsed time independently of frame rate', () => {
  const torch = new Torch(100, 200);
  let still = 0, moving = 0, previous = torch.light.getPosition().clone();
  for (let i = 0; i < 1800; i++) {
    torch.update(1 / 60);
    const position = torch.light.getPosition();
    assert.ok(Math.abs(position.x - torch.x) <= 3 && Math.abs(position.y - torch.y) <= 1.5);
    assert.ok(Math.hypot(position.x - previous.x, position.y - previous.y) < 0.5, 'no random frame-to-frame jumps');
    if (position.x === torch.x && position.y === torch.y) still++;
    if (Math.abs(position.x - torch.x) > 0.5) moving++;
    previous = position.clone();
  }
  assert.ok(still > 900, 'light rests between occasional sways');
  assert.ok(moving > 60, 'sway is visible during gusts');
  const positions = [30, 60, 144].map(fps => {
    const source = new Torch(100, 200, 1.2);
    for (let i = 0; i < fps; i++) source.update(1 / fps);
    return source.light.getPosition();
  });
  for (const p of positions) assert.ok(Math.hypot(p.x - positions[0].x, p.y - positions[0].y) < 1e-9);
  const other = new Torch(100, 200, 4);
  other.update(1);
  assert.notDeepEqual(other.light.getPosition(), positions[0], 'phases keep different torches out of sync');
});

test('random torches use dry clear ground, stay spaced, and reproduce with the map seed', () => {
  const scene = new GameScene({ seed: 42 });
  const torches = scene.torches;
  assert.ok(torches.length >= 10 && torches.length <= 25, `torch count: ${torches.length}`);
  assert.equal(scene.lightingSystem.getLightCount(), torches.length + 2);
  assert.deepEqual(torches, new GameScene({ seed: 42 }).torches);
  for (const [i, torch] of torches.entries()) {
    const body = rectangleCollider(torch.x - 14, torch.y - 18, 28, 42);
    assert.ok(scene.map.isShapeWalkable(body));
    assert.equal(scene.map.getShapeSpeedFactor(body), 1);
    assert.equal(scene.map.blocksLightAt(torch.x, torch.y), false);
    assert.equal(torch.light.shadowTerrain, true);
    for (const other of torches.slice(i + 1)) assert.ok(Math.hypot(torch.x - other.x, torch.y - other.y) >= 320);
  }
  const blocked = new TileMap(10, 10, { generateWater: false });
  blocked.tiles.forEach(row => row.fill('wall'));
  assert.deepEqual(Torch.generate(blocked, seededRandom(42)), []);
});

test('walking and shooting through a torch leaves it and its light intact', () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  const torch = scene.torches[0], map = scene.map;
  const body = rectangleCollider(torch.x - 5, torch.y - 5, 10, 10);
  assert.ok(map.isShapeWalkable(body));
  assert.equal(map.castShape(body, { x: 1, y: 0 }), null);
  const bullet = new Bullet(new Vector2(torch.x - 10, torch.y), new Vector2(100, 0), 10000);
  bullet.update(0.2, map);
  assert.equal(bullet.getIsDestroyed(), false);
  const count = scene.lightingSystem.getLightCount();
  map.damageTile(Math.floor(torch.x / 50), Math.floor(torch.y / 50), 10000);
  map.breakTile(Math.floor(torch.x / 50), Math.floor(torch.y / 50));
  scene.loaded = true;
  scene.update(1 / 60, { isKeyDown: () => false });
  assert.ok(scene.torches.includes(torch));
  assert.equal(scene.lightingSystem.getLightCount(), count);
  for (let i = 0; i < 600; i++) {
    torch.update(1 / 60);
    assert.ok(torch.light.getIntensity() >= 0.9 && torch.light.getIntensity() <= 1);
  }
  assert.equal(torch.light.isLightActive(), true);
});
