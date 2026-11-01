import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { TileMap } = load('map/TileMap');
const { NavigationGrid } = load('navigation/NavigationGrid');
const { NavigationScheduler } = load('navigation/NavigationScheduler');
const { ActorCollisionWorld } = load('physics/ActorCollisionWorld');
const { circleCollider } = load('physics/Collider');
const makeMap = (n = 16) => { const m = new TileMap(n, n, { generateWater: false, seed: 12 }); m.tiles.forEach(r => r.fill('default')); m.invalidateNavigation(); return m; };
const run = (nav, result) => { for (let i = 0; i < 1000 && result.status === 'pending'; i++) nav.update(1 / 30); return result; };

test('radius-aware path goes around L/U walls; every smoothed segment and endpoint is safe', () => {
  const m = makeMap();
  for (let y = 2; y <= 10; y++) m.tiles[y][7] = 'wall';
  for (let x = 7; x <= 12; x++) m.tiles[10][x] = 'wall';
  m.invalidateNavigation();
  const nav = new NavigationScheduler(m), grid = nav.grid(23);
  const r = run(nav, nav.request({ id: 'z1', start: { x: 275, y: 275 }, goal: { x: 475, y: 275 }, radius: 23 }));
  assert.equal(r.status, 'found'); assert.ok(r.path.length > 2);
  for (let i = 1; i < r.path.length; i++) assert.ok(Number.isFinite(grid.segmentCost(r.path[i - 1], r.path[i])));
  assert.ok(r.path.some(p => p.y < 120 || p.y > 550));
});

test('closed regions, invalid start/radius and bounded search are distinct; revision cancels live work', () => {
  const m = makeMap(); for (let y = 0; y < m.height; y++) m.tiles[y][7] = 'wall'; m.invalidateNavigation();
  const nav = new NavigationScheduler(m);
  assert.equal(run(nav, nav.request({ id: 'closed', start: { x: 125, y: 125 }, goal: { x: 625, y: 125 }, radius: 23 })).status, 'unreachable');
  assert.equal(run(nav, nav.request({ id: 'bad', start: { x: 375, y: 125 }, goal: { x: 625, y: 125 }, radius: 23 })).status, 'invalid');
  assert.equal(nav.request({ id: 'radius', start: { x: 125, y: 125 }, goal: { x: 625, y: 125 }, radius: NaN }).status, 'invalid');
  const small = new NavigationScheduler(m, { starts: 2, active: 4, nodes: 8, slice: 4, searchNodes: 10 });
  assert.equal(run(small, small.request({ id: 'budget', start: { x: 125, y: 125 }, goal: { x: 625, y: 125 }, radius: 23 })).status, 'budgetExceeded');
  const stale = nav.request({ id: 'stale', start: { x: 125, y: 125 }, goal: { x: 625, y: 125 }, radius: 23 });
  m.invalidateNavigation(); nav.update(1 / 30); assert.equal(stale.status, 'cancelled');
});

test('water cost favors a dry detour, while wider bodies cannot take a one-tile passage', () => {
  const m = makeMap(12);
  const original = m.getShapeSpeedFactor.bind(m);
  m.getShapeSpeedFactor = body => body.pose.x > 220 && body.pose.x < 380 && body.pose.y > 175 && body.pose.y < 325 ? .08 : original(body);
  const nav = new NavigationScheduler(m), r = run(nav, nav.request({ id: 'water', start: { x: 125, y: 225 }, goal: { x: 475, y: 225 }, radius: 22 }));
  assert.equal(r.status, 'found'); assert.ok(r.path.some(p => p.y <= 175 || p.y >= 325));
  for (let y = 0; y < m.height; y++) if (y !== 6) m.tiles[y][6] = 'wall'; m.invalidateNavigation();
  assert.equal(new NavigationGrid(m, 30).node(6, 6), null);
  assert.ok(new NavigationGrid(m, 22).node(6, 6));
});

