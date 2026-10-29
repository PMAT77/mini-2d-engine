import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { Player } = load('objects/Player');
const { Input } = load('core/Input');
const { TileMap } = load('map/TileMap');
const { DEFAULT_AIM, parsePlayerConfig } = load('objects/PlayerConfig');
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const angleNear = (a, b) => near(Math.atan2(Math.sin(a - b), Math.cos(a - b)), 0);
const poll = (...keys) => ({ isKeyDown: k => keys.includes(k) });
function timeline(player = new Player(200, 200)) {
  player.applyConfig({ shooting: { aimTurnDuration: 0.04 } });
  let x = 0, y = 0, changes = [], now = 0, previous = 0;
  const input = {
    isKeyDown: key => ({ ArrowRight: x > 0, ArrowLeft: x < 0, ArrowDown: y > 0, ArrowUp: y < 0 })[key] ?? false,
    consumeAimChanges() { const result = { changes, now, reset: false }; changes = []; return result; },
  };
  return { player,
    change(time, nextX, nextY) { x = nextX; y = nextY; changes.push({ time, x, y }); },
    tick(time) { now = time; player.update(time - previous, input); previous = time; return player.getAimState(); },
  };
}

test('first input and discontinuous changes snap; release, cancellation and re-press reset the chain', () => {
  const p = new Player(100, 100);
  const body = p.getBodyRotation();
  p.applyConfig({ base: { rotationSpeed: 0.01, rotationStrategy: 'ccw' } });
  p.update(0, poll('ArrowRight')); assert.equal(p.getAimState().visible, true); near(p.getAimState().angle, 0);
  angleNear(p.getBodyRotation(), body);
  p.update(0.01, poll('ArrowLeft')); angleNear(p.getAimState().angle, Math.PI);
  angleNear(p.getBodyRotation(), body);
  p.update(0.01, poll('ArrowLeft', 'ArrowRight')); assert.equal(p.getAimState().visible, false);
  p.update(0.01, poll('ArrowUp', 'ArrowRight')); angleNear(p.getAimState().angle, -Math.PI / 4);
  p.update(0.01, poll()); assert.equal(p.getAimState().visible, false);
  p.update(0, poll('ArrowRight')); near(p.getAimState().angle, 0);
  const bullets = p.getBullets().length;
  p.update(0.3, poll()); assert.equal(p.getBullets().length, bullets);
});

test('clockwise and counterclockwise sweeps cross both angle seams without an extra lap', () => {
  for (const sign of [1, -1]) {
    const t = timeline(); t.change(0, 1, 0); t.tick(0);
    const body = t.player.getBodyRotation();
    for (let i = 1; i <= 16; i++) {
      const target = sign * i * Math.PI / 4, start = i * 0.1;
      t.change(start, Math.round(Math.cos(target)), Math.round(Math.sin(target)));
      const half = t.tick(start + 0.02);
      angleNear(half.angle, target - sign * Math.PI / 8);
      angleNear(t.player.getBodyRotation(), body);
      angleNear(t.tick(start + 0.04).angle, target);
    }
  }
});

test('adjacent changes slide even after a long hold, in either direction and across the angle seam', () => {
  for (const gap of [0.18, 0.180001, 0.5, 5]) {
    const t = timeline(); t.change(0, 1, 0); t.tick(0); t.tick(0.17);
    t.change(gap, 1, 1); angleNear(t.tick(gap + 0.02).angle, Math.PI / 8);
    angleNear(t.tick(gap + 0.04).angle, Math.PI / 4);
    t.change(gap + 1, 1, 0); angleNear(t.tick(gap + 1.02).angle, Math.PI / 8);
    const wrap = timeline(); wrap.change(0, -1, 0); wrap.tick(0);
    wrap.change(gap, -1, -1); angleNear(wrap.tick(gap + 0.02).angle, -7 * Math.PI / 8);
  }
});

