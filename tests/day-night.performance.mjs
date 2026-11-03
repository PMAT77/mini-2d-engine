import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.SCREENSHOT_DIR || '.review/day-night'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const report = { method: 'Paired static-night legacy/automatic rendering on identical terrain, actors, logical lights and perception; 12 warmup + 40 frames per pass; alternating AB/BA; lower p95 of two passes. Includes material response and atmosphere. CPU draw duration, not FPS.', cases: [] };
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.route('**/@vite/client', r => r.fulfill({ contentType: 'application/javascript', body: 'globalThis.__DEV__=true;export {};' }));
    for (const scenario of ['street', 'corner', 'camp', 'water']) {
      await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5191'}/tests/day-night-fixture.html?scenario=${scenario}`);
      await page.waitForFunction(() => window.fixture);
      const results = await page.evaluate(() => {
        const s = fixture.scene, measure = mode => {
          s.graphics.dayNight.mode = mode; fixture.render(960, true);
          for (let i = 0; i < 12; i++) s.draw(fixture.game.renderer.ctx);
          const times = [];
          for (let i = 0; i < 40; i++) { const start = performance.now(); s.draw(fixture.game.renderer.ctx); times.push(performance.now() - start); }
          times.sort((a, b) => a - b); return { p50: times[20], p95: times[38] };
        };
        const legacyA = measure('manual'), autoA = measure('auto'), autoB = measure('auto'), legacyB = measure('manual');
        const legacy = legacyA.p95 < legacyB.p95 ? legacyA : legacyB, automatic = autoA.p95 < autoB.p95 ? autoA : autoB;
        return { legacy, automatic, ratio: automatic.p95 / legacy.p95, passes: { legacyA, autoA, autoB, legacyB } };
      });
      report.cases.push({ dpr, scenario, ...results });
      console.log(`${scenario}@${dpr}: legacy p95 ${results.legacy.p95.toFixed(1)}ms, day/night ${results.automatic.p95.toFixed(1)}ms (${(results.ratio * 100).toFixed(1)}%)`);
    }
    await context.close();
  }
  writeFileSync(`${output}/performance.json`, JSON.stringify(report, null, 2) + '\n');
  assert.ok(report.cases.every(c => c.ratio <= 1.15), 'night rendering p95 regression exceeds 15%; see performance.json');
} finally { await browser.close(); }
