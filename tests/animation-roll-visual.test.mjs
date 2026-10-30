import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const { ROLL_REST_POSE, getRollPose, rollFacingWeight } = load('objects/RollPose');
const { solveTwoBoneIk } = load('animation2d/pose/TwoBoneIk2D');
const { solveForwardKinematics } = load('animation2d/pose/Fk2D');
const { PLAYER_RIG } = load('animation2d/rig/PlayerRig');
const {
  rollAltitudePx,
  rollComOffsetX,
  rollDepthTucked,
} = load('objects/animation/RollGrounding');
const {
  HAND_CONTACT_WINDOW,
  FOOT_CONTACT_WINDOW,
  inContactWindow,
  boneWorldPoint,
} = load('objects/animation/RollContactTracker');
const { createPlayerRenderSnapshot, resetPlayerVisualState } = load('objects/animation/PlayerVisualAdapter');
const { legacyPoseToLocalPose } = load('objects/animation/LegacyPoseAdapter');
const { drawCharacterShadow } = load('animation2d/render/CharacterCanvasRenderer');

const DURATION = .42;
const SIZE = 49;

function makeRollingPlayer(progress) {
  const player = new Player(200, 200);
  player.currentRotation = Math.PI; // facing = 0
  player.armLift = 0;
  player.armDistance = Number.POSITIVE_INFINITY;
  player.weaponSwapTime = 0;
  player.runSwayWeight = 0;
  player.idleTime = 0;
  player.rollDirection.set(1, 0);
  player.rollTimeLeft = DURATION * (1 - progress);
  resetPlayerVisualState(player);
  return player;
}

function handWorld(player, snapshot) {
  return boneWorldPoint(
    snapshot.world,
    'handR',
    player.x + SIZE / 2,
    player.y + SIZE / 2,
    snapshot.facing,
    SIZE,
  );
}

test('altitude lifts and lands at the roll endpoints and peaks mid-roll', () => {
  assert.equal(rollAltitudePx(0, SIZE), 0);
  assert.equal(rollAltitudePx(1, SIZE), 0);
  const peak = rollAltitudePx(.45, SIZE);
  assert.ok(Math.abs(peak - .3 * SIZE) < 1e-9, `peak altitude ${peak}`);
  assert.ok(rollAltitudePx(.3, SIZE) > 0 && rollAltitudePx(.3, SIZE) < peak);
  assert.ok(rollAltitudePx(.8, SIZE) < peak);
});

test('centre of mass offset is bounded and returns to zero at both ends', () => {
  let max = 0;
  for (let i = 0; i <= 100; i++) {
    const offset = rollComOffsetX(i / 100);
    assert.ok(Math.abs(offset) <= .100001, `offset ${offset} exceeds clamp`);
    max = Math.max(max, Math.abs(offset));
    if (i === 0 || i === 100) assert.equal(offset, 0);
  }
  assert.ok(max > .05, 'roll should visibly lean forward');
});

test('depth tuck only engages in the middle of the roll', () => {
  assert.equal(rollDepthTucked(0), false);
  assert.equal(rollDepthTucked(.34), true);
  assert.equal(rollDepthTucked(.5), true);
  assert.equal(rollDepthTucked(.62), false);
  assert.equal(rollDepthTucked(1), false);
});

test('two-bone IK reaches a local target and keeps both segment lengths', () => {
  const locals = legacyPoseToLocalPose(getRollPose(.3));
  const world = solveForwardKinematics(PLAYER_RIG, locals);
  const chain = ['shoulderR', 'elbowR', 'handR'];
  const [root, mid, end] = chain.map(id => world.world[id]);
  const l1 = Math.hypot(mid.x - root.x, mid.y - root.y);
  const l2 = Math.hypot(end.x - mid.x, end.y - mid.y);
  const crooked = Math.sign((mid.x - root.x) * (end.y - root.y) - (mid.y - root.y) * (end.x - root.x));

  const target = { x: root.x + (end.x - root.x) * .4, y: root.y + (end.y - root.y) * .4 };
  assert.equal(solveTwoBoneIk(locals, world, 'shoulderR', 'elbowR', 'handR', target), true);

  const solved = solveForwardKinematics(PLAYER_RIG, locals);
  const sRoot = solved.world.shoulderR;
  const sMid = solved.world.elbowR;
  const sEnd = solved.world.handR;
  assert.ok(Math.abs(Math.hypot(sMid.x - sRoot.x, sMid.y - sRoot.y) - l1) < 1e-9, 'upper segment');
  assert.ok(Math.abs(Math.hypot(sEnd.x - sMid.x, sEnd.y - sMid.y) - l2) < 1e-9, 'lower segment');
  assert.ok(Math.hypot(sEnd.x - target.x, sEnd.y - target.y) < 1e-9, 'end effector');
  const solvedCrooked = Math.sign((sMid.x - sRoot.x) * (sEnd.y - sRoot.y) - (sMid.y - sRoot.y) * (sEnd.x - sRoot.x));
  assert.equal(solvedCrooked, crooked || 1, 'elbow should keep its existing bend side');
});