test('scheduler enforces per-tick starts, active and node limits at 30/60/144 FPS, replaces and cancels requests', () => {
  for (const fps of [30, 60, 144]) {
    const m = makeMap(50); for (let y = 0; y < 49; y++) m.tiles[y][25] = 'wall'; m.invalidateNavigation();
    const nav = new NavigationScheduler(m);
    for (let i = 0; i < 12; i++) nav.request({ id: String(i), start: { x: 125, y: 125 }, goal: { x: 2200, y: 125 }, radius: 22 });
    for (let i = 0; i < fps; i++) { nav.update(1 / fps); assert.ok(nav.stats.lastStarted <= 2); assert.ok(nav.stats.lastExpanded <= 512); assert.ok(nav.stats.active <= 4); }
    assert.equal(nav.stats.ticks, 30);
    const a = nav.request({ id: 'new', start: { x: 125, y: 125 }, goal: { x: 2200, y: 125 }, radius: 22 });
    assert.equal(nav.request({ id: 'new', start: { x: 125, y: 125 }, goal: { x: 2205, y: 125 }, radius: 22 }), a);
    nav.request({ id: 'new', start: { x: 125, y: 125 }, goal: { x: 2300, y: 125 }, radius: 22 }); assert.equal(a.status, 'cancelled');
    nav.clear(); assert.equal(nav.get('new'), undefined); assert.equal(nav.stats.active, 0); assert.equal(nav.stats.queued, 0);
  }
});

test('mineral damage does not invalidate paths until topology changes; blocked goal finds nearby connected point', () => {
  const m = makeMap(); m.tiles[4][4] = 'mineral'; m.tileHp[4][4] = 100; m.invalidateNavigation();
  const rev = m.getNavigationRevision(); m.damageTile(4, 4, 10); assert.equal(m.getNavigationRevision(), rev);
  const nav = new NavigationScheduler(m), r = run(nav, nav.request({ id: 'blocked-goal', start: { x: 125, y: 125 }, goal: { x: 225, y: 225 }, radius: 23 }));
  assert.equal(r.status, 'found'); assert.ok(Math.hypot(r.path.at(-1).x - 225, r.path.at(-1).y - 225) <= 100);
  m.damageTile(4, 4, 100); assert.equal(m.getNavigationRevision(), rev + 1);
  m.breakTile(4, 4); assert.equal(m.getNavigationRevision(), rev + 1, 'breaking an already empty tile does not invalidate navigation');
});

test('swept actors block fast rolls and terrain-constrained separation never crosses a wall', () => {
  const m = makeMap(), world = new ActorCollisionWorld(m);
  const actor = (x, y) => ({ x: x - 23, y: y - 23, getSize: () => 46, getCollider() { return circleCollider(this.x + 23, this.y + 23, 23); } });
  const a = actor(125, 125), b = actor(225, 125); world.register('player', a); world.register('z1', b);
  const result = world.resolve('player', a.getCollider(), { x: 400, y: 0 }); assert.ok(result.collider.pose.x <= 179.02);
  m.tiles[2][3] = 'wall'; m.invalidateNavigation(); a.x = 105 - 23; b.x = 125 - 23; world.sync(); world.separate();
  assert.ok(m.isShapeWalkable(a.getCollider())); assert.ok(m.isShapeWalkable(b.getCollider()));
  world.unregister('z1'); assert.equal(world.size, 1);
});

test('path reconstruction and weighted smoothing also obey the scheduler work quota', () => {
  const m = makeMap(30); for (let y = 0; y < 28; y++) m.tiles[y][15] = 'wall'; m.invalidateNavigation();
  const nav = new NavigationScheduler(m, { starts: 2, active: 4, nodes: 12, slice: 4, searchNodes: 10000 });
  const r = nav.request({ id: 'long', start: { x: 125, y: 125 }, goal: { x: 1300, y: 125 }, radius: 23 });
  for (let i = 0; i < 2000 && r.status === 'pending'; i++) { nav.update(1/30); assert.ok(nav.stats.lastWorkUnits <= 12); }
  assert.equal(r.status, 'found'); assert.ok(nav.stats.workUnits > r.expanded);
});

test('continuous replacement of high-priority active work cannot starve an old low-priority request', () => {
  const m = makeMap(80); for (let y = 0; y < 79; y++) m.tiles[y][40] = 'wall'; m.invalidateNavigation();
  const nav = new NavigationScheduler(m, { starts: 1, active: 1, nodes: 1, slice: 1, searchNodes: 10000 });
  const start = { x: 125, y: 125 }, high = i => ({ id: 'high', start, goal: { x: 3550 + (i%2)*50, y: 125 }, radius: 23, priority: 3 });
  nav.request(high(0)); const low = nav.request({ id: 'low', start, goal: { x: 175, y: 125 }, radius: 23, priority: 0 });
  for (let i=0; i<150 && low.status==='pending'; i++) { if(i) nav.request(high(i)); nav.update(1/30); }
  assert.equal(low.status, 'found'); assert.ok(nav.stats.maxWaitSeconds >= 3);
});
