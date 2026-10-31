import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { resolvePickupVisibility } = load('interaction/PickupVisibilityPolicy');
const { MEAT_PICKUP_CONFIG, GOLD_PICKUP_CONFIG, ITEM_PICKUP_CONFIG } = load('interaction/PickupTypes');

const base = {
  config: MEAT_PICKUP_CONFIG,
  view: 'identified',
  distance: 40,
  lineOfSight: true,
  nearSense: true,
  visionMode: 'three-layer',
  legacyRange: 450,
};
const decide = overrides => resolvePickupVisibility({ ...base, ...overrides });

test('hidden loot never shows a marker, prompt or name', () => {
  const decision = decide({ view: 'hidden', distance: 10 });
  assert.deepEqual(decision, { marker: false, prompt: false, named: false });
});

test('identified meat shows a marker inside discovery range and the prompt inside interaction range', () => {
  assert.deepEqual(decide({ distance: 120 }), { marker: true, prompt: false, named: false });
  assert.deepEqual(decide({ distance: 70 }), { marker: true, prompt: true, named: true });
  assert.deepEqual(decide({ distance: 161 }), { marker: false, prompt: false, named: false });
});

test('identified gold gets a marker but never an E prompt even at zero distance', () => {
  const decision = decide({ config: GOLD_PICKUP_CONFIG, distance: 0 });
  assert.equal(decision.marker, true);
  assert.equal(decision.prompt, false);
  assert.equal(decision.named, false);
});

test('buff items keep a silent AUTO pickup with no marker', () => {
  const decision = decide({ config: ITEM_PICKUP_CONFIG, distance: 0 });
  assert.deepEqual(decision, { marker: false, prompt: false, named: false });
});

test('a distant silhouette cannot reveal loot position', () => {
  const decision = decide({ view: 'silhouette', distance: 120, nearSense: false });
  assert.equal(decision.marker, false);
  assert.equal(decision.prompt, false);
  assert.equal(decision.named, false);
});

test('a nearby silhouette allows tactile pickup without naming the item', () => {
  const decision = decide({ view: 'silhouette', distance: 60, nearSense: true });
  assert.deepEqual(decision, { marker: false, prompt: true, named: false });
});

test('silhouette tactile pickup is blocked by a wall or by near sense being out of range', () => {
  assert.equal(decide({ view: 'silhouette', distance: 60, lineOfSight: false }).prompt, false);
  assert.equal(decide({ view: 'silhouette', distance: 60, nearSense: false }).prompt, false);
});

test('silhouette pickup still respects the interaction radius', () => {
  const decision = decide({ view: 'silhouette', distance: 71, nearSense: true });
  assert.equal(decision.prompt, false);
});

test('legacy mode is limited by the vision range and wall line of sight', () => {
  assert.equal(decide({ visionMode: 'legacy', distance: 300, legacyRange: 200 }).marker, false);
  assert.equal(decide({ visionMode: 'legacy', distance: 100, legacyRange: 200, lineOfSight: false }).marker, false);
  assert.equal(
    decide({ visionMode: 'legacy', distance: 100, legacyRange: 200 }).marker,
    true,
    'legacy still shows loot that is actually in range and visible',
  );
  assert.equal(decide({ visionMode: 'legacy', distance: 60, legacyRange: 200 }).prompt, true);
  assert.equal(decide({ visionMode: 'legacy', distance: 60, legacyRange: 200, lineOfSight: false }).prompt, false);
});

test('invalid distances are treated as not visible', () => {
  for (const distance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(decide({ distance }), { marker: false, prompt: false, named: false });
  }
});
