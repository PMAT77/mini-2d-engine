import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { Bullet } = load('objects/Bullet');
const { Input } = load('core/Input');
const { TileMap } = load('map/TileMap');
const { Vector2 } = load('math/Vector2');
const { DEFAULT_BALLISTICS, parsePlayerConfig } = load('objects/PlayerConfig');
const idle = { isKeyDown: () => false };
const keys = (...down) => ({ isKeyDown: key => down.includes(key) });
const noSpread = { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 };
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, a + ' != ' + b);
const center = bullet => { const p = bullet.getPosition(), r = bullet.getSize() / 2; return { x: p.x + r, y: p.y + r }; };
const makePlayer = () => { const p = new Player(200.5, 200.5); p.applyConfig({ shooting: noSpread }); return p; };
const map = () => { const m = new TileMap(64, 32, { generateWater: false }); m.tiles.forEach(row => row.fill('default')); return m; };
const aim = (x = 825, y = 225, fire = true, face = false) => ({ target: { x, y }, fire, face });

test('mouse fire is independent of body facing and arrow keys no longer shoot', () => {
  const p = makePlayer(), rotation = p.currentRotation;
  p.update(.1, keys('ArrowRight', 'ArrowUp'));
  assert.equal(p.getBullets().length, 0);
  p.update(0, idle, undefined, aim());
  assert.equal(p.getBullets().length, 1); near(p.currentRotation, rotation);
  near(p.getBullets()[0].velocity.x, 800); near(p.getBullets()[0].velocity.y, 0);
});

test('right button reuses turn speed and strategy, remains active while stationary, and release resumes movement facing', () => {
  for (const strategy of ['auto', 'cw', 'ccw']) {
    const p = makePlayer(); p.applyConfig({ base: { rotationSpeed: 1, rotationStrategy: strategy } });
    p.update(.1, idle, undefined, aim(825, 225, false, true));
    near(p.currentRotation, strategy === 'ccw' ? -.1 : .1);
    assert.equal(p.getBullets().length, 0); near(p.getHeatPercentage(), 0);
    const before = p.currentRotation; p.update(.1, idle); near(p.currentRotation, before);
  }
  const p = makePlayer();
  p.update(.5, keys('d'), undefined, aim(225, -500, false, true));
  assert.ok(p.x > 200.5); assert.ok(p.currentRotation > 0 && p.currentRotation < Math.PI);
  p.update(.5, keys('d')); near(Math.abs(p.currentRotation), Math.PI);
});

test('right-only aim permits heat recovery; center and invalid targets never emit a shot', () => {
  const p = makePlayer(); p.setDebugState({ heatPercentage: 50 });
  p.update(.2, idle, undefined, aim(500, 300, false, true));
  near(p.getHeatPercentage(), .4);
  const rotation = p.currentRotation;
  p.update(.1, idle, undefined, aim(225, 225, true, true)); near(p.currentRotation, rotation);
  for (const target of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 225, y: 225 }]) p.shootAt(target);
  assert.equal(p.getBullets().length, 0); near(p.getRecoilState().intensity, 0);
});

test('holding left fires at the configured interval, overheats, and resumes toward the latest target', () => {
  const p = makePlayer(); p.applyConfig({ shooting: { fireRate: .1, maxShootingTime: .2, maxOverheatCooldownTime: .1 } });
  p.update(0, idle, undefined, aim()); p.update(.1, idle, undefined, aim());
  assert.equal(p.getBullets().length, 2);
  p.update(.1, idle, undefined, aim()); assert.equal(p.getIsOverheated(), true);
  p.update(.1, idle, undefined, aim(225, 825));
  assert.equal(p.getIsOverheated(), false);
  near(p.getBullets().at(-1).velocity.x, 0); near(p.getBullets().at(-1).velocity.y, 800);
});

test('bullets freeze their world endpoint and finish exactly there for diagonal and near shots', () => {
  for (const target of [{ x: 235, y: 225 }, { x: 425, y: 375 }]) {
    const p = makePlayer(); p.shootAt(target); const bullet = p.getBullets()[0], expected = { ...target };
    target.x += 1000; target.y += 1000;
    p.applyConfig({ shooting: { maxRange: 20, bulletSpeed: 2000 } });
    bullet.update(10); near(center(bullet).x, expected.x); near(center(bullet).y, expected.y);
    assert.equal(bullet.getIsDestroyed(), true); bullet.update(10); near(center(bullet).x, expected.x);
  }
});

