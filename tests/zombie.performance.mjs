import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.ZOMBIE_OUTPUT || '.review/zombie'; mkdirSync(output, { recursive: true });
const report = { environment: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
  memoryGiB: +(os.totalmem()/2**30).toFixed(1), node: process.version, browser: browser.version(), viewport: '1280x720', seed: 424242 },
  sourceCommit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  method: 'Fixed map/seed and 6 chickens. 1s warmup + 10s wall-clock rAF sampling; fixed 1/60 simulation steps, repeatable WASD square and player gunshot noise every .75 simulated seconds; full scene rendering. A common .7s initial game step precedes warmup. Settled100 pre-generates 100 deaths and lands their 600 parts before warmup; burst100 generates and kills 100 enemies inside the first measured update, including spawn/death cost. Player maxHealth=1000000 only in the harness so death cannot reduce stress workload.',
  goals: { aiAndNavigationMs: 2, frameMs: 16.67 }, gpuMs: null, gcMs: null, cases: [] };
try {
  const workloads = [...[0,4,20,50,100].map(count=>({count,workload:'alive'})), {count:0,workload:'settled100'}, {count:0,workload:'burst100'}];
  for (const dpr of [1, 2]) for (const {count,workload} of workloads) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Disable HMR while retaining Vite's development flag for gated instrumentation.
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'globalThis.__DEV__=true; export {};' }));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=${count}`);
    await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(async ({ count, dpr, workload }) => {
      const f = window.fixture, scene = f.scene, enemies = scene.getEnemySystem(), player = scene.getPlayer();
      player.applyConfig({ base: { maxHealth: 1000000 } }); player.resetLifeState();
      if(!scene.getCombatFeedbackMetrics()) throw new Error('Development feedback metrics are unavailable in the performance fixture');
      const kill100 = () => {
        for(let i=0;i<100;i++) {
          const z=f.addEnemy(i%2?'runner':'shambler',600+(i%10)*40,550+Math.floor(i/10)*40,0);
          enemies.receiveHit(z,{damage:1000,point:z.getCenter(),direction:{x:1,y:0},impulse:200,initialSpeed:100,impactSpeed:100,traveledDistance:1,source:'bullet'});
        }
      };
      if(workload==='settled100') { kill100(); scene.update(0,{isKeyDown:()=>false}); }
      scene.update(.7,{isKeyDown:()=>false});
      const gl=document.createElement('canvas').getContext('webgl'), ext=gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;
      const rows = [], start = performance.now(), warm = start + 1000, finish = warm + 10000;
      let frame = 0, previous = start, perceptionMs = 0, baseline = null, endTime = start, burstDone=false;
      let goreUpdateMs=0,goreDrawMs=0,bloodDrawMs=0;
      const perception = scene.updatePerception.bind(scene);
      scene.updatePerception = delta => { const t = performance.now(); perception(delta); perceptionMs = performance.now() - t; };
      const goreUpdate=scene.zombieGore.update.bind(scene.zombieGore),goreDraw=scene.zombieGore.draw.bind(scene.zombieGore),goreFlash=scene.zombieGore.drawFlashes.bind(scene.zombieGore);
      scene.zombieGore.update=(...args)=>{const t=performance.now();goreUpdate(...args);goreUpdateMs+=performance.now()-t;};
      scene.zombieGore.draw=(...args)=>{const t=performance.now();goreDraw(...args);goreDrawMs+=performance.now()-t;};
      scene.zombieGore.drawFlashes=(...args)=>{const t=performance.now();goreFlash(...args);goreDrawMs+=performance.now()-t;};
      for(const blood of [scene.enemyBlood,scene.bloodStainSystem]){const draw=blood.draw.bind(blood);blood.draw=(...args)=>{const t=performance.now();draw(...args);bloodDrawMs+=performance.now()-t;};}
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
          goreUpdateMs=goreDrawMs=bloodDrawMs=0;
          const before = performance.now();
          if(workload==='burst100'&&timestamp>=warm&&!burstDone){kill100();burstDone=true;}
          scene.update(1/60, input); const afterUpdate = performance.now(); scene.draw(f.game.renderer.ctx); const afterDraw = performance.now();
          if (timestamp >= warm) {
            const metrics = enemies.metrics, nav = enemies.navigation.stats, feedback=scene.getCombatFeedbackMetrics();
            rows.push({ interval, update: afterUpdate-before, draw: afterDraw-afterUpdate, frameCpu: afterDraw-before,
              enemyPerception: metrics.perceptionMs, navigation: metrics.navigationMs, movement: metrics.movementMs, playerPerception: perceptionMs,
              expanded: nav.lastExpanded, work: nav.lastWorkUnits, starts: nav.lastStarted, active: nav.active, queue: nav.queued,
              noise: scene.getNoiseSystem().getEvents().length, bullets: player.getBullets().length,
              particles: scene.particleSystem.getPerformanceStats().activeParticles,
              goreUpdate:goreUpdateMs,goreDraw:goreDrawMs,bloodDraw:bloodDrawMs,...feedback });
          }
          frame++; requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const summary = Object.fromEntries(['interval','update','draw','frameCpu','enemyPerception','navigation','movement','playerPerception','goreUpdate','goreDraw','bloodDraw'].map(k => [k, stats(rows.map(r=>r[k]))]));
      const nav = enemies.navigation.stats;
      return { count, dpr, workload, renderer, spawned: enemies.zombies.length, samples: rows.length, samplingMs: +(endTime-warm).toFixed(2), ...summary,
        aiAndNavigation: stats(rows.map(r=>r.enemyPerception+r.navigation)),
        scheduler: { expandedDuringSample: nav.expanded - baseline.expanded, startedDuringSample: nav.started - baseline.started,
          peakExpandedPerTick: Math.max(...rows.map(r=>r.expanded)), peakWorkPerTick: Math.max(...rows.map(r=>r.work)), peakStartsPerTick: Math.max(...rows.map(r=>r.starts)),
          peakActive: Math.max(...rows.map(r=>r.active)), peakQueued: Math.max(...rows.map(r=>r.queue)), maximumQueueWaitSeconds: nav.maxWaitSeconds },
        objects: { enemies: enemies.zombies.length, actors: enemies.zombies.length + 1, chickens: scene.chickens.length,
          vaccines: scene.getVaccinePickups().length, peakParticles: Math.max(...rows.map(r=>r.particles)),
          peakNoise: Math.max(...rows.map(r=>r.noise)), peakBullets: Math.max(...rows.map(r=>r.bullets)),
          ...scene.getCombatFeedbackMetrics(), peakFlying:Math.max(...rows.map(r=>r.flying)),peakBloodDrops:Math.max(...rows.map(r=>r.drops)),
          peakFragmentPhysicsSteps:Math.max(...rows.map(r=>r.physicsSteps)),peakFragmentDrawCandidates:Math.max(...rows.map(r=>r.drawCandidates)) },
        longFrames33ms: rows.filter(r=>r.interval>33.34).length, longFrames50ms: rows.filter(r=>r.interval>50).length,
        playerAlive: player.isAlive(), gpuMs: null, gcMs: null };
    }, { count, dpr, workload });
    assert.equal(result.spawned, count); assert.equal(result.playerAlive, true); assert.ok(result.samples > 0);
    assert.ok(result.scheduler.peakExpandedPerTick <= 512); assert.ok(result.scheduler.peakWorkPerTick <= 512);
    assert.ok(result.scheduler.peakStartsPerTick <= 2); assert.ok(result.scheduler.peakActive <= 4); assert.deepEqual(errors, []);
    assert.ok(result.objects.peakFlying<=256);
    if(workload!=='alive'){assert.equal(result.objects.settled,600);assert.equal(result.objects.blood,100);}
    if(workload==='settled100')assert.equal(result.objects.peakFragmentPhysicsSteps,0);
    report.cases.push(result); writeFileSync(`${output}/performance.json`, JSON.stringify(report, null, 2));
    console.log(`DPR ${dpr}, ${count} zombies, ${workload}: AI/nav p95=${result.aiAndNavigation.p95}ms, frame CPU p95=${result.frameCpu.p95}ms, interval p95=${result.interval.p95}ms, gore draw p95=${result.goreDraw.p95}ms, ${result.samples} samples.`);
    await context.close();
  }
} finally { await browser.close(); }
