import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { Player } = require(join(process.env.TEST_BUILD_DIR, 'objects/Player.js'));
const { resolveFirstDamageableHit } = require(join(process.env.TEST_BUILD_DIR, 'combat/HitTargetResolver.js'));
const idle = { isKeyDown: () => false };

test('damage validates before mutation, melee protection does not protect against infection, death is once', () => {
  const p = new Player(100, 100);
  assert.throws(() => p.applyDamage({ amount: NaN, kind: 'melee' }));
  assert.equal(p.getHealth(), 100);
  assert.deepEqual(p.applyDamage({ amount: 12, kind: 'melee' }), { appliedAmount: 12, killed: false, blocked: false });
  assert.equal(p.applyDamage({ amount: 20, kind: 'melee' }).blocked, true);
  assert.equal(p.applyDamage({ amount: 1, kind: 'infection' }).appliedAmount, 1);
  p.advanceDamageTimers(.35);
  assert.equal(p.applyDamage({ amount: 200, kind: 'melee', sourceId: 'z1' }).killed, true);
  assert.equal(p.consumeDeathEvent().sourceId, 'z1');
  assert.equal(p.consumeDeathEvent(), null);
  assert.equal(p.applyDamage({ amount: 10, kind: 'infection' }).blocked, true);
  p.heal(100); p.setDebugState({ health: 100 });
  assert.equal(p.getHealth(), 0); assert.equal(p.isAlive(), false);
  p.resetLifeState(); assert.equal(p.isAlive(), true); assert.equal(p.getHealth(), 100);
});

test('dead players reject direct action methods while old projectiles still advance', () => {
  const p = new Player(100, 100);
  let advanced = 0;
  p.bullets.push({ update: () => advanced++, getIsDestroyed: () => false });
  p.takeDamage(100);
  const weapon = p.getWeaponView().id;
  assert.equal(p.requestRoll(idle), false);
  p.requestReload();
  assert.equal(p.getWeaponView().isReloading, false);
  p.shootAt({ x: 200, y: 100 }); p.cycleFirearm(1); p.toggleMelee();
  assert.equal(p.getWeaponView().id, weapon);
  p.update(.1, idle);
  assert.equal(advanced, 1); assert.equal(p.x, 100);
});

test('generic target query is pure and preserves stable candidates on equal contact', () => {
  const entry = (id, fraction, alive = true) => ({ id, target: {
    isDamageable: () => alive, hitTestSegment: () => fraction,
    receiveHit: () => { throw new Error('queries cannot apply damage'); },
  } });
  const q = { startX: 0, startY: 0, endX: 100, endY: 0, radius: 1 };
  assert.equal(resolveFirstDamageableHit(q, [entry('dead', .01, false), entry('far', .8), entry('first', .2), entry('tie', .2)]).entry.id, 'first');
  assert.equal(resolveFirstDamageableHit(q, []), null);
});
