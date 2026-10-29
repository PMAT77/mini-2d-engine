import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap, tileScreenRect } = load('map/TileMap');
const { LightingSystem, projectShadow, lightFalloff, shadowSamples } = load('core/LightingSystem');
const { LightSource } = load('core/LightSource');
const { Player } = load('objects/Player');
const { Vector2 } = load('math/Vector2');
const { ModifierManager } = load('core/ModifierManager');
const { PickupItem, PickupType } = load('objects/PickupItem');
const { parsePlayerConfig } = load('objects/PlayerConfig');
const { Scene, SceneManager } = load('core/Scene');
const { MenuScene } = load('scenes/MenuScene');
const { LoadingScene } = load('scenes/LoadingScene');
const { GameScene } = load('scenes/GameScene');
const { AssetLoader } = load('core/AssetLoader');
const { ConfigLoader } = load('core/ConfigLoader');
const emptyInput = { isKeyDown: () => false };
const makeMap = (width = 20, height = 12) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};
function inside(polygon, x, y) {
  let result = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const [ax, ay, bx, by] = [polygon[i], polygon[i + 1], polygon[j], polygon[j + 1]];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}
const shadowAt = (map, x, y, px, py) => map.getShadowEdges(x, y, 600).some(edge => {
  const polygon = projectShadow(edge, x, y, 600);
  return polygon && inside(polygon, px, py);
});

