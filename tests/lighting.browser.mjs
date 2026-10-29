import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Reuse an installed browser harness; no browser dependency is added to the game.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
let cases = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/lighting-fixture.html`);
    await page.waitForFunction(() => !!window.fixture);
    for (const offset of [[0, 0], [0.35, 0.65], [37.25, 19.75], [-0.5, -0.5]]) {
      const pixels = await page.evaluate(([ox, oy]) => {
        const f = window.fixture, scale = devicePixelRatio;
        f.setup('secondary'); f.offset(ox, oy);
        const sample = (x, y) => [...f.lighting.shadowCtx.getImageData(Math.round((x - ox) * scale), Math.round((y - oy) * scale), 1, 1).data];
        const actual = [sample(625, 275), sample(675, 275), sample(650, 275)];
        const floor = sample(550, 275);
        f.lighting.prepareLightingMask(ox * scale, oy * scale);
        const expected = [sample(625, 275), sample(675, 275), sample(650, 275)];
        f.render();
        f.map.damageTile(13, 5, 100); f.render();
        const destroyedTop = sample(675, 275);
        f.setup('wall'); f.fillLight(true);
        const combined = sample(475 + ox, 275 + oy);
        f.lighting.prepareLightingMask(0, 0);
        const combinedExpected = sample(475 + ox, 275 + oy);
        // A uniform solid map must not expose its dark background at tile joins.
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 500;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 500, 500);
        f.map.tiles.forEach(row => row.fill('wall'));
        f.map.draw(ctx, ox * scale, oy * scale, 500, 500, 0);
        const boundary = Math.round(f.map.tileSize - ox * scale);
        const row = Math.round(75 * scale - oy * scale);
        const seam = [...ctx.getImageData(boundary - 1, row, 2, 1).data];
        return { actual, expected, floor, destroyedTop, combined, combinedExpected, seam };
      }, offset);
      assert.equal(JSON.stringify(pixels.actual), JSON.stringify(pixels.expected), `terrain tops: DPR ${dpr}, camera ${offset}`);
      assert.ok(pixels.actual[0][0] > pixels.floor[0] + 40, 'ground remains shadowed');
      assert.ok(pixels.destroyedTop[0] < pixels.actual[1][0] - 40, 'destroyed mineral becomes a shadow-receiving floor');
      assert.equal(JSON.stringify(pixels.combined), JSON.stringify(pixels.combinedExpected), 'multiple lights preserve terrain surfaces');
      assert.equal(JSON.stringify(pixels.seam), JSON.stringify([85, 85, 85, 255, 85, 85, 85, 255]), 'adjacent tiles have no pixel gap');
      cases++;
    }
    await page.evaluate(() => window.fixture.setup('mineral'));
    const before = await page.evaluate(() => window.fixture.pixel(650, 275)[0]);
    await page.evaluate(() => window.fixture.destroy());
    const after = await page.evaluate(() => window.fixture.pixel(650, 275)[0]);
    assert.ok(after > before + 30, 'destroying the occluder immediately restores light');
    const soft = await page.evaluate(() => {
      const f = window.fixture, scale = devicePixelRatio;
      f.setup('single'); f.setShadow('soft', 16);
      const ctx = f.lighting.shadowCtx;
      const pixel = (x, y) => ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[0];
      const scan = x => {
        const actual = Array.from({ length: 125 }, (_, i) => pixel(x, 150 + i));
        f.lighting.prepareLightingMask(0, 0);
        const lit = Array.from({ length: 125 }, (_, i) => pixel(x, 150 + i));
        f.render();
        return actual.map((value, i) => (value - 58) / Math.max(1, lit[i] - 58)).filter(value => value > .1 && value < .9).length;
      };
      const near = scan(520), far = scan(750);
      const original = [...ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data];
      const cache = f.lighting.shadowCaches.get(f.light), builds = cache.builds;
      for (let i = 0; i < 100; i++) f.render();
      const repeated = [...ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data];
      const stable = original.every((value, i) => value === repeated[i]);
      f.light.setColor('#FFEEDD'); f.light.setIntensity(.9); f.lighting.setAmbientLight('#404955'); f.render();
      const colorBuilds = cache.builds;
      f.light.setColor('#FFF4E8'); f.light.setIntensity(1); f.lighting.setAmbientLight('#3A4450');
      f.offset(.35, .65); const cameraBuilds = cache.builds; f.offset(0, 0);
      f.move(301, 275); const moveBuilds = cache.builds;
      f.move(300, 275); f.light.setSourceRadius(20 * scale); f.render(); const sizeBuilds = cache.builds;
      f.light.setSourceRadius(16 * scale); f.render();
      f.map.tiles[5][8] = 'wall'; f.render(); const mapBuilds = cache.builds;
      f.setup('single'); f.setShadow('hard'); const hard = scan(750);
      f.setShadow('soft', 16);
      const beforeDuplicate = pixel(750, 210);
      const edges = f.map.getShadowEdges.bind(f.map);
      f.map.getShadowEdges = (...args) => { const list = edges(...args); return [...list, ...list]; };
      f.render(); const afterDuplicate = pixel(750, 210); f.map.getShadowEdges = edges;
      // Half of an emitter embedded in a wall loses half its direct energy, without renormalization.
      f.setup('empty'); f.move(299.9, 275);
      const open = pixel(50, 275); // Use unsaturated lighting to measure the energy ratio.
      f.map.tiles[5][6] = 'wall'; f.render(); const partlyBlocked = pixel(50, 275);
      f.move(300.1, 275); const centerInside = pixel(50, 275);
      f.setShadow('hard'); const embeddedHard = pixel(50, 275); f.setShadow('soft', 16);
      f.setup('single');
      const full = edges(300 * scale, 275 * scale, 616 * scale);
      const quality = [];
      for (const count of [300, 220, 190]) {
        f.map.getShadowEdges = () => Array.from({ length: count }, (_, i) => full[i % full.length]);
        f.render(); quality.push(f.lighting.shadowCaches.get(f.light).samples);
      }
      f.map.getShadowEdges = edges;
      return { near, far, hard, stable, builds, colorBuilds, cameraBuilds, moveBuilds, sizeBuilds, mapBuilds,
        beforeDuplicate, afterDuplicate, blockedRatio: (partlyBlocked - 58) / (open - 58),
        insideRatio: (centerInside - 58) / (open - 58), embeddedHard, quality };
    });
    assert.ok(soft.near > 2 && soft.far > soft.near * 1.5, `growing penumbra: ${JSON.stringify(soft)}`);
    assert.ok(soft.hard <= 2, 'zero emitter size retains a hard edge');
    assert.ok(soft.stable, '100 stationary redraws are identical');
    assert.equal(soft.colorBuilds, soft.builds, 'color/ambient changes reuse shadow cache');
    assert.equal(soft.cameraBuilds, soft.builds, 'camera changes reuse world-space shadow cache');
    assert.ok(soft.moveBuilds > soft.builds && soft.sizeBuilds > soft.moveBuilds && soft.mapBuilds > soft.sizeBuilds, 'geometry and emitter changes invalidate the cache');
    assert.ok(Math.abs(soft.beforeDuplicate - soft.afterDuplicate) <= 1, 'overlapping blockers are a union, not extra darkness');
    assert.ok(Math.abs(soft.blockedRatio - .5) < .06, 'blocked samples retain their original weight');
    assert.ok(Math.abs(soft.insideRatio - .5) < .06, 'an embedded emitter center does not discard its exterior samples');
    assert.equal(soft.embeddedHard, 58, 'a fully embedded point light contributes no direct light');
    assert.equal(JSON.stringify(soft.quality), '[4,4,8]', 'sample budget has hysteresis');
    console.log(`DPR ${dpr}: penumbra ${soft.near}px near / ${soft.far}px far; hard ${soft.hard}px; cache and stability passed.`);
    assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  }
  console.log(`Browser lighting regression: ${cases} DPR/camera cases passed, plus destruction and multiple-light checks.`);
} finally {
  await browser.close();
}
