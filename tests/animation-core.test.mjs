import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const angles = load('animation2d/math/angles');
const { PLAYER_RIG, PLAYER_BIND_POSE } = load('animation2d/rig/PlayerRig');
const { BONE_IDS, SOCKET_IDS, CHAIN_IDS } = load('animation2d/rig/RigTypes');
const { solveForwardKinematics, resolveSockets, isRigOrderValid } = load('animation2d/pose/Fk2D');
const { createEmptyLocalPose, cloneLocalPose } = load('animation2d/pose/Pose2D');
const { blendLocalPoses, blendMaskedPoses, chainWeights } = load('animation2d/pose/PoseBlend2D');
const { legacyPoseToLocalPose, legacyPoseToParams } = load('objects/animation/LegacyPoseAdapter');
const { ROLL_REST_POSE, getRollPose } = load('objects/RollPose');

const near = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${message} expected ${expected}, got ${actual}`);
};

test('angle helpers normalize to (-PI, PI] and clamp non-finite input', () => {
  assert.equal(angles.normalizeAngle(0), 0);
  assert.equal(angles.normalizeAngle(Math.PI), Math.PI);
  assert.equal(angles.normalizeAngle(-Math.PI), Math.PI);
  near(angles.normalizeAngle(Math.PI * 3), Math.PI);
  near(angles.normalizeAngle(-Math.PI * 3), Math.PI);
  near(angles.shortestAngleDelta(Math.PI - .1, -Math.PI + .1), .2);
  near(angles.shortestAngleDelta(0, Math.PI), Math.PI);
  assert.equal(angles.clamp01(Number.NaN), 0);
  assert.equal(angles.clamp01(-2), 0);
  assert.equal(angles.clamp01(2), 1);
});

test('player rig is 16 ordered bones with 5 sockets, 4 chains and 20 render parts', () => {
  assert.ok(isRigOrderValid(PLAYER_RIG), 'parents must precede children');
  assert.equal(PLAYER_RIG.bones.length, 16);
  assert.deepEqual(PLAYER_RIG.bones.map(bone => bone.id), BONE_IDS);
  assert.equal(PLAYER_RIG.sockets.length, 5);
  assert.deepEqual(PLAYER_RIG.sockets.map(socket => socket.id), SOCKET_IDS);
  assert.equal(PLAYER_RIG.chains.length, 4);
  assert.deepEqual(PLAYER_RIG.chains.map(chain => chain.id), CHAIN_IDS);
  assert.equal(PLAYER_RIG.renderParts.length, 20);
  assert.equal(new Set(PLAYER_RIG.renderParts).size, 20);
  assert.equal(new Set(PLAYER_RIG.bones.map(bone => bone.id)).size, 16);
});

test('bind pose forward kinematics reproduces the old rest pose', () => {
  const global = solveForwardKinematics(PLAYER_RIG, PLAYER_BIND_POSE);
  const expect = {
    head: [.09, 0], handL: [.04, -.46], handR: [.04, .46],
    elbowL: [.024, -.40], elbowR: [.024, .40],
    hipL: [-.162, -.1539], hipR: [-.162, .1539],
    kneeL: [-.18, -.16], kneeR: [-.18, .16],
    footL: [-.30, -.20], footR: [-.30, .20],
  };
  for (const [id, [x, y]] of Object.entries(expect)) {
    near(global.world[id].x, x, `${id}.x`);
    near(global.world[id].y, y, `${id}.y`);
    near(global.world[id].rotation, 0, `${id}.rotation`);
  }
});

test('legacy pose adapter and FK reproduce every joint of arbitrary roll poses', () => {
  for (const progress of [0, .12, .2, .28, .36, .44, .52, .6, .7, .78, .86, .93, 1]) {
    const pose = getRollPose(progress);
    const locals = legacyPoseToLocalPose(pose);
    const global = solveForwardKinematics(PLAYER_RIG, locals);
    const checks = [
      ['head', pose.headX, pose.headY],
      ['handL', pose.leftHandX, pose.leftHandY],
      ['handR', pose.rightHandX, pose.rightHandY],
      ['elbowL', pose.leftElbowX, pose.leftElbowY],
      ['elbowR', pose.rightElbowX, pose.rightElbowY],
      ['kneeL', pose.leftKneeX, pose.leftKneeY],
      ['kneeR', pose.rightKneeX, pose.rightKneeY],
      ['footL', pose.leftFootX, pose.leftFootY],
      ['footR', pose.rightFootX, pose.rightFootY],
    ];
    for (const [id, x, y] of checks) {
      near(global.world[id].x, x, `p=${progress} ${id}.x`);
      near(global.world[id].y, y, `p=${progress} ${id}.y`);
    }
    near(global.world.hipL.x, pose.bodyX - pose.bodyRx * .4, `p=${progress} hipL.x`);
    near(global.world.hipL.y, -pose.bodyRy * .38, `p=${progress} hipL.y`);
    near(global.world.hipR.y, pose.bodyRy * .38, `p=${progress} hipR.y`);
  }
});

test('rest pose locals are exactly the declared bind pose', () => {
  const locals = legacyPoseToLocalPose(ROLL_REST_POSE);
  for (const id of BONE_IDS) {
    near(locals.locals[id].x, PLAYER_BIND_POSE.locals[id].x, `${id}.x`);
    near(locals.locals[id].y, PLAYER_BIND_POSE.locals[id].y, `${id}.y`);
    near(locals.locals[id].rotation, 0, `${id}.rotation`);
  }
  const params = legacyPoseToParams(ROLL_REST_POSE);
  assert.equal(params.headBindR, ROLL_REST_POSE.headR);
  assert.equal(params.headAlpha, 1);
  assert.equal(params.legAlpha, 0);
});

test('sockets resolve against their bones and keep muzzle offset', () => {
  const global = solveForwardKinematics(PLAYER_RIG, legacyPoseToLocalPose(ROLL_REST_POSE));
  const sockets = resolveSockets(PLAYER_RIG, global);
  near(sockets.mainGrip.x, .02, 'mainGrip.x');
  near(sockets.mainGrip.y, .475, 'mainGrip.y');
  near(sockets.visualMuzzle.x, .38, 'visualMuzzle.x');
  near(sockets.visualMuzzle.y, .475, 'visualMuzzle.y');
});

test('pose blending interpolates positions and rotations along the shortest arc', () => {
  const from = createEmptyLocalPose();
  const to = createEmptyLocalPose();
  from.locals.handR = { x: 0, y: 0, rotation: Math.PI - .1 };
  to.locals.handR = { x: 10, y: 20, rotation: -Math.PI + .1 };
  const middle = blendLocalPoses(from, to, .5);
  near(middle.locals.handR.x, 5, 'x');
  near(middle.locals.handR.y, 10, 'y');
  assert.ok(Math.abs(Math.abs(middle.locals.handR.rotation) - Math.PI) < 1e-9,
    `wrap should stay near PI, got ${middle.locals.handR.rotation}`);

  const clamped = blendLocalPoses(from, to, 5);
  near(clamped.locals.handR.x, 10);
  near(clamped.locals.handR.rotation, -Math.PI + .1);
  const copy = cloneLocalPose(from);
  copy.locals.handR.x = 99;
  near(from.locals.handR.x, 0, 'clone must not alias');
});

test('masked blending only moves the requested chain', () => {
  const from = createEmptyLocalPose();
  const to = createEmptyLocalPose();
  to.locals.handR = { x: 3, y: 0, rotation: 0 };
  to.locals.handL = { x: 5, y: 0, rotation: 0 };
  const weights = chainWeights(PLAYER_RIG, 'rightArm', 1);
  const blended = blendMaskedPoses(from, to, weights);
  near(blended.locals.handR.x, 3, 'right hand');
  near(blended.locals.handL.x, 0, 'left hand untouched');
  assert.equal(weights.shoulderR, 1);
  assert.equal(weights.handL, undefined);
});