test('range is actual distance, independent of bullet speed, and clamps far diagonal targets', () => {
  for (const speed of [400, 800, 1600]) {
    const p = makePlayer(); p.applyConfig({ shooting: { maxRange: 300, bulletSpeed: speed } });
    p.shootAt({ x: 3225, y: 4225 }); const bullet = p.getBullets()[0];
    const start = center(bullet);
    bullet.update(20); near(center(bullet).x, start.x + 180); near(center(bullet).y, start.y + 240);
    assert.equal(bullet.getIsDestroyed(), true);
  }
});

test('sweeps hit the first wall or mineral and cannot damage terrain beyond an endpoint or range', () => {
  for (const seconds of [.1, .5, 10]) {
    const m = map(), p = makePlayer(); m.tiles[4][6] = 'wall'; m.tiles[4][8] = 'mineral'; m.tileHp[4][8] = 100;
    p.applyConfig({ shooting: { bulletSpeed: 10000 } }); p.shootAt({ x: 900, y: 225 });
    const bullet = p.getBullets()[0]; bullet.update(seconds, m);
    assert.equal(bullet.getIsDestroyed(), true); near(center(bullet).x, 295); assert.equal(m.tileHp[4][8], 100);
  }
  for (const [targetX, range, shouldHit] of [[289, 1000, false], [295, 1000, true], [900, 30, false], [900, 32, true]]) {
    const m = map(), p = makePlayer(); m.tiles[4][6] = 'mineral'; m.tileHp[4][6] = 100;
    p.applyConfig({ shooting: { maxRange: range } }); p.shootAt({ x: targetX, y: 225 });
    const bullet = p.getBullets()[0], start = center(bullet); bullet.update(10, m);
    assert.equal(m.tileHp[4][6], shouldHit ? 90 : 100);
    near(center(bullet).x, shouldHit ? 295 : Math.min(targetX, start.x + range));
  }
});

test('range expires precisely during water drag and never damages terrain beyond the stopping point', () => {
  const m = map(); m.tiles.forEach(row => row.fill('shallow_water'));
  const particles = [], b = new Bullet(new Vector2(225, 225), new Vector2(800, 0), 100,
    { createExplosion: (...args) => particles.push(args) }, true, undefined, 100);
  m.tiles[4][7] = 'mineral'; m.tileHp[4][7] = 100;
  b.update(3, m); near(center(b).x, 325); assert.equal(b.getIsDestroyed(), true);
  assert.equal(particles.length, 1); assert.equal(m.tileHp[4][7], 100);
  const stopped = new Bullet(new Vector2(225, 225), new Vector2(800, 0), 10, undefined, true, undefined, 1000);
  m.tiles.forEach(row => row.fill('ultra_deep_water')); stopped.update(1, m);
  near(center(stopped).x, 350); assert.equal(stopped.getIsDestroyed(), true);
});

test('two-axis spread is symmetric, scales with distance, and changes only on successful fire', t => {
  let random = [1, 0]; t.mock.method(Math, 'random', () => random.shift() ?? .5);
  const p = new Player(200.5, 200.5); p.shootAt({ x: 725, y: 225 });
  const b = p.getBullets()[0]; b.update(10);
  near(center(b).x, 725 + 500 * Math.tan(.6 * Math.PI / 180));
  near(center(b).y, 225 - 500 * Math.tan(.4 * Math.PI / 180));
  near(p.getRecoilState().intensity, .18); p.shootAt({ x: 725, y: 225 }); near(p.getRecoilState().intensity, .18);
  random = [0, 1]; const q = new Player(200.5, 200.5); q.shootAt({ x: 475, y: 225 }); const c = q.getBullets()[0]; c.update(10);
  near(center(c).x, 475 - 250 * Math.tan(.6 * Math.PI / 180));
  near(center(c).y, 225 + 250 * Math.tan(.4 * Math.PI / 180));
});

test('continuous fire saturates spread, overheat does not add recoil, and recovery has an exact delay', () => {
  const p = makePlayer();
  for (let i = 0; i < 7; i++) { p.update(i ? .2 : 0, idle); p.shootAt({ x: 825, y: 225 }); }
  near(p.getRecoilState().intensity, 1); p.setDebugState({ heatPercentage: 100 }); p.shootAt({ x: 825, y: 225 });
  near(p.getRecoilState().intensity, 1); p.update(.25, idle); near(p.getRecoilState().intensity, 1);
  p.update(.4, idle); near(p.getRecoilState().intensity, .5); p.update(.4, idle); near(p.getRecoilState().intensity, 0);
});

