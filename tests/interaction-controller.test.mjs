import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { InteractionController } = load('interaction/InteractionController');

const target = id => ({ id });
const candidate = (id, distance, extra = {}) => ({
  target: target(id),
  id,
  x: 0,
  y: 0,
  distance,
  priority: 0,
  duration: 0.5,
  ...extra,
});
const frame = (overrides = {}) => ({
  delta: 1 / 60,
  pressed: false,
  candidates: [],
  ...overrides,
});
const hold = (controller, seconds, candidates, step = 1 / 60) => {
  let result;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
    result = controller.update(frame({ delta: step, pressed: true, candidates }));
  }
  return result;
};

test('a nearby candidate is focused without starting progress', () => {
  const controller = new InteractionController();
  const result = controller.update(frame({ candidates: [candidate('meat-1', 40)] }));
  assert.equal(result.snapshot.state, 'focused');
  assert.equal(result.snapshot.targetId, 'meat-1');
  assert.equal(result.snapshot.progress, 0);
  assert.equal(result.completed, null);
});

test('a short press does not collect; releasing resets the progress to zero', () => {
  const controller = new InteractionController();
  const candidates = [candidate('meat-1', 40)];
  controller.update(frame({ candidates }));
  let result = controller.update(frame({ pressed: true, candidates }));
  assert.equal(result.snapshot.state, 'holding');
  result = controller.update(frame({ delta: 0.3, pressed: true, candidates }));
  assert.ok(Math.abs(result.snapshot.progress - (0.3 + 1 / 60) / 0.5) < 1e-9);
  assert.equal(result.completed, null);

  result = controller.update(frame({ pressed: false, candidates }));
  assert.equal(result.cancelled, true);
  assert.equal(result.snapshot.progress, 0);
  assert.equal(result.snapshot.state, 'focused');

  // 下一次按住从 0 开始：再按 0.4 秒不足以完成。
  result = controller.update(frame({ pressed: true, candidates }));
  result = controller.update(frame({ delta: 0.4, pressed: true, candidates }));
  assert.equal(result.completed, null);
});

test('25% of the way through shows a 50% ring; 0.5s completes exactly once', () => {
  const controller = new InteractionController();
  const candidates = [candidate('meat-1', 40)];
  controller.update(frame({ candidates }));
  let result = controller.update(frame({ delta: 0.25, pressed: true, candidates }));
  assert.equal(result.snapshot.progress, 0.5);
  assert.equal(result.snapshot.state, 'holding');
  assert.equal(result.completed, null);

  result = controller.update(frame({ delta: 0.25, pressed: true, candidates }));
  assert.equal(result.completed.id, 'meat-1');
  assert.equal(result.snapshot.state, 'completed');
  assert.equal(result.snapshot.progress, 1);
});

test('holding E through a completed pickup cannot collect a second target', () => {
  const controller = new InteractionController();
  const first = candidate('meat-1', 40);
  controller.update(frame({ candidates: [first] }));
  const result = controller.update(frame({ delta: 0.5, pressed: true, candidates: [first] }));
  assert.equal(result.completed.id, 'meat-1');

  // 目标被移除后仍然按住：第二块肉不会被自动接管。
  const second = candidate('meat-2', 20);
  for (let index = 0; index < 5; index++) {
    const passive = controller.update(frame({ pressed: true, candidates: [second] }));
    assert.equal(passive.completed, null);
    assert.equal(passive.snapshot.state, 'idle');
  }
  // 松开再按才会重新锁定。
  controller.update(frame({ pressed: false, candidates: [second] }));
  let fresh = controller.update(frame({ pressed: true, candidates: [second] }));
  fresh = controller.update(frame({ delta: 0.5, pressed: true, candidates: [second] }));
  assert.equal(fresh.completed.id, 'meat-2');
});

