import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');

const idleInput = { isKeyDown: () => false };
const step = (player, seconds) => player.update(seconds, idleInput);

test('the pistol is equipped by default and Q/E cycles the two firearms', () => {
  const player = new Player(200.5, 200.5);
  assert.equal(player.getActiveWeaponSlot(), 'secondary');
  assert.equal(player.getWeaponView().name, '格洛克手枪');
  assert.equal(player.isArmed(), true);

  player.cycleFirearm(1);
  assert.equal(player.getActiveWeaponSlot(), 'primary');
  assert.equal(player.getWeaponView().name, '冲锋枪');
  assert.equal(player.getWeaponView().magazineAmmo, 30);
  assert.equal(player.getActiveWeaponSound(), '/audio/weapons/Fire/05_Pistol_Type5_Fire.wav');
  assert.equal(player.getActiveWeaponReloadSound(), '/audio/weapons/Reload/Type_5/Pistol_Reload_Type_5_Full.wav');
  assert.equal(player.getLastFirearmSlot(), 'primary');

  player.cycleFirearm(-1);
  assert.equal(player.getActiveWeaponSlot(), 'secondary');
  assert.equal(player.getActiveWeaponSound(), '/audio/weapons/Fire/01_Pistol_Type1_Fire.wav');
  assert.equal(player.getActiveWeaponReloadSound(), '/audio/weapons/Reload/Type_1/Pistol_Reload_Type_1_Full.wav');
});

test('switching keeps each firearm ammo independent and does not reset the cooldown', () => {
  const player = new Player(200.5, 200.5);
  player.shoot(new Vector2(1, 0));
  assert.equal(player.getWeaponView().magazineAmmo, 5);

  player.cycleFirearm(1);
  assert.equal(player.getWeaponView().magazineAmmo, 30);
  // 全局冷却还在走，切枪不能跳过射速限制。
  player.shoot(new Vector2(1, 0));
  assert.equal(player.getWeaponView().magazineAmmo, 30);

  step(player, 0.3);
  player.shoot(new Vector2(1, 0));
  assert.equal(player.getWeaponView().magazineAmmo, 29);

  player.cycleFirearm(-1);
  assert.equal(player.getWeaponView().magazineAmmo, 5);
  assert.equal(player.getWeaponView().name, '格洛克手枪');
});

test('C holsters the gun; empty hands cannot shoot or reload', () => {
  const player = new Player(200.5, 200.5);
  player.toggleMelee();
  assert.equal(player.getActiveWeaponSlot(), 'melee');
  assert.equal(player.getWeaponView().kind, 'empty');
  assert.equal(player.isArmed(), false);
  assert.equal(player.getActiveWeaponSound(), '');

  player.shoot(new Vector2(1, 0));
  player.requestReload();
  step(player, 1.5);
  assert.equal(player.getBullets().length, 0);
  assert.equal(player.getWeaponView().isReloading, false);

  // 再按一次 C 回到最近用过的枪。
  player.toggleMelee();
  assert.equal(player.getActiveWeaponSlot(), 'secondary');
  assert.equal(player.isArmed(), true);

  // 空手时 Q/E 也能直接拔枪。
  player.toggleMelee();
  player.cycleFirearm(1);
  assert.equal(player.getActiveWeaponSlot(), 'secondary');
});

test('a reload is frozen on its own gun while another slot is active', () => {
  const player = new Player(200.5, 200.5);
  player.shoot(new Vector2(1, 0));
  player.requestReload();
  step(player, 0.35);
  const progress = player.getWeaponView().reloadProgress;
  assert.ok(progress > 0.2 && progress < 0.3, `progress ${progress}`);

  player.cycleFirearm(1);
  step(player, 1);
  player.cycleFirearm(-1);
  const resumed = player.getWeaponView().reloadProgress;
  // 切走的这一秒不推进，所以进度基本没变。
  assert.ok(Math.abs(resumed - progress) < 1e-9, `${resumed} != ${progress}`);

  step(player, 1.2);
  assert.equal(player.getWeaponView().isReloading, false);
  assert.equal(player.getWeaponView().magazineAmmo, 6);
});