test('exposed edges omit shared sides, water, and blocks outside the radius', () => {
  const map = makeMap();
  map.tiles[2][4] = 'wall'; map.tiles[2][5] = 'mineral'; map.tiles[3][3] = 'water';
  const edges = map.getShadowEdges(150, 150, 300);
  assert.ok(edges.length > 6, 'rounded corners add boundary segments');
  assert.ok(edges.every(e => !(e.ax === 250 && e.bx === 250 && e.ay !== e.by)), 'shared wall/ore face is hidden');
  assert.equal(map.getShadowEdges(0, 0, 10).length, 0);
  assert.equal(map.getShadowEdges(0, 0, 0).length, 0);
});
test('block face stays lit while its shadow follows the light and extends to the radius', () => {
  const map = makeMap(); map.tiles[4][6] = 'wall';
  assert.equal(shadowAt(map, 200, 225, 325, 225), false);
  assert.equal(shadowAt(map, 200, 225, 500, 225), true);
  assert.equal(shadowAt(map, 200, 225, 790, 225), true);
  assert.equal(shadowAt(map, 500, 225, 200, 225), true);
  assert.equal(shadowAt(map, 500, 225, 600, 225), false);
});
test('mineral destruction immediately exposes the previously shadowed floor', () => {
  const map = makeMap(); map.tiles[4][6] = 'mineral'; map.tileHp[4][6] = 100;
  assert.equal(shadowAt(map, 200, 225, 500, 225), true);
  map.damageTile(6, 4, 100);
  assert.equal(shadowAt(map, 200, 225, 500, 225), false);
});
test('continuous walls have no light leaks and a one-tile gap transmits light', () => {
  const map = makeMap(); for (let r = 1; r < 10; r++) map.tiles[r][6] = 'wall';
  assert.equal(shadowAt(map, 200, 225, 500, 225), true);
  map.tiles[4][6] = 'default';
  assert.equal(shadowAt(map, 200, 225, 500, 225), false);
  assert.equal(shadowAt(map, 200, 225, 500, 100), true);
});
test('tangent and endpoint cases never produce non-finite polygons', () => {
  const map = makeMap(); map.tiles[4][6] = 'wall';
  for (const point of [[300, 200], [299.999, 200], [325, 199.999], [350.001, 250]]) {
    for (const edge of map.getShadowEdges(...point, 600)) {
      assert.ok((projectShadow(edge, ...point, 600) ?? []).every(Number.isFinite));
    }
  }
});
test('same-stat pickup refreshes one stable ID and expires from the latest pickup', () => {
  const player = new Player(0, 0), manager = new ModifierManager(player);
  const effect = { stat: 'maxSpeed', value: 0.5, duration: 1, isMultiplier: true, description: 'speed' };
  const id = manager.addModifier(effect);
  manager.update(0.8);
  assert.equal(manager.addModifier({ ...effect, value: 0.3, duration: 5 }), id);
  assert.equal(manager.getModifierCount(), 1);
  manager.update(0.3); assert.equal(player.getMaxSpeed(), 520);
  manager.update(4.8); assert.equal(player.getMaxSpeed(), 400);
  assert.equal(manager.getModifierCount(), 0);
});
test('independent stats and permanent effects retain their own lifetimes', () => {
  const p = new Player(0, 0), manager = new ModifierManager(p);
  manager.addModifier({ stat: 'maxSpeed', value: 1, duration: 1, isMultiplier: true, description: '' });
  manager.addModifier({ stat: 'bulletSpeed', value: 1, duration: 0, isMultiplier: true, description: '' });
  manager.update(2); assert.equal(p.getMaxSpeed(), 400); assert.equal(p.getBulletSpeed(), 1600);
  assert.throws(() => manager.addModifier({ stat: 'damage', value: NaN, duration: 1 }), /Invalid/);
  manager.clearAllModifiers(); assert.equal(p.getBulletSpeed(), 800);
});
test('health clamps to 0..100 and a health pickup heals without adding a modifier', () => {
  const p = new Player(0, 0); assert.equal(p.getHealth(), 100);
  p.takeDamage(80); p.heal(50); assert.equal(p.getHealth(), 70);
  p.heal(500); assert.equal(p.getHealth(), 100);
  p.takeDamage(500); assert.equal(p.getHealth(), 0);
  assert.throws(() => p.heal(-1)); assert.throws(() => p.takeDamage(Infinity));
  const scene = new GameScene(); scene.player.takeDamage(80);
  scene.collectPickup(new PickupItem(0, 0, PickupType.HEALTH));
  assert.equal(scene.player.getHealth(), 70); assert.equal(scene.modifierManager.getModifierCount(), 0);
});
test('damage applies at spawn, including explicit base damage; existing bullets stay unchanged', () => {
  const p = new Player(0, 0), dir = new Vector2(1, 0);
  p.addModifier('damage', 1, 1, true); p.shoot(dir);
  const first = p.getBullets()[0]; assert.equal(first.getDamage(), 20);
  p.removeModifier('damage'); p.update(0.2, emptyInput); p.shoot(dir, 6);
  assert.equal(first.getDamage(), 20); assert.equal(p.getBullets()[1].getDamage(), 6);
});
test('pickup descriptions match their actual randomly selected multiplier', () => {
  for (const type of [PickupType.SPEED_BOOST, PickupType.FIRE_RATE_BOOST, PickupType.BULLET_SPEED_BOOST, PickupType.DAMAGE_BOOST]) {
    const effect = new PickupItem(0, 0, type).getModifierEffect();
    assert.ok(effect.description.includes(`${Math.round(effect.value * 100)}%`));
  }
});
test('configuration validates atomically and applies rotation and heat capacity', () => {
  const p = new Player(0, 0);
  p.applyConfig({ base: { rotationSpeed: 1, rotationStrategy: 'ccw' }, shooting: { maxShootingTime: 7 } });
  assert.equal(p.rotationSpeed, 1); assert.equal(p.rotationStrategy, 'ccw'); assert.equal(p.getHeatPercentage(), 0);
  for (const config of [null, [], { base: { size: 0 } }, { shooting: { fireRate: -1 } }, { base: { rotationStrategy: 'x' } }, { ui: { fadeSpeed: Infinity } }, { unknown: {} }]) assert.throws(() => parsePlayerConfig(config));
  assert.throws(() => p.applyConfig({ base: { maxSpeed: 700 }, shooting: { fireRate: 0 } }));
  assert.equal(p.getMaxSpeed(), 400);
});
test('movement facing takes the shortest wrap and respects forced rotation independently of aim', () => {
  const p = new Player(0, 0); const dir = new Vector2(-1, 0);
  p.velocity.set(-1, 0);
  p.currentRotation = 0.2; p.applyConfig({ base: { rotationSpeed: 1, rotationStrategy: 'auto' } });
  p.updateRotation(0.1, dir); assert.ok(Math.abs(p.currentRotation - 0.1) < 1e-8);
  p.currentRotation = 0.2; p.applyConfig({ base: { rotationStrategy: 'cw' } });
  p.updateRotation(0.1, dir); assert.ok(Math.abs(p.currentRotation - 0.3) < 1e-8);
  p.currentRotation = -0.2; p.applyConfig({ base: { rotationStrategy: 'ccw' } });
  p.updateRotation(0.1, dir); assert.ok(Math.abs(p.currentRotation + 0.3) < 1e-8);
});
test('non-square maps clamp both axes using tileSize', () => {
  const map = makeMap(4, 8), p = new Player(10000, 10000);
  p.update(0, emptyInput, map); assert.equal(p.x, 151); assert.equal(p.y, 351);
  p.x = -10; p.y = -10; p.update(0, emptyInput, map); assert.equal(p.x, 0); assert.equal(p.y, 0);
});
class EmptyScene extends Scene { update() {} draw() {} }
test('zero-duration transitions commit immediately, including redirects from onEnter', () => {
  const game = {}, manager = new SceneManager(game); game.sceneManager = manager;
  const first = new EmptyScene(), redirect = new EmptyScene(), last = new EmptyScene();
  redirect.onEnter = () => manager.changeScene(last, 0);
  manager.changeScene(first); manager.changeScene(redirect, 0); assert.equal(manager.getCurrentScene(), last);
});
test('repeated requests during a transition cannot restart its clock', () => {
  const manager = new SceneManager({}), first = new EmptyScene(), next = new EmptyScene();
  manager.changeScene(first); manager.changeScene(next, 0.5);
  for (let i = 0; i < 40; i++) { manager.changeScene(next, 0.5); manager.update(1 / 60, emptyInput); }
  assert.equal(manager.getCurrentScene(), next);
});
const listeners = new Set();
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
  addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn) };
