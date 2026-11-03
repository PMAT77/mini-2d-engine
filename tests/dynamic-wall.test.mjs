import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap } = load('map/TileMap');
const { rectangleCollider, circleCollider } = load('physics/Collider');
const { Bullet } = load('objects/Bullet');
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');
const { EnemySystem } = load('enemies/EnemySystem');
const { ActorCollisionWorld } = load('physics/ActorCollisionWorld');
const { NavigationScheduler } = load('navigation/NavigationScheduler');
const { hasLineOfSight } = load('vision/SightGeometry');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
function map() {
  const map = new TileMap(24, 20, { seed: 42, generateWater: false });
  map.tiles.forEach(row => row.fill('default')); map.tileHp.forEach(row => row.fill(0)); map.invalidateNavigation(); return map;
}
const wall = () => rectangleCollider(450, 200, 40, 400);
const run = (nav, result) => { for (let i = 0; i < 1000 && result.status === 'pending'; i++) nav.update(1/30); return result; };

test('one owned wall blocks real player/enemy motion, projectile casts, LOS and shadow queries until removal', () => {
  const m = map(), player = new Player(300 - 24.5, 400 - 24.5), actors = new ActorCollisionWorld(m);
  actors.register('player', player); player.setMotionResolver((body, move, angle) => actors.resolve('player', body, move, angle));
  const enemies = new EnemySystem(m, actors, 42), enemy = enemies.add('shambler', { x: 650, y: 400 });
  const remove = m.registerSolid('wall-1', [wall()]);
  assert.ok(actors.resolve('player', player.getCollider(), { x: 600, y: 0 }).collider.pose.x <= 425.51);
  assert.ok(actors.resolve(enemy.id, enemy.getCollider(), { x: -600, y: 0 }).collider.pose.x >= 490 + enemy.getCollider().radius - .02);
  assert.equal(m.castShape(circleCollider(300, 400, 5), { x: 600, y: 0 }, 'projectile').obstacle.ownerId, 'wall-1');
  assert.equal(hasLineOfSight(m, 300, 400, 650, 400), false); assert.equal(m.blocksLightAt(470, 400), true);
  assert.equal(m.getShadowEdges(300, 400, 600).length, 4);
  remove();
  assert.equal(m.castShape(circleCollider(300, 400, 5), { x: 600, y: 0 }, 'projectile'), null);
  assert.equal(hasLineOfSight(m, 300, 400, 650, 400), true); assert.equal(m.getShadowEdges(300, 400, 600).length, 0);
});

test('real bullet hits carry owner identity, damage once and remove blocking geometry on destruction', () => {
  const m = map(); let hp = 20, hits = 0;
  const remove = m.registerSolid('wall-health', [wall()], impact => {
    hits++; hp -= impact.damage;
    assert.equal(impact.source, 'bullet'); assert.equal(impact.point.x, 445);
    if (hp <= 0) remove();
  });
  const fire = () => { const bullet = new Bullet(new Vector2(300, 400), new Vector2(5000, 0), 10); bullet.update(.1, m); bullet.update(.1, m); };
  fire(); assert.equal(hp, 10); assert.equal(hits, 1); assert.equal(m.blocksLightAt(470, 400), true);
  fire(); assert.equal(hp, 0); assert.equal(hits, 2); assert.equal(m.blocksLightAt(470, 400), false);
  fire(); assert.equal(hits, 2);
  let launchHits = 0;
  m.registerSolid('muzzle-wall', [wall()], () => launchHits++);
  const near = new Bullet(new Vector2(500, 400), new Vector2(1000, 0), 10);
  near.checkLaunchPath(new Vector2(430, 400), m); near.update(1, m);
  assert.equal(launchHits, 1, 'body-to-muzzle sweep uses the same owned damage path');
});

test('navigation grids and pending paths invalidate; replanned paths detour and removal restores the direct route', () => {
  const m = map(), nav = new NavigationScheduler(m), start = { x: 300, y: 400 }, goal = { x: 700, y: 400 };
  const grid = nav.grid(23), pending = nav.request({ id: 'pending', start, goal, radius: 23 });
  const release = m.registerSolid('nav-wall', [wall()]);
  assert.equal(grid.valid(), false); nav.update(1/30); assert.equal(pending.status, 'cancelled');
  const path = run(nav, nav.request({ id: 'detour', start, goal, radius: 23 }));
  assert.equal(path.status, 'found'); assert.ok(path.path.length > 2);
  for (let i = 1; i < path.path.length; i++) assert.ok(Number.isFinite(nav.grid(23).segmentCost(path.path[i-1], path.path[i])));
  release(); assert.notEqual(path.revision, m.getNavigationRevision());
  const direct = run(nav, nav.request({ id: 'direct', start, goal, radius: 23 }));
  assert.equal(direct.status, 'found'); assert.equal(direct.path.length, 2);
});

test('registration copies geometry, invalid updates are atomic, and stale releases cannot remove replacements or traders', () => {
  const m = map(), source = wall();
  m.setStaticObstacles([rectangleCollider(200, 200, 30, 30)]);
  const first = m.registerSolid('same-owner', [source]); source.pose.x = 999; source.parts[0].vertices[0].x = 999;
  assert.equal(m.blocksLightAt(470, 400), true);
  const second = m.registerSolid('same-owner', [rectangleCollider(550, 200, 40, 400)]), revision = m.getNavigationRevision();
  first(); assert.equal(m.getNavigationRevision(), revision); assert.equal(m.blocksLightAt(570, 400), true);
  assert.throws(() => m.registerSolid('same-owner', [circleCollider(570, 400, 10)]));
  assert.equal(m.getNavigationRevision(), revision); assert.equal(m.blocksLightAt(570, 400), true);
  const candidate = map(), disposeCandidate = candidate.registerSolid('same-owner', [wall()]); disposeCandidate();
  assert.equal(m.blocksLightAt(570, 400), true);
  second(); m.setStaticObstacles([rectangleCollider(200, 200, 30, 30)]);
  assert.ok(m.castShape(circleCollider(100, 215, 10), { x: 200, y: 0 }));
  const third = m.registerSolid('still-owned', [wall()]); m.setStaticObstacles([]);
  assert.equal(m.blocksLightAt(470, 400), true); third();
});