test('primaryShooting configures the SMG and appears in the snapshot', () => {
  const player = new Player(200.5, 200.5);
  player.applyConfig({ primaryShooting: { damage: 25, fireRate: 0.05, magazineSize: 20, reloadDuration: 2.5 } });
  player.cycleFirearm(1);
  const view = player.getWeaponView();
  assert.equal(view.magazineSize, 20);
  assert.equal(view.magazineAmmo, 20);
  assert.equal(player.getConfigSnapshot().primaryShooting.magazineSize, 20);
  assert.equal(player.getConfigSnapshot().primaryShooting.damage, 25);
  assert.equal(player.getConfigSnapshot().shooting.magazineSize, 6);
});

/** 定位 WAV 的 data 块；峰值与时长的断言共用同一套格式解析。 */
const wavData = file => {
  const buffer = readFileSync(file);
  const channels = buffer.readUInt16LE(22);
  const rate = buffer.readUInt32LE(24);
  let offset = 12;
  while (offset + 8 <= buffer.length && buffer.toString('ascii', offset, offset + 4) !== 'data') {
    offset += 8 + buffer.readUInt32LE(offset + 4);
  }
  const dataStart = offset + 8;
  return { buffer, channels, rate, dataStart, seconds: buffer.readUInt32LE(offset + 4) / (rate * channels * 2) };
};

/** 读出 WAV 的 data 块，返回 [from, to) 秒内所有声道的最大绝对振幅。 */
const wavPeak = (file, from, to) => {
  const { buffer, channels, rate, dataStart, seconds } = wavData(file);
  const frames = Math.floor(seconds * rate);
  const start = Math.max(0, Math.floor(from * rate));
  const end = Math.min(frames, Math.ceil(to * rate));
  let peak = 0;
  for (let frame = start; frame < end; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(dataStart + (frame * channels + channel) * 2)));
    }
  }
  return peak;
};

test('each gun sound starts on the shot instead of the silent pre-roll', () => {
  const player = new Player(200.5, 200.5);
  for (const slot of ['secondary', 'primary']) {
    if (player.getActiveWeaponSlot() !== slot) player.cycleFirearm(1);
    const start = player.getActiveWeaponSoundStartAt();
    const file = join(process.cwd(), 'public', player.getActiveWeaponSound().replace(/^\//, ''));
    assert.ok(start > 0, `${slot} 应该跳过静音预卷`);
    assert.ok(wavPeak(file, 0, start - 0.005) < 200, `${slot} 预卷应该是静音`);
    assert.ok(wavPeak(file, start + 0.005, start + 0.015) > 10000, `${slot} 起播点应该落在枪响上`);
  }
});

test('each gun has its own full reload take, paced to outlast the reload', () => {
  const player = new Player(200.5, 200.5);
  for (const slot of ['secondary', 'primary']) {
    if (player.getActiveWeaponSlot() !== slot) {
      player.cycleFirearm(1);
      step(player, 0.3);
    }
    assert.match(player.getActiveWeaponReloadSound(), /^\/audio\/weapons\/Reload\/Type_\d\/Pistol_Reload_Type_\d_Full\.wav$/);
    player.shoot(new Vector2(1, 0));
    player.requestReload();
    assert.ok(player.getWeaponView().isReloading, `${slot} 应该开始换弹`);
    let elapsed = 0;
    while (player.getWeaponView().isReloading && elapsed < 5) {
      step(player, 0.01);
      elapsed += 0.01;
    }
    assert.ok(!player.getWeaponView().isReloading, `${slot} 换弹应该在 5 秒内结束`);
    const file = join(process.cwd(), 'public', player.getActiveWeaponReloadSound().replace(/^\//, ''));
    const heard = wavData(file).seconds / player.getActiveWeaponReloadRate();
    assert.ok(heard >= elapsed, `${slot} 的换弹声只有 ${heard.toFixed(2)}s，撑不满 ${elapsed.toFixed(2)}s 的换弹`);
  }
});

test('an invalid primaryShooting config is rejected atomically', () => {
  const player = new Player(200.5, 200.5);
  const before = player.getConfigSnapshot();
  assert.throws(() => player.applyConfig({ primaryShooting: { magazineSize: 12, bogus: 1 } }));
  assert.deepEqual(player.getConfigSnapshot(), before);

  assert.throws(() => player.applyConfig({ primaryShooting: { magazineSize: 0 } }));
  assert.throws(() => player.applyConfig({ primaryShooting: { magazineSize: 2.5 } }));
});

