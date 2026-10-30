import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const { poseWithOffsets } = load('animation2d/pose/PoseLayers');
const { legacyPoseToLocalPose } = load('objects/animation/LegacyPoseAdapter');
const { PLAYER_RIG } = load('animation2d/rig/PlayerRig');
const { solveForwardKinematics } = load('animation2d/pose/Fk2D');
const { ROLL_REST_POSE } = load('objects/RollPose');
const {
  punchAmount,
  PLAYER_PUNCH_DURATION,
  PLAYER_PUNCH_IMPACT,
  buildPunchOffsets,
} = load('objects/animation/PlayerPunchClip');
const {
  createPlayerRenderSnapshot,
  getPlayerAnimationController,
  resetPlayerVisualState,
} = load('objects/animation/PlayerVisualAdapter');

const idle = { isKeyDown: () => false };
const SIZE = 49;
const noSpread = { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 };
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const aim = (x = 825, y = 225) => ({ target: { x, y }, fire: true, face: false });

function handOf(snapshot) {
  return snapshot.world.world.handR;
}

function makePlayer() {
  const player = new Player(200.5, 200.5);
  player.applyConfig({ shooting: noSpread });
  player.currentRotation = Math.PI; // facing = 0
  player.armLift = 0;
  player.armDistance = Number.POSITIVE_INFINITY;
  player.weaponSwapTime = 0;
  player.runSwayWeight = 0;
  player.idleTime = 0;
  resetPlayerVisualState(player);
  return player;
}

test('zero-weight layers return the base pose without touching it', () => {
  const base = legacyPoseToLocalPose(ROLL_REST_POSE);
  const offsets = buildPunchOffsets(1);
  const result = poseWithOffsets(base, offsets, 0);
  for (const id of Object.keys(base.locals)) {
    near(result.locals[id].x, base.locals[id].x);
    near(result.locals[id].y, base.locals[id].y);
    near(result.locals[id].rotation, base.locals[id].rotation);
  }
  near(base.locals.shoulderR.rotation, 0, 1e-12);
});

test('punch layer moves only the upper body and its envelope peaks once', () => {
  assert.equal(punchAmount(0), 0);
  assert.equal(punchAmount(1), 0);
  const peak = punchAmount(PLAYER_PUNCH_IMPACT);
  assert.ok(peak > 0.9, `impact weight ${peak}`);
  assert.ok(punchAmount(0.1) < peak);
  assert.ok(punchAmount(0.8) < peak);

  const base = legacyPoseToLocalPose(ROLL_REST_POSE);
  const layered = poseWithOffsets(base, buildPunchOffsets(1), 1);
  for (const id of ['pelvis', 'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR', 'handL']) {
    near(layered.locals[id].x, base.locals[id].x, 1e-12);
    near(layered.locals[id].y, base.locals[id].y, 1e-12);
  }
  const baseWorld = solveForwardKinematics(PLAYER_RIG, base);
  const punchWorld = solveForwardKinematics(PLAYER_RIG, layered);
  assert.ok(punchWorld.world.handR.x > baseWorld.world.handR.x + 0.02, 'right hand should reach forward');
  near(punchWorld.world.pelvis.x, baseWorld.world.pelvis.x);
});

test('punch is a one-shot visual action with one ordered impact event', () => {
  const player = makePlayer();
  const controller = getPlayerAnimationController(player);
  assert.equal(controller.playPunch(), true);
  assert.equal(controller.playPunch(), false, 'repeated request must not restart the action');

  let impacts = 0;
  let lastSequence = -1;
  for (let step = 0; step < 20; step++) {
    controller.update(0, false, 0.02);
    for (let i = 0; i < controller.punchEvents.count; i++) {
      const event = controller.punchEvents.eventAt(i);
      assert.equal(event.kind, 'punchImpactVisual');
      assert.ok(event.sequence > lastSequence, 'events must be ordered');
      lastSequence = event.sequence;
      impacts++;
    }
    assert.ok(controller.punchProgress >= 0 && controller.punchProgress <= 1);
  }
  assert.equal(impacts, 1, 'impact marker fires exactly once');
  assert.ok(PLAYER_PUNCH_IMPACT > 0 && PLAYER_PUNCH_IMPACT < 1);
  assert.equal(controller.punchActive, false);
  assert.ok(PLAYER_PUNCH_DURATION > 0);
});

