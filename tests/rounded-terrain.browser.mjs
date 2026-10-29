import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173',output=process.env.SCREENSHOT_DIR||'.review',results=[];
mkdirSync(output,{recursive:true});
try{
  for(const dpr of [1,1.25,2]){
    const page=await browser.newPage({viewport:{width:1100,height:800},deviceScaleFactor:dpr});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/tests/lighting-fixture.html`);await page.waitForFunction(()=>window.fixture);
    const result=await page.evaluate(async()=>{
      const {TileMap}=await import('/src/map/TileMap.ts'),{TILE_TYPES}=await import('/src/map/TileType.ts');
      const m=new TileMap(20,12,{generateWater:false});m.tileSize=50*devicePixelRatio;m.tiles.forEach(r=>r.fill('default'));
      const put=(x,y,type='wall')=>{m.tiles[y][x]=type;m.tileHp[y][x]=100};
      put(2,2,'mineral');put(6,2,'mineral');put(7,2);put(8,2,'damage_mineral');
      put(2,6);put(3,6,'mineral');put(2,7,'damage_mineral');put(3,7,'water');
      for(const x of [7,8,9])put(x,6);put(8,7,'mineral');
      put(13,2);put(14,3,'mineral');
      put(5,10,'mineral');put(6,10,'mineral');
      for(let y=6;y<=9;y++)for(let x=13;x<=16;x++)if(y===6||y===9||x===13||x===16)put(x,y,x%2?'wall':'mineral');
      for(let y=1;y<11;y++)put(18,y);
      const canvas=document.createElement('canvas'),dpr=devicePixelRatio;canvas.width=1000*dpr;canvas.height=600*dpr;
      canvas.style.cssText='width:1000px;height:600px;margin:25px';document.body.replaceChildren(canvas);
      const ctx=canvas.getContext('2d',{willReadFrequently:true}),checks=[];
      const expected=type=>[1,3,5].map(i=>parseInt(TILE_TYPES[type].color.slice(i,i+2),16));
      for(const camera of [[0,0],[.35,.65],[37.25,19.75],[-.5,-.5]]){
        ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);m.draw(ctx,camera[0]*dpr,camera[1]*dpr,canvas.width,canvas.height,0);
        const pixel=(x,y)=>[...ctx.getImageData(Math.floor((x-camera[0])*dpr),Math.floor((y-camera[1])*dpr),1,1).data];
        const color=(x,y,type)=>{const actual=pixel(x,y),want=expected(type);if(!want.every((v,i)=>Math.abs(actual[i]-v)<=2))throw Error(JSON.stringify({camera,x,y,type,actual,want}));checks.push([x,y,type])};
        color(101,101,'default');color(125,125,'mineral');color(349,125,'mineral');color(351,125,'wall');
        color(152,350,'mineral');color(150,352,'damage_mineral');color(175,375,'water');
        color(699,149,'default');color(701,151,'default');color(725,375,'default');color(925,150,'wall');
        color(299.8,525,'mineral');color(300.2,525,'mineral');
        const snapshot=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        m.draw(ctx,camera[0]*dpr,camera[1]*dpr,canvas.width,canvas.height,0);
        const repeated=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        if(!snapshot.every((v,i)=>v===repeated[i])){const i=snapshot.findIndex((v,i)=>v!==repeated[i]);throw Error(JSON.stringify({camera,dpr,index:i,x:Math.floor(i/4)%canvas.width,y:Math.floor(i/4/canvas.width),before:snapshot[i],after:repeated[i]}));}
      }
      const water=document.createElement('canvas');water.width=water.height=100;
      m.drawWaterLayer(water.getContext('2d'),150*dpr,350*dpr,100,100);
      if(water.getContext('2d').getImageData(1,1,1,1).data[3]!==0)throw Error('water tint covers a concave fillet');
      if(water.getContext('2d').getImageData(25,25,1,1).data[3]!==255)throw Error('visible water tint is missing');
      const before=m.getShadowEdges(150*dpr,350*dpr,200*dpr);m.breakTile(2,7);
      if(m.blocksLightAt(151*dpr,351*dpr)||JSON.stringify(before)===JSON.stringify(m.getShadowEdges(150*dpr,350*dpr,200*dpr)))throw Error('destruction left stale fillet geometry');
      put(2,7,'damage_mineral');m.damageTile(2,2,50);m.tileHighlight[2][2]=0;m.draw(ctx,0,0,canvas.width,canvas.height,0);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle='#e0ebef';ctx.font='18px system-ui';
      for(const [text,x,y] of [['圆角独立矿石',80,70],['异类地块连续融合',290,70],['斜对角保持分离',640,70],['内凹圆角与水面',75,280],['T 形连接',350,280],['闭合地形与孔洞',650,280]])ctx.fillText(text,x,y);
      window.roundedMap=m;
      return {dpr,checks:checks.length,polygons:m.getBlockingPolygons(0,0,canvas.width,canvas.height).length};
    });
    await page.screenshot({path:`${output}/rounded-terrain-dpr${dpr}.png`});assert.deepEqual(errors,[]);results.push(result);await page.close();
  }
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.addInitScript(()=>{let seed=8351;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)});
  await page.goto(base);
  await page.evaluate(async()=>{const entry=document.querySelector('script[type="module"][src*="/src/main.ts"]');window.roundedGame=(await import(entry.src)).game;});
  await page.keyboard.down('Enter');
  await page.waitForFunction(()=>roundedGame.sceneManager.getCurrentScene()?.constructor.name==='GameScene'&&roundedGame.sceneManager.getCurrentScene().loaded);
  await page.keyboard.up('Enter');
  await page.evaluate(()=>roundedGame.sceneManager.getCurrentScene().draw(roundedGame.renderer.ctx));
  await page.screenshot({path:`${output}/rounded-game.png`});await page.close();
  writeFileSync(`${output}/rounded-terrain.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`Rounded terrain: ${results.reduce((n,r)=>n+r.checks,0)} raster checks passed; destruction and water masks passed at all three DPRs.`);
}finally{await browser.close()}
