import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.ZOMBIE_OUTPUT || '.review/zombie'; mkdirSync(output, { recursive: true });
const report = { environment: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
  memoryGiB: +(os.totalmem()/2**30).toFixed(1), node: process.version, browser: browser.version(), viewport: '1280x720', seed: 424242 },
  method: '1s warmup + 10s wall-clock rAF sampling; fixed 1/60 simulation steps, repeatable WASD square and player gunshot noise every .75 simulated seconds; full scene rendering. Player maxHealth=1000000 only in the harness so death cannot reduce stress workload.',
  goals: { aiAndNavigationMs: 2, frameMs: 16.67 }, gpuMs: null, gcMs: null, cases: [] };
try {
  for (const dpr of [1, 2]) for (const count of [0, 4, 20, 50, 100]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=${count}`);
    await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(async ({ count, dpr }) => {
      const f = window.fixture, scene = f.scene, enemies = scene.getEnemySystem(), player = scene.getPlayer();
      player.applyConfig({ base: { maxHealth: 1000000 } }); player.resetLifeState();
      const rows = [], start = performance.now(), warm = start + 1000, finish = warm + 10000;
      let frame = 0, previous = start, perceptionMs = 0, baseline = null, endTime = start;
      const perception = scene.updatePerception.bind(scene);
      scene.updatePerception = delta => { const t = performance.now(); perception(delta); perceptionMs = performance.now() - t; };
      const stats = array => {
        const values = [...array].sort((a,b) => a-b), sum = values.reduce((a,b) => a+b,0);
        return { mean: +(sum/values.length).toFixed(3), p50: +values[Math.floor((values.length-1)*.50)].toFixed(3),
          p95: +values[Math.floor((values.length-1)*.95)].toFixed(3), max: +values.at(-1).toFixed(3) };
      };
      await new Promise(resolve => {
        const step = timestamp => {
          const interval = timestamp - previous; previous = timestamp;
          if (timestamp >= finish) { endTime = timestamp; resolve(); return; }
          const key = ['w','d','s','a'][Math.floor(frame/120)%4], input = { isKeyDown: k => k === key };
          if (frame % 45 === 0) { const v = player.getVisionState(); scene.getNoiseSystem().emit('gunshot', v.x, v.y, { sourceId: 'player' }); }
          if (timestamp >= warm && !baseline) baseline = { ...enemies.navigation.stats };
          const before = performance.now(); scene.update(1/60, input); const afterUpdate = performance.now(); scene.draw(f.game.renderer.ctx); const afterDraw = performance.now();
          if (timestamp >= warm) {
            const metrics = enemies.metrics, nav = enemies.navigation.stats;
            rows.push({ interval, update: afterUpdate-before, draw: afterDraw-afterUpdate, frameCpu: afterDraw-before,
              enemyPerception: metrics.perceptionMs, navigation: metrics.navigationMs, movement: metrics.movementMs, playerPerception: perceptionMs,
              expanded: nav.lastExpanded, work: nav.lastWorkUnits, starts: nav.lastStarted, active: nav.active, queue: nav.queued,
              noise: scene.getNoiseSystem().getEvents().length, bullets: player.getBullets().length,
              particles: scene.particleSystem.getPerformanceStats().activeParticles });
          }
          frame++; requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const summary = Object.fromEntries(['interval','update','draw','frameCpu','enemyPerception','navigation','movement','playerPerception'].map(k => [k, stats(rows.map(r=>r[k]))]));
      const nav = enemies.navigation.stats;
      return { count, dpr, spawned: enemies.zombies.length, samples: rows.length, samplingMs: +(endTime-warm).toFixed(2), ...summary,
        aiAndNavigation: stats(rows.map(r=>r.enemyPerception+r.navigation)),
        scheduler: { expandedDuringSample: nav.expanded - baseline.expanded, startedDuringSample: nav.started - baseline.started,
          peakExpandedPerTick: Math.max(...rows.map(r=>r.expanded)), peakWorkPerTick: Math.max(...rows.map(r=>r.work)), peakStartsPerTick: Math.max(...rows.map(r=>r.starts)),
          peakActive: Math.max(...rows.map(r=>r.active)), peakQueued: Math.max(...rows.map(r=>r.queue)), maximumQueueWaitSeconds: nav.maxWaitSeconds },
        objects: { enemies: enemies.zombies.length, actors: enemies.zombies.length + 1, chickens: scene.chickens.length,
          vaccines: scene.getVaccinePickups().length, peakParticles: Math.max(...rows.map(r=>r.particles)),
          peakNoise: Math.max(...rows.map(r=>r.noise)), peakBullets: Math.max(...rows.map(r=>r.bullets)) },
        longFrames33ms: rows.filter(r=>r.interval>33.34).length, longFrames50ms: rows.filter(r=>r.interval>50).length,
        playerAlive: player.isAlive(), gpuMs: null, gcMs: null };
    }, { count, dpr });
    assert.equal(result.spawned, count); assert.equal(result.playerAlive, true); assert.ok(result.samples > 0);
    assert.ok(result.scheduler.peakExpandedPerTick <= 512); assert.ok(result.scheduler.peakWorkPerTick <= 512);
    assert.ok(result.scheduler.peakStartsPerTick <= 2); assert.ok(result.scheduler.peakActive <= 4); assert.deepEqual(errors, []);
    report.cases.push(result); writeFileSync(`${output}/performance.json`, JSON.stringify(report, null, 2));
    console.log(`DPR ${dpr}, ${count} zombies: AI/nav p95=${result.aiAndNavigation.p95}ms, frame CPU p95=${result.frameCpu.p95}ms, interval p95=${result.interval.p95}ms, ${result.samples} samples.`);
    await context.close();
  }
} finally { await browser.close(); }
