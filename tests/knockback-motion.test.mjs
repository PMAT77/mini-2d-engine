import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { KnockbackMotion } = load('combat/KnockbackMotion');
const { CHICKEN_KNOCKBACK_PROFILE, computeKnockbackSpeed, createKnockbackProfile, validateKnockbackProfile } = load('combat/KnockbackProfiles');
const { compileShape, transformCollider } = load('physics/Collider');
const { TileMap } = load('map/TileMap');

const chickenShape = compileShape({ type: 'circle', radius: 0.5 });

/** 最小宿主：与 Chicken 一样以左上角定位、以中心为碰撞体位姿。 */
class Host {
  constructor(x, y, size = 22) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.velocity = { x: 5, y: -3 };
  }
  getSize() { return this.size; }
  getCollider() {
    return transformCollider(chickenShape, {
      x: this.x + this.size / 2,
      y: this.y + this.size / 2,
      size: this.size,
      rotation: 0,
    });
  }
}

const dryMap = (width = 60, height = 40) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

const impact = (overrides = {}) => ({
  damage: 10,
  point: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  impulse: 280,
  impactSpeed: 2600,
  initialSpeed: 2600,
  traveledDistance: 10,
  source: 'bullet',
  ...overrides,
});

const run = (motion, seconds, fps) => {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) motion.update(1 / fps);
};

test('the default chicken profile matches the design table', () => {
  assert.deepEqual({ ...CHICKEN_KNOCKBACK_PROFILE }, {
    mass: 1,
    resistance: 0,
    maxSpeed: 360,
    damping: 7,
    stopSpeed: 10,
    hitStunSeconds: 0.14,
    deathImpulseMultiplier: 1,
    minDeathSeconds: 0.14,
    maxDeathSeconds: 0.45,
    deathSettleDistance: 12,
    immuneToDisplacement: false,
  });
  assert.ok(Object.isFrozen(CHICKEN_KNOCKBACK_PROFILE));
});

test('profiles reject impossible values and freeze valid ones', () => {
  assert.throws(() => createKnockbackProfile({ mass: 0 }), /mass/);
  assert.throws(() => createKnockbackProfile({ resistance: 1.5 }), /resistance/);
  assert.throws(() => createKnockbackProfile({ damping: 0 }), /damping/);
  assert.throws(() => createKnockbackProfile({ maxSpeed: NaN }), /maxSpeed/);
  assert.throws(() => createKnockbackProfile({ minDeathSeconds: 0.6, maxDeathSeconds: 0.4 }), /maxDeathSeconds/);
  assert.throws(() => createKnockbackProfile({ deathSettleDistance: -1 }), /deathSettleDistance/);
  assert.throws(() => createKnockbackProfile({ immuneToDisplacement: 'yes' }), /immuneToDisplacement/);
  assert.throws(() => validateKnockbackProfile(null), /对象/);
  const heavy = createKnockbackProfile({ mass: 6, resistance: 0.5 });
  assert.ok(Object.isFrozen(heavy));
  assert.equal(heavy.mass, 6);
});

test('weapon impulse becomes speed through mass, resistance and the speed ratio', () => {
  const light = createKnockbackProfile({ mass: 1, resistance: 0 });
  const heavy = createKnockbackProfile({ mass: 6, resistance: 0.5 });
  const immune = createKnockbackProfile({ immuneToDisplacement: true });
  assert.equal(computeKnockbackSpeed(impact(), light), 280);
  assert.ok(Math.abs(computeKnockbackSpeed(impact(), heavy) - 280 / 6 / 2) < 1e-9);
  assert.equal(computeKnockbackSpeed(impact(), immune), 0);
  // 水中减速后按真实速度比衰减，伤害数值不参与速度换算。
  assert.ok(Math.abs(computeKnockbackSpeed(impact({ impactSpeed: 1300 }), light) - 140) < 1e-9);
  assert.equal(computeKnockbackSpeed(impact({ impulse: 0 }), light), 0);
  assert.equal(computeKnockbackSpeed(impact({ initialSpeed: 0 }), light), 0);
  assert.equal(computeKnockbackSpeed(impact({ impulse: NaN }), light), 0);
  // 上限只裁剪速度，不改变伤害。
  assert.equal(computeKnockbackSpeed(impact({ impulse: 5000 }), light), 360);
});