test('holding Enter creates exactly one loading scene', () => {
  const menu = new MenuScene(); let requests = 0;
  menu._setGame({ sceneManager: { changeScene() { requests++; } } });
  for (let i = 0; i < 60; i++) menu.update(1 / 60, { isKeyDown: () => true });
  assert.equal(requests, 1);
});
test('loading scene reports real progress, displays errors and ignores completion after exit', async () => {
  let finish; let switches = 0;
  const target = new EmptyScene();
  const scene = new LoadingScene(report => { report(1, 2); return new Promise(resolve => { finish = resolve; }); }, target);
  scene._setGame({ sceneManager: { changeScene() { switches++; } } });
  const pending = scene.onEnter(); assert.equal(scene.progress, 0.5); scene.onExit(); finish(); await pending;
  assert.equal(switches, 0);
  const failed = new LoadingScene(async () => { throw new Error('missing image'); }, target);
  failed._setGame({ sceneManager: { changeScene() { switches++; } } }); await failed.onEnter();
  assert.equal(failed.error, 'missing image'); assert.equal(switches, 0);
});
test('failed images and failed configuration fetches reject instead of completing progress', async () => {
  globalThis.Image = class { set src(_value) { queueMicrotask(() => this.onerror()); } };
  let progress = 0;
  await assert.rejects(new AssetLoader({ player: '/missing.png' }).load(() => progress++), /图片加载失败/);
  assert.equal(progress, 0);
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try { await assert.rejects(new ConfigLoader({ missing: '/missing.json' }).load(), /404/); }
  finally { globalThis.fetch = original; ConfigLoader.clearCache(); }
});
test('game load is idempotent, completes real resources and preserves one resize listener', async t => {
  // The DOM overlay is exercised in debug.browser.mjs; this test owns scene lifecycle only.
  let panels = 0;
  const panelModule = load('ui/PlayerDebugPanel'), originalPanel = panelModule.PlayerDebugPanel;
  t.after(() => { panelModule.PlayerDebugPanel = originalPanel; });
  panelModule.PlayerDebugPanel = class {
    constructor() { panels++; }
    dispose() { panels--; }
  };
  const scene = new GameScene(); let assets = 0, configs = 0;
  scene.assetLoader = { async load(report) { assets++; report(1, 1); }, getImage() { return {}; } };
  scene.configLoader = { async load() { configs++; }, getConfig() { return {}; } };
  scene.initLightingSystem = () => {};
  scene._setGame({ renderer: { width: 1200, height: 800, ctx: { canvas: {} } }, input: { setPointerEnabled() {}, clear() {} } });
  const progress = [];
  await Promise.all([scene.load((a, b) => progress.push([a, b])), scene.load()]);
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]); assert.equal(assets, 1); assert.equal(configs, 1);
  await scene.onEnter(); assert.equal(listeners.size, 1); assert.equal(panels, 1);
  await scene.onEnter(); assert.equal(panels, 1);
  scene.onExit(); assert.equal(listeners.size, 0); assert.equal(panels, 0);
  await scene.onEnter(); assert.equal(listeners.size, 1); assert.equal(panels, 1);
  scene.onExit(); assert.equal(listeners.size, 0); assert.equal(panels, 0);
});

