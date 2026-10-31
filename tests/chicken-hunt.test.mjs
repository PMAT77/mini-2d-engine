import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
const { TileMap } = load('map/TileMap');
const { GameScene } = load('scenes/GameScene');
const { Chicken } = load('objects/Chicken');
const { MeatPickup } = load('objects/MeatPickup');
const { seededRandom } = load('map/WaterTerrain');
const idle = { isKeyDown: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const dryMap = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const centerOf = bullet => {
  const position = bullet.getPosition(), half = bullet.getSize() / 2;
  return { x: position.x + half, y: position.y + half };
};

test('a bullet sweeps an entity before open ground and applies its callback once', () => {
  const map = dryMap();
  let applied = 0;
  let seen = null;
  const bullet = new Bullet(new Vector2(100, 100), new Vector2(300, 0), 10);
  bullet.setEntityHitTest((x0, y0, x1, y1, radius, damage) => {
    seen = { x0, y0, x1, y1, radius, damage };
    return { fraction: 0.5, x: (x0 + x1) / 2, y: y0, apply: () => { applied++; } };
  });
  bullet.update(0.1, map);
  assert.equal(applied, 1);
  assert.equal(bullet.getIsDestroyed(), true);
  assert.deepEqual(seen, { x0: 100, y0: 100, x1: 130, y1: 100, radius: 5, damage: 10 });
  const hitCenter = centerOf(bullet);
  assert.ok(Math.abs(hitCenter.x - 115) < 1e-9 && Math.abs(hitCenter.y - 100) < 1e-9);
});

test('terrain closer than the entity consumes the bullet first', () => {
  const map = dryMap(20, 20);
  for (let row = 0; row < map.height; row++) {
    map.tiles[row][2] = 'wall';
    map.tileHp[row][2] = 100;
  }
  let applied = 0;
  const bullet = new Bullet(new Vector2(80, 100), new Vector2(600, 0), 10);
  bullet.setEntityHitTest(() => ({ fraction: 0.9, x: 134, y: 100, apply: () => { applied++; } }));
  bullet.update(0.1, map);
  assert.equal(applied, 0);
  assert.equal(bullet.getIsDestroyed(), true);
});

test('shooting a chicken kills it, drops meat with the puff, and collects it', () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.loaded = true;
  // 用一张全干地小地图消除出生点随机墙体的影响，玩家和鸡都放在通路中心。
  scene.map = dryMap();
  scene.player.x = 500;
  scene.player.y = 500;
  scene.player.applyConfig({ shooting: {
    spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0,
  } });

  const chicken = new Chicken(700, 500, seededRandom(1));
  chicken.walking = false;
  chicken.velocity.set(0, 0);
  chicken.timer = 999;
  scene.chickens = [chicken];
  scene.player.takeDamage(50);
  const cx = chicken.x + Chicken.SIZE / 2, cy = chicken.y + Chicken.SIZE / 2;
  scene.player.shootAt({ x: cx, y: cy }, 1000, scene.map);
  assert.equal(scene.player.getBullets().length, 1);

  for (let frame = 0; frame < 12; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.chickens.length, 1, 'the corpse is still sliding after the lethal hit');
  assert.equal(scene.chickens[0].getLifeState(), 'dying');
  assert.equal(scene.chickens[0].isDamageable(), false);
  assert.equal(scene.player.getHealth(), 50, 'killing a chicken does not heal by itself');
  const corpse = scene.chickens[0];

  for (let frame = 0; frame < 24; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.chickens.length, 0, 'the corpse is removed after the death slide');
  assert.equal(scene.meatPickups.length, 1, 'meat drops on the same frame as the death puff');
  const finalCenter = { x: corpse.x + Chicken.SIZE / 2, y: corpse.y + Chicken.SIZE / 2 };
  assert.ok(finalCenter.x > cx + 25, `the corpse should slide forward, dx=${finalCenter.x - cx}`);

  for (let frame = 0; frame < 60; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.meatPickups.length, 1, 'the dropped meat stays until it is picked up');
  const meat = scene.meatPickups[0];
  const meatCenter = { x: meat.x + MeatPickup.SIZE / 2, y: meat.y + MeatPickup.SIZE / 2 };
  // 白烟与肉块都跟随尸体最终位置，而不是死亡当帧的位置。
  assert.ok(Math.abs(meatCenter.x - finalCenter.x) < 1e-9 && Math.abs(meatCenter.y - finalCenter.y) < 1e-9,
    'meat drops at the corpse final position');
  assert.equal(meat.isReady(), true);

  scene.player.x = meatCenter.x - scene.player.getSize() / 2;
  scene.player.y = meatCenter.y - scene.player.getSize() / 2;
  for (let frame = 0; frame < 5; frame++) scene.update(1 / 60, idle);
  assert.equal(scene.player.getHealth(), 55, 'each meat restores five health');
  assert.equal(scene.meatPickups.length, 0);
  assert.ok(scene.floatingTexts.getTexts().some(text => text.text === 'HP+5'));
});
