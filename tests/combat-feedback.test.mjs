import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { Player } = load('objects/Player'), { Camera } = load('core/Camera');
const { DamageFeedbackOverlay } = load('ui/DamageFeedbackOverlay');
const { Zombie } = load('enemies/Zombie'), { ZOMBIE_CONFIG } = load('enemies/ZombieConfig');
const { hitFlashAlpha } = load('combat/CombatFeedbackConfig');
const { MeleeAttackController } = load('enemies/MeleeAttackController');
const { ZombieRenderer } = load('enemies/ZombieRenderer');
const impact = damage => ({ damage, point: { x: 125, y: 125 }, direction: { x: 1, y: 0 }, impulse: 0, impactSpeed: 1, initialSpeed: 1, traveledDistance: 0, source: 'bullet' });

test('only applied damage queues an immutable source/target snapshot, consumed once and cleared by reset', () => {
  const p = new Player(100, 100), origin = { x: 0, y: 125 };
  assert.throws(() => p.applyDamage({ kind: 'melee', amount: 3, sourcePosition: { x: NaN, y: 0 } }));
  assert.equal(p.getHealth(), 100); assert.deepEqual(p.consumeDamageEvents(), []);
  p.applyDamage({ kind: 'melee', amount: 0 });
  p.applyDamage({ kind: 'melee', amount: 12, sourcePosition: origin });
  p.applyDamage({ kind: 'melee', amount: 12, sourcePosition: origin });
  origin.x = 999; p.x = 999;
  const events = p.consumeDamageEvents();
  assert.equal(events.length, 1); assert.equal(events[0].appliedAmount, 12);
  assert.deepEqual(events[0].sourcePosition, { x: 0, y: 125 }); assert.equal(events[0].targetPosition.x, 124.5);
  assert.ok(Object.isFrozen(events[0]) && Object.isFrozen(events[0].sourcePosition));
  assert.deepEqual(p.consumeDamageEvents(), []);
  p.applyDamage({ kind: 'infection', amount: 1 }); assert.equal(p.getHealth(), 87);
  p.resetLifeState(); assert.deepEqual(p.consumeDamageEvents(), []);
});

test('eight attack directions map to matching edges, infection has no direction and slots stay bounded', () => {
  const ui = new DamageFeedbackOverlay();
  for (let i = 0; i < 8; i++) {
    ui.clear(); const a = i * Math.PI / 4;
    ui.push({ kind: 'melee', amount: 12, appliedAmount: 12, sequence: i, targetPosition: { x: 0, y: 0 }, sourcePosition: { x: 50 * Math.cos(a), y: 50 * Math.sin(a) } });
    const g = ui.snapshot()[0]; assert.ok(Math.abs(g.x - Math.cos(a)) < 1e-8); assert.ok(Math.abs(g.y - Math.sin(a)) < 1e-8);
    const calls = [], ctx = { save() {}, restore() {}, fillRect(...args) { calls.push(args); }, createLinearGradient() { return { addColorStop() {} }; } };
    ui.draw(ctx, 360, 640); assert.ok(calls.length >= 1 && calls.length <= 2);
    ui.update(.45); assert.equal(ui.snapshot().length, 0);
  }
  for (let i = 0; i < 100; i++) ui.push({ kind: 'infection', amount: 1, appliedAmount: 1, sequence: i, targetPosition: { x: 0, y: 0 }, sourcePosition: { x: 100, y: 0 } });
  assert.equal(ui.snapshot().length, 1); assert.equal(ui.snapshot()[0].x, 0); assert.equal(ui.snapshot()[0].peak, .12);
  ui.update(.25); assert.deepEqual(ui.snapshot(), []);
});

