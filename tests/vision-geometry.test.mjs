import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeMap, load } from './vision-helpers.mjs';

const { targetSamplePoints, hasLineOfSight, anySampleVisible, distanceBetween } = load('vision/SightGeometry');
const { segmentsIntersect } = load('physics/Collider');

test('segmentsIntersect 已导出，可供 LOS 复用', () => {
  assert.equal(typeof segmentsIntersect, 'function');
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }), true);
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 5 }), false);
});

test('targetSamplePoints 生成中心 + 四边内缩点，小包围盒只保留中心', () => {
  const target = {
    id: 't',
    category: 'enemy',
    x: 100,
    y: 100,
    bounds: { x: 95, y: 95, width: 10, height: 10 }
  };
  const points = targetSamplePoints(target);
  assert.equal(points.length, 5);
  assert.deepEqual(points[0], { x: 100, y: 100 });
  assert.ok(points.some(point => point.x < 100));
  assert.ok(points.some(point => point.x > 100));
  assert.ok(points.some(point => point.y < 100));
  assert.ok(points.some(point => point.y > 100));

  const small = targetSamplePoints({ ...target, bounds: { x: 99, y: 99, width: 2, height: 2 } });
  assert.deepEqual(small, [{ x: 100, y: 100 }]);

  const custom = targetSamplePoints({ ...target, samplePoints: [{ x: 1, y: 2 }] });
  assert.deepEqual(custom, [{ x: 1, y: 2 }]);
});

test('hasLineOfSight 处理墙体、端点、空地和非有限坐标', () => {
  const wall = new FakeMap([{ x: 100, y: 0, w: 20, h: 200 }]);
  assert.equal(hasLineOfSight(wall, 50, 100, 200, 100), false);
  assert.equal(hasLineOfSight(wall, 50, 250, 200, 250), true);
  assert.equal(hasLineOfSight(wall, 50, 100, 90, 100), true);
  assert.equal(hasLineOfSight(wall, 50, 100, 110, 100), false);
  assert.equal(hasLineOfSight(wall, Number.NaN, 100, 200, 100), false);
  assert.equal(hasLineOfSight(new FakeMap(), 50, 100, 200, 100), true);
  assert.equal(distanceBetween(0, 0, 3, 4), 5);
});

test('anySampleVisible 允许部分身体露出，但中心仍被墙挡住', () => {
  const wall = new FakeMap([{ x: 100, y: 0, w: 20, h: 200 }]);
  const observer = { id: 'o', x: 50, y: 100, facing: 0, nearSenseRadius: 100, maxObservationRange: 450 };
  const hidden = {
    id: 'hidden',
    category: 'enemy',
    x: 200,
    y: 100,
    bounds: { x: 190, y: 90, width: 20, height: 20 }
  };
  assert.equal(anySampleVisible(wall, observer, hidden), false);

  const partial = {
    id: 'partial',
    category: 'enemy',
    x: 200,
    y: 100,
    bounds: { x: 40, y: 80, width: 180, height: 40 }
  };
  assert.equal(anySampleVisible(wall, observer, partial), true);
  assert.equal(hasLineOfSight(wall, observer.x, observer.y, partial.x, partial.y), false);
});