test('retargeting and reversal start from the current pointer, never wait for the previous segment', () => {
  const t = timeline(); t.change(0, 1, 0); t.tick(0);
  t.change(0.05, 1, 1); const first = t.tick(0.06); angleNear(first.angle, Math.PI / 16);
  t.change(0.06, 0, 1); const second = t.tick(0.07);
  assert.ok(second.angle > first.angle && second.angle < Math.PI / 2);
  t.change(0.07, 1, 1); t.tick(0.08);
  t.change(0.08, 1, 0); const reversed = t.tick(0.09);
  assert.ok(reversed.angle < second.angle, 'reversal responds before an older target is reached');
  near(t.tick(0.12).angle, 0);
  angleNear(t.tick(0.5).angle, 0);
});

test('same-frame intermediate directions survive; interruption in that frame still snaps', () => {
  const t = timeline(); t.change(0, 1, 0); t.tick(0);
  t.change(0.01, 1, 1); t.change(0.02, 0, 1);
  const current = t.tick(0.03);
  assert.ok(current.angle > 0 && current.angle < Math.PI / 2);
  angleNear(current.targetAngle, Math.PI / 2);
  angleNear(t.tick(0.06).angle, Math.PI / 2);
  t.change(0.07, 0, 0); t.change(0.071, -1, 1);
  angleNear(t.tick(0.08).angle, 3 * Math.PI / 4);
});

test('30/60/144 FPS respond on the first frame and settle within 40ms plus one frame', () => {
  for (const fps of [30, 60, 144]) {
    const t = timeline(); t.change(0, 1, 0); t.tick(0);
    t.change(0.1, 1, 1);
    const first = t.tick(0.1 + 1 / fps);
    assert.ok(first.angle > 0 && first.angle < Math.PI / 4);
    angleNear(first.angle, Math.PI / 4 * (1 / fps) / 0.04);
    let elapsed = 1 / fps;
    while (elapsed < 0.04) { elapsed += 1 / fps; t.tick(0.1 + elapsed); }
    angleNear(t.player.getAimState().angle, Math.PI / 4);
    assert.ok(elapsed <= 0.04 + 1 / fps);
  }
});

test('event input ignores repeat, bounds its records and resets after blur and hidden page', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const win = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  globalThis.window = win; globalThis.document = doc;
  let time = 0;
  const clock = mock.method(performance, 'now', () => time * 1000);
  const emit = (type, code, at) => {
    time = at; const event = new Event(type, { cancelable: true }); Object.assign(event, { code }); win.dispatchEvent(event);
  };
  try {
    const input = new Input(), p = new Player(200, 200);
    p.applyConfig({ shooting: { aimTurnDuration: 0.04 } });
    emit('keydown', 'ArrowRight', 0); p.update(0, input);
    emit('keydown', 'ArrowRight', 0.17);
    emit('keydown', 'ArrowDown', 0.181); p.update(0.181, input);
    near(p.getAimState().angle, 0);
    time = 0.201; p.update(0.02, input); angleNear(p.getAimState().angle, Math.PI / 8);
    assert.equal(input.consumeAimChanges().changes.length, 0);
    for (let i = 0; i < 40; i++) emit(i % 2 ? 'keydown' : 'keyup', 'ArrowDown', 0.19 + i / 1000);
    const overflow = input.consumeAimChanges();
    assert.equal(overflow.reset, true); assert.equal(overflow.changes.length, 1);
    // Exercise overflow through Player as well, ending at an adjacent direction.
    for (let i = 0; i < 40; i++) emit(i % 2 ? 'keydown' : 'keyup', 'ArrowDown', 0.24 + i / 1000);
    emit('keyup', 'ArrowDown', 0.28); p.update(0.099, input); near(p.getAimState().angle, 0);
    win.dispatchEvent(new Event('blur')); p.update(0, input); assert.equal(p.getAimState().visible, false);
    emit('keydown', 'ArrowDown', 0.29); p.update(0.01, input); angleNear(p.getAimState().angle, Math.PI / 2);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); p.update(0, input);
    assert.equal(p.getAimState().visible, false); assert.ok(input.isKeyUp('ArrowDown'));
  } finally {
    clock.mock.restore(); globalThis.window = oldWindow; globalThis.document = oldDocument;
  }
});

