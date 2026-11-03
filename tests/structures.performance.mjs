import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review/structures', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5187');
  await page.locator('[data-new-campaign]').click(); await page.waitForSelector('[data-campaign-hud]');
  const rows = await page.evaluate(async () => {
    const { StructureSystem } = await import('/src/structures/StructureSystem.ts');
    const game = window.__miniGame, scene = game.sceneManager.getCurrentScene(); window.dispatchEvent(new Event('focus'));
    const states = [];
    for (const row of [2, 4, 6, 8, 12, 14]) for (let col = 10; col <= 21 && states.length < 64; col++)
      states.push({ instanceId: 'bench-' + states.length, definitionId: 'wood-wall', level: 1, col, row, rotation: 0, hp: 120, status: 'standing', observedHp: 120 });
    const results = [];
    for (const count of [0, 64]) {
      scene.structures?.dispose(); scene.structures = new StructureSystem(scene.map, states.slice(0, count), () => {});
      for (const fps of [30, 60, 144]) {
        const frame = () => { scene.update(1 / fps, game.input); scene.draw(game.renderer.ctx); };
        for (let i = 0; i < 20; i++) frame();
        const samples = [];
        for (let i = 0; i < fps; i++) { const start = performance.now(); frame(); samples.push(performance.now() - start); }
        samples.sort((a, b) => a - b);
        results.push({ walls: count, fps, frames: samples.length, meanMs: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3),
          p95Ms: +samples[Math.floor((samples.length - 1) * .95)].toFixed(3) });
      }
    }
    return results;
  });
  assert.deepEqual(errors, []); assert.equal(rows.length, 6);
  const report = { viewport: '1280x720', dpr: 1, browser: browser.version(), cpu: os.cpus()[0]?.model,
    method: 'Synchronous real GameScene update+draw, 20 warmup frames then one simulated second at each fixed step; reports CPU call time, not a display-FPS guarantee.', rows };
  writeFileSync('.review/structures/performance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
