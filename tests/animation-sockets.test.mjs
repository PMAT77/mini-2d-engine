import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const {
  createPlayerRenderSnapshot,
  getPlayerMuzzleWorld,
  resetPlayerVisualState,
} = load('objects/animation/PlayerVisualAdapter');
const { buildPlayerPartCommands } = load('animation2d/render/PlayerRenderParts');

const idle = { isKeyDown: () => false };
const SIZE = 49;
const noSpread = { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 };
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const aim = (x, y) => ({ target: { x, y }, fire: false, face: true });

function makePlayer(rotation = Math.PI) {
  const player = new Player(200.5, 200.5);
  player.applyConfig({ shooting: noSpread });
  player.currentRotation = rotation;
  player.armLift = 0;
  player.armDistance = Number.POSITIVE_INFINITY;
  player.weaponSwapTime = 0;
  player.runSwayWeight = 0;
  player.idleTime = 0;
  resetPlayerVisualState(player);
  return player;
}

function holdAim(player, x, y) {
  for (let i = 0; i < 12; i++) player.update(1 / 60, idle, undefined, aim(x, y));
}

/** 旧枪口火焰点：getMuzzlePosition + 朝向系里的 (0.34s, 0.015s)。 */
function legacyFlamePoint(player) {
  const muzzle = player.getMuzzlePosition();
  const facing = player.getVisualFacing();
  const s = SIZE * .34;
  const y = SIZE * .015;
  const c = Math.cos(facing);
  const sn = Math.sin(facing);
  return { x: muzzle.x + s * c - y * sn, y: muzzle.y + s * sn + y * c };
}

test('visualMuzzle socket tracks the legacy fire point within 1e-6 px', () => {
  const forward = makePlayer(Math.PI);
  holdAim(forward, forward.x + SIZE / 2 + 300, forward.y + SIZE / 2);
  const socket = getPlayerMuzzleWorld(forward);
  const legacy = legacyFlamePoint(forward);
  near(socket.x, legacy.x, 1e-6);
  near(socket.y, legacy.y, 1e-6);
  near(socket.facing, forward.getVisualFacing(), 1e-9);

  const turned = makePlayer(Math.PI / 2);
  holdAim(turned, turned.x + SIZE / 2, turned.y + SIZE / 2 + 300);
  const turnedSocket = getPlayerMuzzleWorld(turned);
  const turnedLegacy = legacyFlamePoint(turned);
  near(turnedSocket.x, turnedLegacy.x, 1e-6);
  near(turnedSocket.y, turnedLegacy.y, 1e-6);
  assert.ok(Math.hypot(turnedSocket.x - turnedLegacy.x, turnedSocket.y - turnedLegacy.y) <= 1);
});

test('mainGrip socket carries the legacy grip offset', () => {
  const player = makePlayer();
  holdAim(player, player.x + SIZE / 2 + 300, player.y + SIZE / 2);
  const snapshot = createPlayerRenderSnapshot(player);
  const hand = snapshot.world.world.handR;
  near(snapshot.sockets.mainGrip.x, hand.x - .02, 1e-12);
  near(snapshot.sockets.mainGrip.y, hand.y + .015, 1e-12);

  const commands = buildPlayerPartCommands(snapshot);
  const held = commands.find(command => command.op === 'drawHeldWeapon');
  assert.ok(held, 'held weapon command exists');
  near(held.hand.x, snapshot.sockets.mainGrip.x * SIZE, 1e-9);
  near(held.hand.y, snapshot.sockets.mainGrip.y * SIZE, 1e-9);
});

test('reload gesture is bounded, visual-only and returns to the base pose', () => {
  const twin = makePlayer();
  const player = makePlayer();
  player.magazineAmmo = Math.max(0, player.magazineSize - 1);
  twin.magazineAmmo = player.magazineAmmo;
  player.requestReload();
  assert.equal(player.getWeaponView().isReloading, true);

  player.update(0.2, idle);
  twin.update(0.2, idle);
  const during = createPlayerRenderSnapshot(player);
  const clean = createPlayerRenderSnapshot(twin);
  assert.ok(during.reloadProgress > 0 && during.reloadProgress < 1);
  assert.ok(during.locals.locals.shoulderR.rotation > clean.locals.locals.shoulderR.rotation + 1e-6);
  assert.ok(during.locals.locals.elbowR.rotation > clean.locals.locals.elbowR.rotation + 1e-6);
  // 玩法标记不变：换弹不移动枪口，也不改变发射点。
  near(player.getMuzzlePosition().x, twin.getMuzzlePosition().x, 1e-12);
  near(player.getMuzzlePosition().y, twin.getMuzzlePosition().y, 1e-12);

  for (let i = 0; i < 40; i++) player.update(0.05, idle);
  for (let i = 0; i < 40; i++) twin.update(0.05, idle);
  assert.equal(player.getWeaponView().isReloading, false);
  const after = createPlayerRenderSnapshot(player);
  const settled = createPlayerRenderSnapshot(twin);
  assert.equal(after.reloadProgress, 0);
  near(after.locals.locals.shoulderR.rotation, settled.locals.locals.shoulderR.rotation, 1e-12);
  near(after.locals.locals.handR.rotation, settled.locals.locals.handR.rotation, 1e-12);
});

test('muzzle socket stays inside one pixel of the spawn point while aiming still', () => {
  const player = makePlayer(Math.PI * 0.75);
  holdAim(player, player.x + 400, player.y + 260);
  const socket = getPlayerMuzzleWorld(player);
  const legacy = legacyFlamePoint(player);
  assert.ok(Math.hypot(socket.x - legacy.x, socket.y - legacy.y) <= 1);
});
