import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const capture = process.env.DAY_NIGHT_CAPTURE || 'after';
const output = `${process.env.SCREENSHOT_DIR || '.review/day-night'}/${capture}`;
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const report = [];
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/@vite/client', r => r.fulfill({ contentType: 'application/javascript', body: 'globalThis.__DEV__=true;export {};' }));
    for (const scenario of ['street', 'corner', 'camp', 'water']) {
      await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5191'}/tests/day-night-fixture.html?scenario=${scenario}`);
      try { await page.waitForFunction(() => window.fixture); }
      catch (error) { throw new Error(`${scenario}@${dpr}: ${errors.join('; ') || error.message}`); }
      for (const [phase, minute] of [['day', 360], ['dusk', 765], ['night', 960]]) {
        for (const torch of [false, true]) {
          await page.evaluate(([minute, torch]) => fixture.render(minute, torch), [minute, torch]);
          await page.screenshot({ path: `${output}/${scenario}-${phase}-${torch ? 'on' : 'off'}-dpr${dpr}.png` });
          if (capture !== 'before' && dpr === 1) for (const stage of [1, 2, 3]) {
            mkdirSync(`${output}/stage-${stage}`, { recursive: true });
            await page.evaluate(([minute, torch, stage]) => fixture.render(minute, torch, stage), [minute, torch, stage]);
            await page.screenshot({ path: `${output}/stage-${stage}/${scenario}-${phase}-${torch ? 'on' : 'off'}.png` });
          }
        }
      }
      if (capture !== 'before') {
        const visual = await page.evaluate(async ({ scenario, dpr }) => {
          const f = fixture, ctx = f.scene.worldContext;
          const sample = () => {
            const data = ctx.getImageData(Math.round(ctx.canvas.width / 2 - 55), Math.round(ctx.canvas.height / 2 + 35), 5, 5).data;
            let luma = 0; for (let i = 0; i < data.length; i += 4) luma += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
            return luma / (data.length / 4);
          };
          const values = [];
          for (const minute of [360, 765, 960]) { f.render(minute, false); values.push(sample()); }
          f.render(360, false);
          const sun = f.scene.lightingSystem.directionalLight, before = f.scene.lightingSystem.getStats().directionalShadowRasterizations;
          f.scene.lightingSystem.setDirectionalLight({ ...sun, color: '#F4D3A1', intensity: .2 });
          f.scene.lightingSystem.prepareLightingMask(f.scene.camera.x, f.scene.camera.y, f.map);
          const after = f.scene.lightingSystem.getStats().directionalShadowRasterizations;
          f.render(960, false);
          let baselineLuma = null;
          if (scenario === 'street' && dpr === 1) {
            const response = await fetch('/.review/day-night/before/street-day-off-dpr1.png');
            if (response.ok && response.headers.get('content-type')?.includes('image')) {
              const image = await createImageBitmap(await response.blob()), canvas = document.createElement('canvas');
              canvas.width = image.width; canvas.height = image.height; const paint = canvas.getContext('2d'); paint.drawImage(image, 0, 0);
              const pixels = paint.getImageData(Math.round(canvas.width / 2 - 55), Math.round(canvas.height / 2 + 35), 5, 5).data;
              baselineLuma = 0; for (let i = 0; i < pixels.length; i += 4) baselineLuma += (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 25;
              image.close();
            }
          }
          return { luma: values, baselineLuma, cacheBuilds: [before, after], nightSolar: f.scene.lightingSystem.directionalLight.intensity,
            logicalTorch: f.scene.flashlight.getIntensity(), weight: f.scene.flashlight.visualWeight };
        }, { scenario, dpr });
        assert.ok(visual.luma[0] > visual.luma[1] && visual.luma[1] > visual.luma[2], `${scenario}@${dpr}: daylight > dusk > night: ${visual.luma}`);
        assert.ok(visual.luma[2] >= 10, `${scenario}@${dpr}: near ground remains playable: ${visual.luma}`);
        assert.equal(visual.nightSolar, 0); assert.deepEqual(visual.cacheBuilds[0], visual.cacheBuilds[1], 'colour/intensity changes never rerasterize solar geometry');
        assert.equal(visual.logicalTorch, .95); assert.equal(visual.weight, 1);
        if (visual.baselineLuma !== null) assert.ok(visual.luma[0] >= visual.baselineLuma * 2, `daylight >= 2× baseline: ${JSON.stringify(visual)}`);
        report.push({ dpr, scenario, visual });
      }
      const metrics = await page.evaluate(() => {
        fixture.render(960, true);
        for (let i = 0; i < 10; i++) fixture.scene.draw(fixture.game.renderer.ctx);
        const times = [];
        for (let i = 0; i < 60; i++) {
          const start = performance.now(); fixture.scene.draw(fixture.game.renderer.ctx); times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { p50: times[30], p95: times[57], lighting: fixture.scene.lightingSystem.getStats() };
      });
      report.push({ dpr, scenario, ...metrics });
      assert.deepEqual(errors, []);
      console.log(`${capture}: ${scenario}@${dpr} p50=${metrics.p50.toFixed(1)}ms p95=${metrics.p95.toFixed(1)}ms`);
    }
    if (capture !== 'before' && dpr === 1) {
      const shadows = await page.evaluate(async () => {
        const { LightingSystem } = await import('/src/core/LightingSystem.ts');
        const { TileMap } = await import('/src/map/TileMap.ts');
        const map = new TileMap(14, 12, { seed: 817, generateWater: false }); map.tiles.forEach(row => row.fill('default'));
        map.tiles[5][5] = 'mineral'; map.tileHp[5][5] = 100;
        const light = new LightingSystem(); light.initialize(700, 600); light.setAmbientLight('#808090');
        const sun = { direction: { x: .8, y: .6 }, color: '#FFFFFF', intensity: .3, shadowLength: 32.5, shadowOpacity: .9, softness: 3 };
        const px = (x, y) => light.shadowCtx.getImageData(x, y, 1, 1).data[0];
        light.setDirectionalLight(sun); light.prepareLightingMask(0, 0, map);
        const day = { open: px(150, 150), shadow: px(307, 285), far: px(340, 310), top: px(275, 275) };
        light.setDirectionalLight({ ...sun, shadowLength: 110 }); light.prepareLightingMask(0, 0, map);
        const dusk = { far: px(340, 310), shadow: px(307, 285) };
        const edges = map.getShadowEdges.bind(map); map.getShadowEdges = (...args) => [...edges(...args), ...edges(...args)]; light.solarChunks.clear();
        light.prepareLightingMask(0, 0, map); const duplicate = px(307, 285);
        map.damageTile(5, 5, 100); light.prepareLightingMask(0, 0, map); const destroyed = px(307, 285);
        return { day, dusk, duplicate, destroyed };
      });
      assert.ok(shadows.day.shadow < shadows.day.open - 20);
      assert.equal(shadows.day.top, shadows.day.open, 'sun shadows never darken solid tops');
      assert.ok(shadows.dusk.far < shadows.day.far - 20, 'dusk shadow reaches beyond the daytime shadow');
      assert.ok(Math.abs(shadows.duplicate - shadows.dusk.shadow) <= 1, 'overlapping projections form a union');
      assert.ok(shadows.destroyed > shadows.dusk.shadow + 20, 'destruction removes the solar shadow in the same frame');
      report.push({ shadows });

      await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5191');
      await page.keyboard.press('n'); await page.waitForSelector('[data-campaign-hud]');
      await page.evaluate(async () => {
        const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
        window.realGame = (await import(entry.src)).game; window.requestAnimationFrame = () => 0;
        await new Promise(resolve => setTimeout(resolve, 70)); window.dispatchEvent(new Event('focus'));
        window.clockTick = seconds => { const s = realGame.sceneManager.getCurrentScene(); realGame.campaign.advance(s, seconds); s.update(0, realGame.input); s.draw(realGame.renderer.ctx); };
        clockTick(450);
      });
      await page.screenshot({ path: `${output}/campaign-day.png` });
      await page.evaluate(() => { realGame.campaign.endDay(); clockTick(45); });
      assert.match(await page.locator('[data-day-clock-hud]').getAttribute('aria-label'), /黄昏.*18:45.*距夜袭开始/);
      await page.screenshot({ path: `${output}/campaign-dusk.png` });
      await page.evaluate(() => clockTick(135));
      const night = await page.evaluate(() => ({ clock: realGame.campaign.session.getClockReading(), environment: realGame.sceneManager.getCurrentScene().getEnvironmentState() }));
      assert.equal(night.clock.worldMinute, 960); assert.equal(night.environment.worldMinute, 960);
      assert.equal(night.clock.phase, 'night');
      assert.match(await page.locator('[data-day-clock-hud]').getAttribute('aria-label'), /夜晚.*22:00.*夜间防守时间/);
      await page.screenshot({ path: `${output}/campaign-night.png` });
      const raid = await page.evaluate(() => { const s = realGame.sceneManager.getCurrentScene(); s.setRaidVisualState({ wave: 1, totalWaves: 3 }); clockTick(0); return s.facilityLights.map(l => l.visualWeight); });
      assert.ok(raid.every(weight => weight === 1.15));
      assert.match(await page.locator('[data-day-clock-hud]').getAttribute('aria-label'), /第 1 波 \/ 3/);
      await page.screenshot({ path: `${output}/campaign-raid.png` });
      await page.evaluate(() => { realGame.sceneManager.getCurrentScene().setRaidVisualState(undefined); clockTick(0); });
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => clockTick(0));
      const hud = await page.locator('[data-day-clock-hud]').boundingBox();
      assert.ok(hud.x >= 0 && hud.x + hud.width <= 390.1);
      await page.screenshot({ path: `${output}/campaign-night-portrait.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.keyboard.press('F2'); await page.getByRole('tab', { name: '画面', exact: true }).click();
      const mode = page.locator('[data-debug-field="graphics.dayNight.mode"]');
      await mode.selectOption('manual');
      assert.equal(await page.evaluate(() => realGame.sceneManager.getCurrentScene().graphics.dayNight.mode), 'manual');
      await mode.selectOption('auto');
      const daylight = page.locator('[data-debug-field="graphics.dayNight.day.ambientIntensity"]');
      await daylight.fill('.70'); await daylight.press('Enter');
      assert.equal(await page.evaluate(() => realGame.sceneManager.getCurrentScene().graphics.dayNight.day.ambientIntensity), .70);
      assert.equal(await page.evaluate(() => realGame.campaign.session.getClockReading().worldMinute), 960, 'debug graphics never advance campaign time');
      await daylight.fill('.72'); await daylight.press('Enter'); await page.keyboard.press('F2');
      assert.deepEqual(errors, []);
    }
    await context.close();
  }
  writeFileSync(`${output}/metrics.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(capture === 'before' ? 'Day/night before: 72 matched screenshots and 12 rendering measurements captured.'
    : 'Day/night after: matched screenshots, staged captures, luminance, parallel/long/union shadows, cache reuse, playable campaign night, raid HUD and nested F2 controls passed.');
} finally { await browser.close(); }