test('30/60/144 FPS preserve turning, movement, shot count and recoil recovery', () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const p = makePlayer(); p.applyConfig({ base: { rotationSpeed: 1 } }); let shots = 0;
    p.setOnShootCallback(() => shots++); p.update(0, idle, undefined, aim(225, 825, true, true));
    for (let i = 0; i < fps; i++) p.update(1 / fps, keys('d'), undefined, aim(225, 825, true, true));
    const rotation = p.currentRotation, x = p.x;
    for (let i = 0; i < fps * 2; i++) p.update(1 / fps, idle);
    results.push({ shots, rotation, x, recoil: p.getRecoilState().intensity });
  }
  for (const result of results) { assert.equal(result.shots, 6); near(result.rotation, results[0].rotation, .003); assert.ok(result.rotation < -.9); near(result.recoil, 0); near(result.x, results[0].x, .05); }
});

test('ballistic defaults match shipped JSON; partial edits validate atomically and old fields remain inert', () => {
  const config = JSON.parse(readFileSync('public/configs/playerConfig.json', 'utf8')), p = new Player(0, 0);
  for (const [key, value] of Object.entries(DEFAULT_BALLISTICS)) { near(config.shooting[key], value); near(p.getConfigSnapshot().shooting[key], value); }
  const before = p.getConfigSnapshot();
  for (const shooting of [{ maxRange: 0 }, { maxRange: NaN }, { spreadHorizontal: 4 }, { spreadVertical: -1 }, { maxSpreadHorizontal: 45 }, { recoilPerShot: 2 }, { recoilRecoveryDuration: 0 }]) {
    assert.throws(() => p.applyConfig({ base: { maxSpeed: 999 }, shooting })); assert.deepEqual(p.getConfigSnapshot(), before);
  }
  p.applyConfig({ shooting: { aimTurnDuration: 0, aimContinuityWindow: .18 } }); assert.deepEqual(p.getConfigSnapshot(), before);
  assert.throws(() => parsePlayerConfig({ shooting: { aimTurnDuration: -1 } }));
  assert.throws(() => parsePlayerConfig({ shooting: { spreadHorizontal: 2, maxSpreadHorizontal: 1 } }));
  const snapshot = p.getConfigSnapshot(); snapshot.shooting.maxRange = 99; near(p.getConfigSnapshot().shooting.maxRange, 1000);
});

test('pointer click edges survive release between frames and clear on ownership, leave, cancel, blur and visibility', t => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  t.after(() => { globalThis.window = originalWindow; globalThis.document = originalDocument; });
  const listeners = {}, docListeners = {}, canvasListeners = {};
  globalThis.window = { addEventListener: (type, callback) => listeners[type] = callback };
  globalThis.document = { hidden: false, addEventListener: (type, callback) => docListeners[type] = callback };
  const canvas = { style: { cursor: 'crosshair' }, addEventListener: (type, callback) => canvasListeners[type] = callback };
  const input = new Input(canvas), event = { pointerType: 'mouse', button: 0, buttons: 1, clientX: 321, clientY: 123 };
  canvasListeners.mousedown(event); assert.equal(input.getPointerState().active, false);
  input.setPointerEnabled(true); canvasListeners.mousedown(event); listeners.mouseup(event);
  const click = input.consumePointerState(); assert.equal(click.leftDown, false); assert.equal(click.leftPressed, true);
  assert.equal(input.consumePointerState().leftPressed, false); assert.equal(canvas.style.cursor, 'none');
  for (const clear of [() => input.setBlocked(true), () => canvasListeners.pointerleave(), () => listeners.pointercancel(), () => listeners.blur(), () => { document.hidden = true; docListeners.visibilitychange(); document.hidden = false; }, () => input.setPointerEnabled(false)]) {
    input.setBlocked(false); input.setPointerEnabled(true); canvasListeners.mousedown(event); canvasListeners.mousedown({ ...event, button: 2, buttons: 3 });
    clear(); const state = input.consumePointerState(); assert.equal(state.active, false); assert.equal(state.leftDown || state.rightDown || state.leftPressed, false); assert.equal(canvas.style.cursor, 'crosshair');
  }
  input.setPointerEnabled(true); canvasListeners.pointermove({ ...event, buttons: 3 });
  assert.equal(input.getPointerState().leftDown || input.getPointerState().rightDown, false);
  let prevented = false; canvasListeners.contextmenu({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  input.setPointerEnabled(false); prevented = false; canvasListeners.contextmenu({ preventDefault() { prevented = true; } }); assert.equal(prevented, false);
});
