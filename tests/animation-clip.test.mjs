import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const { ROLL_REST_POSE, getRollPose, rollFacingWeight, rollVisualAngle } = load('objects/RollPose');
const { PLAYER_ROLL_CLIP, PLAYER_ROLL_MARKERS, sampleRollPose } = load('objects/animation/PlayerRollClip');
const { AnimationEventQueue2D } = load('animation2d/clip/AnimationEventQueue2D');
const { resolvePlayerAnimationPhase, PlayerAnimationController } = load('objects/animation/PlayerAnimationController');
const { RollFacingTracker } = load('objects/animation/RollFacingTracker');
const { createPlayerRenderSnapshot, resetPlayerVisualState } = load('objects/animation/PlayerVisualAdapter');
const { legacyPoseToParams } = load('objects/animation/LegacyPoseAdapter');
const { rollComOffsetX, rollAltitudePx, rollDepthTucked } = load('objects/animation/RollGrounding');

const near = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) <= 1e-6, `${message} expected ${expected}, got ${actual}`);
};

const FIELDS = Object.keys(ROLL_REST_POSE);
const DURATION = PLAYER_ROLL_CLIP.duration;

test('roll clip samples every legacy pose field within 1e-6 across 1001 progress values', () => {
  for (let i = 0; i <= 1000; i++) {
    const progress = i / 1000;
    const legacy = getRollPose(progress);
    const sampled = sampleRollPose(progress);
    for (const field of FIELDS) {
      near(sampled[field], legacy[field], `p=${progress} ${field}`);
    }
  }
});

test('roll clip endpoints return the rest pose exactly', () => {
  for (const progress of [-2, 0, 1, 3]) {
    const pose = sampleRollPose(progress);
    for (const field of FIELDS) {
      assert.equal(pose[field], ROLL_REST_POSE[field], `p=${progress} ${field}`);
    }
  }
});

test('roll clip describes one track per pose field with ordered markers inside its duration', () => {
  assert.equal(PLAYER_ROLL_CLIP.id, 'playerRoll');
  assert.equal(DURATION, .42);
  const tracks = Object.keys(PLAYER_ROLL_CLIP.tracks);
  assert.equal(tracks.length, FIELDS.length);
  for (const field of FIELDS) {
    const track = PLAYER_ROLL_CLIP.tracks[field];
    assert.ok(track, `missing track ${field}`);
    assert.equal(track.stops.length, 14);
    assert.equal(track.values.length, 14);
    assert.equal(track.tangents.length, 14);
  }
  assert.deepEqual(PLAYER_ROLL_MARKERS.map(marker => marker.kind), ['rollContact', 'rollDust', 'rollRelease']);
  let previous = 0;
  for (const marker of PLAYER_ROLL_MARKERS) {
    assert.ok(marker.time > previous && marker.time <= 1, `marker ${marker.time}`);
    previous = marker.time;
  }
});