test('an unentered scene does not receive input during its transition', () => {
  const manager = new SceneManager({}), first = new EmptyScene(), next = new EmptyScene();
  let updates = 0; next.update = () => updates++;
  manager.changeScene(first); manager.changeScene(next, 1); manager.update(0.1, emptyInput);
  assert.equal(updates, 0); manager.update(1, emptyInput); assert.equal(updates, 1);
});
test('leaving a game during an outstanding load cannot install a resize listener later', async () => {
  const scene = new GameScene(); let finish;
  scene.load = () => new Promise(resolve => { finish = resolve; });
  scene._setGame({ renderer: { width: 1200, height: 800 } });
  scene.lightingSystem.initialize = () => { throw new Error('must not initialize an exited scene'); };
  const entering = scene.onEnter(); scene.onExit(); finish(); await entering;
  assert.equal(listeners.size, 0);
});

test('direct game entry also surfaces a load failure instead of leaving an unexplained blank screen', async () => {
  const scene = new GameScene();
  scene.load = async () => { throw new Error('invalid player config'); };
  await scene.onEnter();
  const text = [];
  scene.draw({ canvas: { width: 1200, height: 800 }, fillRect() {}, fillText(message) { text.push(message); } });
  assert.ok(text.some(message => message.includes('刷新页面')));
  assert.ok(text.includes('invalid player config'));
  scene.onExit();
});

test('fractional camera motion never leaves partially covered pixel borders between tiles', () => {
  const map = makeMap(6, 5);
  for (const [cameraX, cameraY] of [[0.35, 0.65], [37.25, 19.75], [-0.5, -0.5]]) {
    const calls = [];
    map.draw({ fillRect(...rect) { calls.push(rect); } }, cameraX, cameraY, 200, 160, 0);
    assert.ok(calls.length > 1);
    for (const rect of calls) assert.ok(rect.every(Number.isInteger));
    const rows = new Map();
    for (const rect of calls) {
      if (!rows.has(rect[1])) rows.set(rect[1], []);
      rows.get(rect[1]).push(rect);
    }
    for (const row of rows.values()) for (let i = 1; i < row.length; i++) {
      assert.equal(row[i - 1][0] + row[i - 1][2], row[i][0]);
    }
  }
});
test('shared pixel boundaries also hold for fractional tile sizes and a moving camera', () => {
  for (const camera of [0.35, -12.75, 19.5]) for (let col = 0; col < 6; col++) {
    const first = tileScreenRect({ x: col * 62.5, y: 0, width: 62.5, height: 62.5 }, camera, camera);
    const next = tileScreenRect({ x: (col + 1) * 62.5, y: 0, width: 62.5, height: 62.5 }, camera, camera);
    assert.equal(first.x + first.width, next.x);
    assert.ok(Object.values(first).every(Number.isInteger));
  }
});
test('terrain top clips merge touching wall and mineral tiles without including water', () => {
  const map = makeMap();
  map.tiles[4][8] = 'wall'; map.tiles[4][9] = 'mineral'; map.tiles[4][10] = 'water';
  map.tiles[5][9] = 'wall';
  assert.deepEqual(map.getBlockingRects(300, 150, 300, 200), [
    { x: 400, y: 200, width: 100, height: 50 }, { x: 450, y: 250, width: 50, height: 50 },
  ]);
  assert.deepEqual(map.getBlockingRects(0, 0, 20, 20), []);
  assert.deepEqual(map.getBlockingRects(0, 0, 0, 20), []);
  assert.deepEqual(map.getBlockingRects(499.8, 200.4, 0.1, 0.1), [{ x: 450, y: 200, width: 50, height: 50 }]);
  map.breakTile(9, 4);
  assert.deepEqual(map.getBlockingRects(300, 150, 300, 200), [
    { x: 400, y: 200, width: 50, height: 50 }, { x: 450, y: 250, width: 50, height: 50 },
  ]);
});

