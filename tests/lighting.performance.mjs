import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Headless Chromium falls back to SwiftShader (software raster) unless GPU flags are passed;
// the frame budget below only means anything on the real GPU path, so allow opt-in flags.
const launchArgs = process.env.BROWSER_ARGS ? process.env.BROWSER_ARGS.split(/\s+/).filter(Boolean) : [];
const browser = await chromium.launch({
  headless: true,
  ...(launchArgs.length ? { args: launchArgs } : {}),
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const cases = process.env.PERF_CASE ? [process.env.PERF_CASE] : ['desktop', 'dpr2', 'dense'];
const results = [];
mkdirSync('.review', { recursive: true });
try {
  for (const name of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: name === 'dpr2' ? 2 : 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Freeze the loaded source while other development work may trigger Vite HMR.
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.addInitScript(() => { let seed = 8351; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); });
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/`);
    await page.evaluate(async () => { window.gameRef = (await import('/src/main.ts')).game; });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => window.gameRef.sceneManager.getCurrentScene()?.loaded === true);
    await page.keyboard.up('Enter');
    const result = await page.evaluate(async name => {
      const { LightSource } = await import('/src/core/LightSource.ts');
      const { Vector2 } = await import('/src/math/Vector2.ts');
      const game = window.gameRef, scene = game.sceneManager.getCurrentScene();
      if (name === 'dense') scene.map.tiles.forEach((row, y) => row.forEach((_, x) => row[x] = (x + y) % 2 ? 'wall' : 'default'));
      for (let row = 4; row <= 10; row++) for (let col = 9; col <= 18; col++) scene.map.tiles[row][col] = 'default';
      for (let row = 2; row <= 11; row++) scene.map.tiles[row][15] = 'wall';
      for (let row = 4; row <= 8; row++) for (let col = 16; col <= 18; col++) scene.map.tiles[row][col] = 'default';
      scene.player.x = 620; scene.player.y = 350;
      scene.camera.x = 0; scene.camera.y = 0;
      scene.camera.deadZoneWidth = scene.camera.width; scene.camera.deadZoneHeight = scene.camera.height;
      scene.pickupItems = [];
      const auxiliary = new LightSource(new Vector2(850, 300), 450, '#B4C8E0', .65, 16);
      scene.addLightSource(auxiliary);
      const update = scene.update.bind(scene); let elapsed = 0;
      scene.update = (delta, input) => {
        elapsed += delta;
        scene.player.x = 620 + 60 * Math.cos(elapsed * .8);
        scene.player.y = 350 + 50 * Math.sin(elapsed * .8);
        update(delta, input);
      };
      const cpu = [], intervals = [];
      let frameStart = 0, recording = false;
      const managerUpdate = game.sceneManager.update.bind(game.sceneManager);
      game.sceneManager.update = (...args) => { frameStart = performance.now(); managerUpdate(...args); };
      const drawPosition = game.renderer.drawPos.bind(game.renderer);
      game.renderer.drawPos = (...args) => { drawPosition(...args); if (recording) cpu.push(performance.now() - frameStart); };
      await new Promise(resolve => {
        let warmup = 0, started = 0, previous = 0;
        const tick = now => {
          if (!warmup) warmup = now;
          if (now - warmup >= 1000) {
            if (!started) { started = now; recording = true; }
            if (previous) intervals.push(now - previous);
            previous = now;
            if (now - started >= 10000) { recording = false; resolve(); return; }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const summarize = values => {
        const sorted = values.slice().sort((a, b) => a - b);
        // performance.now() sums carry float noise (e.g. 16.700000000000728 for one 60 Hz
        // frame); microsecond resolution is already far below anything this test can act on.
        const round = value => Math.round(value * 1000) / 1000;
        return { medianMs: round(sorted[Math.floor(sorted.length * .5)]), p95Ms: round(sorted[Math.floor(sorted.length * .95)]), maximumMs: round(sorted[sorted.length - 1]) };
      };
      const main = scene.lightingSystem.shadowCaches.get(scene.playerLight);
      const fixed = scene.lightingSystem.shadowCaches.get(auxiliary);
      const terrain = scene.lightingSystem.terrainLight, terrainBuffer = scene.lightingSystem.terrainShadowCanvas;
      return { name, viewport: [1280, 720], dpr: devicePixelRatio, durationMs: 10000, frames: intervals.length,
        frameInterval: summarize(intervals), frameCpu: summarize(cpu), samples: main?.samples,
        playerRange: scene.playerLight.getRadius(), sourceRadius: scene.playerLight.getSourceRadius(),
        terrainLight: { position: terrain.position, intensity: terrain.intensity, shadowLength: terrain.shadowLength, softness: terrain.softness,
          buffer: [terrainBuffer.width, terrainBuffer.height] },
        movingCacheBuilds: main?.builds, stationaryCacheBuilds: fixed?.builds,
        visibleEdges: scene.map.getShadowEdges(scene.playerLight.getPosition().x, scene.playerLight.getPosition().y,
          scene.playerLight.getRadius() + scene.playerLight.getSourceRadius()).length };
    }, name);
    result.errors = errors;
    results.push(result);
    console.log(JSON.stringify(result));
    await page.screenshot({ path: `.review/soft-game-${name}.png` });
    await context.close();
    writeFileSync('.review/lighting-performance.json', JSON.stringify(results, null, 2) + '\n');
    assert.deepEqual(errors, [], `${name}: browser errors`);
    assert.ok(result.frames >= 300, `${name}: incomplete 10-second recording`);
    if (name === 'desktop') assert.ok(result.frameInterval.p95Ms <= 16.7, `desktop frame p95 ${result.frameInterval.p95Ms}ms exceeds 16.7ms`);
  }
} finally { await browser.close(); }