test('default-rate mid-turn shots follow the pointer independently of the stationary body', () => {
  const p = new Player(100, 150), t = timeline(p), shots = [];
  const body = p.getBodyRotation();
  near(p.getFireRate(), 0.2);
  p.addModifier('damage', 1, 1, true); p.addModifier('bulletSpeed', 0.5, 1, true);
  p.setOnShootCallback(direction => {
    const b = p.getBullets().at(-1), pos = b.getPosition();
    near(pos.x + b.getSize() / 2, p.x + p.getSize() / 2);
    near(pos.y + b.getSize() / 2, p.y + p.getSize() / 2);
    angleNear(Math.atan2(direction.y, direction.x), p.getAimState().angle);
    angleNear(p.getBodyRotation(), body);
    shots.push(b);
  });
  t.change(0, 1, 0); t.tick(0);
  t.change(0.18, 1, 1); t.tick(0.18); t.tick(0.2);
  assert.equal(shots.length, 2, 'normal 200ms cadence fires without extra transition bullets');
  const shot = shots.at(-1); angleNear(Math.atan2(shot.velocity.y, shot.velocity.x), Math.PI / 8);
  near(shot.velocity.length(), 1200); assert.equal(shot.getDamage(), 20);
  const oldVelocity = shot.velocity.clone();
  t.change(0.21, -1, 0); t.tick(0.22);
  assert.equal(shots.length, 2);
  near(shot.velocity.x, oldVelocity.x); near(shot.velocity.y, oldVelocity.y);
});

test('default-rate bullets cover intermediate angles in all eight sectors in both sweep directions', () => {
  for (const sign of [1, -1]) for (let sector = 0; sector < 8; sector++) {
    const t = timeline(), start = sector * Math.PI / 4, target = start + sign * Math.PI / 4;
    t.change(0, Math.round(Math.cos(start)), Math.round(Math.sin(start))); t.tick(0);
    t.change(0.18, Math.round(Math.cos(target)), Math.round(Math.sin(target))); t.tick(0.18);
    t.tick(0.2);
    const bullets = t.player.getBullets(); assert.equal(bullets.length, 2);
    const bullet = bullets[1];
    angleNear(Math.atan2(bullet.velocity.y, bullet.velocity.x), start + sign * Math.PI / 8);
    assert.ok(Math.abs(Math.sin(Math.atan2(bullet.velocity.y, bullet.velocity.x) * 4)) > 0.99,
      'the actual velocity is between the eight input directions');
  }
});

test('movement, reversal, stopping and simultaneous sweeping keep body facing independent at 30/60/144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    const p = new Player(200, 200);
    p.applyConfig({ shooting: { aimTurnDuration: 0.04 } });
    const advance = (seconds, ...keys) => {
      for (let left = seconds; left > 1e-9;) {
        const delta = Math.min(left, 1 / fps); p.update(delta, poll(...keys)); left -= delta;
      }
    };
    advance(0.4, 'w', 'ArrowRight');
    angleNear(p.getBodyRotation(), 0); near(p.getAimState().angle, 0);
    advance(0.4, 's', 'ArrowRight');
    angleNear(p.getBodyRotation(), Math.PI); near(p.getAimState().angle, 0);
    advance(0.25, 'ArrowRight');
    const stoppedBody = p.getBodyRotation(); near(p.getVelocity().length(), 0);
    advance(0.02, 'ArrowRight', 'ArrowDown');
    angleNear(p.getBodyRotation(), stoppedBody); angleNear(p.getAimState().angle, Math.PI / 8);
    const before = { x: p.x, y: p.y };
    advance(0.4, 'a', 'ArrowDown');
    assert.ok(p.x < before.x); near(p.y, before.y);
    angleNear(p.getBodyRotation(), -Math.PI / 2); angleNear(p.getAimState().angle, Math.PI / 2);
    const aim = p.getAimState();
    near(aim.x, p.x + p.getSize() / 2); near(aim.y, p.y + p.getSize() / 2 + aim.radius);
    advance(0.02, 'a', 'ArrowDown', 'ArrowLeft');
    angleNear(p.getBodyRotation(), -Math.PI / 2); angleNear(p.getAimState().angle, 5 * Math.PI / 8);
  }
});