test('damage kick survives repeated recoil calls, expires independently and reset clears it', () => {
  const camera = new Camera(800, 600); camera.kickFromDamage(0);
  assert.equal(camera.getOffset().x, 3);
  camera.shake(0, .05, 1); camera.advanceDamageKick(.02); assert.notEqual(camera.getOffset().x, 0);
  camera.advanceDamageKick(.1); assert.equal(camera.getOffset().x, 0);
  camera.kickFromDamage(1); camera.reset(); assert.deepEqual(camera.getOffset(), { x: 0, y: 0 });
});

test('every valid zombie hit flashes even during stun cooldown and refreshes the 60ms hold/80ms fade', () => {
  const z = new Zombie('z', 100, 100, ZOMBIE_CONFIG.shambler), idle = { isKeyDown: () => false };
  z.receiveHit(impact(1)); assert.equal(z.getPose().flash, 1);
  z.update(.1, idle); assert.ok(Math.abs(z.getPose().flash - .5) < 1e-8);
  z.update(.05, idle); assert.equal(z.getPose().flash, 0);
  z.receiveHit(impact(1)); assert.equal(z.isStunned(), false); assert.equal(z.getPose().flash, 1);
  z.receiveHit(impact(0)); z.update(.14, idle); assert.equal(z.getPose().flash, 0);
  for (const fps of [30, 60, 144]) {
    const frames = Math.ceil(.14 * fps); assert.equal(hitFlashAlpha(frames / fps), 0);
    assert.equal(hitFlashAlpha(.06), 1);
  }
});

test('attack pose snaps through four phases at the real hit, alternates hands and never changes physical pose', () => {
  for (const kind of ['shambler', 'runner']) {
    const c = ZOMBIE_CONFIG[kind], z = new Zombie('pose', 100, 100, c, .7), attack = z.attack;
    attack.start(0, .7); attack.advance(c.windup - c.swingSeconds - .001);
    assert.equal(attack.getPoseSnapshot().phase, 'anticipation');
    attack.advance(c.windup - c.swingSeconds / 2); assert.equal(attack.getPoseSnapshot().phase, 'strike');
    const hit = attack.advance(c.windup); assert.ok(hit); assert.equal(attack.getPoseSnapshot().phase, 'followThrough');
    assert.equal(attack.getPoseSnapshot().strike, 1); assert.equal(attack.getPoseSnapshot().trail, 1);
    attack.advance(c.windup + c.followThroughSeconds + .001); assert.equal(attack.getPoseSnapshot().phase, 'recovery');
    const hand = attack.getPoseSnapshot().hand;
    attack.advance(c.windup + c.recovery); assert.equal(attack.getPoseSnapshot().phase, 'idle');
    attack.start(2, .7); assert.equal(attack.getPoseSnapshot().hand, -hand);
    const deadline = attack.getRecoveryDeadline(); attack.cancel(); assert.equal(attack.getPoseSnapshot().phase, 'idle'); assert.equal(attack.getRecoveryDeadline(), deadline);
    for (const t of [0, c.windup / 2, c.windup - .01, c.windup, c.windup + .04, c.windup + c.recovery - .01]) {
      const visual = new MeleeAttackController('bounds', c); visual.start(0, .7); visual.advance(t);
      const pose = { ...z.getPose(), attack: visual.getPoseSnapshot() }, bounds = ZombieRenderer.bounds(pose);
      for (const part of ZombieRenderer.parts(pose)) {
        const ex = (part.width * Math.abs(Math.cos(part.angle)) + part.height * Math.abs(Math.sin(part.angle))) / 2;
        const ey = (part.width * Math.abs(Math.sin(part.angle)) + part.height * Math.abs(Math.cos(part.angle))) / 2;
        assert.ok(part.x - ex >= bounds.x && part.x + ex <= bounds.x + bounds.width);
        assert.ok(part.y - ey >= bounds.y && part.y + ey <= bounds.y + bounds.height);
      }
    }
    assert.equal(z.x, 100); assert.equal(z.y, 100); assert.ok(Math.abs(z.getFacingDirection() - .7) < 1e-8);
  }
});
