import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
let cases=0;
try{
  for(const dpr of [1,1.25,2]){
    const page=await browser.newPage({viewport:{width:1100,height:900},deviceScaleFactor:dpr});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:5173'}/tests/collision-fixture.html`);
    await page.waitForFunction(()=>!!window.fixture);await page.locator('#run').uncheck();
    for(const fps of [30,60,144])for(const scene of ['wall','corner','corridor','water']){
      const result=await page.evaluate(({fps,scene})=>{
        const f=window.fixture;f.setup(scene,'square');let penetration=0;
        for(let i=0;i<Math.ceil(fps/4);i++){f.step(1/fps,['ArrowUp']);penetration=Math.max(penetration,f.snapshot().penetration)}
        return{...f.snapshot(),penetration};
      },{fps,scene});
      assert.ok(result.penetration<=0.01,JSON.stringify({dpr,fps,scene,result}));
      if(scene==='wall')assert.ok(Math.abs(result.x-210.1482)<0.05);
      if(scene==='corner')assert.ok(result.x>=215&&result.y>=265,'the square starts clear of the concave fillet');
      if(scene==='corridor')assert.ok(result.angle<0.04&&result.x<201.02);
      if(scene==='water')assert.ok(Math.abs(result.factor-0.75)<0.001);
      cases++;
    }
    for(const shape of ['circle','concave','compound']){
      const result=await page.evaluate(shape=>{const f=window.fixture;f.setup('water',shape);for(let i=0;i<120;i++)f.step(1/120,['d']);return f.snapshot()},shape);
      assert.ok(result.penetration<=0.01&&result.factor>=0.499&&result.factor<=1);
      cases++;
    }
    for(const fps of [30,60,144]){
      const corridor=await page.evaluate(fps=>{
        const f=window.fixture;f.setup('corridor');f.player.applyConfig({animation:{breathingAmplitude:30}});
        const initial=f.snapshot();let penetration=0;
        for(let i=0;i<2*fps;i++){f.step(1/fps);penetration=Math.max(penetration,f.snapshot().penetration)}
        const afterBreathing=f.snapshot();
        for(let i=0;i<Math.ceil(0.4*fps);i++)f.step(1/fps,['s']);const outward=f.snapshot();
        for(let i=0;i<Math.ceil(0.4*fps);i++)f.step(1/fps,['w']);
        return{initial,afterBreathing,outward,back:f.snapshot(),penetration};
      },fps);
      assert.deepEqual(corridor.initial.bounds,corridor.afterBreathing.bounds,'breathing cannot change the body');
      assert.ok(corridor.penetration<=0.01&&corridor.back.penetration<=0.01);
      assert.ok(corridor.outward.y>corridor.initial.y+48&&corridor.back.y<corridor.outward.y-48,'player must reverse in the narrow corridor');
      cases++;
      const corner=await page.evaluate(fps=>{
        const f=window.fixture;f.setup('wall');f.map.tiles.forEach(row=>row.fill('default'));f.map.tiles[4][4]='wall';f.player.x=180;f.player.y=151;
        let penetration=0;for(let i=0;i<Math.ceil(0.75*fps);i++){f.step(1/fps,['d','s']);penetration=Math.max(penetration,f.snapshot().penetration)}
        return{...f.snapshot(),penetration};
      },fps);
      assert.ok(corner.x>260&&corner.y>185&&corner.penetration<=0.01,'diagonal corner contact must retain sliding movement');
      cases++;
    }
    const long=await page.evaluate(()=>{const f=window.fixture;f.setup('wall','square');return f.step(0.5,['ArrowUp'])});
    assert.ok(long.penetration<=0.01&&Math.abs(long.x-210.1482)<0.05);
    assert.deepEqual(errors,[]);
    if(process.env.COLLISION_SCREENSHOT){
      await page.evaluate(()=>{const f=window.fixture;f.setup('wall');f.player.applyConfig({animation:{breathingAmplitude:20}});f.player.setIdleTime(Math.PI/4);f.render()});
      await page.screenshot({path:process.env.COLLISION_SCREENSHOT.replace('.png',`-${dpr}.png`)});
    }
    await page.close();
  }
  console.log(`Browser collision regression: ${cases} DPR/frame-rate/shape cases passed, plus long-frame checks.`);
}finally{await browser.close()}