test('nearby terrain is hit from the center; overheating keeps aim and resumes in the latest direction', () => {
  const map = new TileMap(20, 12, { generateWater: false }); map.tiles.forEach(row => row.fill('default'));
  map.tiles[4][5] = 'mineral'; map.tileHp[4][5] = 100;
  const p = new Player(200, 200); p.update(0.05, poll('ArrowRight'), map);
  assert.equal(map.tileHp[4][5], 90); assert.equal(p.getBullets().length, 0);
  const q = new Player(200, 200), t = timeline(q);
  q.applyConfig({ shooting: { fireRate: 0.02, maxShootingTime: 0.02, maxOverheatCooldownTime: 0.1 } });
  t.change(0, 1, 0); t.tick(0); t.tick(0.02); assert.equal(q.getIsOverheated(), true);
  t.change(0.03, 1, 1); const mid = t.tick(0.05);
  assert.ok(mid.angle > 0 && mid.angle < Math.PI / 4); assert.equal(q.getIsOverheated(), true);
  t.change(0.06, -1, 0); t.tick(0.08); angleNear(q.getAimState().angle, Math.PI);
  t.tick(0.13); assert.equal(q.getIsOverheated(), false);
  assert.ok(q.getBullets().at(-1).velocity.x < 0);
});

test('configuration is atomic, old files use defaults, and zero duration disables sliding', () => {
  const p = new Player(200, 200);
  assert.deepEqual(p.aim, DEFAULT_AIM);
  const config = parsePlayerConfig(JSON.parse(readFileSync('public/configs/playerConfig.json', 'utf8')));
  assert.equal(config.shooting.aimTurnDuration, 0.15);
  assert.equal(p.getConfigSnapshot().shooting.aimTurnDuration, 0.15);
  p.update(0, poll('ArrowRight'));
  p.update(0.075, poll('ArrowRight', 'ArrowDown'));
  angleNear(p.getAimState().angle, Math.PI / 8);
  p.update(0.075, poll('ArrowRight', 'ArrowDown'));
  angleNear(p.getAimState().angle, Math.PI / 4);
  p.applyConfig({ shooting: { aimContinuityWindow: 0.18 } }); // Old files still load.
  for (const shooting of [{ aimTurnDuration: -1 }, { aimTurnDuration: Infinity }, { aimContinuityWindow: 0 }, { aimContinuityWindow: NaN }]) {
    assert.throws(() => p.applyConfig({ base: { maxSpeed: 999 }, shooting }));
    assert.equal(p.getMaxSpeed(), 400);
  }
  p.applyConfig({ shooting: { aimTurnDuration: 0 } });
  p.update(0.01, poll('ArrowRight')); p.update(0.01, poll('ArrowRight', 'ArrowDown'));
  angleNear(p.getAimState().angle, Math.PI / 4);
});

test('orbit is independent of collider/breathing, and both overlays clear its entire pointer envelope', () => {
  for (const size of [30, 49, 100]) {
    const p = new Player(100, 120); p.setSize(size); p.update(0, poll('ArrowDown'));
    const aim = p.getAimState(), center = { x: p.x + size / 2, y: p.y + size / 2 };
    near(Math.hypot(aim.x - center.x, aim.y - center.y), size / Math.SQRT2 + 8);
    const layout = p.getOverlayLayout(), envelope = aim.radius + Math.hypot(5, 4) + 0.75;
    assert.ok(layout.healthY - 1 - center.y - envelope >= 6);
    assert.ok(Math.hypot(layout.heatX - center.x, layout.heatY - center.y) - 12.5 - envelope >= 6);
    const body = p.getCollider(); near(body.radius, size / 2);
    p.setIdleTime(1); p.applyConfig({ animation: { breathingAmplitude: 50 } });
    near(p.getAimState().radius, aim.radius); near(p.getCollider().radius, body.radius);
  }
});
