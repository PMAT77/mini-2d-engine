import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { TileMap } = load('map/TileMap'), { Player } = load('objects/Player');
const { EnemySystem } = load('enemies/EnemySystem'), { ActorCollisionWorld } = load('physics/ActorCollisionWorld');
const { MeleeAttackController, sectorIntersectsCircle } = load('enemies/MeleeAttackController');
const { ZOMBIE_CONFIG } = load('enemies/ZombieConfig');
const { Zombie } = load('enemies/Zombie');
const idle = { isKeyDown: () => false };
const impact = damage => ({ damage, point: { x: 225, y: 225 }, direction: { x: 1, y: 0 }, impulse: 0, impactSpeed: 100, initialSpeed: 100, traveledDistance: 10, source: 'bullet' });
const setup = () => {
  const map = new TileMap(16, 16, { seed: 7, generateWater: false }); map.tiles.forEach(r => r.fill('default')); map.invalidateNavigation();
  const actors = new ActorCollisionWorld(map), enemies = new EnemySystem(map, actors, 3), player = new Player(275 - 24.5, 225 - 24.5);
  actors.register('player', player); return { map, actors, enemies, player };
};
const tick = (f, dt) => { f.player.advanceDamageTimers(dt); f.actors.sync(); const body = f.player.getCollider(); f.enemies.update(dt, { target: { x: body.pose.x, y: body.pose.y, radius: body.radius, alive: f.player.isAlive() }, lights: [], playerNoises: [] }); f.enemies.settleAttacks(f.player); };

test('attack sector touches a circle at the edge but never adds the attacker radius', () => {
  const o = { x: 0, y: 0 }, hit = (x, y) => sectorIntersectsCircle(o, 0, 60, Math.PI / 4, { x, y }, 24.5);
  assert.equal(hit(84, 0), true); assert.equal(hit(85, 0), false); assert.equal(hit(-50, 0), false);
  assert.equal(hit(45, 60), true); assert.equal(hit(0, 90), false);
});

test('crossing large delta emits once, cancellation preserves committed recovery deadline', () => {
  const attack = new MeleeAttackController('a', ZOMBIE_CONFIG.shambler);
  assert.equal(attack.start(0, .4), true);
  assert.deepEqual(attack.advance(10), { attackId: 'a:1', occurredAt: .55, facing: .4 });
  assert.equal(attack.advance(11), null);
  attack.start(12, 0); const deadline = attack.getRecoveryDeadline(); attack.cancel();
  assert.equal(attack.advance(13), null); assert.equal(attack.canStart(13), false); assert.equal(attack.getRecoveryDeadline(), deadline);
});

test('windup, one-time melee damage and multi-enemy grace agree at 30/60/144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    const f = setup(); f.enemies.add('shambler', { x: 225, y: 225 }, 0); f.enemies.add('shambler', { x: 250, y: 175 }, Math.PI / 2);
    for (let i = 0; i < fps * 1.1; i++) tick(f, 1 / fps);
    assert.equal(f.player.getHealth(), 88, `FPS ${fps}`);
    assert.equal(f.enemies.snapshot()[0].action, 'recovery');
  }
});

test('dodging behind the frozen attack or behind terrain misses and still consumes recovery', () => {
  for (const block of ['behind', 'wall']) {
    const f = setup(), z = f.enemies.add('shambler', { x: 225, y: 225 }, 0);
    for (let i = 0; i < 19; i++) tick(f, 1 / 60);
    assert.equal(z.attack.getState(), 'windup'); const facing = z.getFacingDirection();
    if (block === 'behind') f.player.x = 175 - 24.5;
    else { f.map.tiles[4][5] = 'wall'; f.map.invalidateNavigation(); }
    for (let i = 0; i < 40; i++) tick(f, 1 / 60);
    assert.equal(f.player.getHealth(), 100); assert.equal(z.getFacingDirection(), facing); assert.equal(z.attack.getState(), 'recovery');
  }
});

test('gun hits always damage, only cooldown-ready hits stun and pending attacks are cancelled', () => {
  const z = new Zombie('z', 200, 200, ZOMBIE_CONFIG.shambler);
  z.attack.start(0, 0); const deadline = z.attack.getRecoveryDeadline();
  z.receiveHit(impact(1)); assert.equal(z.isStunned(), true); assert.equal(z.attack.advance(.7), null);
  z.update(.15, idle); assert.equal(z.isStunned(), false);
  z.receiveHit(impact(1)); assert.equal(z.isStunned(), false); assert.equal(z.getHealth(), 53);
  z.update(.3, idle); z.receiveHit(impact(1)); assert.equal(z.isStunned(), true);
  assert.equal(z.attack.getRecoveryDeadline(), deadline);
});

test('fatal bullets cancel attacks and navigation; corpse blocks until exactly one death completion', () => {
  const f = setup(), z = f.enemies.add('runner', { x: 225, y: 225 }, 0);
  z.attack.start(0, 0); f.enemies.receiveHit(z, impact(100)); assert.equal(z.getLifeState(), 'dying'); assert.equal(f.actors.size, 2);
  for (let i = 0; i < 5; i++) tick(f, 1 / 60);
  assert.equal(f.actors.size, 2); assert.equal(f.player.getHealth(), 100);
  for (let i = 0; i < 35; i++) tick(f, 1 / 60);
  assert.equal(f.actors.size, 1); assert.equal(f.enemies.consumeDeaths().length, 1); assert.equal(f.enemies.consumeDeaths().length, 0); assert.equal(f.enemies.zombies.length, 0);
});
