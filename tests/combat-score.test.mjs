import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { CombatScoreSystem } = load('combat/CombatScoreSystem');
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
const { Chicken } = load('objects/Chicken');
const { Zombie } = load('enemies/Zombie');
const { ZombieRenderer } = load('enemies/ZombieRenderer');
const { ZOMBIE_CONFIG } = load('enemies/ZombieConfig');
const { resolveFirstDamageableHit } = load('combat/HitTargetResolver');
const { getKillIndicatorLayout } = load('ui/KillIndicator');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
const idle = { isKeyDown: () => false };
const impact = (damage, hitRegion = 'body', source = 'bullet') => ({ damage, hitRegion, source,
  point: { x: 700, y: 500 }, direction: { x: -1, y: 0 }, impulse: 0,
  impactSpeed: 2600, initialSpeed: 2600, traveledDistance: 100 });

function setup() {
  const map = new TileMap(24, 20, { seed: 42, generateWater: false });
  map.tiles.forEach(row => row.fill('default')); map.invalidateNavigation();
  const scene = new GameScene({ map, seed: 42, chickenCount: 0, playerSpawn: { x: 400, y: 400 },
    encounters: { shambler: 0, runner: 0, vaccines: 0 } });
  return { scene, map, add: (kind = 'runner', x = 700, y = 500, facing = 0) => scene.getEnemySystem().add(kind, { x, y }, facing) };
}
function shoot(f, z, damage, head = true, fps = 60) {
  const center = z.getCenter(), direction = head ? -1 : 1;
  const bullet = new Bullet(new Vector2(center.x - direction * 140, center.y), new Vector2(direction * 2600, 0), damage);
  let captured;
  bullet.setEntityHitTest((...args) => {
    const hit = f.scene.findChickenHit(...args);
    if (hit) { const apply = hit.apply; hit.apply = value => { captured = value; apply(value); }; }
    return hit;
  });
  for (let i = 0; i < fps && !bullet.getIsDestroyed(); i++) bullet.update(1 / fps, f.map);
  assert.ok(captured, 'real bullet reaches target');
  return captured;
}

test('mixed qualities score immediately, round once and cap only the multiplier', () => {
  const score = new CombatScoreSystem();
  assert.deepEqual(score.recordKill('shambler', 'head'), { quality: 'gold', points: 200, chainCount: 1, multiplier: 1 });
  assert.equal(score.recordKill('shambler', 'body').points, 125);
  assert.equal(score.recordKill('runner', 'head').points, 450);
  assert.equal(score.snapshot().score, 775);
  score.reset(); score.recordKill('runner');
  assert.equal(score.recordKill('runner').points, 188);
  for (let i = 3; i <= 12; i++) {
    const feedback = score.recordKill('runner', 'body');
    assert.equal(feedback.chainCount, i);
    assert.equal(feedback.quality, 'silver');
    assert.equal(feedback.multiplier, Math.min(2, 1 + (i - 1) * .25));
  }
  const before = score.snapshot(); score.endChain();
  assert.equal(score.snapshot().score, before.score); assert.equal(score.snapshot().bestChain, 12);
  assert.equal(score.recordKill('runner').chainCount, 1);
  assert.ok(Object.isFrozen(score.snapshot())); score.reset();
  assert.deepEqual(score.snapshot(), { score: 0, kills: 0, goldKills: 0, bestChain: 0, chainCount: 0, chainRemaining: 0, multiplier: 1 });
});

test('four-second boundary is inclusive and invalid deltas do not advance a chain at 30/60/144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    const score = new CombatScoreSystem(); score.recordKill('shambler');
    for (const dt of [-1, NaN, Infinity, 0]) score.update(dt);
    assert.equal(score.snapshot().chainRemaining, 4);
    for (let i = 0; i < fps * 4; i++) score.update(1 / fps);
    assert.equal(score.recordKill('shambler').chainCount, 2);
    score.update(4.001);
    assert.equal(score.snapshot().chainCount, 0);
    assert.equal(score.recordKill('shambler').chainCount, 1);
  }
});

test('posed head and body use actual earliest contact, rotation, overlap and high-speed sweeps', () => {
  for (const kind of ['shambler', 'runner']) for (const facing of [0, Math.PI / 2, Math.PI, -.73]) {
    const z = new Zombie('geometry', 500, 500, ZOMBIE_CONFIG[kind], facing);
    for (const attackTime of [null, 0, z.config.windup - .02, z.config.windup + .02]) {
      if (attackTime !== null) { z.attack.start(0, facing); z.attack.advance(attackTime); }
      const pose = z.getPose(), head = ZombieRenderer.parts(pose).at(-1);
      const hits = Array.from({ length: 16 }, (_, i) => {
        const a = facing + i * Math.PI / 8;
        return z.queryBulletHit(head.x + Math.cos(a) * 1000, head.y + Math.sin(a) * 1000, head.x, head.y, 1);
      });
      assert.ok(hits.every(hit => hit && hit.fraction < 1), 'long sweeps cannot tunnel through the posed parts');
      if (attackTime === null || attackTime === 0) assert.ok(hits.some(hit => hit.hitRegion === 'head'), 'idle head is exposed');
      assert.ok(hits.every(hit => hit.damageMultiplier === (hit.hitRegion === 'head' ? 2 : 1)));
      assert.equal(z.queryBulletHit(head.x, head.y, head.x, head.y, 0)?.hitRegion, 'head', 'head wins a starting overlap');
      assert.equal(z.getCollider().compiled.shape.type, 'circle', 'movement still uses the circular body');
    }
  }
  const z = new Zombie('body', 500, 500, ZOMBIE_CONFIG.shambler, 0), c = z.getCenter();
  assert.equal(z.queryBulletHit(c.x - 100, c.y, c.x + 100, c.y, 1)?.hitRegion, 'body', 'body shields head from behind');
  const arm = ZombieRenderer.parts(z.getPose()).find(p => p.kind === 'arm');
  assert.equal(z.queryBulletHit(arm.x + 100, arm.y, arm.x, arm.y, 1)?.hitRegion, 'body', 'arm shields a side shot');
  assert.equal(z.queryBulletHit(NaN, 0, 1, 1, 1), null);
  z.attack.start(0, 0); z.attack.advance(z.config.windup - .02);
  const guardedHead = ZombieRenderer.parts(z.getPose()).at(-1);
  assert.equal(z.queryBulletHit(guardedHead.x + 100, guardedHead.y, guardedHead.x, guardedHead.y, 1)?.hitRegion, 'body', 'extended arm shields the head during a strike');
  const near = new Zombie('near', 450, 500, ZOMBIE_CONFIG.runner, 0);
  const hit = resolveFirstDamageableHit({ startX: 300, startY: c.y, endX: 650, endY: c.y, radius: 1 }, [{ id: 'far', target: z }, { id: 'near', target: near }]);
  assert.equal(hit.entry.id, 'near');
});

