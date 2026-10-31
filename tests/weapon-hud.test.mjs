import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const {
  WEAPON_LIST, getWeaponListLayout, getWeaponListRows, WeaponListHud,
} = load('ui/WeaponListHud');
const { Player } = load('objects/Player');

const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b} (±${epsilon})`);

const pistolView = (patch = {}) => ({
  slot: 'secondary', name: '格洛克手枪', kind: 'firearm',
  magazineAmmo: 6, magazineSize: 6, chambered: true, reserveAmmo: null,
  isReloading: false, reloadMode: null, reloadProgress: 0, ...patch,
});
const smgView = (patch = {}) => ({
  slot: 'primary', name: '冲锋枪', kind: 'firearm',
  magazineAmmo: 30, magazineSize: 30, chambered: true, reserveAmmo: null,
  isReloading: false, reloadMode: null, reloadProgress: 0, ...patch,
});
const emptyView = (patch = {}) => ({
  slot: 'melee', name: '空手', kind: 'empty',
  magazineAmmo: 0, magazineSize: 0, chambered: false, reserveAmmo: null,
  isReloading: false, reloadMode: null, reloadProgress: 0, ...patch,
});
const knifeView = (patch = {}) => emptyView({ name: '小刀', kind: 'melee', ...patch });
const loadout = (activeSlot = 'secondary', patches = {}) => ({
  activeSlot,
  primary: smgView(patches.primary),
  secondary: pistolView(patches.secondary),
  melee: patches.melee || emptyView(),
});

/** 只记录列表绘制用到的路径与文字。 */
function stubContext() {
  const calls = {
    texts: [], fills: [], fillRects: [], roundRects: [], strokes: [],
    saves: 0, restores: 0,
  };
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: 'left', textBaseline: 'alphabetic',
    save() { calls.saves += 1; },
    restore() { calls.restores += 1; },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    translate() {},
    rotate() {},
    scale() {},
    roundRect(x, y, width, height, radius) { calls.roundRects.push({ x, y, width, height, radius }); },
    fill() { calls.fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    stroke() { calls.strokes.push({ style: ctx.strokeStyle, alpha: ctx.globalAlpha }); },
    fillRect(x, y, width, height) { calls.fillRects.push({ x, y, width, height, style: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    strokeRect() {},
    fillText(text, x, y) {
      calls.texts.push({ text, x, y, font: ctx.font, fillStyle: ctx.fillStyle, alpha: ctx.globalAlpha });
    },
  };
  return { ctx, calls };
}

test('weapon list hugs the right edge with two rows centred vertically', () => {
  const layout = getWeaponListLayout(1100, 800);
  assert.equal(layout.area.width, 253);
  assert.equal(layout.area.x, 823);
  assert.equal(layout.area.x + layout.area.width, 1100 - WEAPON_LIST.rightMargin);
  assert.equal(layout.area.height, WEAPON_LIST.rowHeight * 2 + WEAPON_LIST.rowGap);
  assert.equal(layout.area.y, (800 - layout.area.height) / 2);
  assert.deepEqual(layout.topRow, { x: 823, y: layout.area.y, width: 253, height: 42 });
  assert.deepEqual(layout.bottomRow, { x: 823, y: layout.area.y + 45, width: 253, height: 42 });

  const small = getWeaponListLayout(320, 200);
  assert.equal(small.area.width, 190);
  assert.equal(small.area.x, 320 - 24 - 190);
  assert.ok(small.area.y >= 0);

  const tiny = getWeaponListLayout(100, 20);
  assert.equal(tiny.area.x, 24);
  assert.equal(tiny.area.width, 52);
  assert.equal(tiny.area.y, 0);
});

test('the active firearm is always the first row, melee collapses to one row', () => {
  const secondaryActive = getWeaponListRows(loadout('secondary'));
  assert.deepEqual(secondaryActive.map(view => view.slot), ['secondary', 'primary']);
  assert.deepEqual(secondaryActive.map(view => view.magazineAmmo), [6, 30]);

  const primaryActive = getWeaponListRows(loadout('primary'));
  assert.deepEqual(primaryActive.map(view => view.slot), ['primary', 'secondary']);

  const meleeActive = getWeaponListRows(loadout('melee', { melee: knifeView() }));
  assert.deepEqual(meleeActive.map(view => view.slot), ['melee']);
  assert.equal(meleeActive[0].kind, 'melee');
});

test('draw writes only ammo counts and right-aligned bullet silhouettes', () => {
  const { ctx, calls } = stubContext();
  new WeaponListHud().draw(ctx, loadout('secondary'), 1100, 800);

  assert.deepEqual(calls.texts.map(entry => entry.text), ['6', '30']);
  assert.equal(calls.texts[0].fillStyle, '#f2f8fa');
  assert.match(calls.texts[0].font, /18px/);
  assert.ok(calls.texts[0].x < 823 + 253);
  assert.ok(calls.texts[0].x > 823 + 190, 'count sits to the right of the silhouette');
  assert.ok(calls.fills.some(fill => fill.style === 'rgba(12,18,26,0.82)'), 'active row plate');
  assert.ok(calls.fills.some(fill => fill.style === 'rgba(12,18,26,0.46)'), 'inactive row plate');
  assert.ok(calls.fillRects.some(rect => rect.style === 'rgba(242,248,250,0.92)' && rect.width === 2),
    'active row has a left accent bar');
  assert.equal(calls.saves, calls.restores);

  const primary = stubContext();
  new WeaponListHud().draw(primary.ctx, loadout('primary'), 1100, 800);
  assert.deepEqual(primary.calls.texts.map(entry => entry.text), ['30', '6']);
});

test('switching firearms slides the bottom row up and the top row down', () => {
  const hud = new WeaponListHud();
  const { ctx, calls } = stubContext();
  hud.update(1 / 60, loadout('secondary'));
  hud.draw(ctx, loadout('secondary'), 1100, 800);
  let status = hud.getLastStatus();
  assert.equal(status.swapProgress, 1);
  assert.deepEqual(status.rows.map(row => row.slot), ['secondary', 'primary']);

  hud.update(WEAPON_LIST.swapSeconds / 2, loadout('primary'));
  hud.draw(ctx, loadout('primary'), 1100, 800);
  status = hud.getLastStatus();
  near(status.swapProgress, 0.5);
  const primary = status.rows.find(row => row.slot === 'primary');
  const secondary = status.rows.find(row => row.slot === 'secondary');
  near(primary.rect.y, 379);
  near(secondary.rect.y, 379);

  hud.update(WEAPON_LIST.swapSeconds / 2, loadout('primary'));
  hud.draw(ctx, loadout('primary'), 1100, 800);
  status = hud.getLastStatus();
  assert.equal(status.swapProgress, 1);
  near(status.rows.find(row => row.slot === 'primary').rect.y, 356.5);
  near(status.rows.find(row => row.slot === 'secondary').rect.y, 401.5);
  assert.deepEqual(calls.texts.map(entry => entry.text).slice(-2), ['30', '6']);
});

test('melee keeps a single row and never prints a count', () => {
  const hud = new WeaponListHud();
  const { ctx, calls } = stubContext();
  hud.update(1, loadout('melee', { melee: knifeView() }));
  hud.draw(ctx, loadout('melee', { melee: knifeView() }), 1100, 800);

  const status = hud.getLastStatus();
  assert.equal(status.mode, 'melee');
  assert.equal(status.rows.length, 1);
  assert.equal(status.rows[0].slot, 'melee');
  assert.equal(status.rows[0].rect.y, 356.5);
  assert.deepEqual(calls.texts, []);
  assert.equal(calls.roundRects.length, 1, 'only the row plate, no bullets');

  const fist = stubContext();
  hud.update(1, loadout('melee'));
  hud.draw(fist.ctx, loadout('melee'), 1100, 800);
  assert.ok(fist.calls.roundRects.length > 1, 'fist silhouette uses rounded shapes');
  assert.deepEqual(fist.calls.texts, []);
});

test('player exposes a per-slot loadout without changing the held slot', () => {
  const player = new Player(200.5, 200.5);
  const loadoutView = player.getWeaponLoadoutView();

  assert.equal(loadoutView.activeSlot, 'secondary');
  assert.deepEqual(loadoutView.secondary, player.getWeaponView());
  assert.equal(loadoutView.primary.slot, 'primary');
  assert.equal(loadoutView.primary.name, '冲锋枪');
  assert.equal(loadoutView.primary.magazineAmmo, 30);
  assert.equal(loadoutView.primary.chambered, true);
  assert.deepEqual(loadoutView.melee, player.getWeaponViewForSlot('melee'));
  assert.equal(loadoutView.melee.kind, 'empty');
  assert.equal(player.getActiveWeaponSlot(), 'secondary', 'reading the other slot must not equip it');

  assert.equal(player.getIsExhausted(), false);
  player.setDebugState({ stamina: 0 });
  assert.equal(player.getIsExhausted(), true);

  player.switchWeapon('primary');
  const after = player.getWeaponLoadoutView();
  assert.equal(after.activeSlot, 'primary');
  assert.deepEqual(after.primary, player.getWeaponView());
  assert.equal(after.primary.magazineAmmo, 30);
  assert.equal(after.secondary.magazineAmmo, 6);

  player.toggleMelee();
  assert.equal(player.getWeaponLoadoutView().activeSlot, 'melee');
  player.toggleMelee();
  assert.equal(player.getWeaponLoadoutView().activeSlot, 'primary', 'C returns to the last firearm');
});
