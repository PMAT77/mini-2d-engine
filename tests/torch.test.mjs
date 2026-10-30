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

test('random torches use dry clear ground near walls, stay spaced, and reproduce with the map seed', () => {
  const scene = new GameScene({ seed: 42 });
  const torches = scene.torches, map = scene.map;
  assert.ok(torches.length >= 10 && torches.length <= 25, `torch count: ${torches.length}`);
  assert.equal(scene.lightingSystem.getLightCount(), torches.length + 3);
  assert.deepEqual(torches, new GameScene({ seed: 42 }).torches);
  for (const [i, torch] of torches.entries()) {
    const body = rectangleCollider(torch.x - 14, torch.y - 18, 28, 42);
    assert.ok(map.isShapeWalkable(body));
    assert.equal(map.getShapeSpeedFactor(body), 1);
    assert.equal(map.blocksLightAt(torch.x, torch.y), false);
    assert.equal(torch.light.shadowTerrain, false);
    assert.equal(torch.light.groundOnly, true);
    // 火把必须落在墙体 2 格范围内。
    const col = Math.floor(torch.x / map.tileSize), row = Math.floor(torch.y / map.tileSize);
    let nearWall = false;
    for (let r = Math.max(0, row - 2); r <= Math.min(map.height - 1, row + 2); r++)
      for (let c = Math.max(0, col - 2); c <= Math.min(map.width - 1, col + 2); c++)
        if (map.tiles[r][c] === 'wall') nearWall = true;
    assert.ok(nearWall, `torch at (${torch.x}, ${torch.y}) is within 2 tiles of a wall`);
    for (const other of torches.slice(i + 1)) assert.ok(Math.hypot(torch.x - other.x, torch.y - other.y) >= 320);
  }
  const blocked = new TileMap(10, 10, { generateWater: false });
  blocked.tiles.forEach(row => row.fill('wall'));
  assert.deepEqual(Torch.generate(blocked, seededRandom(42)), []);
  const open = new TileMap(100, 100, { generateWater: false });
  open.tiles.forEach(row => row.fill('default'));
  assert.deepEqual(Torch.generate(open, seededRandom(42)), [], 'open ground with no wall nearby gets no torches');
});

test('a torch can be walked through, but only a crosshair aimed at it lets a bullet extinguish it', () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  // 只留火把：避免随机小鸡挡在测试弹道上。
  scene.chickens = [];
  const torch = scene.torches[0], map = scene.map;
  const body = rectangleCollider(torch.x - 5, torch.y - 5, 10, 10);
  assert.ok(map.isShapeWalkable(body));
  assert.equal(map.castShape(body, { x: 1, y: 0 }), null);

  const count = scene.lightingSystem.getLightCount();
  // 运行时读取 Player 上的私有回调：这里用的就是 GameScene 装配的真实命中链。
  const hitTest = scene.player.bulletEntityHitTest;
  assert.equal(typeof hitTest, 'function');

  // 拦截粒子，确认熄灭时冒的是白色烟雾。
  const particles = scene.particleSystem, bursts = [];
  scene.particleSystem = { createExplosion: (...args) => bursts.push(args), update() {}, addParticle() {} };

  // 准星在火把外的空地：即使弹道正好穿过火苗，也不算命中。
  const passing = new Bullet(new Vector2(torch.x - 40, torch.y - 2), new Vector2(1000, 0), 10);
  passing.setEntityHitTest(hitTest);
  passing.setAimTarget(new Vector2(torch.x + 200, torch.y - 2));
  passing.update(0.05);
  assert.equal(passing.getIsDestroyed(), false);
  assert.equal(torch.isLit(), true);
  assert.equal(scene.lightingSystem.getLightCount(), count);
  // 同一线段显式查询：准星不在火把上返回 null，压在火把上才算命中。
  assert.equal(hitTest(torch.x - 40, torch.y - 2, torch.x + 40, torch.y - 2, 5, 10,
    { x: torch.x + 200, y: torch.y - 2 }), null);
  assert.ok(hitTest(torch.x - 40, torch.y - 2, torch.x + 40, torch.y - 2, 5, 10,
    { x: torch.x, y: torch.y - 2 }) !== null);

  // 准星压在火苗上：子弹停在火苗边缘，火把永久熄灭并撤掉光源。
  const aimed = new Bullet(new Vector2(torch.x - 40, torch.y - 2), new Vector2(1000, 0), 10);
  aimed.setEntityHitTest(hitTest);
  aimed.setAimTarget(new Vector2(torch.x, torch.y - 2));
  aimed.update(0.1);
  assert.equal(aimed.getIsDestroyed(), true);
  const stop = aimed.getPosition().clone();
  stop.add(new Vector2(aimed.getSize() / 2, aimed.getSize() / 2));
  assert.ok(Math.abs(stop.x - (torch.x - Torch.HIT_RADIUS - aimed.getSize() / 2)) < 1e-6, 'bullet stops at the flame edge');
  assert.ok(Math.abs(stop.y - (torch.y - 2)) < 1e-6);
  assert.equal(torch.isLit(), false);
  assert.equal(torch.light.isLightActive(), false);
  assert.equal(scene.lightingSystem.getLightCount(), count - 1);

  // 白色烟雾：至少有一团大颗粒、慢速、停留久的白烟，颜色全是白／灰白。
  assert.ok(bursts.length >= 2, 'extinguishing spawns smoke');
  const smoke = bursts.find(([, amount, , size, life]) => amount >= 12 && size >= 5 && life >= 0.8);
  assert.ok(smoke, 'a large slow white puff replaces the old ember burst');
  assert.ok(smoke[5].includes('#ffffff'));
  const white = new Set(['#ffffff', '#f7f7f7', '#ececec', '#dedede']);
  assert.ok(smoke[5].every(color => white.has(color)));

  // 已灭的火把不挡子弹，也不能被重复熄灭或重新点亮。
  assert.equal(hitTest(torch.x - 40, torch.y - 2, torch.x + 40, torch.y - 2, 5, 10,
    { x: torch.x, y: torch.y - 2 }), null);
  assert.equal(torch.isAimedAt(torch.x, torch.y), false);
  assert.equal(torch.extinguish(), false);
  for (let i = 0; i < 120; i++) torch.update(1 / 60);
  scene.particleSystem = particles;
  scene.loaded = true;
  scene.update(1 / 60, { isKeyDown: () => false });
  assert.equal(torch.light.isLightActive(), false);
  assert.equal(scene.lightingSystem.getLightCount(), count - 1);
  assert.ok(scene.torches.includes(torch));
});

test('the torch hit zone is the flame core, and the crosshair must be on the torch', () => {
  const torch = new Torch(100, 200);
  // 火苗中心在 (100, 198)：贴着占地边缘横穿、离火苗 22px 的两条线都不算命中。
  assert.equal(torch.hitTestSegment(40, 220, 140, 220, 5), null);
  assert.equal(torch.hitTestSegment(40, 240, 140, 240, 5), null);
  assert.ok(torch.hitTestSegment(40, 198, 140, 198, 5) !== null);
  // 准星判定覆盖火焰和木柄，偏出 10px 就不再算瞄准。
  assert.equal(torch.isAimedAt(100, 200), true);
  assert.equal(torch.isAimedAt(100, 210), true);
  assert.equal(torch.isAimedAt(100, 211), false);
  assert.equal(torch.isAimedAt(111, 200), false);
  torch.extinguish();
  assert.equal(torch.hitTestSegment(40, 198, 140, 198, 5), null, 'a dead torch is no longer a target');
  assert.equal(torch.isAimedAt(100, 200), false, 'a dead torch is no longer aimable');
});
