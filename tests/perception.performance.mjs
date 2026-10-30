import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });

// One observer, the flashlight and player glow, plus optional auxiliary lights.
// Single vs multi isolates the cost of extra recognition lights in each mode.
const cases = [
  { name: 'legacy-single', mode: 'legacy', auxiliary: 0 },
  { name: 'three-layer-single', mode: 'three-layer', auxiliary: 0 },
  { name: 'legacy-multi', mode: 'legacy', auxiliary: 3 },
  { name: 'three-layer-multi', mode: 'three-layer', auxiliary: 3 },
];
const results = [];

try {
  for (const testCase of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(`${base}/${testCase.mode === 'three-layer' ? '?vision=three-layer' : ''}`);
    await page.evaluate(async () => { window.perfGame = (await import('/src/main.ts')).game; });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => window.perfGame.sceneManager.getCurrentScene()?.loaded === true);
    await page.keyboard.up('Enter');

    const result = await page.evaluate(async ({ mode, auxiliary }) => {
      const { Torch } = await import('/src/objects/Torch.ts');
      const game = window.perfGame;
      const scene = game.sceneManager.getCurrentScene();
      if (scene.visionMode !== mode) throw new Error(`expected ${mode}, got ${scene.visionMode}`);

      // Keep the world and camera identical across modes; remove roaming torches.
      scene.torches.forEach(torch => scene.lightingSystem.removeLightSource(torch.light));
      scene.torches = [];
      scene.chickens = [];
      scene.goldPickups = [];
      scene.meatPickups = [];
      scene.pickupItems = [];
      scene.particleSystem.clear();
      scene.player.x = 620;
      scene.player.y = 350;
      scene.camera.x = 0;
      scene.camera.y = 0;
      scene.camera.deadZoneWidth = scene.camera.width;
      scene.camera.deadZoneHeight = scene.camera.height;
      scene.flashlight.setActive(true);
      scene.flashlight.setDirection(0);

      const positions = [[850, 300], [360, 520], [700, 380]];
      for (let i = 0; i < auxiliary; i++) {
        const torch = new Torch(positions[i][0], positions[i][1], i);
        scene.torches.push(torch);
        scene.addLightSource(torch.light);
      }

      const update = scene.update.bind(scene);
      let elapsed = 0;
      scene.update = (delta, input) => {
        elapsed += delta;
        scene.player.x = 620 + 60 * Math.cos(elapsed * .8);
        scene.player.y = 350 + 50 * Math.sin(elapsed * .8);
        update(delta, input);
      };

      const perceptionMs = [];
      if (scene.perception) {
        const original = scene.updatePerception.bind(scene);
        scene.updatePerception = delta => {
          const start = performance.now();
          original(delta);
          perceptionMs.push(performance.now() - start);
        };
      }
      const renderMs = [];
      if (scene.perceptionRenderer) {
        const original = scene.perceptionRenderer.render.bind(scene.perceptionRenderer);
        scene.perceptionRenderer.render = (...args) => {
          const start = performance.now();
          const value = original(...args);
          renderMs.push(performance.now() - start);
          return value;
        };
      }

      const frameCpu = [];
      let frameStart = 0;
      let recording = false;
      const managerUpdate = game.sceneManager.update.bind(game.sceneManager);
      game.sceneManager.update = (...args) => { frameStart = performance.now(); managerUpdate(...args); };
      const drawPosition = game.renderer.drawPos.bind(game.renderer);
      game.renderer.drawPos = (...args) => {
        drawPosition(...args);
        if (recording) frameCpu.push(performance.now() - frameStart);
      };

      await new Promise(resolve => {
        let warmup = 0;
        let started = 0;
        const tick = now => {
          if (!warmup) warmup = now;
          if (now - warmup >= 1000) {
            if (!started) { started = now; recording = true; }
            if (now - started >= 5000) { recording = false; resolve(); return; }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      const summarize = values => {
        if (!values.length) return null;
        const sorted = values.slice().sort((a, b) => a - b);
        const round = value => Math.round(value * 1000) / 1000;
        const at = fraction => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
        return { medianMs: round(at(.5)), p95Ms: round(at(.95)), p99Ms: round(at(.99)), maximumMs: round(sorted[sorted.length - 1]) };
      };

      return {
        name: `${mode}-${auxiliary ? 'multi' : 'single'}`,
        mode,
        auxiliary,
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        frames: frameCpu.length,
        frameCpu: summarize(frameCpu),
        perceptionUpdate: summarize(perceptionMs),
        concealmentRender: summarize(renderMs),
        maskScale: scene.graphics.visibility.maskScale,
        overlay: scene.perceptionRenderer ? [scene.perceptionRenderer.overlay.width, scene.perceptionRenderer.overlay.height] : null,
        litLights: scene.perceptionLights?.length ?? null,
      };
    }, { mode: testCase.mode, auxiliary: testCase.auxiliary });

    result.errors = errors;
    results.push(result);
    console.log(JSON.stringify(result));
    assert.deepEqual(errors, [], `${testCase.name}: browser errors`);
    assert.ok(result.frames >= 100, `${testCase.name}: incomplete recording (${result.frames} frames)`);
    await context.close();
  }
  writeFileSync(`${output}/perception-performance.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('Perception performance comparison written to .review/perception-performance.json');
} finally {
  await browser.close();
}