test('losing the target, rolling, firing or UI takeover cancels the hold', () => {
  const cases = [
    { label: 'target gone', run: (controller, candidates) => controller.update(frame({ pressed: true, candidates: [] })) },
    { label: 'interrupted', run: (controller, candidates) => controller.update(frame({ pressed: true, interrupted: true, candidates })) },
    { label: 'blocked', run: (controller, candidates) => controller.update(frame({ pressed: true, blocked: true, candidates })) },
    { label: 'released', run: (controller, candidates) => controller.update(frame({ pressed: false, candidates })) },
  ];
  for (const testCase of cases) {
    const controller = new InteractionController();
    const candidates = [candidate('meat-1', 40)];
    controller.update(frame({ candidates }));
    controller.update(frame({ pressed: true, candidates }));
    const held = controller.update(frame({ delta: 0.2, pressed: true, candidates }));
    assert.equal(held.snapshot.progress > 0, true, `${testCase.label}: progress should have started`);
    const result = testCase.run(controller, candidates);
    assert.equal(result.cancelled, true, `${testCase.label}: should report cancellation`);
    assert.equal(result.completed, null, `${testCase.label}: cancellation must not settle`);
    assert.equal(result.snapshot.progress, 0, `${testCase.label}: progress resets`);
  }
});

test('after a cancellation the player must release E before a new hold starts', () => {
  const controller = new InteractionController();
  const candidates = [candidate('meat-1', 40), candidate('meat-2', 30)];
  controller.update(frame({ candidates }));
  controller.update(frame({ pressed: true, candidates }));
  controller.update(frame({ delta: 0.2, pressed: true, candidates }));
  const cancelled = controller.update(frame({ pressed: true, interrupted: true, candidates }));
  assert.equal(cancelled.cancelled, true);

  // 仍然按住：不会自动锁定下一块肉。
  const passive = controller.update(frame({ pressed: true, candidates }));
  assert.equal(passive.snapshot.state, 'idle');
  // 松开后目标才重新出现。
  const released = controller.update(frame({ pressed: false, candidates }));
  assert.equal(released.snapshot.state, 'focused');
  assert.equal(released.snapshot.targetId, 'meat-2');
});

test('target selection is stable and only switches when the new target is clearly closer', () => {
  const controller = new InteractionController();
  const far = candidate('meat-2', 100);
  const near = candidate('meat-1', 40);
  controller.update(frame({ candidates: [far, near] }));
  assert.equal(controller.getSnapshot().targetId, 'meat-1');

  // 另一个目标只近 10 像素：保持当前锁定，提示不闪烁。
  const slightlyCloser = candidate('meat-3', 30);
  controller.update(frame({ candidates: [slightlyCloser, near] }));
  assert.equal(controller.getSnapshot().targetId, 'meat-1');

  // 近出 12 像素以上才切换。
  const clearlyCloser = candidate('meat-4', 20);
  controller.update(frame({ candidates: [clearlyCloser, near] }));
  assert.equal(controller.getSnapshot().targetId, 'meat-4');
});

test('equal distances fall back to the stable id regardless of candidate order', () => {
  const controller = new InteractionController();
  const a = candidate('meat-10', 50);
  const b = candidate('meat-2', 50);
  controller.update(frame({ candidates: [a, b] }));
  assert.equal(controller.getSnapshot().targetId, 'meat-10');

  const other = new InteractionController();
  other.update(frame({ candidates: [b, a] }));
  assert.equal(other.getSnapshot().targetId, 'meat-10');
});

test('completion arrives at the same simulated time at 30, 60 and 144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    const step = 1 / fps;
    const controller = new InteractionController();
    const candidates = [candidate('meat-1', 40)];
    let elapsed = 0;
    let result = controller.update(frame({ delta: step, candidates }));
    while (!result.completed && elapsed < 2) {
      result = controller.update(frame({ delta: step, pressed: true, candidates }));
      elapsed += step;
    }
    assert.ok(result.completed, `${fps}FPS should complete`);
    assert.ok(Math.abs(elapsed - 0.5) <= step + 1e-6,
      `${fps}FPS completed at ${elapsed}, expected about 0.5s`);
  }
});