test('the chicken slide integrates to the analytic distance and stops at stopSpeed', () => {
  const map = dryMap();
  const host = new Host(600, 600);
  const motion = new KnockbackMotion(host, map, CHICKEN_KNOCKBACK_PROFILE);
  assert.equal(motion.addImpact(impact()), 280);
  assert.ok(Math.abs(motion.getSpeed() - 280) < 1e-9);
  run(motion, 1, 60);
  const distance = host.x - 600;
  const expected = (280 - 10) / 7;
  assert.ok(Math.abs(distance - expected) < 0.2, `distance ${distance}, expected ${expected}`);
  assert.equal(motion.isActive(), false);
  assert.equal(motion.getSpeed(), 0);
  assert.ok(Math.abs(motion.getElapsedSeconds() - Math.log(28) / 7) < 0.03, `elapsed ${motion.getElapsedSeconds()}`);
  assert.deepEqual(host.velocity, { x: 5, y: -3 }, 'the host normal velocity is never touched');
  assert.ok(map.isShapeWalkable(host.getCollider()));
  assert.equal(map.getShapeSpeedFactor(host.getCollider()), 1);
});

test('30, 60 and 144 FPS reach the same endpoint', () => {
  const endpoints = [30, 60, 144].map(fps => {
    const map = dryMap();
    const host = new Host(600, 600);
    const motion = new KnockbackMotion(host, map, CHICKEN_KNOCKBACK_PROFILE);
    motion.addImpact(impact());
    run(motion, 1, fps);
    return { x: host.x, y: host.y, active: motion.isActive() };
  });
  endpoints.forEach(endpoint => {
    assert.ok(Math.abs(endpoint.x - endpoints[0].x) < 0.2, `fps endpoint ${endpoint.x} vs ${endpoints[0].x}`);
    assert.ok(Math.abs(endpoint.y - endpoints[0].y) < 1e-9);
    assert.equal(endpoint.active, false);
  });
});

test('stacked impulses add up and clamp to maxSpeed', () => {
  const map = dryMap();
  const host = new Host(600, 600);
  const motion = new KnockbackMotion(host, map, CHICKEN_KNOCKBACK_PROFILE);
  motion.addImpact(impact());
  motion.addImpact(impact());
  assert.ok(Math.abs(motion.getSpeed() - 360) < 1e-9, `stacked speed ${motion.getSpeed()}`);
  motion.addImpact(impact({ direction: { x: -1, y: 0 } }));
  assert.ok(motion.getSpeed() <= 360 + 1e-9, 'clamp applies to every direction');
});

test('a wall turns the slide tangential instead of letting the corpse pass through', () => {
  const map = dryMap();
  for (let row = 0; row < map.height; row++) map.tiles[row][15] = 'wall';
  const host = new Host(720, 600);
  const motion = new KnockbackMotion(host, map, CHICKEN_KNOCKBACK_PROFILE);
  motion.addImpact(impact({ direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 } }));
  run(motion, 1, 60);
  assert.ok(host.x + 22 <= 750 + 1e-6, `wall crossed: right edge ${host.x + 22}`);
  assert.ok(host.y > 605, `expected tangential slide, y=${host.y}`);
  assert.ok(map.isShapeWalkable(host.getCollider()));
  assert.equal(motion.isActive(), false);
});

