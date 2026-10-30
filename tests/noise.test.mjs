import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { NoiseSystem, NOISE_PROFILES } = require(join(process.env.TEST_BUILD_DIR, 'core/NoiseSystem.js'));

const near = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${message} expected ${expected}, got ${actual}`);
};

test('emit records the event with its profile defaults and a monotonic id', () => {
  const noise = new NoiseSystem();
  const first = noise.emit('gunshot', 10, 20, { sourceId: 'player' });
  const second = noise.emit('footstep', 30, 40);
  assert.ok(first && second);
  assert.deepEqual(second.id, first.id + 1);
  near(first.radius, NOISE_PROFILES.gunshot.radius, 'radius');
  near(first.loudness, NOISE_PROFILES.gunshot.loudness, 'loudness');
  assert.equal(first.sourceId, 'player');
  assert.equal(first.age, 0);
  assert.equal(noise.getEvents().length, 2);
});

test('emit clamps loudness, accepts radius overrides and ignores invalid coordinates', () => {
  const noise = new NoiseSystem();
  const loud = noise.emit('footstep', 0, 0, { loudness: 4 });
  const quiet = noise.emit('footstep', 0, 0, { loudness: -1 });
  const custom = noise.emit('roll', 0, 0, { radius: 40 });
  assert.ok(loud && quiet && custom);
  near(loud.loudness, 1, 'clamped high');
  near(quiet.loudness, 0, 'clamped low');
  near(custom.radius, 40, 'custom radius');
  assert.equal(noise.emit('roll', Number.NaN, 0), null);
  assert.equal(noise.emit('roll', 0, Number.POSITIVE_INFINITY), null);
  assert.equal(noise.getEvents().length, 3);
});

test('update ages events and drops the ones past maxAge', () => {
  const noise = new NoiseSystem(1.5, 16);
  noise.emit('footstep', 0, 0);
  noise.emit('gunshot', 0, 0);
  noise.update(0.5);
  assert.deepEqual(noise.getEvents().map(event => event.age), [0.5, 0.5]);
  noise.update(1.2);
  assert.equal(noise.getEvents().length, 0, 'old events must expire');
});

test('update ignores zero, negative and non-finite deltas', () => {
  const noise = new NoiseSystem();
  noise.emit('footstep', 0, 0);
  for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) noise.update(delta);
  near(noise.getEvents()[0].age, 0);
});

test('capacity drops the oldest events first', () => {
  const noise = new NoiseSystem(10, 3);
  for (let i = 0; i < 5; i++) noise.emit('footstep', i, 0);
  assert.deepEqual(noise.getEvents().map(event => event.id), [3, 4, 5]);
});

test('query uses the smaller of the event radius and the listener range', () => {
  const noise = new NoiseSystem();
  noise.emit('gunshot', 0, 0); // radius 560
  noise.emit('footstep', 0, 500); // radius 150
  assert.equal(noise.query({ x: 0, y: 200 }).length, 1, 'gunshot alone reaches 200px');
  assert.equal(noise.query({ x: 0, y: 200, maxRange: 120 }).length, 0, 'listener range wins');
  assert.equal(noise.query({ x: 0, y: 300 }).length, 1, 'footstep at 500 is out of its own radius');
});

test('query filters by kind, loudness and age and sorts by age then loudness', () => {
  const noise = new NoiseSystem(4, 16);
  noise.emit('footstep', 0, 0, { loudness: 0.2 });
  noise.emit('gunshot', 0, 0, { loudness: 1 });
  noise.emit('waterStep', 0, 0, { loudness: 0.6 });
  noise.update(1);
  noise.emit('gunshot', 0, 0, { loudness: 0.9 });

  const all = noise.query({ x: 0, y: 0 });
  assert.deepEqual(all.map(event => event.id), [4, 2, 3, 1], 'newest first, then louder');

  const footsteps = noise.query({ x: 0, y: 0, kinds: ['footstep', 'waterStep'] });
  assert.deepEqual(footsteps.map(event => event.id), [3, 1]);

  const loud = noise.query({ x: 0, y: 0, minLoudness: 0.8 });
  assert.deepEqual(loud.map(event => event.id), [4, 2]);

  const recent = noise.query({ x: 0, y: 0, maxAge: 0.5 });
  assert.deepEqual(recent.map(event => event.id), [4]);
});

test('clear removes every event without resetting the id sequence', () => {
  const noise = new NoiseSystem();
  const first = noise.emit('roll', 1, 2);
  noise.clear();
  assert.equal(noise.getEvents().length, 0);
  const second = noise.emit('roll', 1, 2);
  assert.ok(first && second);
  assert.equal(second.id, first.id + 1);
});
