import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { KillIndicator } = load('ui/KillIndicator');
const { GameScene } = load('scenes/GameScene');
const { TileMap } = load('map/TileMap');
const { Chicken } = load('objects/Chicken');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

function drawing() {
  const calls = [], stack = [];
  const ctx = {
    globalAlpha: 1,
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop(); },
    drawImage(image, x, y, width, height) { calls.push({ image, x, y, width, height, alpha: this.globalAlpha }); },
  };
  const indicator = new KillIndicator();
  indicator.image = { complete: true, naturalWidth: 256 };
  return { indicator, ctx, calls, draw: () => indicator.draw(ctx, 1200, 800) };
}

test('kill confirmation pops, holds, fades, restarts on another kill and clears', () => {
  const { indicator, ctx, calls, draw } = drawing();
  draw();
  assert.equal(calls.length, 0, 'hidden before a kill');
  indicator.show(); draw();
  const popSize = calls.at(-1).width;
  assert.equal(calls.at(-1).alpha, 1);
  assert.equal(calls.at(-1).x + popSize / 2, 600);
  assert.equal(calls.at(-1).y + popSize / 2, 504);
  indicator.update(0.2); draw();
  assert.ok(calls.at(-1).width < popSize);
  assert.equal(calls.at(-1).alpha, 1);
  for (const delta of [-1, NaN, Infinity]) indicator.update(delta);
  draw();
  assert.equal(calls.at(-1).alpha, 1, 'invalid deltas do not advance the animation');
  indicator.update(0.4); draw();
  assert.ok(calls.at(-1).alpha > 0 && calls.at(-1).alpha < 1);
  indicator.show(); draw();
  assert.equal(calls.at(-1).alpha, 1);
  assert.equal(calls.at(-1).width, popSize);
  indicator.update(1);
  const count = calls.length; draw();
  assert.equal(calls.length, count, 'expires after 0.8 seconds');
  indicator.show(); indicator.clear(); draw();
  assert.equal(calls.length, count, 'scene exit removes the indicator immediately');
  assert.equal(ctx.globalAlpha, 1, 'does not leak opacity into other HUD elements');
});

test('a loading or failed image is skipped safely', () => {
  const { indicator, calls, draw } = drawing();
  indicator.show();
  indicator.image.complete = false; draw();
  indicator.image.complete = true; indicator.image.naturalWidth = 0; draw();
  assert.equal(calls.length, 0);
});

test('only zombie lethal hits show a confirmation; chicken deaths never show a skull', () => {
  for (const kind of ['chicken', 'zombie']) {
    const map = new TileMap(20, 20, { generateWater: false, seed: 42 });
    map.tiles.forEach(row => row.fill('default'));
    const scene = new GameScene({ map, seed: 42, playerSpawn: { x: 400, y: 400 },
      encounters: { shambler: 0, runner: 0, vaccines: 0 } });
    scene.chickens = [];
    const target = kind === 'chicken' ? new Chicken(700, 500, () => 0.5)
      : scene.getEnemySystem().add('shambler', { x: 700, y: 500 });
    if (kind === 'chicken') scene.chickens = [target];
    let confirmations = 0;
    scene.killIndicator.show = () => { confirmations++; };
    const x = target.x + target.getSize() / 2, y = target.y + target.getSize() / 2;
    const hit = scene.findChickenHit(x - 80, y, x + 80, y, 2, 1);
    assert.ok(hit, kind);
    const impact = damage => ({ damage, point: { x, y }, direction: { x: 1, y: 0 },
      impulse: 0, impactSpeed: 300, initialSpeed: 300, traveledDistance: 100, source: 'bullet' });
    hit.apply(impact(0));
    if (kind === 'zombie') hit.apply(impact(1));
    assert.equal(confirmations, 0, `${kind}: non-lethal damage does not show the icon`);
    hit.apply(impact(1000));
    const expected = kind === 'zombie' ? 1 : 0;
    assert.equal(confirmations, expected, `${kind}: only a zombie lethal hit confirms immediately`);
    hit.apply(impact(1000));
    assert.equal(confirmations, expected, `${kind}: a repeated hit on a corpse does not replay`);
  }
});