test('a water bank ends the slide on dry ground instead of drifting in', () => {
  const map = dryMap();
  for (let row = 0; row < map.height; row++) map.tiles[row][15] = 'shallow_water';
  const host = new Host(700, 600);
  const motion = new KnockbackMotion(host, map, CHICKEN_KNOCKBACK_PROFILE);
  motion.addImpact(impact());
  run(motion, 1, 60);
  // 干地判定容差 1e-6 允许小于 0.01px 的接触误差，但绝不允许可见的入水位移。
  assert.ok(host.x + 22 <= 750 + 0.01, `entered water: right edge ${host.x + 22}`);
  assert.ok(host.x + 22 > 748, `expected to reach the bank, right edge ${host.x + 22}`);
  assert.ok(Math.abs(map.getShapeSpeedFactor(host.getCollider()) - 1) <= 1e-6);
  assert.equal(motion.isActive(), false);
});

test('illegal and long deltas terminate without moving through walls', () => {
  const map = dryMap();
  const host = new Host(600, 600);
  const motion = new KnockbackMotion(host, map, CHICKEN_KNOCKBACK_PROFILE);
  motion.addImpact(impact());
  const start = { x: host.x, y: host.y };
  motion.update(NaN);
  motion.update(-1);
  motion.update(Infinity);
  assert.deepEqual({ x: host.x, y: host.y }, start, 'invalid deltas are ignored');
  motion.update(0.5);
  assert.ok(Number.isFinite(host.x) && Number.isFinite(host.y));
  assert.ok(host.x > start.x && host.x - start.x < 40);
  assert.deepEqual(host.velocity, { x: 5, y: -3 });
});

test('a zero contact normal or an exhausted solver stops conservatively in place', () => {
  const makeWorld = (contacts, exhausted) => ({
    getShapeSpeedFactor: () => 1,
    resolveMotion: collider => ({
      collider: transformCollider(collider.compiled, { ...collider.pose, x: collider.pose.x + 5, y: collider.pose.y }),
      contacts,
      rotationBlocked: false,
      exhausted,
    }),
  });
  const zeroNormal = makeWorld([{ normal: { x: 0, y: 0 }, depth: 1, point: { x: 0, y: 0 } }], false);
  const first = new Host(600, 600);
  const firstMotion = new KnockbackMotion(first, zeroNormal, CHICKEN_KNOCKBACK_PROFILE);
  firstMotion.addImpact(impact());
  firstMotion.update(1 / 60);
  assert.deepEqual({ x: first.x, y: first.y }, { x: 600, y: 600 });
  assert.equal(firstMotion.isActive(), false);

  const exhaustedWorld = makeWorld([], true);
  const second = new Host(600, 600);
  const secondMotion = new KnockbackMotion(second, exhaustedWorld, CHICKEN_KNOCKBACK_PROFILE);
  secondMotion.addImpact(impact());
  secondMotion.update(1 / 60);
  assert.deepEqual({ x: second.x, y: second.y }, { x: 600, y: 600 });
});

test('an immune target takes no displacement but still reports the applied impulse', () => {
  const map = dryMap();
  const host = new Host(600, 600);
  const motion = new KnockbackMotion(host, map, createKnockbackProfile({ immuneToDisplacement: true }));
  assert.equal(motion.addImpact(impact()), 0);
  run(motion, 0.5, 60);
  assert.equal(host.x, 600);
  assert.equal(host.y, 600);
  assert.equal(motion.isActive(), false);
});

test('the dry-land preflight bisects to the last legal position', () => {
  const world = {
    getShapeSpeedFactor: collider => collider.pose.x > 700 ? 0.4 : 1,
    resolveMotion: (collider, movement) => ({
      collider: transformCollider(collider.compiled, {
        ...collider.pose,
        x: collider.pose.x + movement.x,
        y: collider.pose.y + movement.y,
      }),
      contacts: [],
      rotationBlocked: false,
      exhausted: false,
    }),
  };
  const host = new Host(660, 600);
  const motion = new KnockbackMotion(host, world, CHICKEN_KNOCKBACK_PROFILE);
  motion.addImpact(impact({ impulse: 5000 }));
  run(motion, 1, 60);
  const center = host.x + 11;
  assert.ok(center <= 700 + 1e-6, `crossed the bank: center ${center}`);
  assert.ok(center > 699.9, `should reach the bank, center ${center}`);
  assert.equal(motion.isActive(), false);
});
