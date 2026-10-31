import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { CROSSHAIR_SPREAD, getCrosshairOffset } = load('ui/CrosshairOverlay');

test('a resting crosshair keeps the asset spacing', () => {
  assert.equal(getCrosshairOffset(0, 0), 0);
});

test('full recoil spreads both brackets outward and full aim pulls them inward', () => {
  assert.equal(getCrosshairOffset(1, 0), CROSSHAIR_SPREAD.outward);
  assert.equal(getCrosshairOffset(0, 1), -CROSSHAIR_SPREAD.inward);
  assert.ok(CROSSHAIR_SPREAD.outward > 0);
  assert.ok(CROSSHAIR_SPREAD.inward > 0);
});

test('recoil and aim offset each other linearly', () => {
  assert.equal(getCrosshairOffset(0.5, 0), CROSSHAIR_SPREAD.outward * 0.5);
  assert.equal(getCrosshairOffset(0, 0.5), -CROSSHAIR_SPREAD.inward * 0.5);
  assert.equal(getCrosshairOffset(0.5, 0.5), CROSSHAIR_SPREAD.outward * 0.5 - CROSSHAIR_SPREAD.inward * 0.5);
});

test('out-of-range and non-finite inputs are clamped to the resting pose', () => {
  assert.equal(getCrosshairOffset(2, 0), CROSSHAIR_SPREAD.outward);
  assert.equal(getCrosshairOffset(0, 2), -CROSSHAIR_SPREAD.inward);
  assert.equal(getCrosshairOffset(-1, 0), 0);
  assert.equal(getCrosshairOffset(0, -1), 0);
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    assert.equal(getCrosshairOffset(value, 0), 0);
    assert.equal(getCrosshairOffset(0, value), 0);
  }
});

test('the offset grows with recoil and shrinks with aim progress', () => {
  let previous = -Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const offset = getCrosshairOffset(i / 20, 0);
    assert.ok(offset > previous);
    previous = offset;
  }
  previous = Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const offset = getCrosshairOffset(0, i / 20);
    assert.ok(offset < previous);
    previous = offset;
  }
});
