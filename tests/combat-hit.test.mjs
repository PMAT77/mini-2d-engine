import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { Chicken } = load('objects/Chicken');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');
const { computeKnockbackSpeed, CHICKEN_KNOCKBACK_PROFILE } = load('combat/KnockbackProfiles');
const idle = { isKeyDown: () => false };
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const dryMap = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

/**
 * 在鸡上装一个探针，记录 GameScene 真正传给目标的命中快照。
 * 这是一种测试观测手段，不改变生产代码路径。
 */
const probeHit = (scene, chicken) => {
  const captured = { impact: null };
  const original = chicken.receiveHit.bind(chicken);
  chicken.receiveHit = (impact, world) => {
    if (!captured.impact) captured.impact = impact;
    return original(impact, world);
  };
  return captured;
};

const sceneWithChicken = () => {
  const scene = new GameScene({ seed: 42, generateWater: false });
  scene.loaded = true;
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
  return { scene, chicken };
};

test('the same real hit yields the same impulse whether the crosshair is on or behind the target', () => {
  const onTarget = sceneWithChicken();
  const behind = sceneWithChicken();
  const onProbe = probeHit(onTarget.scene, onTarget.chicken);
  const behindProbe = probeHit(behind.scene, behind.chicken);

  const onCenter = { x: onTarget.chicken.x + Chicken.SIZE / 2, y: onTarget.chicken.y + Chicken.SIZE / 2 };
  const half = onTarget.scene.player.getSize() / 2;
  const pc = { x: onTarget.scene.player.x + half, y: onTarget.scene.player.y + half };
  const dir = { x: onCenter.x - pc.x, y: onCenter.y - pc.y };
  const length = Math.hypot(dir.x, dir.y);
  // 两个准星点与玩家中心共线：子弹方向、命中点、命中比例都相同，只有飞行终点不同。
  onTarget.scene.player.shootAt({ x: onCenter.x, y: onCenter.y }, 10, onTarget.scene.map);
  behind.scene.player.shootAt({
    x: onCenter.x + (dir.x / length) * 600,
    y: onCenter.y + (dir.y / length) * 600,
  }, 10, behind.scene.map);

  for (let frame = 0; frame < 60; frame++) {
    onTarget.scene.update(1 / 60, idle);
    behind.scene.update(1 / 60, idle);
  }

  const onImpact = onProbe.impact;
  const behindImpact = behindProbe.impact;
  assert.ok(onImpact && behindImpact, 'both shots must produce a real hit');
  assert.equal(onImpact.source, 'bullet');
  assert.equal(onImpact.impulse, 280);
  assert.equal(onImpact.damage, 10);
  assert.equal(onImpact.impulse, behindImpact.impulse, 'crosshair position must not change the impulse');
  assert.equal(onImpact.damage, behindImpact.damage);
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(close(onImpact.point.x, behindImpact.point.x) && close(onImpact.point.y, behindImpact.point.y),
    `hit points differ: ${JSON.stringify(onImpact.point)} vs ${JSON.stringify(behindImpact.point)}`);
  assert.ok(close(onImpact.direction.x, behindImpact.direction.x) && close(onImpact.direction.y, behindImpact.direction.y));
  assert.equal(onImpact.impactSpeed, behindImpact.impactSpeed);
  assert.equal(onImpact.initialSpeed, behindImpact.initialSpeed);

  // 尸体最终位置也应一致：击退强度只来自命中与目标配置。
  assert.equal(onTarget.chicken.getLifeState(), 'removed');
  assert.equal(behind.chicken.getLifeState(), 'removed');
  assert.ok(Math.abs(onTarget.chicken.x - behind.chicken.x) < 1e-9);
  assert.ok(Math.abs(onTarget.chicken.y - behind.chicken.y) < 1e-9);
});

test('the impact snapshot is frozen, data-only, and carries no crosshair-relative field', () => {
  const { scene, chicken } = sceneWithChicken();
  const probe = probeHit(scene, chicken);
  const center = { x: chicken.x + Chicken.SIZE / 2, y: chicken.y + Chicken.SIZE / 2 };
  scene.player.shootAt(center, 10, scene.map);
  for (let frame = 0; frame < 12; frame++) scene.update(1 / 60, idle);

  const impact = probe.impact;
  assert.ok(impact);
  assert.equal(Object.isFrozen(impact), true);
  assert.equal(Object.isFrozen(impact.point), true);
  assert.equal(Object.isFrozen(impact.direction), true);
  assert.deepEqual(Object.keys(impact).sort(), [
    'damage', 'direction', 'impactSpeed', 'impulse', 'initialSpeed',
    'point', 'source', 'traveledDistance',
  ]);
  for (const forbidden of ['crosshair', 'aim', 'aimTarget', 'rig', 'bone', 'joint']) {
    assert.equal(forbidden in impact, false, `impact must not carry ${forbidden}`);
  }
});

test('V1 keeps distanceFactor at one: traveled distance never changes the applied speed', () => {
  const base = Object.freeze({
    damage: 10,
    point: Object.freeze({ x: 0, y: 0 }),
    direction: Object.freeze({ x: 1, y: 0 }),
    impulse: 280,
    impactSpeed: 2600,
    initialSpeed: 2600,
    traveledDistance: 0,
    source: 'bullet',
  });
  const near = computeKnockbackSpeed(base, CHICKEN_KNOCKBACK_PROFILE);
  const far = computeKnockbackSpeed({ ...base, traveledDistance: 999 }, CHICKEN_KNOCKBACK_PROFILE);
  assert.equal(near, 280);
  assert.equal(far, near, 'traveledDistance is recorded but not used for falloff in V1');

  // 命中点也不参与强度计算：换一个命中点，速度不变。
  const otherPoint = computeKnockbackSpeed({ ...base, point: { x: 42, y: -7 } }, CHICKEN_KNOCKBACK_PROFILE);
  assert.equal(otherPoint, near);
});

test('weapon config and documentation expose the knockback impulse', () => {
  const json = JSON.parse(readFileSync('public/configs/playerConfig.json', 'utf8'));
  assert.equal(json.shooting.knockbackImpulse, 280);
  assert.equal(json.primaryShooting.knockbackImpulse, 200);

  const doc = readFileSync('public/configs/CONFIGURATION.md', 'utf8');
  assert.match(doc, /\|\s*shooting\s*\|\s*knockbackImpulse\s*\|\s*280\s*\|/);
  assert.match(doc, /\|\s*primaryShooting\s*\|\s*knockbackImpulse\s*\|\s*200\s*\|/);
  assert.match(doc, /准星落在目标身上还是目标后方无关/);
});
