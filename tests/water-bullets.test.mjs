import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap } = load('map/TileMap');
const { Bullet } = load('objects/Bullet');
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');
const { ParticleSystem } = load('objects/ParticleSystem');
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const idle = { isKeyDown: () => false };
const playerAt = (...args) => { const p = new Player(...args); p.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } }); return p; };
const aimRight = p => ({ target: { x: p.x + 1024.5, y: p.y + 24.5 }, fire: true, face: false });
const empty = () => {
  const map = new TileMap(64, 32, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
const shot = (x = 225, y = 225, speed = 800, particles) =>
  new Bullet(new Vector2(x, y), new Vector2(speed, 0), 100, particles, true, undefined, 10000);
const center = bullet => bullet.getPosition().x + bullet.getSize() / 2;

test('each water depth applies linear drag and emits one white annihilation burst at its exact stopping point', () => {
  for (const [type, duration] of [['shallow_water', 2.5], ['water', 1.25], ['deep_water', .625], ['ultra_deep_water', .3125]]) {
    const map = empty(); map.tiles.forEach(row => row.fill(type));
    for (const speed of [400, 800, 1200]) {
      const bursts = []; let damage = 0;
      const bullet = shot(225, 225, speed, { createExplosion: (...args) => bursts.push(args) });
      map.damageTile = () => damage++;
      bullet.update(duration / 2, map);
      near(bullet.velocity.length(), speed / 2);
      near(center(bullet), 225 + speed * duration * .375);
      assert.equal(bullet.getIsDestroyed(), false);
      assert.equal(bursts.length, 0);
      bullet.update(duration / 2, map);
      near(bullet.velocity.length(), 0);
      near(center(bullet), 225 + speed * duration / 2);
      assert.equal(bullet.getIsDestroyed(), true);
      bullet.update(1, map);
      near(center(bullet), 225 + speed * duration / 2);
      assert.equal(bursts.length, 1); assert.equal(damage, 0);
      const [pos, count, spreadSpeed, size, life, colors] = bursts[0];
      near(pos.x, center(bullet)); near(pos.y, 225);
      assert.equal(count, 4); assert.ok(spreadSpeed <= 60 && size <= 4 && life <= .35);
      assert.deepEqual(colors, ['#ffffff', '#e8e8e8', '#cfcfcf', '#b5b5b5']);
    }
    const long = shot(); long.update(3, map);
    assert.equal(long.getIsDestroyed(), true);
    near(center(long), 225 + 800 * duration / 2);
  }
});

test('bullet footprint weights land and different water depths by their actual coverage', () => {
  const map = empty();
  for (const [left, right, expectedRate] of [['default', 'shallow_water', .5 * .4], ['shallow_water', 'deep_water', .5 * .4 + .5 * 1.6]]) {
    map.tiles.forEach(row => row.forEach((_, col) => row[col] = col < 8 ? left : right));
    const bullet = new Bullet(new Vector2(400, 225), new Vector2(0, 800), 100, undefined, true);
    bullet.update(.06, map);
    near(bullet.velocity.length(), 800 * (1 - expectedRate * .06));
    near(bullet.getPosition().y + 5, 225 + 800 * .06 - .5 * 800 * expectedRate * .06 ** 2);
  }
});

test('firing snapshots partial body contact, independently of the bullet footprint and later shooter movement', () => {
  const map = empty();
  map.tiles.forEach(row => row.forEach((_, col) => row[col] = col >= 8 ? 'shallow_water' : 'default'));
  const wet = playerAt(390 - 24.5, 225 - 24.5);
  wet.update(0, idle, map, aimRight(wet));
  const wetBullet = wet.getBullets()[0];
  near(center(wetBullet), wet.getMuzzlePosition().x);
  assert.ok(wet.terrainWaterCoverage.fraction > 1e-6 && wet.terrainWaterCoverage.fraction < 1);
  wet.x = 200; wet.update(0, idle, map);
  wetBullet.update(.1, map);
  assert.ok(wetBullet.velocity.length() < 2600);

  const dry = playerAt(350 - 24.5, 225 - 24.5);
  dry.update(0, idle, map, aimRight(dry));
  const dryBullet = dry.getBullets()[0];
  const dryStart = center(dryBullet);
  dry.x = 425; dry.update(0, idle, map);
  dryBullet.update(.3, map);
  near(dryBullet.velocity.length(), 2600); near(center(dryBullet), dryStart + 780);

  const edge = playerAt(375.5 - 24.5, 225 - 24.5); // Only tangent to water.
  edge.update(0, idle, map); edge.shoot(new Vector2(1, 0));
  const tangentBullet = edge.getBullets()[0]; tangentBullet.update(.2, map);
  near(tangentBullet.velocity.length(), 2600);
});

test('drag accumulates on re-entry, while dry flight preserves remaining velocity and launch-speed buffs', () => {
  const map = empty(), bullet = shot();
  const originalSpeed = bullet.velocity.length();
  for (const [type, seconds] of [['shallow_water', .25], ['default', .2], ['deep_water', .0625], ['default', .2], ['water', .125]]) {
    map.tiles.forEach(row => row.fill(type));
    const before = bullet.velocity.length(), start = center(bullet);
    bullet.update(seconds, map);
    if (type === 'default') { near(bullet.velocity.length(), before); near(center(bullet) - start, before * seconds); }
    else near(bullet.velocity.length(), before - originalSpeed * .1);
  }
  // Traverse two actual water strips separated by dry land, including partial-circle exits.
  map.tiles.forEach(row => row.forEach((_, col) => row[col] = col === 4 ? 'shallow_water' : col === 6 ? 'water' : 'default'));
  const crossing = shot(225); crossing.update(.05, map);
  assert.ok(center(crossing) > 255 && center(crossing) < 280);
  const afterFirst = crossing.velocity.length(), dryStart = center(crossing);
  crossing.update(.01, map);
  near(crossing.velocity.length(), afterFirst); near(center(crossing) - dryStart, afterFirst * .01);
  crossing.update(.06, map); assert.ok(center(crossing) > 305 && center(crossing) < 345);
  assert.ok(crossing.velocity.length() < afterFirst);
  crossing.update(.1, map); assert.ok(center(crossing) > 355);
  const afterSecond = crossing.velocity.length(), secondDryStart = center(crossing);
  crossing.update(.02, map);
  near(crossing.velocity.length(), afterSecond); near(center(crossing) - secondDryStart, afterSecond * .02);
  const player = playerAt(200, 200); player.addModifier('bulletSpeed', .5, 0, true);
  // 加速后的子弹在 .625s 内会飞过默认射程，放宽射程以观察水阻衰减。
  player.applyConfig({ shooting: { maxRange: 4000 } });
  map.tiles.forEach(row => row.fill('water')); player.update(0, idle, map); player.shoot(new Vector2(1, 0));
  const buffed = player.getBullets()[0]; buffed.update(.625, map);
  near(buffed.velocity.length(), player.getBulletSpeed() / 2);
  const noMap = shot(); noMap.update(.5); near(center(noMap), 625); near(noMap.velocity.length(), 800);
});

test('dragged bullets still damage the first swept mineral, but cannot hit targets beyond their stopping point', () => {
  for (const [col, shouldHit] of [[5, true], [9, false]]) {
    const map = empty(); map.tiles.forEach(row => row.fill('ultra_deep_water'));
    map.tiles[4][col] = 'mineral'; map.tileHp[4][col] = 100;
    let explosions = 0;
    const bullet = shot(225, 225, 800, { createExplosion: () => explosions++ });
    bullet.update(.5, map);
    assert.equal(bullet.getIsDestroyed(), true);
    assert.equal(map.tileHp[4][col], shouldHit ? 0 : 100);
    assert.equal(explosions, 1);
    if (!shouldHit) near(center(bullet), 350);
  }
  const map = empty(); map.tiles.forEach(row => row.fill('ultra_deep_water'));
  const dry = new Bullet(new Vector2(225, 225), new Vector2(800, 0));
  map.getTerrainCoverage = () => { throw Error('dry-origin bullets must skip water queries'); };
  dry.update(.5, map); near(center(dry), 625); near(dry.velocity.length(), 800);
  const invalid = shot();
  for (const delta of [-1, NaN, Infinity, 0]) invalid.update(delta, empty());
  near(center(invalid), 225); near(invalid.velocity.length(), 800);
});

test('annihilation particles are white, small, fade out and expire through the existing particle pool', () => {
  const map = empty(); map.tiles.forEach(row => row.fill('deep_water'));
  const particles = new ParticleSystem(), bullet = shot(225, 225, 800, particles);
  bullet.update(.625, map);
  assert.equal(particles.getPerformanceStats().activeParticles, 4);
  for (const particle of particles.particles) {
    assert.ok(['#ffffff', '#e8e8e8', '#cfcfcf', '#b5b5b5'].includes(particle.getColor()));
    near(particle.getPosition().x, center(bullet)); near(particle.getPosition().y, 225);
    // 湮灭烟尘的基准尺寸 4，粒子按 0.8–1.2 倍随机缩放。
    assert.ok(particle.getSize() <= 4.8);
  }
  particles.update(.1);
  for (const particle of particles.particles) assert.ok(particle.getAlpha() > 0 && particle.getAlpha() < 1);
  particles.update(.5); // 烟尘寿命 0.35s 随机 0.8–1.2 倍，累计 0.6s 后池应清空。
  assert.equal(particles.getPerformanceStats().activeParticles, 0);
  bullet.update(.3, map); assert.equal(particles.getPerformanceStats().activeParticles, 0);
});

test('per-depth drag edits affect newly fired bullets only, support zero and restore from a detached snapshot', () => {
  const map = empty(), player = playerAt(200, 200), dir = new Vector2(1, 0);
  const initial = player.getConfigSnapshot();
  assert.deepEqual(initial.bulletWaterDrag, { shallow: .4, water: .8, deep: 1.6, ultraDeep: 3.2 });
  // Validate each field through the real player configuration and firing path.
  for (const [key, type] of [['shallow', 'shallow_water'], ['water', 'water'], ['deep', 'deep_water'], ['ultraDeep', 'ultra_deep_water']]) {
    map.tiles.forEach(row => row.fill(type));
    player.fireCooldown = 0; player.update(0, idle, map); player.shoot(dir);
    const old = player.getBullets().at(-1), previousRate = initial.bulletWaterDrag[key];
    player.applyConfig({ bulletWaterDrag: { [key]: .2 } });
    player.fireCooldown = 0; player.shoot(dir); const tuned = player.getBullets().at(-1);
    player.applyConfig({ bulletWaterDrag: { [key]: 0 } });
    player.fireCooldown = 0; player.shoot(dir); const disabled = player.getBullets().at(-1);
    old.update(.1, map); tuned.update(.1, map); disabled.update(.1, map);
    const base = player.getBulletSpeed();
    near(old.velocity.length(), base * (1 - previousRate * .1));
    near(tuned.velocity.length(), base * .98); near(disabled.velocity.length(), base);
    player.setDebugState({ magazineAmmo: player.getMagazineSize(), chambered: true }); player.applyConfig(initial);
  }
  const snapshot = player.getConfigSnapshot(); snapshot.bulletWaterDrag.deep = 99;
  near(player.getConfigSnapshot().bulletWaterDrag.deep, 1.6);
  for (const value of [-1, NaN, Infinity, '10', null]) {
    assert.throws(() => player.applyConfig({ shooting: { bulletSpeed: 1200 }, bulletWaterDrag: { deep: value } }));
    assert.deepEqual(player.getConfigSnapshot(), initial);
  }
  assert.throws(() => player.applyConfig({ bulletWaterDrag: { unknown: 1 } }));
  const rates = { shallow: .2 }, standalone = new Bullet(new Vector2(200, 200), new Vector2(800, 0), 10, undefined, true, rates);
  rates.shallow = 4; map.tiles.forEach(row => row.fill('shallow_water')); standalone.update(.1, map);
  near(standalone.velocity.length(), 784);
});

test('cross-depth and curved-lake trajectories agree at 30/60/144 FPS and across a half-second frame', () => {
  const stripe = empty();
  const bands = ['default', 'shallow_water', 'water', 'deep_water', 'ultra_deep_water'];
  stripe.tiles.forEach(row => row.forEach((_, col) => row[col] = bands[Math.min(4, Math.max(0, col - 3))]));
  const curved = new TileMap(100, 100, { seed: 8351 }); curved.tiles.forEach(row => row.fill('default'));
  const lake = curved.water.lakes[0], y = lake.center.y * 50;
  for (const [map, x, cy] of [[stripe, 175, 225], [curved, lake.bounds.x * 50 - 10, y]]) {
    const simulate = (fps, collision = false) => {
      const bullet = shot(x, cy, 1000);
      const steps = fps ? Array.from({ length: fps / 2 }, () => 1 / fps) : [.5];
      for (const delta of steps) bullet.update(delta, map);
      if (collision) bullet.update(1, map);
      return { x: center(bullet), speed: bullet.velocity.length(), destroyed: bullet.getIsDestroyed() };
    };
    const reference = simulate(144);
    for (const fps of [30, 60, 0]) {
      const result = simulate(fps);
      near(result.x, reference.x, 2); near(result.speed, reference.speed, 5);
      assert.equal(result.destroyed, reference.destroyed);
    }
    // A nearby wall is hit consistently even when drag and a boundary occur in the same long frame.
    const col = Math.floor((x + 35) / 50), row = Math.floor(cy / 50);
    map.tiles[row][col] = 'wall';
    const hit = simulate(144, true); assert.equal(hit.destroyed, true);
    for (const fps of [30, 60, 0]) { const result = simulate(fps, true); assert.equal(result.destroyed, true); near(result.x, hit.x, .001); }
  }
});
