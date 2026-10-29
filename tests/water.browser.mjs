import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173',output=process.env.SCREENSHOT_DIR||'.review';
const performanceMode=process.argv.includes('--performance'),results=[];
mkdirSync(output,{recursive:true});
async function checkWading(page){
  return page.evaluate(async()=>{
    const {Player}=await import('/src/objects/Player.ts'),{TileMap}=await import('/src/map/TileMap.ts');
    const {TILE_TYPES}=await import('/src/map/TileType.ts');
    const map=new TileMap(8,8,{generateWater:false}),p=new Player(75.5,75.5),empty={isKeyDown:()=>false};
    p.applyConfig({animation:{breathingAmplitude:0}});
    const canvas=document.createElement('canvas'),dpr=devicePixelRatio;canvas.width=240*dpr;canvas.height=220*dpr;
    const ctx=canvas.getContext('2d');let camera=[0,0],checks=0;
    const expect=(value,message)=>{if(!value)throw Error(message);checks++;};
    const pixel=(x,y)=>[...ctx.getImageData(Math.floor((x-camera[0])*dpr),Math.floor((y-camera[1])*dpr),1,1).data];
    const render=(ui=true)=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr,0,0,dpr,0,0);p.draw(ctx,...camera);if(ui)p.drawUI(ctx,...camera);};
    const color=(actual,expected,message)=>expect(actual[3]===255&&expected.every((v,i)=>Math.abs(actual[i]-v)<=3),`${message}: ${actual} vs ${expected}`);
    const tinted=(type,x=112,y=112)=>{
      const water=p.wadingMap;p.wadingMap=undefined;render(false);const dry=pixel(x,y);p.wadingMap=water;render();
      if(!type)return dry.slice(0,3);
      const hex=TILE_TYPES[type].color;return dry.slice(0,3).map((v,i)=>Math.round(v*.65+parseInt(hex.slice(i*2+1,i*2+3),16)*.35));
    };
    const arrowColors={shallow_water:[98,186,255],water:[177,143,178],deep_water:[255,100,100]};
    const chevrons=rgb=>{const layout=p.getOverlayLayout(...camera);for(const dy of [-6,1,8])color(pixel(layout.debuffX+camera[0],layout.debuffY+camera[1]+dy),rgb,'all chevrons use the depth color');};
    map.tiles.forEach(row=>row.fill('default'));p.update(.12,empty,map);render();
    expect(pixel(112,112)[3]===255,'cylinder body is opaque');
    expect(p.wadingAlpha===0,'dry land has no debuff');
    map.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<2?'default':'shallow_water'));
    p.update(.04,empty,map);expect(Math.abs(p.wadingAlpha-.5)<1e-7,'80ms fade-in midpoint');
    p.update(.04,empty,map);render();
    color(pixel(88,112),tinted(undefined,88,112),'dry half remains unchanged');color(pixel(112,112),tinted('shallow_water'),'wet half tint');
    chevrons(arrowColors.shallow_water);
    expect(pixel(100,100)[3]===255,'cylinder head stays opaque');expect(pixel(140,100)[3]===0,'mask cannot tint the background');
    const buffer=p.wadingCanvas;
    map.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<2?'shallow_water':'deep_water'));p.update(0,empty,map);render();
    color(pixel(88,112),tinted('shallow_water',88,112),'shallow half of depth transition');color(pixel(112,112),tinted('deep_water'),'deep half of depth transition');
    chevrons([177,143,178]);
    map.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<2?'default':'deep_water'));p.update(0,empty,map);render();
    chevrons(arrowColors.deep_water);
    expect(p.wadingCanvas===buffer,'reuse the player buffer');
    for(const type of ['shallow_water','water','deep_water']){
      map.tiles.forEach(row=>row.fill(type));p.update(.08,empty,map);
      for(const offset of [[0,0],[.375,.625],[13.25,7.75]]){
        camera=offset;render();color(pixel(112,112),tinted(type),`${type}, camera ${offset}`);
        const layout=p.getOverlayLayout(...camera);
        chevrons(arrowColors[type]);
      }
    }
    camera=[.375,.625];const bounds=JSON.stringify(p.getCollider().bounds);
    for(const angle of [0,Math.PI/4,Math.PI,Math.PI*1.5]){
      p.currentRotation=angle;p.aimAngle=angle;p.aimVisible=true;p.cooldownBarAlpha=1;render();
      expect(pixel(100,100)[3]===255,'rotated head remains intact');expect(JSON.stringify(p.getCollider().bounds)===bounds,'render rotation must not alter the circular collider');
      const {debuffX,debuffY}=p.getOverlayLayout(...camera);color(pixel(debuffX+camera[0],debuffY+camera[1]-6),arrowColors.deep_water,'rotation does not rotate the debuff');
    }
    p.applyConfig({animation:{breathingAmplitude:30}});p.aimVisible=false;p.velocity.set(0,0);
    for(const time of [Math.PI/4,Math.PI*3/4]){p.setIdleTime(time);render();expect(pixel(100,100)[3]===255,'breathing head remains intact');expect(JSON.stringify(p.getCollider().bounds)===bounds,'breathing does not change the body');}
    const breathingBuffer=p.wadingCanvas,extent=breathingBuffer.width;p.setIdleTime(0);render();
    expect(p.wadingCanvas===breathingBuffer&&breathingBuffer.width===extent,'breathing must not reallocate the buffer');
    p.sprite=undefined;p.applyConfig({animation:{breathingAmplitude:0}});render();
    color(pixel(100,100),tinted('deep_water',100,100),'cylinder head tint');
    const speedQuery=map.getShapeSpeedFactor;map.getShapeSpeedFactor=()=>{throw Error('draw requested terrain speed');};map.getTerrainCoverage=()=>{throw Error('draw requested coverage');};render();map.getShapeSpeedFactor=speedQuery;
    map.tiles.forEach(row=>row.fill('default'));p.update(0,empty,map);render();color(pixel(100,100),tinted(undefined,100,100),'leaving water immediately clears model tint');
    p.update(.06,empty,map);expect(Math.abs(p.wadingAlpha-.5)<1e-7,'120ms fade-out midpoint');p.update(.06,empty,map);render();
    expect(p.wadingAlpha===0,'debuff fades out completely');
    const layout=p.getOverlayLayout(...camera);expect(pixel(layout.debuffX+camera[0],layout.debuffY+camera[1])[3]===0,'dry debuff pixels are gone');
    return checks;
  });
}
async function checkBulletVisuals(page){
  return page.evaluate(async()=>{
    const {Bullet}=await import('/src/objects/Bullet.ts'),{TileMap}=await import('/src/map/TileMap.ts');
    const {Vector2}=await import('/src/math/Vector2.ts'),{ParticleSystem}=await import('/src/objects/ParticleSystem.ts');
    const {TILE_TYPES}=await import('/src/map/TileType.ts'),{circleCollider}=await import('/src/physics/Collider.ts');
    const map=new TileMap(8,8,{generateWater:false}),canvas=document.createElement('canvas'),dpr=devicePixelRatio;
    canvas.width=canvas.height=220*dpr;const ctx=canvas.getContext('2d');let checks=0;
    const expect=(value,message)=>{if(!value)throw Error(message);checks++;};
    const pixel=(x,y)=>[...ctx.getImageData(Math.floor(x*dpr),Math.floor(y*dpr),1,1).data];
    const tint=(type,base=[255,255,0])=>{const hex=TILE_TYPES[type].color;return base.map((v,i)=>Math.round(v*.65+parseInt(hex.slice(i*2+1,i*2+3),16)*.35));};
    const color=(actual,rgb,message)=>expect(actual[3]===255&&rgb.every((v,i)=>Math.abs(v-actual[i])<=4),`${message}: ${actual} vs ${rgb}`);
    const clear=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr,0,0,dpr,0,0);};
    // Masking also applies to dry-origin bullets without altering their speed.
    const bullet=new Bullet(new Vector2(100,100),new Vector2(800,0));
    for(const type of ['shallow_water','water','deep_water','ultra_deep_water']){
      map.tiles.forEach(row=>row.fill(type));clear();bullet.draw(ctx,0,0,map);
      color(pixel(100,100),tint(type),`${type} bullet tint`);
      expect(pixel(107,100)[3]===0,'water must not color outside the circle');
    }
    map.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<2?'default':'deep_water'));
    clear();bullet.draw(ctx,0,0,map);color(pixel(97,100),[255,255,0],'dry half');color(pixel(102,100),tint('deep_water'),'wet half');
    map.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<2?'shallow_water':'deep_water'));
    clear();bullet.draw(ctx,0,0,map);color(pixel(97,100),tint('shallow_water'),'shallow half');color(pixel(102,100),tint('deep_water'),'deep half');
    map.tiles.forEach(row=>row.fill('water'));
    for(const [x,y] of [[.375,.625],[13.25,7.75]]){clear();bullet.draw(ctx,x,y,map);color(pixel(100-x,100-y),tint('water'),'fractional camera and shake');}
    map.tiles.forEach(row=>row.fill('default'));clear();bullet.draw(ctx,0,0,map);color(pixel(100,100),[255,255,0],'land restores the original color');
    map.tiles.forEach(row=>row.fill('deep_water'));bullet.setColor('#ffffff');clear();bullet.draw(ctx,0,0,map);color(pixel(100,100),tint('deep_water',[255,255,255]),'custom bullet color');
    clear();bullet.draw(ctx);color(pixel(100,100),[255,255,255],'drawing without a map remains compatible');
    const curved=new TileMap(100,100,{seed:8351});curved.tiles.forEach(row=>row.fill('default'));
    const lake=curved.water.lakes[0],cy=lake.center.y*50,seen=new Set();
    for(let x=lake.bounds.x*50;x<lake.center.x*50;x+=3){
      const type=curved.water.getTypeAt(x,cy,50);if(!type||seen.has(type))continue;
      if(Math.abs(curved.getShapeSpeedFactor(circleCollider(x,cy,5))-TILE_TYPES[type].speedFactor)>1e-7)continue;
      const b=new Bullet(new Vector2(x,cy),new Vector2(800,0));clear();b.draw(ctx,x-100,cy-100,curved);
      color(pixel(100,100),tint(type),`curved lake ${type}`);seen.add(type);
    }
    expect(seen.size===4,'generated lake mask must include all four depths');
    const particles=new ParticleSystem(),stopped=new Bullet(new Vector2(100,100),new Vector2(100,0),10,particles,true);
    stopped.update(.625,map);expect(stopped.getIsDestroyed(),'drag must remove the bullet');
    const stopX=stopped.getPosition().x+5;
    clear();stopped.draw(ctx,0,0,map);expect(pixel(stopX,100)[3]===0,'stopped bullet is invisible');
    particles.draw(ctx,0,0);color(pixel(stopX,100),[255,255,255],'white annihilation particles render at the stop position');
    particles.update(.3);clear();particles.draw(ctx,0,0);expect(pixel(stopX,100)[3]===0,'annihilation particles expire');
    return checks;
  });
}
async function checkWaterBullets(page,dpr){
  await page.goto(base);
  await page.evaluate(async()=>{
    const entry=document.querySelector('script[type="module"][src*="/src/main.ts"]');
    window.waterBulletGame=(await import(entry.src)).game;
  });
  await page.keyboard.down('Enter');await page.waitForFunction(()=>waterBulletGame.sceneManager.getCurrentScene()?.loaded);await page.keyboard.up('Enter');
  const measurements=[];
  for(const wet of [true,false]){
    await page.evaluate(async wet=>{
      const {TileMap}=await import('/src/map/TileMap.ts');
      const scene=waterBulletGame.sceneManager.getCurrentScene(),p=scene.player;
      if(window.waterBulletRun){p.update=waterBulletRun.original;scene.particleSystem.createExplosion=waterBulletRun.originalExplosion;}
      scene.map=new TileMap(30,24,{generateWater:false});
      scene.map.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<5?'default':col===5?'shallow_water':col===6?'water':col===7?'deep_water':'ultra_deep_water'));
      scene.pickupItems=[];scene.goldPickups=[];scene.particleSystem.clear();
      p.bullets=[];p.fireCooldown=0;p.isOverheated=false;p.shootingTimeRemaining=10;
      p.applyConfig({shooting:{fireRate:5,maxShootingTime:10}});
      p.x=(wet?245:225)-24.5;p.y=500-24.5;p.velocity.set(0,0);
      p.update(0,{isKeyDown:()=>false},scene.map);scene.camera.reset();
      window.waterBulletRun={original:p.update,originalExplosion:scene.particleSystem.createExplosion,bursts:[],bullet:undefined,samples:[],frames:0,wet,originCoverage:p.terrainWaterCoverage.fraction,depths:new Set()};
      scene.particleSystem.createExplosion=function(...args){waterBulletRun.bursts.push({count:args[1],colors:args[5],x:args[0].x,y:args[0].y});return waterBulletRun.originalExplosion.apply(this,args);};
      p.update=function(...args){
        waterBulletRun.original.apply(this,args);
        const r=waterBulletRun;r.frames++;r.bullet??=this.bullets[0];
        if(r.bullet&&!r.bullet.getIsDestroyed()){
          const x=r.bullet.getPosition().x+5,y=r.bullet.getPosition().y+5;
          r.samples.push({x,speed:r.bullet.velocity.length()});r.depths.add(scene.map.getSpeedFactor(x,y));
        }
      };
    },wet);
    // Warm up map/light rendering before input so asset setup time is not the firing frame's delta.
    await page.waitForFunction(()=>waterBulletRun.frames>=3);
    const waterTarget = await page.evaluate(() => {
      const s = waterBulletGame.sceneManager.getCurrentScene(), p = s.player;
      p.applyConfig({ shooting: { maxRange: 2000, spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      s.draw(waterBulletGame.renderer.ctx); const v = s.displayedView, r = s.getCanvasViewport();
      return { x: r.left + (900 - v.x) * r.width / v.width, y: r.top + (500 - v.y) * r.height / v.height };
    });
    await page.mouse.move(waterTarget.x, waterTarget.y); await page.mouse.down();
    await page.waitForFunction(()=>waterBulletRun.samples.length>=8);
    await page.mouse.up();
    if(wet)await page.screenshot({path:`${output}/water-bullets-dpr${dpr}.png`});
    await page.waitForFunction(()=>waterBulletRun.depths.size>=3||waterBulletRun.bullet.getIsDestroyed());
    const result=await page.evaluate(()=>{
      const r=waterBulletRun;
      return{wet:r.wet,coverage:r.originCoverage,samples:r.samples,depths:[...r.depths]};
    });
    assert.ok(result.depths.length>=3,JSON.stringify(result));
    assert.ok(wet?result.coverage>1e-6&&result.coverage<1:result.coverage===0);
    for(let i=0;i<result.samples.length;i++){
      const sample=result.samples[i];
      if(wet){if(i)assert.ok(sample.speed<=result.samples[i-1].speed+1e-7);}
      else assert.ok(Math.abs(sample.speed-800)<1e-7);
    }
    if(wet){
      assert.ok(result.samples.at(-1).speed<800,'water-origin bullet must lose speed while traversing depth bands');
      await page.waitForFunction(()=>waterBulletRun.bullet.getIsDestroyed());
      const stopped=await page.evaluate(()=>({speed:waterBulletRun.bullet.velocity.length(),remaining:waterBulletGame.sceneManager.getCurrentScene().player.getBullets().length,bursts:waterBulletRun.bursts}));
      assert.equal(stopped.speed,0);assert.equal(stopped.remaining,0);
      assert.equal(stopped.bursts.length,1);assert.equal(stopped.bursts[0].count,4);assert.deepEqual(stopped.bursts[0].colors,['#ffffff']);
      await page.screenshot({path:`${output}/water-bullet-annihilation-dpr${dpr}.png`});
    }
    measurements.push(result);
  }
  await page.evaluate(()=>{const scene=waterBulletGame.sceneManager.getCurrentScene();scene.player.update=waterBulletRun.original;scene.particleSystem.createExplosion=waterBulletRun.originalExplosion;});
  writeFileSync(`${output}/water-bullets-dpr${dpr}.json`,JSON.stringify(measurements,null,2)+'\n');
}
try{
  for(const dpr of performanceMode?[1,2]:[1,1.25,2]){
    const page=await browser.newPage({viewport:{width:1280,height:performanceMode?720:1000},deviceScaleFactor:dpr});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:'export {};'}));
    if(!performanceMode){
      await page.goto(`${base}/tests/water-fixture.html`);await page.waitForFunction(()=>!!window.waterFixture);await page.locator('#run').uncheck();
      for(const fps of [30,60,144]){
        const state=await page.evaluate(fps=>{
          const f=waterFixture;f.setup();let penetration=0;
          for(let i=0;i<fps*3;i++)penetration=Math.max(penetration,f.step(1/fps,['d','Shift']).penetration);
          penetration=Math.max(penetration,f.step(.5,['d','Shift']).penetration,f.step(.5).penetration);
          const startY=f.player.y;
          for(let i=0;i<fps;i++)penetration=Math.max(penetration,f.step(1/fps,['d','s']).penetration);
          f.render();return{...f.snapshot(),penetration,slide:f.player.y-startY};
        },fps);
        assert.ok(state.penetration<=0.01&&state.slide>25,JSON.stringify({dpr,fps,state}));
      }
      const pixels=await page.evaluate(async()=>{
        const f=waterFixture;f.setup();f.player.x=f.player.y=-10000;f.render();
        const {circleCollider}=await import('/src/physics/Collider.ts'),{TILE_TYPES}=await import('/src/map/TileType.ts');
        const y=f.lake.center.y*50,ctx=document.querySelector('canvas').getContext('2d');const samples=[];
        for(let x=f.lake.bounds.x*50;x<f.lake.center.x*50;x+=7){
          const factor=f.map.getSpeedFactor(x,y),footprint=f.map.getShapeSpeedFactor(circleCollider(x,y,8));
          if(factor===1||Math.abs(factor-footprint)>1e-7)continue;
          const type=f.map.water.getTypeAt(x,y,50),hex=TILE_TYPES[type].color;
          const pixel=ctx.getImageData(Math.round((x-f.camera.x)*f.zoom*devicePixelRatio),Math.round((y-f.camera.y)*f.zoom*devicePixelRatio),1,1).data;
          samples.push({type,expected:[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),actual:[...pixel].slice(0,3)});
        }
        return samples;
      });
      assert.equal(new Set(pixels.map(p=>p.type)).size,4);
      for(const sample of pixels)assert.ok(sample.actual.every((v,i)=>Math.abs(v-sample.expected[i])<=5),JSON.stringify(sample));
      const wadingChecks=await checkWading(page);
      const bulletVisualChecks=await checkBulletVisuals(page);
      await page.evaluate(()=>{waterFixture.setup();waterFixture.step(.08);waterFixture.camera.x+=.375;waterFixture.camera.y+=.625;waterFixture.render()});
      await page.screenshot({path:`${output}/water-dpr${dpr}.png`});
      console.log(`Water browser DPR ${dpr}: 30/60/144 FPS, long frames, sliding, ${pixels.length} color/seam samples and ${wadingChecks} wading-overlay checks passed.`);
      await checkWaterBullets(page,dpr);
      console.log(`Water bullets DPR ${dpr}: ${bulletVisualChecks} mask/particle pixel checks, real mouse input, cross-depth drag, white annihilation and dry-origin full speed passed.`);
    }else{
      await page.goto(base);
      await page.evaluate(async()=>{const entry=document.querySelector('script[type="module"][src*="/src/main.ts"]');window.waterGame=(await import(entry.src)).game;});
      await page.keyboard.down('Enter');await page.waitForFunction(()=>waterGame.sceneManager.getCurrentScene()?.loaded);await page.keyboard.up('Enter');
      const setup=await page.evaluate(async()=>{
        const {TileMap}=await import('/src/map/TileMap.ts');const scene=waterGame.sceneManager.getCurrentScene();
        scene.map=new TileMap(100,100,{seed:8351});scene.pickupItems=[];
        const m=scene.map,lake=m.water.lakes[0],cy=lake.center.y*50;
        const {circleCollider}=await import('/src/physics/Collider.ts');
        let left,right;
        for(let x=lake.bounds.x*50;x<lake.center.x*50;x+=2){const factor=m.getShapeSpeedFactor(circleCollider(x,cy,24.5));if(left===undefined&&factor<.99)left=x-30;if(factor>.24999&&factor<.25001&&m.isShapeWalkable(circleCollider(x,cy,24.5))){right=x;break;}}
        for(let row=Math.floor((cy-75)/50);row<=Math.ceil((cy+75)/50);row++)for(let col=Math.floor((left-75)/50);col<=Math.ceil((right+75)/50);col++)m.tiles[row][col]='default';
        window.waterPerf={scene,left,right,cy,originalUpdate:scene.update.bind(scene)};
        scene.player.x=left-24.5;scene.player.y=cy-24.5;scene.camera.x=left-scene.camera.width/2;scene.camera.y=cy-scene.camera.height/2;
        return{left,right,cy};
      });
      for(const sprint of [false,true]){
        const result=await page.evaluate(async sprint=>{
          const f=waterPerf,p=f.scene.player;let direction=1,recording=false;
          p.x=f.left-24.5;p.y=f.cy-24.5;p.stamina=p.sprint.maxStamina;p.exhausted=false;
          const updates=[],draws=[],overlays=[],intervals=[],depths=new Set();const originalPlayerUpdate=p.update.bind(p),originalPlayerDraw=p.draw.bind(p),originalPlayerUI=p.drawUI.bind(p);
          p.update=(...args)=>{const start=performance.now();originalPlayerUpdate(...args);if(recording)updates.push(performance.now()-start)};
          p.draw=(...args)=>{const start=performance.now();originalPlayerDraw(...args);if(recording)draws.push(performance.now()-start)};
          p.drawUI=(...args)=>{const start=performance.now();originalPlayerUI(...args);if(recording)overlays.push(performance.now()-start)};
          f.scene.update=delta=>{
            if(p.x+24.5>=f.right)direction=-1;if(p.x+24.5<=f.left)direction=1;
            f.originalUpdate(delta,{isKeyDown:key=>key===(direction>0?'d':'a')||(sprint&&key==='Shift')});
            if(recording)depths.add(f.scene.map.getSpeedFactor(p.x+24.5,p.y+24.5));
          };
          await new Promise(resolve=>{
            let warmup,started,previous;
            function tick(now){warmup??=now;if(now-warmup>=1000){if(!started){started=now;recording=true;}if(previous)intervals.push(now-previous);previous=now;if(now-started>=5000){recording=false;resolve();return;}}requestAnimationFrame(tick);}requestAnimationFrame(tick);
          });
          p.update=originalPlayerUpdate;p.draw=originalPlayerDraw;p.drawUI=originalPlayerUI;
          const summarize=a=>{const sorted=a.slice().sort((a,b)=>a-b);return{meanMs:a.reduce((a,b)=>a+b,0)/a.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)}};
          p.x=f.right-24.5;p.update(0,{isKeyDown:()=>false},f.scene.map);
          const scratch=document.createElement('canvas');scratch.width=scratch.height=192;const ctx=scratch.getContext('2d'),wet=p.wadingMap,alpha=p.wadingAlpha;
          const render=()=>{p.draw(ctx,p.x+24.5-96,p.y+24.5-96);p.drawUI(ctx,p.x+24.5-96,p.y+24.5-96);};
          const measure=masked=>{p.wadingMap=masked?wet:undefined;p.wadingAlpha=masked?1:0;for(let i=0;i<10;i++)render();const start=performance.now();for(let i=0;i<300;i++){ctx.clearRect(0,0,192,192);render();}return(performance.now()-start)/300;};
          const baseMeanMs=measure(false),maskedMeanMs=measure(true);p.wadingMap=wet;p.wadingAlpha=alpha;
          return{sprint,frames:intervals.length,playerUpdate:summarize(updates),playerDraw:summarize(draws),playerOverlay:summarize(overlays),drawComparison:{samples:300,baseMeanMs,maskedMeanMs,addedMeanMs:maskedMeanMs-baseMeanMs},frameInterval:summarize(intervals),depths:[...depths].sort(),position:[p.x,p.y]};
        },sprint);
        result.dpr=dpr;result.path=setup;result.errors=errors;results.push(result);console.log(JSON.stringify(result));
        writeFileSync(`${output}/water-performance.json`,JSON.stringify(results,null,2)+'\n');
        assert.ok(result.frames>=200,'incomplete five-second recording');
        assert.ok(result.depths.includes(.75)&&result.depths.includes(.5)&&result.depths.includes(.25),'path must cross each walkable water depth');
        assert.ok(result.playerUpdate.p95Ms<=2,`water movement p95 ${result.playerUpdate.p95Ms}ms exceeds 2ms`);
      }
      await page.screenshot({path:`${output}/water-game-dpr${dpr}.png`});
    }
    assert.deepEqual(errors,[]);await page.close();
  }
}finally{await browser.close()}
