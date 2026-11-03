import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review/dynamic-wall', { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 830 }, deviceScaleFactor: dpr }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5187') + '/tests/dynamic-wall-fixture.html');
    await page.waitForFunction(() => window.fixture);
    const closed = await page.evaluate(() => ({ ...fixture.state(), path: fixture.route().path.length, shade: fixture.pixel(650, 300)[0] }));
    assert.equal(closed.hp, 30); assert.ok(closed.path > 2);
    await page.locator('#move').click();
    const stopped = await page.evaluate(() => fixture.state());
    assert.ok(stopped.player < 450 && stopped.enemy > 490, 'actual actor solver respects the wall');
    await page.locator('#reset').click();
    await page.screenshot({ path: `.review/dynamic-wall/closed-dpr-${dpr}.png` });
    await page.locator('#shoot').click(); await page.locator('#shoot').click();
    assert.equal((await page.evaluate(() => fixture.state())).hp, 10);
    await page.locator('#shoot').click();
    const opened = await page.evaluate(() => ({ ...fixture.state(), path: fixture.route().path.length, shade: fixture.pixel(650, 300)[0] }));
    assert.equal(opened.hp, 0); assert.equal(opened.hits, 3); assert.equal(opened.path, 2);
    assert.ok(opened.shade > closed.shade + 10, JSON.stringify({ closed, opened }));
    await page.locator('#shoot').click(); assert.equal((await page.evaluate(() => fixture.state())).hits, 3);
    await page.screenshot({ path: `.review/dynamic-wall/open-dpr-${dpr}.png` });
    const probes = await page.evaluate(() => {
      const f = fixture;
      f.light.setActive(false); f.remove(); const terrainOpen = f.pixel(500, 350)[0];
      f.build(); const terrainClosed = f.pixel(500, 350)[0];
      f.remove(); const terrainRestored = f.pixel(500, 350)[0];
      f.light.setSourceRadius(20); f.light.setActive(true); f.render(); const softOpen = f.pixel(650, 300)[0];
      f.build(); const softClosed = f.pixel(650, 300)[0]; f.remove(); const softRestored = f.pixel(650, 300)[0];
      return { terrainOpen, terrainClosed, terrainRestored, softOpen, softClosed, softRestored };
    });
    assert.ok(probes.terrainClosed < probes.terrainOpen, JSON.stringify(probes));
    assert.equal(probes.terrainRestored, probes.terrainOpen, 'cached terrain lighting refreshes without manual cache clearing');
    assert.ok(probes.softClosed < probes.softOpen - 10, JSON.stringify(probes));
    assert.equal(probes.softRestored, probes.softOpen);
    const overlap = await page.evaluate(async () => {
      const { rectangleCollider } = await import('/src/physics/Collider.ts');
      const m = fixture.map;
      const old = m.getGroundContour(0, 0, 960, 600);
      const a = m.registerSolid('overlap-a', [rectangleCollider(450, 200, 80, 100)]);
      const b = m.registerSolid('overlap-b', [rectangleCollider(470, 200, 80, 100)]);
      m.tiles[4][9] = 'wall'; m.invalidateNavigation();
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 600;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; m.fillGround(ctx, 0, 0, 960, 600);
      const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
      const result = { ownOverlap: alpha(490, 270), terrainOverlap: alpha(475, 225), open: alpha(100, 100), invalidated: old !== m.getGroundContour(0, 0, 960, 600) };
      ctx.clearRect(0, 0, 960, 600); ctx.fill(m.getTerrainTopContour(0, 0, 960, 600));
      result.topOverlap = alpha(490, 270); result.topTerrainOverlap = alpha(475, 225);
      a(); b(); m.tiles[4][9] = 'default'; m.invalidateNavigation(); fixture.render();
      return result;
    });
    assert.deepEqual(overlap, { ownOverlap: 0, terrainOverlap: 0, open: 255, invalidated: true, topOverlap: 255, topTerrainOverlap: 255 });
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Dynamic wall browser: real actor collision, owned bullet damage/removal, navigation, hard/soft light, cached terrain shadows, overlapping solid masks and DPR 1/1.25/2 passed.');
} finally { await browser.close(); }
