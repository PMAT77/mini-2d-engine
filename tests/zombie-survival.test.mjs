import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { Player } = load('objects/Player');
const { PlayerSurvivalSystem } = load('survival/PlayerSurvivalSystem');
const { ConsumableInventory } = load('survival/ConsumableInventory');
const { InfectionController } = load('survival/InfectionController');
const { VaccinePickup } = load('objects/VaccinePickup');
const { MeatPickup } = load('objects/MeatPickup');
const { InteractionController } = load('interaction/InteractionController');
const { createPickupCandidate } = load('interaction/PickupTargetResolver');
const { getPlayerStatusHudRect } = load('ui/PlayerStatusHud');
const setup = () => { const player = new Player(100, 100); return { player, survival: new PlayerSurvivalSystem(player) }; };
const usable = { paused: false, rolling: false, reloading: false, interacting: false, actionInput: false };

test('infection ticks retain fractions across 30/60/144 FPS, do not stack or refresh, and healing does not cure', () => {
  for (const fps of [30, 60, 144]) {
    const { player, survival } = setup(); survival.infection.infect();
    for (let i = 0; i < fps * 2; i++) { survival.update(1/fps); survival.infection.infect(); }
    assert.equal(player.getHealth(), 98); assert.ok(survival.infection.getRemainder() < 1e-8);
    survival.update(.4); player.heal(1); assert.equal(survival.infection.isInfected(), true);
    survival.update(.6); assert.equal(player.getHealth(), 98);
  }
  const controller = new InfectionController(); controller.infect(); assert.equal(controller.advance(1e9 + .25), 1e9); assert.equal(controller.getRemainder(), .25);
});

test('only actual surviving melee damage rolls infection; blocked and already infected attacks do not consume RNG', () => {
  const { player, survival } = setup(); let rolls = 0; const random = () => { rolls++; return 0; };
  survival.onMeleeDamage({ appliedAmount: 0, killed: false, blocked: true }, 1, random); assert.equal(rolls, 0);
  const result = player.applyDamage({ kind: 'melee', amount: 12 }); assert.equal(survival.onMeleeDamage(result, 1, random), true);
  survival.onMeleeDamage(result, 1, random); assert.equal(rolls, 1);
  player.takeDamage(100); survival.update(.1); assert.equal(survival.snapshot().infected, false); assert.equal(player.consumeDeathEvent().kind, 'script'); assert.equal(player.consumeDeathEvent(), null);
});

test('vaccine collection is once, use is atomic, rejects all blocked contexts, and never heals', () => {
  const { player, survival } = setup(), pickup = new VaccinePickup(100, 100);
  assert.equal(survival.snapshot().vaccines, 0); assert.equal(survival.collectVaccine(pickup), true); assert.equal(survival.collectVaccine(pickup), false);
  assert.equal(survival.tryUseVaccine(usable), false); assert.equal(survival.snapshot().vaccines, 1);
  survival.infection.infect(); player.takeDamage(20);
  for (const key of Object.keys(usable)) { assert.equal(survival.tryUseVaccine({ ...usable, [key]: true }), false); assert.equal(survival.snapshot().vaccines, 1); }
  assert.equal(survival.tryUseVaccine(usable), true); assert.equal(survival.snapshot().infected, false); assert.equal(survival.snapshot().vaccines, 0); assert.equal(player.getHealth(), 80);
});

test('inventory rejects invalid values and overflow without mutation; reset life preserves inventory', () => {
  const inventory = new ConsumableInventory();
  for (const n of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => inventory.addVaccines(n));
  inventory.addVaccines(Number.MAX_SAFE_INTEGER); assert.throws(() => inventory.addVaccines(1)); assert.equal(inventory.getVaccines(), Number.MAX_SAFE_INTEGER);
  const { player, survival } = setup(); survival.inventory.addVaccines(2); survival.infection.infect(); player.takeDamage(100); survival.resetLife();
  assert.deepEqual(survival.snapshot(), { alive: true, infected: false, vaccines: 2, infectionRemainder: 0 }); assert.equal(player.getHealth(), 100);
});

test('shared pickup controller prefers distance before type priority and completes only one item per hold', () => {
  const meat = new MeatPickup(100, 100); meat.update(1); const vaccine = new VaccinePickup(100, 100);
  const make = (target, distance) => ({ ...createPickupCandidate(target, `${target.kind}-${target.id}`, target.getPickupAnchor(), { x: 100, y: 100 }, target.pickupConfig), distance });
  const c = new InteractionController();
  let r = c.update({ delta: 0, pressed: false, candidates: [make(meat, 20), make(vaccine, 21)] }); assert.equal(c.getSnapshot().target, meat);
  c.reset(); c.update({ delta: 0, pressed: false, candidates: [make(meat, 20), make(vaccine, 20)] }); assert.equal(c.getSnapshot().target, vaccine);
  r = c.update({ delta: .5, pressed: true, candidates: [make(meat, 20), make(vaccine, 20)] }); assert.equal(r.completed, vaccine);
  assert.equal(c.update({ delta: 1, pressed: true, candidates: [make(meat, 20)] }).completed, null);
});

test('infection death is once and survival clears state; ordinary health edits cannot resurrect', () => {
  const { player, survival } = setup(); player.takeDamage(99); survival.infection.infect(); survival.update(3);
  assert.equal(player.isAlive(), false); assert.equal(player.getDeathCause().kind, 'infection'); assert.equal(survival.snapshot().infected, false);
  assert.ok(player.consumeDeathEvent()); survival.update(100); assert.equal(player.consumeDeathEvent(), null); player.heal(100); assert.equal(player.getHealth(), 0);
});

test('status HUD stays inside narrow portrait, narrow landscape and desktop viewports', () => {
  for (const [width, height] of [[360,640],[640,360],[1280,720]]) {
    const r = getPlayerStatusHudRect(width, height, { x: width - 300, y: 240, width: 280, height: 180 });
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height);
  }
});
