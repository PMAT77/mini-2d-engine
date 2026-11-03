import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { sampleEnvironment, naturalLightStrength, DEFAULT_DAY_NIGHT } = load('core/EnvironmentLighting');
const { parseGraphicsConfig, cloneGraphicsConfig } = load('core/GraphicsConfig');
const { projectDirectionalShadow } = load('core/DirectionalShadow');
const { canIdentifyPoint } = load('vision/IlluminationProbe');
const { createVisionRules } = load('vision/VisionRules');
const { PerceptionSystem } = load('vision/PerceptionSystem');
const { VisionSensor } = load('ai/VisionSensor');
const { createSenseRules } = load('ai/SenseRules');
const { TileMap } = load('map/TileMap');
const { LightingSystem } = load('core/LightingSystem');
const observer = { id: 'player', x: 100, y: 250, facing: 0, nearSenseRadius: 100, maxObservationRange: 450 };
function map() { const m = new TileMap(16, 12, { seed: 817, generateWater: false }); m.tiles.forEach(row => row.fill('default')); return m; }

test('day/night presets separate ambient, sun and artificial contrast without modifying gameplay through graphics', () => {
  const day = sampleEnvironment(360), dusk = sampleEnvironment(765), night = sampleEnvironment(960);
  assert.equal(day.ambientIntensity, .72); assert.equal(dusk.shadowScale, 2.2); assert.equal(night.sunIntensity, 0);
  assert.ok(day.ambientIntensity > dusk.ambientIntensity && dusk.ambientIntensity > night.ambientIntensity);
  assert.ok(day.shadowScale < dusk.shadowScale && night.shadowScale === 0);
  assert.ok(day.artificialWeight < dusk.artificialWeight && dusk.artificialWeight < night.artificialWeight);
  const custom = parseGraphicsConfig({ dayNight: { day: { ambientIntensity: 0 }, night: { sunIntensity: 1 } } }).dayNight;
  assert.equal(sampleEnvironment(360, custom).naturalRange, day.naturalRange);
  assert.equal(sampleEnvironment(960, custom).sunIntensity, 0);
  const clone = cloneGraphicsConfig(); clone.dayNight.day.ambientIntensity = 0;
  assert.equal(DEFAULT_DAY_NIGHT.day.ambientIntensity, .72);
  for (const bad of [{ mode: 'bright' }, { day: { shadowScale: -1 } }, { night: { hazeOpacity: NaN } }, { day: { missing: 1 } }]) assert.throws(() => parseGraphicsConfig({ dayNight: bad }));
});

test('clock-derived transitions are continuous through phase boundaries and midnight', () => {
  for (const minute of [0, 30, 630, 720, 780, 840, 1080, 1410, 1440]) {
    const a = sampleEnvironment(minute === 0 ? 1439.999 : minute - .001), b = sampleEnvironment(minute + .001);
    for (const key of ['ambientIntensity', 'sunIntensity', 'artificialWeight', 'naturalRange', 'daylight']) assert.ok(Math.abs(a[key] - b[key]) < .01, `${minute}:${key}`);
  }
  for (const bad of [-1, Infinity, NaN]) assert.throws(() => sampleEnvironment(bad));
  assert.deepEqual(sampleEnvironment(360).sunDirection, sampleEnvironment(765).sunDirection);
});

test('directional shadows project parallel at every world position and reject upstream edges', () => {
  const a = { ax: 10, ay: 10, bx: 10, by: 60 }, b = { ax: 1010, ay: 700, bx: 1010, by: 750 };
  for (const length of [32.5, 110]) for (const edge of [a, b]) {
    const p = projectDirectionalShadow(edge, { x: .8, y: .6 }, length);
    assert.ok(Math.abs(p[4] - p[2] - length * .8) < 1e-9);
    assert.ok(Math.abs(p[5] - p[3] - length * .6) < 1e-9);
  }
  assert.equal(projectDirectionalShadow({ ax: 10, ay: 60, bx: 10, by: 10 }, { x: .8, y: .6 }, 20), null);
  assert.equal(projectDirectionalShadow(a, { x: 0, y: 0 }, 20), null);
  const system = new LightingSystem();
  assert.throws(() => system.setDirectionalLight({ direction: { x: 0, y: 0 }, color: '#FFFFFF', intensity: 1, shadowLength: 20, shadowOpacity: 1, softness: 2 }));
});

test('daylight identification, exploration and memory obey LOS, range and smoke at 30/60/144 FPS', () => {
  const rules = createVisionRules();
  for (const fps of [30, 60, 144]) {
    const m = map(), system = new PerceptionSystem({ map: m, terrain: m, rules });
    const target = { id: 'enemy', category: 'enemy', x: 325, y: 250, bounds: { x: 310, y: 235, width: 30, height: 30 } };
    system.setEnvironment(sampleEnvironment(360));
    for (let i = 0; i < fps; i++) system.update(1 / fps, [observer], [], [target]);
    assert.equal(system.getView('player', 'enemy').level, 'identified');
    assert.equal(system.getTerrainRecall('player', 325, 250), 'observed');
    assert.equal(canIdentifyPoint(m, observer, 700, 250, [], rules, sampleEnvironment(360)), false);
    m.tiles.forEach(row => { row[4] = 'wall'; });
    system.update(1 / fps, [observer], [], [target]);
    assert.equal(system.getView('player', 'enemy').alpha, 0);
    m.tiles.forEach(row => { row[4] = 'default'; }); m.sightOpacity = () => .5;
    assert.equal(canIdentifyPoint(m, observer, 325, 250, [], rules, sampleEnvironment(360)), false);
    m.sightOpacity = undefined; system.setEnvironment(sampleEnvironment(960));
    for (let i = 0; i < fps; i++) system.update(1 / fps, [observer], [], [target]);
    assert.equal(system.getView('player', 'enemy').level, 'hidden');
    assert.equal(system.getTerrainRecall('player', 325, 250), 'remembered');
  }
  assert.equal(naturalLightStrength(sampleEnvironment(960), 50), 0);
});

test('AI sees by the same daylight schedule while preserving confirmation, smoke, walls and local exposure', () => {
  const m = map(), rules = createSenseRules({ visionRange: 300, darkVisionRange: 120, confirmSeconds: .2 });
  const sensor = new VisionSensor(rules), viewer = { x: 100, y: 250, facing: 0 }, target = { x: 325, y: 250 };
  assert.equal(sensor.sense(.1, m, viewer, target, [], sampleEnvironment(360)).visible, false);
  assert.equal(sensor.sense(.1, m, viewer, target, [], sampleEnvironment(360)).visible, true);
  assert.equal(sensor.sense(.3, m, viewer, target, [], sampleEnvironment(960)).visible, false);
  m.tiles[5][4] = 'wall'; assert.equal(sensor.sense(.3, m, viewer, target, [], sampleEnvironment(360)).visible, false);
  m.tiles[5][4] = 'default'; m.sightOpacity = () => .5;
  assert.equal(sensor.sense(.3, m, viewer, target, [], sampleEnvironment(360)).visible, false);
});