test('event queue emits crossing markers once and never backfills', () => {
  const queue = new AnimationEventQueue2D();
  assert.equal(queue.update(.1, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 0);
  assert.equal(queue.update(.2, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 0);
  assert.equal(queue.update(.35, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 1);
  assert.equal(queue.eventAt(0).kind, 'rollContact');
  assert.equal(queue.update(.35, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 0);
  assert.equal(queue.update(.62, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 2);
  assert.equal(queue.eventAt(0).kind, 'rollDust');
  assert.equal(queue.eventAt(1).kind, 'rollRelease');
  assert.equal(queue.eventAt(1).progress, .62);
  assert.ok(queue.eventAt(1).sequence > queue.eventAt(0).sequence);

  // 新一次翻滚：回退只重建起点，不补发已经过去的标记。
  assert.equal(queue.update(.05, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 0);
  assert.equal(queue.update(.36, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 1);
  assert.equal(queue.eventAt(0).kind, 'rollContact');

  // 重新开始后再第一次 update 落在标记之后，也不能补发。
  queue.reset();
  assert.equal(queue.update(.7, PLAYER_ROLL_MARKERS, PLAYER_ROLL_CLIP.id), 0);
});

test('animation phase covers idle, enter, loop and exit', () => {
  assert.equal(resolvePlayerAnimationPhase(false, .5), 'idle');
  assert.equal(resolvePlayerAnimationPhase(true, 0), 'idle');
  assert.equal(resolvePlayerAnimationPhase(true, .05), 'rollEnter');
  assert.equal(resolvePlayerAnimationPhase(true, .5), 'rollLoop');
  assert.equal(resolvePlayerAnimationPhase(true, .9), 'rollExit');
});

test('controller only advances once per update and resets outside a roll', () => {
  const controller = new PlayerAnimationController();
  controller.update(.05, true);
  assert.equal(controller.phase, 'rollEnter');
  assert.equal(controller.events.count, 0);
  controller.update(.35, true);
  assert.equal(controller.phase, 'rollLoop');
  assert.equal(controller.events.count, 1);
  assert.equal(controller.events.eventAt(0).kind, 'rollContact');
  controller.update(.36, true);
  assert.equal(controller.events.count, 0);
  controller.update(0, false);
  assert.equal(controller.phase, 'idle');
  controller.update(.35, true);
  assert.equal(controller.events.count, 0, 'non-rolling frames reset the event start');
});

test('facing tracker keeps non-wrap frames bit-identical to the legacy formula', () => {
  const tracker = new RollFacingTracker();
  const facing = 1.2;
  const rollAngle = 2.1;
  const weight = .5;
  const expected = facing + Math.atan2(Math.sin(rollAngle - facing), Math.cos(rollAngle - facing)) * weight;
  assert.equal(tracker.resolve(facing, rollAngle, weight), expected);
  assert.equal(tracker.resolve(facing, rollAngle, weight), expected);
});

test('facing tracker unwraps a +/-PI crossing instead of jumping the whole body', () => {
  const tracker = new RollFacingTracker();
  const rollAngle = Math.PI - .02;
  const weight = .5;
  const sequence = [Math.PI - .02, Math.PI - .01, -Math.PI + .01, -Math.PI + .02];
  const outputs = sequence.map(facing => tracker.resolve(facing, rollAngle, weight));
  for (let i = 1; i < outputs.length; i++) {
    assert.ok(Math.abs(outputs[i] - outputs[i - 1]) < .1, `step ${i} jumped ${outputs[i] - outputs[i - 1]}`);
  }
  const legacies = sequence.map(facing => rollVisualAngle(.5, facing, rollAngle));
  assert.ok(Math.abs(legacies[2] - legacies[1]) > 1, 'legacy path is expected to jump across the wrap');
  tracker.reset();
  assert.equal(tracker.resolve(-Math.PI + .03, rollAngle, 0), -Math.PI + .03);
});

test('rig snapshot uses the clip for rolling poses and stays on the legacy angle away from wraps', () => {
  const player = new Player(0, 0);
  player.currentRotation = Math.PI;
  player.rollDirection.set(1, 0);
  resetPlayerVisualState(player);

  player.rollTimeLeft = DURATION * (1 - .5);
  const snapshot = createPlayerRenderSnapshot(player);
  const params = legacyPoseToParams(getRollPose(.5));
  const com = rollComOffsetX(.5);
  assert.ok(Math.abs(com) > 0.01, 'mid-roll should lean the centre of mass');
  for (const field of Object.keys(params)) {
    const shift = field === 'backX' || field === 'plateX' || field === 'shellX' ? com : 0;
    near(snapshot.pose[field], params[field] + shift, field);
  }
  near(snapshot.altitudePx, rollAltitudePx(.5, player.getSize()), 'altitude');
  assert.equal(snapshot.depthTuck, rollDepthTucked(.5));
  assert.equal(snapshot.rolling, true);
  near(snapshot.progress, .5);
  near(snapshot.facing, rollVisualAngle(.5, 0, 0));

  // 非翻滚帧直接沿用心跳后的渲染状态，tracker 不参与。
  player.rollTimeLeft = 0;
  const idle = createPlayerRenderSnapshot(player);
  assert.equal(idle.rolling, false);
  near(idle.facing, player.getRenderState().angle);
  assert.equal(rollFacingWeight(idle.progress), 0);
});
