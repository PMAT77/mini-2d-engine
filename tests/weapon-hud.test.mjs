import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const {
  WeaponHud, WEAPON_HUD, getWeaponHudLayout, getWeaponHudStatus,
} = load('ui/WeaponHud');
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');

const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b} (±${epsilon})`);

/** 记录调用的 2D 上下文替身：只实现 HUD 真正用到的 API。 */
function stubContext() {
  const calls = { texts: [], fills: [], fillRects: [], roundRects: [], saves: 0, restores: 0 };
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
    clip() {},
    translate() {},
    rotate() {},
    scale() {},
    roundRect(x, y, width, height, radius) { calls.roundRects.push({ x, y, width, height, radius }); },
    fill() { calls.fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    stroke() {},
    fillRect(x, y, width, height) { calls.fillRects.push({ x, y, width, height, style: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    fillText(text, x, y, maxWidth) {
      calls.texts.push({ text, x, y, maxWidth, font: ctx.font, fillStyle: ctx.fillStyle, align: ctx.textAlign, alpha: ctx.globalAlpha });
    },
  };
  return { ctx, calls };
}

const pistolView = (patch = {}) => ({
  slot: 'secondary', name: '格洛克手枪', kind: 'firearm', magazineAmmo: 6, magazineSize: 6,
  chambered: true, reserveAmmo: null, isReloading: false, reloadProgress: 0, reloadMode: null,
  ...patch,
});

const smgView = (patch = {}) => ({
  slot: 'primary', name: '冲锋枪', kind: 'firearm', magazineAmmo: 30, magazineSize: 30,
  chambered: true, reserveAmmo: null, isReloading: false, reloadProgress: 0, reloadMode: null,
  ...patch,
});

test('HUD card anchors to the bottom-right corner with a 24px margin', () => {
  const layout = getWeaponHudLayout(1100, 800);
  assert.deepEqual(layout.card, { x: 1100 - 336 - 24, y: 800 - 132 - 24, width: 336, height: 132 });
  assert.deepEqual(layout.icon, { x: 760, y: 682, width: 60, height: 60 });
  assert.deepEqual(layout.pill, { x: 836, y: 682, width: 34, height: 22 });
  assert.equal(layout.name.x, 878);
  assert.equal(layout.name.baseline, 698);
  assert.equal(layout.name.maxWidth, 120);
  assert.equal(layout.tag.right, 1054);
  assert.equal(layout.hint.x, 878);
  assert.equal(layout.hint.baseline, 720);
  assert.equal(layout.ammo.x, 836);
  assert.equal(layout.ammo.baseline, 760);
  assert.equal(layout.ammo.maxWidth, 96);
  near(layout.mags.slotWidth, (96 - 5 * 4) / 6);
  assert.equal(layout.mags.right, 1032);
  assert.equal(layout.mags.y, 732);
  assert.equal(layout.mags.height, 28);
  assert.deepEqual(layout.chamber, { x: 1042, y: 732, width: 12, height: 28 });
  assert.equal(layout.bar, null);
});

test('a cramped viewport falls back to an 8px margin and clamps into the canvas', () => {
  const small = getWeaponHudLayout(400, 110);
  assert.equal(small.card.x, 400 - 8 - 336);
  assert.equal(small.card.y, 0, 'card is taller than the viewport, so it clamps to the top edge');
  assert.equal(small.card.x + small.card.width, 392);

  const tiny = getWeaponHudLayout(120, 60);
  assert.equal(tiny.card.x, 0);
  assert.equal(tiny.card.y, 0);
});

test('the compact unarmed card is shorter and keeps the icon centered', () => {
  const layout = getWeaponHudLayout(1100, 800, true);
  assert.equal(layout.card.height, 92);
  assert.equal(layout.card.y, 800 - 92 - 24);
  assert.equal(layout.icon.y, layout.card.y + 20);
  assert.equal(layout.icon.width, 54);
  assert.equal(layout.name.baseline, layout.card.y + 48);
  assert.equal(layout.hint.baseline, layout.card.y + 70);
});

test('large magazines degrade to a continuous capacity bar', () => {
  const layout = getWeaponHudLayout(1100, 800, false, 30);
  assert.deepEqual(layout.bar, { x: 936, y: 732, width: 96, height: 28 });

  const status = getWeaponHudStatus(smgView());
  assert.equal(status.ammoText, '30/30');
  // 30 发不再逐槽排布，只保留一个膛内槽。
  assert.deepEqual(status.slots.map(slot => slot.kind), ['chamber']);

  const half = getWeaponHudStatus(smgView({ magazineAmmo: 15, chambered: true }));
  assert.equal(half.phase, 'normal');
  assert.equal(half.ammoText, '15/30');
});

test('6+1 pistol reports ready rounds, capacity text and infinite reserve', () => {
  const status = getWeaponHudStatus(pistolView());
  assert.equal(status.phase, 'normal');
  assert.equal(status.roundsReady, 7);
  assert.equal(status.magazineSize, 6);
  assert.equal(status.ammoText, '6/6');
  assert.equal(status.tagText, '备弹 ∞');
  assert.equal(status.pillText, '副');
  assert.equal(status.hintText, 'Q/E 切换 · C 收枪');
  assert.equal(status.showAmmo, true);
  assert.deepEqual(status.slots.map(slot => slot.kind), ['mag', 'mag', 'mag', 'mag', 'mag', 'mag', 'chamber']);
  assert.deepEqual(status.slots.map(slot => slot.fill), [1, 1, 1, 1, 1, 1, 1]);
});

test('low ammo and empty states switch the HUD into warning modes', () => {
  // 6+1 的阈值是 ceil(7 * 0.25) = 2。
  const low = getWeaponHudStatus(pistolView({ magazineAmmo: 1, chambered: true }));
  assert.equal(low.phase, 'low');
  assert.equal(low.roundsReady, 2);

  const normal = getWeaponHudStatus(pistolView({ magazineAmmo: 2, chambered: true }));
  assert.equal(normal.phase, 'normal');

  const empty = getWeaponHudStatus(pistolView({ magazineAmmo: 0, chambered: false }));
  assert.equal(empty.phase, 'empty');
  assert.equal(empty.roundsReady, 0);
  assert.equal(empty.ammoText, '0/6');
  assert.equal(empty.tagText, 'R 换弹');
  assert.deepEqual(empty.slots.map(slot => slot.fill), [0, 0, 0, 0, 0, 0, 0]);
});

test('reloading fills slots left-to-right including the chamber', () => {
  const status = getWeaponHudStatus(pistolView({
    magazineAmmo: 3, chambered: false, isReloading: true, reloadProgress: 0.5, reloadMode: 'reload',
  }));
  assert.equal(status.phase, 'reloading');
  assert.equal(status.tagText, '换弹中');
  // progress * (6 + 1) = 3.5：前三格满、第四格半格、后两格与膛内仍是空。
  const fills = status.slots.map(slot => slot.fill);
  near(fills[0], 1); near(fills[1], 1); near(fills[2], 1); near(fills[3], 0.5);
  near(fills[4], 0); near(fills[5], 0); near(fills[6], 0);

  const finished = getWeaponHudStatus(pistolView({
    magazineAmmo: 0, chambered: false, isReloading: true, reloadProgress: 1, reloadMode: 'reload',
  }));
  assert.deepEqual(finished.slots.map(slot => slot.fill), [1, 1, 1, 1, 1, 1, 1]);
});

test('melee and unarmed cards hide the ammo readout', () => {
  const melee = getWeaponHudStatus(pistolView({ slot: 'melee', kind: 'melee', name: '小刀' }));
  assert.equal(melee.phase, 'melee');
  assert.equal(melee.showAmmo, false);
  assert.equal(melee.tagText, '近战');
  assert.equal(melee.pillText, '近战');
  assert.equal(melee.hintText, 'Q/E 切换 · C 收刀');
  assert.deepEqual(melee.slots, []);

  const unarmed = getWeaponHudStatus(pistolView({
    slot: 'melee', kind: 'empty', name: '空手', magazineAmmo: 0, magazineSize: 0, chambered: false,
  }));
  assert.equal(unarmed.phase, 'unarmed');
  assert.equal(unarmed.tagText, '空手');
  assert.equal(unarmed.pillText, '空手');
  assert.equal(unarmed.hintText, 'Q/E 拔枪');
  assert.deepEqual(unarmed.slots, []);

  const finite = getWeaponHudStatus(pistolView({ reserveAmmo: 12 }));
  assert.equal(finite.tagText, '备弹 12');
});

test('draw writes pill, name, tag, hint and ammo with the enlarged sizes', () => {
  const { ctx, calls } = stubContext();
  new WeaponHud().draw(ctx, pistolView(), 1100, 800);

  const texts = calls.texts.map(entry => entry.text);
  assert.deepEqual(texts, ['副', '格洛克手枪', '备弹 ∞', 'Q/E 切换 · C 收枪', '6/6']);
  const ammo = calls.texts[4];
  assert.equal(ammo.maxWidth, 96);
  assert.match(ammo.font, /30px/);
  assert.equal(ammo.fillStyle, '#e8f4f8');
  assert.equal(calls.saves, calls.restores);
});

test('draw paints reload progress amber and suppresses ammo for melee', () => {
  const { ctx, calls } = stubContext();
  new WeaponHud().draw(ctx, pistolView({
    magazineAmmo: 0, chambered: false, isReloading: true, reloadProgress: 0.5, reloadMode: 'reload',
  }), 1100, 800);
  assert.ok(calls.fillRects.some(rect => rect.style === '#ffce6b'), 'reload fill should be amber');

  const melee = stubContext();
  new WeaponHud().draw(melee.ctx, pistolView({ slot: 'melee', kind: 'melee', name: '小刀' }), 1100, 800);
  assert.deepEqual(melee.calls.texts.map(entry => entry.text),
    ['小刀', '近战', 'Q/E 切换 · C 收刀']);
  assert.equal(melee.calls.roundRects[0].height, 92 - 1);
});

test('draw uses the SMG icon and a continuous bar for the primary weapon', () => {
  const { ctx, calls } = stubContext();
  new WeaponHud().draw(ctx, smgView(), 1100, 800);
  const texts = calls.texts.map(entry => entry.text);
  assert.deepEqual(texts, ['主', '冲锋枪', '备弹 ∞', 'Q/E 切换 · C 收枪', '30/30']);
  assert.ok(calls.roundRects.some(rect => rect.width === 96 && rect.height === 28), 'expected a capacity bar');
});

test('a fired round flashes its slot once, then the flash expires', () => {
  const hud = new WeaponHud();
  const { ctx, calls } = stubContext();
  hud.update(1 / 60, pistolView());
  hud.update(1 / 60, pistolView({ magazineAmmo: 5 }));
  hud.draw(ctx, pistolView({ magazineAmmo: 5 }), 1100, 800);
  assert.ok(calls.fills.some(fill => /^rgba\(255,255,255,0\.5/.test(fill.style)), 'expected a white shot flash');

  hud.update(0.2, pistolView({ magazineAmmo: 5 }));
  const later = stubContext();
  hud.draw(later.ctx, pistolView({ magazineAmmo: 5 }), 1100, 800);
  assert.ok(!later.calls.fills.some(fill => /^rgba\(255,255,255,0\.5/.test(fill.style)));
});

test('switching slots does not flash as if a round was fired', () => {
  const hud = new WeaponHud();
  hud.update(1 / 60, pistolView());
  hud.update(1 / 60, smgView());
  const { ctx, calls } = stubContext();
  hud.draw(ctx, smgView(), 1100, 800);
  assert.ok(!calls.fills.some(fill => /^rgba\(255,255,255,0\.5/.test(fill.style)));
});

test('Player.getWeaponView mirrors the active weapon and live reload state', () => {
  const player = new Player(200.5, 200.5);
  const initial = player.getWeaponView();
  assert.deepEqual(initial, {
    slot: 'secondary', name: '格洛克手枪', kind: 'firearm', magazineAmmo: 6, magazineSize: 6,
    chambered: true, reserveAmmo: null, isReloading: false, reloadProgress: 0, reloadMode: null,
  });
  assert.equal(player.getWeaponKind(), 'firearm');

  player.shoot(new Vector2(1, 0));
  const afterShot = player.getWeaponView();
  assert.equal(afterShot.chambered, true); // 弹匣里的下一发已经上膛
  assert.equal(afterShot.magazineAmmo, 5);
  assert.equal(getWeaponHudStatus(afterShot).ammoText, '5/6');

  player.setDebugState({ magazineAmmo: 0, chambered: false, reloadProgress: 50 });
  const reloading = player.getWeaponView();
  assert.equal(reloading.isReloading, true);
  assert.equal(reloading.reloadProgress, 0.5);
  assert.equal(getWeaponHudStatus(reloading).phase, 'reloading');
  assert.equal(WEAPON_HUD.maxDiscreteSlots, 12);
});

test('loading keeps partial rounds and seats one round at a time', () => {
  const halfway = getWeaponHudStatus(pistolView({
    magazineAmmo: 3, chambered: true, isReloading: true, reloadProgress: 0.5, reloadMode: 'load',
  }));
  assert.equal(halfway.phase, 'reloading');
  assert.equal(halfway.reloadMode, 'load');
  assert.equal(halfway.tagText, '装填中');
  assert.equal(halfway.ammoText, '3/6');
  const fills = halfway.slots.map(slot => slot.fill);
  // 先保留原有 3 发，再按进度补入 1 整发和半格。
  near(fills[0], 1); near(fills[1], 1); near(fills[2], 1); near(fills[3], 1);
  near(fills[4], 0.5); near(fills[5], 0);
  assert.equal(fills[6], 1, '装填不会退出膛内那发');

  const done = getWeaponHudStatus(pistolView({
    magazineAmmo: 6, chambered: true, isReloading: true, reloadProgress: 1, reloadMode: 'load',
  }));
  assert.deepEqual(done.slots.map(slot => slot.fill), [1, 1, 1, 1, 1, 1, 1]);
});