test('punch snapshot reports progress and keeps aiming hand drift within 1px', () => {
  const player = makePlayer();
  const twin = makePlayer();
  const before = createPlayerRenderSnapshot(twin);
  const controller = getPlayerAnimationController(player);
  controller.playPunch();
  controller.update(0, false, 0.09); // 接近命中帧
  const punched = createPlayerRenderSnapshot(player);

  assert.ok(punched.punchProgress > 0);
  assert.ok(
    (punched.world.world.handR.x - before.world.world.handR.x) * SIZE > 1,
    'right hand moves forward',
  );
  const leftDrift = Math.hypot(
    punched.world.world.handL.x - before.world.world.handL.x,
    punched.world.world.handL.y - before.world.world.handL.y,
  ) * SIZE;
  assert.ok(leftDrift < 1, `support hand drift ${leftDrift}px must stay under 1px`);
});

test('hit react is additive, bounded and decays without cumulative drift', () => {
  const player = makePlayer();
  const twin = makePlayer();
  player.takeDamage(10);
  assert.equal(player.getHitReactProgress(), 1, 'fresh hit starts at full amplitude');
  assert.equal(twin.getHitReactProgress(), 0);

  player.update(0.05, idle);
  twin.update(0.05, idle);
  const damaged = createPlayerRenderSnapshot(player);
  const clean = createPlayerRenderSnapshot(twin);
  assert.ok(damaged.hitReactProgress > 0 && damaged.hitReactProgress < 1);
  const drift = Math.hypot(
    handOf(damaged).x - handOf(clean).x,
    handOf(damaged).y - handOf(clean).y,
  ) * SIZE;
  assert.ok(drift <= 1, `aim hand drift ${drift}px`);
  near(player.x, twin.x);
  near(player.y, twin.y);

  // 同一进度重复采样必须逐位一致：additive 每帧从 base 重算，不累积。
  for (let i = 0; i < 50; i++) {
    const snapshot = createPlayerRenderSnapshot(player);
    near(handOf(snapshot).x, handOf(damaged).x, 1e-12);
    near(handOf(snapshot).y, handOf(damaged).y, 1e-12);
  }

  player.update(0.3, idle);
  twin.update(0.3, idle);
  assert.equal(player.getHitReactProgress(), 0);
  const settled = createPlayerRenderSnapshot(player);
  const control = createPlayerRenderSnapshot(twin);
  for (const id of ['handR', 'handL', 'head', 'pelvis']) {
    near(settled.world.world[id].x, control.world.world[id].x, 1e-12);
    near(settled.world.world[id].y, control.world.world[id].y, 1e-12);
  }
});

test('punch never changes the muzzle or the bullet path', () => {
  const plain = makePlayer();
  const punching = makePlayer();
  const controller = getPlayerAnimationController(punching);
  controller.playPunch();
  controller.update(0, false, 0.05);

  plain.update(0, idle, undefined, aim());
  punching.update(0, idle, undefined, aim());
  near(plain.getMuzzlePosition().x, punching.getMuzzlePosition().x, 1e-12);
  near(plain.getMuzzlePosition().y, punching.getMuzzlePosition().y, 1e-12);
  const a = plain.getBullets()[0];
  const b = punching.getBullets()[0];
  for (let i = 0; i < 10; i++) {
    a.update(0.01);
    b.update(0.01);
    near(a.getPosition().x, b.getPosition().x, 1e-9);
    near(a.getPosition().y, b.getPosition().y, 1e-9);
  }
});
