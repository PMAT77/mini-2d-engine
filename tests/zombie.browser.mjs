import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review/zombie'; mkdirSync(output, { recursive: true });
let cases = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html`);
    await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(() => {
      const f = window.fixture, enemy = f.scene.getEnemySystem();
      const initial = enemy.snapshot();
      f.addEnemy('shambler', 900, 750, Math.PI); f.addEnemy('runner', 740, 800, -Math.PI/2);
      f.tick(40);
      return { initial, after: enemy.snapshot(), budget: enemy.navigation.stats };
    });
    assert.equal(result.initial.length, 4); assert.equal(result.after.length, 6);
    assert.ok(result.budget.lastExpanded <= 512); assert.ok(result.after.some(z => z.state === 'chase'));
    await page.screenshot({ path: `${output}/encounter-dpr-${dpr}.png` });
    assert.deepEqual(errors, []); cases++; await page.close();
  }
  console.log(`Zombie browser: ${cases} DPR encounter/render cases passed.`);
} finally { await browser.close(); }
