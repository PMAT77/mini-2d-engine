import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const duration = Number(process.env.PERF_SECONDS || 60), repeats = Number(process.env.PERF_REPEATS || 3);
const output = process.env.PERF_OUTPUT || '.review/exploration-performance/after.json';
mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const gpu = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
const report = { environment: { cpu: os.cpus()[0]?.model, browser: browser.version(), gpu: gpu.gpu },
  duration, repeats, method: 'Real rAF intervals and Game.MAX_DELTA-equivalent elapsed simulation time. 3s warmup. 100 live enemies with harness-only extra health, 100 deaths/600 fragments, all terrain remembered. Continuous aimed fire and WASD square. No subsystems disabled.', cases: [] };
try {
  const views = process.env.PERF_VIEW === 'dpr2' ? [[1920,1080,2]] : [[1280,720,1],[1920,1080,1],[1920,1080,2]];
  const seeds = process.env.PERF_SEED ? [Number(process.env.PERF_SEED)] : [817,424242];
  for (const [width,height,dpr] of views) for (const seed of seeds) for (let repeat=0;repeat<repeats;repeat++) {
    const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
    const page = await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/@vite/client',r=>r.fulfill({contentType:'application/javascript',body:'globalThis.__DEV__=true;export {};'}));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5179'}/tests/zombie-fixture.html?count=0`);
    await page.waitForFunction(()=>window.fixture);
    const profiler = process.env.PERF_PROFILE ? await context.newCDPSession(page) : null;
    if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
    const result = await page.evaluate(async ({seed,duration})=>{
      const {GameScene}=await import('/src/scenes/GameScene.ts'),{TileMap}=await import('/src/map/TileMap.ts');
      const map=new TileMap(100,100,{seed}),game=fixture.game,positions=[];
      for(let y=1750;y<3250;y+=60)for(let x=1750;x<3250;x+=60)if(map.isWalkableArea(x,y,49))positions.push({x,y});
      positions.sort((a,b)=>Math.hypot(a.x-2500,a.y-2500)-Math.hypot(b.x-2500,b.y-2500));
      if(positions.length<101)throw new Error('Insufficient safe spawn positions');
      const scene=new GameScene({map,seed,playerSpawn:positions[0],chickenCount:6,encounters:{shambler:0,runner:0,vaccines:0,grenades:0,smokeGrenades:0,tradingStations:0}});
      await scene.load();game.sceneManager.changeScene(scene,0);await new Promise(requestAnimationFrame);
      const player=scene.getPlayer();player.applyConfig({base:{maxHealth:1000000}});player.resetLifeState();
      const idle={isKeyDown:()=>false};scene.update(1/60,idle);
      const memory=scene.perception.getTerrainMemory('player'),grid=scene.perception.getExplorationGrid('player');
      for(let row=0;row<100;row++)for(let col=0;col<100;col++)memory.capture(col,row);
      for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.cols;col++)grid.markCell(col,row);
      for(let i=0;i<100;i++){
        const z=scene.enemies.add(i%2?'runner':'shambler',positions[i+1],0);
        scene.enemies.receiveHit(z,{damage:1000,point:z.getCenter(),direction:{x:1,y:0},impulse:200,initialSpeed:100,impactSpeed:100,traveledDistance:1,source:'bullet'});
      }
      scene.update(.7,idle);scene.update(.7,idle);
      for(let i=0;i<100;i++){const z=scene.enemies.add(i%2?'runner':'shambler',positions[i+1],0);z.health=1000000;}
      let elapsed=0;
      scene.getPointerAim=()=>({target:{x:player.x+350*Math.cos(elapsed),y:player.y+350*Math.sin(elapsed)},fire:true,face:true});
      const rows=[],checkpoints=[],times={};
      for(const [owner,key,label]of[[scene,'updatePerception','perception'],[scene,'updateMinimap','minimap'],[scene.enemies,'update','enemies'],[scene.lightingSystem,'prepareLightingMask','lighting'],[scene.perceptionRenderer,'render','visionDraw']]){
        const fn=owner[key].bind(owner);owner[key]=(...args)=>{const t=performance.now(),v=fn(...args);times[label]=performance.now()-t;return v;};
      }
      const start=performance.now(),warm=start+3000,end=warm+duration*1000;let last=start,nextCheckpoint=warm;
      await new Promise(resolve=>{const tick=now=>{
        if(now>=end){resolve();return;}
        const interval=now-last;last=now;const dt=Math.min(1/30,Math.max(0,interval/1000));elapsed+=dt;
        const key=['w','d','s','a'][Math.floor(elapsed/2)%4];
        const t=performance.now();scene.update(dt,{isKeyDown:k=>k===key||k==='r'});const updated=performance.now();scene.draw(game.renderer.ctx);
        if(now>=warm)rows.push({at:now-warm,interval,update:updated-t,cpu:performance.now()-t,...times,ai:scene.enemies.metrics.perceptionMs,navigation:scene.enemies.metrics.navigationMs,movement:scene.enemies.metrics.movementMs});
        if(now>=nextCheckpoint){checkpoints.push({at:now-warm,lighting:scene.lightingSystem.getStats(),heap:performance.memory?.usedJSHeapSize,gore:scene.zombieGore.getStats()});nextCheckpoint=now+10000;}
        requestAnimationFrame(tick);
      };requestAnimationFrame(tick);});
      const stats=values=>{values.sort((a,b)=>a-b);const q=p=>+values[Math.floor((values.length-1)*p)].toFixed(3);return{p50:q(.5),p95:q(.95),p99:q(.99),max:q(1)};};
      let minWindowFps=Infinity,left=0;
      for(let right=0;right<rows.length;right++){while(rows[right].at-rows[left].at>1000)left++;if(rows[right].at>=1000)minWindowFps=Math.min(minWindowFps,right-left+1);}
      return {frames:rows.length,fps:rows.length/duration,minWindowFps,stats:Object.fromEntries(Object.keys(rows[0]).filter(k=>k!=='at').map(k=>[k,stats(rows.map(r=>r[k]))])),checkpoints,
        alive:scene.enemies.zombies.length,playerAlive:player.isAlive(),explored:grid.exploredCount,gore:scene.zombieGore.getStats(),longFrames50:rows.filter(r=>r.interval>50).length};
    },{seed,duration});
    if (profiler) {
      const {profile}=await profiler.send('Profiler.stop');
      writeFileSync(output.replace('.json','.cpuprofile'),JSON.stringify(profile));
      console.log(JSON.stringify(profile.nodes.sort((a,b)=>(b.hitCount||0)-(a.hitCount||0)).slice(0,25).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber,hits:n.hitCount}))));
    }
    const passed=result.stats.interval.p99<=25&&result.minWindowFps>=40&&result.alive===100&&result.gore.settled===600&&errors.length===0;
    report.cases.push({width,height,dpr,seed,repeat,passed,...result,errors});
    writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({width,height,dpr,seed,repeat,passed,fps:result.fps,p99:result.stats.interval.p99,minWindowFps:result.minWindowFps,cpu:result.stats.cpu}));
    await context.close();
  }
} finally { await browser.close(); }
if(process.env.PERF_ENFORCE==='1'&&report.cases.some(c=>!c.passed))process.exitCode=1;
