import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = p => require(join(process.env.TEST_BUILD_DIR, p + '.js'));
const { Player } = load('objects/Player');
const { PlayerSurvivalSystem } = load('survival/PlayerSurvivalSystem');
const { createBackpackView, getBackpackLoad } = load('ui/BackpackView');
const { QuickSlotHud } = load('ui/QuickSlotHud');
const { getWeaponListRows } = load('ui/WeaponListHud');
const { createPlayerRenderSnapshot } = load('objects/animation/PlayerVisualAdapter');
const { buildPlayerPartCommands } = load('animation2d/render/PlayerRenderParts');

test('backpack projects live weapon slots and vaccines, calculating one shared load without copying inventory', () => {
  const player = new Player(100, 100), survival = new PlayerSurvivalSystem(player);
  const view = () => createBackpackView(player.getWeaponLoadoutView(), survival.inventory.getVaccines(), '当前未感染');
  assert.deepEqual(view().items.map(item => item.id), ['melee', 'primary', 'secondary']);
  assert.deepEqual(view().load, { weightKg: 4.1, capacityKg: 30 });
  survival.inventory.addVaccines(3); player.switchWeapon('primary');
  assert.equal(view().items.find(item => item.id === 'primary').equipped, true);
  assert.equal(view().items.find(item => item.id === 'vaccine').quantity, 3);
  assert.equal(view().items.find(item => item.id === 'vaccine').disabledReason, '当前未感染');
  assert.equal(view().load.weightKg, 4.4);
  survival.inventory.consumeVaccine();
  assert.equal(view().load.weightKg, 4.3);
  assert.equal(view().items.find(item => item.id === 'vaccine').quantity, 2);
  assert.equal(getBackpackLoad(1000).weightKg, 104.1, 'capacity is display-only');
  assert.equal(survival.inventory.getVaccines(), 2, 'reading UI does not change inventory');
});

test('backpack can cure during its simulation pause, retaining every other vaccine eligibility check', () => {
  const player = new Player(100, 100), survival = new PlayerSurvivalSystem(player);
  const context = { paused: true, source: 'backpack', rolling: false, reloading: false, interacting: false, actionInput: false };
  survival.inventory.addVaccines(2); survival.infection.infect(); player.takeDamage(20);
  assert.equal(survival.tryUseVaccine({ ...context, source: 'gameplay' }), false);
  assert.equal(survival.tryUseVaccine({ ...context, source: undefined }), false);
  for (const flag of ['rolling', 'reloading', 'interacting', 'actionInput']) {
    assert.equal(survival.tryUseVaccine({ ...context, [flag]: true }), false);
  }
  assert.equal(survival.tryUseVaccine(context), true);
  assert.equal(player.getHealth(), 80);
  assert.equal(survival.snapshot().vaccines, 1);
  assert.equal(survival.snapshot().infected, false);
  assert.equal(survival.tryUseVaccine(context), false, 'no infection consumes nothing');
  survival.inventory.consumeVaccine(); survival.infection.infect();
  assert.equal(survival.getVaccineUseFailure(context), '疫苗不足');
  player.takeDamage(100);
  assert.equal(survival.tryUseVaccine(context), false, 'dead actors cannot use vaccines');
});

test('dropping weapons removes possession, weight, HUD and stowed visuals; recovery preserves ammo and cannot duplicate', () => {
  const player = new Player(100, 100); player.switchWeapon('primary');
  player.shootAt({ x: 1000, y: 100 });
  const ammo = player.getWeaponView().magazineAmmo, chambered = player.getWeaponView().chambered;
  const item = player.dropWeapon('primary');
  assert.ok(item); assert.equal(item.magazineAmmo, ammo);
  assert.equal(player.hasWeapon('primary'), false);
  player.switchWeapon('primary'); assert.equal(player.getActiveWeaponSlot(), 'secondary');
  assert.equal(player.dropWeapon('primary'), null);
  assert.equal(player.dropWeapon('melee'), null);
  const view = createBackpackView(player.getWeaponLoadoutView(), 0, null);
  assert.equal(view.load.weightKg, .9);
  assert.equal(view.items.some(item => item.id === 'primary'), false);
  assert.equal(getWeaponListRows(player.getWeaponLoadoutView()).some(item => item.slot === 'primary'), false);
  const command = buildPlayerPartCommands(createPlayerRenderSnapshot(player)).find(cmd => cmd.op === 'drawStowedWeapons');
  assert.equal(command.ownedFirearms.primary, false);
  assert.equal(player.collectWeapon(item), true);
  assert.equal(player.collectWeapon(item), false);
  assert.equal(player.getWeaponViewForSlot('primary').magazineAmmo, ammo);
  assert.equal(player.getWeaponViewForSlot('primary').chambered, chambered);
  player.dropWeapon('primary'); player.dropWeapon('secondary');
  player.cycleFirearm(1); player.toggleMelee();
  assert.equal(player.getActiveWeaponSlot(), 'melee', 'no dropped weapon can be re-equipped via Tab or C');
  assert.equal(getBackpackLoad(0, player.getWeaponLoadoutView()).weightKg, 0);
});

test('backpack parameters use real configured and modified combat values', () => {
  const player = new Player(100, 100);
  player.addModifier('damage', .5, 0, true); player.addModifier('fireRate', .5, 0, true);
  const primary = createBackpackView(player.getWeaponLoadoutView(), 0, null).items.find(item => item.id === 'primary');
  assert.equal(primary.properties.find(p => p.label === '攻击力').value, '24.0');
  assert.equal(primary.properties.find(p => p.label === '射速').value, '1200 发/分');
});

test('quick slot activation consumes key edges, supports chords and releases ownership after reset', () => {
  const hud = new QuickSlotHud(), keys = new Set(); let reset = 0;
  const input = { isKeyDown: key => keys.has(key), getResetVersion: () => reset };
  keys.add('1'); assert.equal(hud.update(input), 0); assert.equal(hud.update(input), null);
  keys.add('2'); assert.equal(hud.update(input), 1); assert.equal(hud.update(input), null);
  keys.clear(); reset++; assert.equal(hud.update(input), null);
  keys.add('Numpad4'); assert.equal(hud.update(input), 3);
});
