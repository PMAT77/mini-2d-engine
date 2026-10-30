import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Bullet } = load('objects/Bullet');
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');
const { TileMap } = load('map/TileMap');
const { parsePlayerConfig } = load('objects/PlayerConfig');

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

test('a real hit carries a frozen impact built from the segment that actually flew', () => {
  const map = dryMap();
  let impact = null;
  const bullet = new Bullet(new Vector2(100, 100), new Vector2(300, 0), 10);
  assert.throws(() => bullet.setImpactProfile({ impulse: -1 }));
  assert.throws(() => bullet.setImpactProfile({ impulse: NaN }));
  assert.throws(() => bullet.setImpactProfile({ impulse: Infinity }));
  assert.throws(() => bullet.setImpactProfile({ impulse: 'high' }));
  bullet.setImpactProfile({ impulse: 280 });
  bullet.setEntityHitTest((x0, y0, x1, y1, radius, damage) => {
    assert.equal(radius, 5);
    assert.equal(damage, 10);
    return {
      fraction: 0.5,
      x: (x0 + x1) / 2,
      y: y0,
      apply: value => { impact = value; },
    };
  });

  bullet.update(0.1, map);
  assert.equal(bullet.getIsDestroyed(), true);
  assert.ok(impact, 'the hit callback receives an impact');
  assert.equal(Object.isFrozen(impact), true);
  assert.equal(Object.isFrozen(impact.point), true);
  assert.equal(Object.isFrozen(impact.direction), true);
  assert.deepEqual({ x: impact.point.x, y: impact.point.y }, { x: 115, y: 100 });
  assert.deepEqual(centerOf(bullet), { x: 115, y: 100 }, 'impact point equals the bullet center at contact');
  assert.equal(impact.damage, 10);
  assert.equal(impact.impulse, 280);
  assert.equal(impact.impactSpeed, 300);
  assert.equal(impact.initialSpeed, 300);
  assert.ok(Math.abs(impact.direction.x - 1) < 1e-12 && Math.abs(impact.direction.y) < 1e-12);
  // 10 秒帧只飞了 30 像素，命中在 0.5 比例处：累计距离必须是 15 而不是 30。
  assert.equal(impact.traveledDistance, 15);
  assert.equal(impact.source, 'bullet');
});

test('traveled distance accumulates over frames and only counts the hit fraction', () => {
  const map = dryMap();
  let impact = null;
  const bullet = new Bullet(new Vector2(100, 100), new Vector2(300, 0), 10);
  bullet.update(0.01, map);
  bullet.update(0.01, map);
  bullet.setEntityHitTest((x0, y0, x1, y1) => ({
    fraction: 0.5, x: (x0 + x1) / 2, y: y0, apply: value => { impact = value; },
  }));
  bullet.update(0.01, map);
  assert.ok(impact);
  assert.equal(impact.impulse, 0, 'a bullet without an impact profile applies no impulse');
  assert.ok(Math.abs(impact.traveledDistance - 7.5) < 1e-9, `traveled: ${impact.traveledDistance}`);
});

test('a legacy zero-argument apply callback keeps working', () => {
  const map = dryMap();
  let applied = 0;
  const bullet = new Bullet(new Vector2(100, 100), new Vector2(300, 0), 10);
  bullet.setEntityHitTest(() => ({ fraction: 0.5, x: 115, y: 100, apply: () => { applied++; } }));
  bullet.update(0.1, map);
  assert.equal(applied, 1);
});

test('weapons snapshot their knockback impulse when the shot leaves the muzzle', () => {
  const player = new Player(0, 0);
  const defaults = player.getConfigSnapshot();
  assert.equal(defaults.shooting.knockbackImpulse, 280, 'the glock defaults to 280');
  assert.equal(defaults.primaryShooting.knockbackImpulse, 200, 'the smg defaults to 200');

  player.applyConfig({ shooting: { knockbackImpulse: 123 }, primaryShooting: { knockbackImpulse: 45 } });
  const configured = player.getConfigSnapshot();
  assert.equal(configured.shooting.knockbackImpulse, 123);
  assert.equal(configured.primaryShooting.knockbackImpulse, 45);

  player.shootAt({ x: 900, y: 0 }, 10);
  const bullets = player.getBullets();
  assert.equal(bullets.length, 1);
  let impact = null;
  bullets[0].setEntityHitTest((x0, y0, x1, y1) => ({
    fraction: 0.5, x: (x0 + x1) / 2, y: y0, apply: value => { impact = value; },
  }));
  bullets[0].update(1 / 60, dryMap());
  assert.ok(impact);
  assert.equal(impact.impulse, 123, 'the fired bullet keeps the impulse of the firing weapon');
  assert.equal(impact.source, 'bullet');

  // 已发射的子弹持有快照，之后改配置或切枪都不能改写它。
  player.applyConfig({ shooting: { knockbackImpulse: 999 } });
  assert.equal(impact.impulse, 123);
  assert.equal(player.getConfigSnapshot().shooting.knockbackImpulse, 999);
});

test('the parser accepts zero knockback and rejects invalid impulses', () => {
  assert.doesNotThrow(() => parsePlayerConfig({ shooting: { knockbackImpulse: 0 } }));
  assert.doesNotThrow(() => parsePlayerConfig({ primaryShooting: { knockbackImpulse: 0 } }));
  assert.doesNotThrow(() => parsePlayerConfig({ shooting: { knockbackImpulse: 280 } }));
  assert.throws(() => parsePlayerConfig({ shooting: { knockbackImpulse: -1 } }));
  assert.throws(() => parsePlayerConfig({ primaryShooting: { knockbackImpulse: NaN } }));
  assert.throws(() => parsePlayerConfig({ shooting: { knockbackImpulse: Infinity } }));
  assert.throws(() => parsePlayerConfig({ shooting: { knockbackImpulse: '280' } }));
});