test('two-bone IK refuses unreachable targets without touching the pose', () => {
  const locals = legacyPoseToLocalPose(getRollPose(.3));
  const world = solveForwardKinematics(PLAYER_RIG, locals);
  const before = JSON.stringify(locals.locals);
  const reach = Math.hypot(world.world.elbowR.x - world.world.shoulderR.x, world.world.elbowR.y - world.world.shoulderR.y)
    + Math.hypot(world.world.handR.x - world.world.elbowR.x, world.world.handR.y - world.world.elbowR.y);
  const far = { x: world.world.shoulderR.x + reach * 2, y: world.world.shoulderR.y };
  assert.equal(solveTwoBoneIk(locals, world, 'shoulderR', 'elbowR', 'handR', far), false);
  assert.equal(JSON.stringify(locals.locals), before);
});

test('contact anchoring pins the support hand in world space while the body moves', () => {
  const player = makeRollingPlayer(.4);
  const first = createPlayerRenderSnapshot(player);
  assert.ok(rollFacingWeight(.4) > 0);
  const anchored = handWorld(player, first);

  player.x += 4;
  const second = createPlayerRenderSnapshot(player);
  const moved = handWorld(player, second);
  const drift = Math.hypot(moved.x - anchored.x, moved.y - anchored.y);
  assert.ok(drift <= 2, `hand drifted ${drift.toFixed(3)} px`);
});

test('contact anchoring is released after the hand window and outside the roll', () => {
  const player = makeRollingPlayer(.4);
  createPlayerRenderSnapshot(player);
  player.x += 4;

  // p=.6 已离开撑手窗口，手不再被钉住，应随身体一起移动约 4 px。
  player.rollTimeLeft = DURATION * (1 - .6);
  const snapshot = createPlayerRenderSnapshot(player);
  const before = handWorld(player, snapshot);
  player.x += 4;
  const after = handWorld(player, createPlayerRenderSnapshot(player));
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 3.5, 'hand should follow the body again');

  player.rollTimeLeft = 0;
  createPlayerRenderSnapshot(player);
  player.x += 4;
  const idle = createPlayerRenderSnapshot(player);
  assert.equal(idle.rolling, false);
  assert.ok(Number.isFinite(idle.world.world.handR.x));
});

test('shadow is only drawn while airborne and sits outside the character buffer', () => {
  const calls = [];
  const ctx = {
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    translate() { calls.push('translate'); },
    beginPath() { calls.push('beginPath'); },
    ellipse() { calls.push('ellipse'); },
    fill() { calls.push('fill'); },
    fillStyle: '',
    globalAlpha: 1,
  };
  drawCharacterShadow(ctx, 100, 100, SIZE, 0);
  assert.equal(calls.length, 0, 'grounded frames must not add a shadow');
  drawCharacterShadow(ctx, 100, 100, SIZE, rollAltitudePx(.3, SIZE));
  assert.deepEqual(calls, ['save', 'translate', 'beginPath', 'ellipse', 'fill', 'restore']);
  assert.ok(ctx.globalAlpha >= 0 && ctx.globalAlpha <= 1);
});

test('contact windows cover the support phases without overlapping in time', () => {
  assert.equal(inContactWindow(HAND_CONTACT_WINDOW, .30), true);
  assert.equal(inContactWindow(HAND_CONTACT_WINDOW, .54), false);
  assert.equal(inContactWindow(FOOT_CONTACT_WINDOW, .54), true);
  assert.equal(inContactWindow(FOOT_CONTACT_WINDOW, .76), false);
  assert.ok(HAND_CONTACT_WINDOW.end <= FOOT_CONTACT_WINDOW.start, 'hand then foot support');
  assert.ok(ROLL_REST_POSE.headR > 0);
  assert.ok(Number.isFinite(getRollPose(.5).headAlpha));
});

test('wall contact collapses the visual altitude without touching gameplay', () => {
  const free = new Player(200, 200);
  assert.equal(free.requestRoll({ isKeyDown: key => key === 'd' }), true);
  free.update(1 / 60, { isKeyDown: () => false });
  assert.ok(free.getRollGroundingScale() > 0.99, 'free roll keeps full grounding');

  const pinned = makeRollingPlayer(.5);
  const baseAltitude = rollAltitudePx(.5, SIZE);
  assert.ok(baseAltitude > 0);
  pinned.rollGroundingScale = 0; // 撞墙后 Player.updateMovement 会把该值压到 0
  const snapshot = createPlayerRenderSnapshot(pinned);
  assert.equal(snapshot.altitudePx, 0, 'blocked roll must not look airborne');
  assert.equal(snapshot.pose.backX, getRollPose(.5).backX, 'blocked roll must drop the forward lean');
});