test('real head impacts double damage once, and only the fatal bullet determines quality across FPS', () => {
  for (const fps of [30, 60, 144]) {
    const f = setup(), z = f.add();
    const first = shoot(f, z, 15, true, fps);
    assert.equal(first.damage, 30); assert.equal(first.hitRegion, 'head'); assert.equal(z.getHealth(), 10);
    assert.equal(f.scene.getCombatScoreState().score, 0); assert.ok(z.getPose().headFlash > 0);
    const final = shoot(f, z, 10, false, fps);
    assert.equal(final.damage, 10); assert.equal(final.hitRegion, 'body');
    assert.equal(f.scene.getCombatScoreState().score, 150); assert.equal(f.scene.getCombatScoreState().goldKills, 0);
    const next = f.add('runner', 800, 600);
    shoot(f, next, 10, false, fps); shoot(f, next, 15, true, fps);
    assert.equal(f.scene.getCombatScoreState().goldKills, 1); assert.equal(f.scene.getCombatScoreState().score, 525);
  }
});

test('terrain wins before a head and a corpse cannot award again', () => {
  const f = setup(), z = f.add();
  f.map.tiles[10][15] = 'wall'; f.map.invalidateNavigation();
  const bullet = new Bullet(new Vector2(850, 500), new Vector2(-10000, 0), 100);
  bullet.setEntityHitTest((...args) => f.scene.findChickenHit(...args)); bullet.update(.1, f.map);
  assert.equal(z.getHealth(), 40); assert.equal(f.scene.getCombatScoreState().score, 0);
  f.map.tiles[10][15] = 'default'; f.map.invalidateNavigation();
  const hit = f.scene.findChickenHit(850, 500, 650, 500, 1, 100);
  hit.apply(impact(100, 'head')); hit.apply(impact(100, 'head'));
  assert.equal(f.scene.getCombatScoreState().score, 300); assert.equal(f.scene.getCombatScoreState().kills, 1);
});

test('chickens, scripts and posthumous bullets do not change score or an active badge', () => {
  const f = setup(); shoot(f, f.add(), 100);
  const before = f.scene.getCombatScoreState(), feedback = f.scene.killIndicator.feedback;
  let shown = 0; const show = f.scene.killIndicator.show.bind(f.scene.killIndicator);
  f.scene.killIndicator.show = (...args) => { shown++; show(...args); };
  const chicken = new Chicken(750, 600, () => .5); f.scene.chickens = [chicken];
  f.scene.damageChicken(chicken, impact(1));
  assert.equal(shown, 0, 'chicken death never requests a skull');
  assert.deepEqual(f.scene.getCombatScoreState(), before); assert.equal(f.scene.killIndicator.feedback, feedback);
  const z = f.add('shambler', 850, 700);
  f.scene.findChickenHit(1000, 700, 800, 700, 1, 100).apply(impact(1000, 'head', 'script'));
  assert.deepEqual(f.scene.getCombatScoreState(), before);
  f.scene.getPlayer().applyDamage({ kind: 'script', amount: 1000 });
  shoot(f, f.add('runner', 900, 800), 100);
  assert.deepEqual(f.scene.getCombatScoreState(), before);
});

test('scene freezes the chain on pause, retains score on death and clears on explicit life reset', () => {
  const f = setup(); f.scene.loaded = true;
  shoot(f, f.add(), 100);
  f.scene.paused = true; const frozen = f.scene.getCombatScoreState();
  f.scene.update(8, idle); assert.deepEqual(f.scene.getCombatScoreState(), frozen);
  f.scene.getPlayer().applyDamage({ kind: 'script', amount: 1000 }); f.scene.update(0, idle);
  assert.equal(f.scene.getCombatScoreState().chainCount, 0); assert.equal(f.scene.getCombatScoreState().score, 300);
  f.scene.getPlayer().resetLifeState(); f.scene.update(0, idle);
  assert.equal(f.scene.getCombatScoreState().score, 0); assert.equal(f.scene.getCombatScoreState().bestChain, 0);
});

test('badge layout reserves the quick slots and keeps a twelve-pixel screen margin', () => {
  for (const [w, h] of [[360, 640], [640, 360], [1280, 720]]) {
    const reserved = { x: w / 2 - 80, y: h - 100, width: 160, height: 60 };
    const r = getKillIndicatorLayout(w, h, [reserved]);
    assert.ok(r.x >= 12 && r.y >= 12 && r.x + r.width <= w - 12 && r.y + r.height <= reserved.y - 12 + 1e-8);
  }
});
