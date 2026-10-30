import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './vision-helpers.mjs';

const { DEFAULT_VISION_RULES, createVisionRules } = load('vision/VisionRules');
const { VisibilityPolicy } = load('vision/VisibilityPolicy');

test('默认玩法规则符合已确认方案', () => {
  assert.equal(DEFAULT_VISION_RULES.nearSenseRadius, 100);
  assert.equal(DEFAULT_VISION_RULES.maxObservationRange, 450);
  assert.equal(DEFAULT_VISION_RULES.identifyLightThreshold, 0.3);
  assert.equal(DEFAULT_VISION_RULES.identifyDwellSeconds, 0.12);
  assert.equal(DEFAULT_VISION_RULES.identifyFadeSeconds, 0.25);
  assert.equal(DEFAULT_VISION_RULES.nearRevealAlpha, 0.55);
  assert.equal(DEFAULT_VISION_RULES.unknownTerrain, 'outline');
  assert.equal(DEFAULT_VISION_RULES.memoryShare, 'none');
  assert.equal(DEFAULT_VISION_RULES.ambientIdentifies, false);
  assert.equal(DEFAULT_VISION_RULES.strongestLightOnly, true);
  assert.equal(DEFAULT_VISION_RULES.explorationCellSize, 25);
  assert.equal(DEFAULT_VISION_RULES.explorationInterval, 0.25);
  assert.equal(DEFAULT_VISION_RULES.cullingMargin, 64);
  assert.equal(Object.isFrozen(DEFAULT_VISION_RULES), true);
});

test('覆盖规则生成新对象，不修改默认值', () => {
  const custom = createVisionRules({ nearSenseRadius: 120, unknownTerrain: 'black' });
  assert.equal(custom.nearSenseRadius, 120);
  assert.equal(custom.unknownTerrain, 'black');
  assert.equal(custom.maxObservationRange, 450);
  assert.equal(DEFAULT_VISION_RULES.nearSenseRadius, 100);
  assert.notEqual(custom, DEFAULT_VISION_RULES);
  assert.deepEqual(createVisionRules({}), DEFAULT_VISION_RULES);
});

test('非法规则被拒绝', () => {
  const invalid = [
    { nearSenseRadius: 0 },
    { nearSenseRadius: Number.NaN },
    { maxObservationRange: -1 },
    { identifyLightThreshold: 1.1 },
    { identifyDwellSeconds: -1 },
    { identifyFadeSeconds: -1 },
    { nearRevealAlpha: 2 },
    { unknownTerrain: 'wat' },
    { memoryShare: 'all' },
    { explorationCellSize: 0 },
    { explorationInterval: 0 },
    { cullingMargin: -1 }
  ];
  for (const overrides of invalid) {
    assert.throws(() => createVisionRules(overrides));
  }
});

test('VisibilityPolicy 对动态效果比实体更保守', () => {
  const identified = { level: 'identified', alpha: 1 };
  const silhouette = { level: 'silhouette', alpha: 1 };
  const hidden = { level: 'hidden', alpha: 0 };

  assert.equal(VisibilityPolicy.entity(identified), 'identified');
  assert.equal(VisibilityPolicy.entity(silhouette), 'silhouette');
  assert.equal(VisibilityPolicy.lightBody(silhouette), 'silhouette');

  assert.equal(VisibilityPolicy.goldGlow(silhouette), 'hidden');
  assert.equal(VisibilityPolicy.goldGlow(identified), 'identified');
  assert.equal(VisibilityPolicy.floatingText(silhouette), 'hidden');
  assert.equal(VisibilityPolicy.floatingText(identified), 'identified');

  assert.equal(VisibilityPolicy.crosshair(silhouette), false);
  assert.equal(VisibilityPolicy.crosshair(identified), true);
  assert.equal(VisibilityPolicy.healthBar(silhouette), false);
  assert.equal(VisibilityPolicy.healthBar(identified), true);
  assert.equal(VisibilityPolicy.effect(hidden), 'hidden');
});