test('finite emitter size is optional, independent from range, and validated', () => {
  const hard = new LightSource(new Vector2(), 600, '#FFFFFF', 1);
  assert.equal(hard.getSourceRadius(), 0);
  hard.setSourceRadius(16); assert.equal(hard.getSourceRadius(), 16); assert.equal(hard.getRadius(), 600);
  assert.equal(new LightSource(new Vector2(), 600, '#FFFFFF', 1, 12).getSourceRadius(), 12);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => hard.setSourceRadius(invalid));
});
test('disc samples are deterministic opposite pairs with a stationary centroid', () => {
  for (const count of [4, 8]) {
    const samples = shadowSamples(16, count);
    assert.equal(samples.length, count); assert.deepEqual(samples, shadowSamples(16, count));
    for (let i = 0; i < count; i += 2) {
      assert.ok(Math.hypot(samples[i].x, samples[i].y) <= 16);
      assert.equal(samples[i].x + samples[i + 1].x, 0); assert.equal(samples[i].y + samples[i + 1].y, 0);
    }
  }
  assert.deepEqual(shadowSamples(0, 8), [{ x: 0, y: 0 }]);
});
test('light falloff is bounded, smooth at center and cutoff, and decreases with distance', () => {
  assert.equal(lightFalloff(0, 600), 1); assert.equal(lightFalloff(600, 600), 0);
  assert.equal(lightFalloff(100, 0), 0); assert.equal(lightFalloff(Infinity, 600), 0);
  let previous = 1;
  for (let d = 0; d <= 600; d++) {
    const value = lightFalloff(d, 600);
    assert.ok(value >= 0 && value <= previous); previous = value;
  }
  assert.ok(lightFalloff(0, 600) - lightFalloff(0.1, 600) < 1e-6);
  assert.ok(lightFalloff(599.9, 600) < 1e-6);
});

test('light sample containment uses points rather than one-pixel entity collision boxes', () => {
  const map = makeMap(); map.tiles[5][6] = 'wall'; map.tiles[5][7] = 'water';
  assert.equal(map.blocksLightAt(299.9, 275), false);
  assert.equal(map.blocksLightAt(300, 275), true);
  assert.equal(map.blocksLightAt(350, 275), false);
  assert.equal(map.blocksLightAt(-.01, 275), true);
});

test('terrain shadows project away from an off-map origin and end at the configured length', () => {
  const map = makeMap(); map.tiles[4][6] = 'wall';
  const polygons = map.getShadowEdges(325, 225, 100)
    .map(edge => projectShadow(edge, -1000, -600, 20, 20)).filter(Boolean);
  assert.ok(polygons.length > 2, 'rounded edges also project');
  for (const polygon of polygons) {
    assert.ok(Math.abs(Math.hypot(polygon[4] - polygon[2], polygon[5] - polygon[3]) - 20) < 1e-8);
    assert.ok(Math.abs(Math.hypot(polygon[6] - polygon[0], polygon[7] - polygon[1]) - 20) < 1e-8);
  }
  assert.ok(polygons.some(polygon => inside(polygon, 355, 235)));
  assert.ok(!polygons.some(polygon => inside(polygon, 380, 260)));
  assert.ok(!polygons.some(polygon => inside(polygon, 290, 210)));
});

test('terrain light is optional, validates atomically, and clears with the other lights', () => {
  const lighting = new LightingSystem();
  const light = { position: { x: -1000, y: -600 }, color: '#B4C8E0', intensity: .06, shadowLength: 20, softness: 2 };
  assert.equal(lighting.getLightCount(), 0);
  lighting.setTerrainLight(light);
  for (const invalid of [{ intensity: NaN }, { intensity: -1 }, { intensity: 1.1 }, { shadowLength: -1 },
    { softness: Infinity }, { position: { x: NaN, y: 0 } }, { color: 'invalid' }]) {
    assert.throws(() => lighting.setTerrainLight({ ...light, ...invalid }));
    assert.equal(lighting.getLightCount(), 1);
  }
  lighting.setTerrainLight(null); assert.equal(lighting.getLightCount(), 0);
  lighting.setTerrainLight({ ...light, shadowLength: 0, softness: 0 });
  lighting.addLightSource(new LightSource(new Vector2(100, 100)));
  assert.equal(lighting.getLightCount(), 2);
  lighting.clearAllLights(); assert.equal(lighting.getLightCount(), 0);
});
