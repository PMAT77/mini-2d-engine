import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const {
  MEAT_PICKUP_CONFIG, GOLD_PICKUP_CONFIG, ITEM_PICKUP_CONFIG,
  clampProgress, isInteractionPickup,
} = load('interaction/PickupTypes');
const { MeatPickup } = load('objects/MeatPickup');
const { GoldPickup } = load('objects/GoldPickup');

test('the meat chunk is an INTERACT pickup with the agreed defaults', () => {
  assert.equal(MEAT_PICKUP_CONFIG.mode, 'INTERACT');
  assert.equal(MEAT_PICKUP_CONFIG.duration, 0.5);
  assert.equal(MEAT_PICKUP_CONFIG.interactionRadius, 70);
  assert.equal(MEAT_PICKUP_CONFIG.discoveryRadius, 160);
  assert.equal(MEAT_PICKUP_CONFIG.markerStyle, 'whiteDot');
  assert.equal(MEAT_PICKUP_CONFIG.displayName, '鸡肉块');
  assert.equal(isInteractionPickup(MEAT_PICKUP_CONFIG), true);

  const meat = new MeatPickup(10, 20);
  assert.equal(meat.pickupConfig, MEAT_PICKUP_CONFIG);
  assert.equal(meat.pickupConfig.duration, 0.5);
});

test('gold and buff items stay AUTO so they never enter the hold state machine', () => {
  assert.equal(GOLD_PICKUP_CONFIG.mode, 'AUTO');
  assert.equal(GOLD_PICKUP_CONFIG.duration, 0);
  assert.equal(GOLD_PICKUP_CONFIG.markerStyle, 'goldDot');
  assert.equal(isInteractionPickup(GOLD_PICKUP_CONFIG), false);

  assert.equal(ITEM_PICKUP_CONFIG.mode, 'AUTO');
  assert.equal(ITEM_PICKUP_CONFIG.markerStyle, 'none');

  const gold = new GoldPickup(0, 0, 10, 10);
  assert.equal(gold.pickupConfig, GOLD_PICKUP_CONFIG);
});

test('interaction progress is elapsed over duration, clamped to 0..1', () => {
  assert.equal(clampProgress(0, 0.5), 0);
  assert.equal(clampProgress(0.25, 0.5), 0.5);
  assert.equal(clampProgress(0.5, 0.5), 1);
  assert.equal(clampProgress(0.75, 0.5), 1);
  assert.equal(clampProgress(-1, 0.5), 0);
  assert.equal(clampProgress(NaN, 0.5), 0);
  assert.equal(clampProgress(0.1, 0), 1);
  assert.equal(clampProgress(0.1, NaN), 1);
});

test('pickup ids are unique so overlapping chunks resolve deterministically', () => {
  const ids = new Set();
  for (let index = 0; index < 20; index++) {
    const meat = new MeatPickup(index, index);
    assert.equal(ids.has(meat.id), false);
    ids.add(meat.id);
  }
});
