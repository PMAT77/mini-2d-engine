import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5174'}/?vision=legacy&visionDebug=world&zombieDebug=paths`);
  await page.keyboard.down('Enter'); await page.waitForSelector('[data-player-debug]'); await page.keyboard.up('Enter');
  const result = await page.evaluate(() => {
    const scene = window.__miniGame.sceneManager.getCurrentScene();
    return { vision: scene.visionMode, visionDebug: scene.visionDebugLayer, zombiePaths: scene.zombieDebugPaths,
      debug: scene.getZombieDebugState(), feedback:scene.getCombatFeedbackState(), feedbackMetrics:scene.getCombatFeedbackMetrics(),
      enemies: scene.getEnemySystem().zombies.length, vaccines: scene.getVaccinePickups().length, status: scene.getSurvivalSystem().snapshot() };
  });
  assert.equal(result.vision,'three-layer'); assert.equal(result.visionDebug,null); assert.equal(result.zombiePaths,false); assert.equal(result.debug,null);
  assert.equal(result.feedback,null); assert.equal(result.feedbackMetrics,null);
  assert.equal(result.enemies,20); assert.equal(result.vaccines,2); assert.equal(result.status.vaccines,0); assert.equal(result.status.infected,false);
  assert.deepEqual(errors,[]); console.log('Production zombie check passed: default 20 enemies / 2 vaccines, debug URLs ignored.');
} finally { await browser.close(); }
