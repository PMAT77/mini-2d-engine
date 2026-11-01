import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review/zombie-v12'; mkdirSync(output, { recursive: true });
let cases = 0;
try {
  for (const dpr of [1, 1.25, 2]) for (const [width, height] of [[360, 640], [640, 360], [1280, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0`);
    await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(async () => {
      const f = window.fixture, p = f.scene.getPlayer(), canvas = f.game.renderer.ctx.canvas;
      const { DamageFeedbackOverlay } = await import('/src/ui/DamageFeedbackOverlay.ts');
      const overlay = new DamageFeedbackOverlay(), surface = document.createElement('canvas'); surface.width = 360; surface.height = 640;
      const ctx = surface.getContext('2d'), samples = [[3, 320], [357, 320], [180, 3], [180, 637]], directions = [];
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4; overlay.clear(); ctx.clearRect(0, 0, 360, 640);
        overlay.push({ sequence: i, kind: 'melee', amount: 12, appliedAmount: 12, targetPosition: { x: 0, y: 0 }, sourcePosition: { x: Math.cos(a), y: Math.sin(a) } });
        overlay.draw(ctx, 360, 640);
        directions.push(samples.map(([x,y]) => ctx.getImageData(x,y,1,1).data[3]));
      }
      const target = p.getCollider().pose;
      p.applyDamage({ kind: 'melee', amount: 12, sourcePosition: { x: target.x + 50, y: target.y - 50 } }); f.tick(1, 0);
      const before = f.scene.getCombatFeedbackState().player;
      p.applyDamage({ kind: 'melee', amount: 12, sourcePosition: { x: target.x - 50, y: target.y } }); f.tick(1, 0);
      const after = f.scene.getCombatFeedbackState().player;
      const z = f.addEnemy('shambler', 700, 650, 0);
      f.scene.getEnemySystem().receiveHit(z, { damage: 1, point: z.getCenter(), direction: { x: 1, y: 0 }, impulse: 0, impactSpeed: 1, initialSpeed: 1, traveledDistance: 0, source: 'bullet' });
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 160;
      z.draw(sprite.getContext('2d'), z.x - 50, z.y - 50);
      const white = [...sprite.getContext('2d').getImageData(73,73,1,1).data];
      f.tick(1, 0);
      return { directions, before, after, white, canvas: [canvas.width,canvas.height], state: f.scene.getCombatFeedbackState() };
    });
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, expected = [Math.cos(a) < -.1, Math.cos(a) > .1, Math.sin(a) < -.1, Math.sin(a) > .1];
      assert.deepEqual(result.directions[i].map(v => v > 10), expected, `DPR ${dpr} direction ${i}`);
    }
    assert.deepEqual(result.before, result.after, 'blocked hit cannot create red glow');
    assert.deepEqual(result.white, [255,255,255,255], 'hit sprite is solid white');
    assert.equal(result.state.gore.drops.length, 6); assert.ok(result.state.player.length > 0);
    assert.deepEqual(result.canvas, [Math.round(width*dpr),Math.round(height*dpr)]);
    await page.screenshot({ path: `${output}/direction-hit-${width}x${height}-dpr-${dpr}.png` });
    await page.keyboard.press('F2'); await page.evaluate(() => window.fixture.tick());
    const frozen = await page.evaluate(() => JSON.stringify(window.fixture.scene.getCombatFeedbackState()));
    await page.evaluate(() => window.fixture.tick(180, 1/30));
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.scene.getCombatFeedbackState())), frozen, 'feedback pauses with F2');
    await page.evaluate(()=>{window.fixture.scene.getPlayer().resetLifeState();window.fixture.tick();});
    assert.deepEqual(await page.evaluate(()=>window.fixture.scene.getCombatFeedbackState().player),[],'explicit life reset clears old damage glow even while paused');
    assert.deepEqual(errors, []); cases++; await context.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 420 } });
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0`); await page.waitForFunction(() => window.fixture);
    const poses = await page.evaluate(async () => {
      const { Zombie } = await import('/src/enemies/Zombie.ts'), { ZombieRenderer } = await import('/src/enemies/ZombieRenderer.ts');
      const { ZOMBIE_CONFIG } = await import('/src/enemies/ZombieConfig.ts');
      const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 420;
      document.querySelector('canvas').style.display = 'none'; document.body.append(canvas);
      const ctx = canvas.getContext('2d'), samples = [];
      ctx.fillStyle = '#26312c'; ctx.fillRect(0,0,1100,420);
      for (const [row,kind] of ['shambler','runner'].entries()) {
        const c = ZOMBIE_CONFIG[kind], z = new Zombie('preview',0,0,c); z.attack.start(0,0);
        const times = [0, c.windup-c.swingSeconds-.01, c.windup-c.swingSeconds/2, c.windup, c.windup+c.followThroughSeconds/2, c.windup+c.recovery*.65];
        times.forEach((t,col) => {
          z.attack.advance(t); const pose = { ...z.getPose(), x: col*180+55, y: row*200+90 };
          const before = JSON.stringify(pose); ZombieRenderer.shadow(ctx,pose); ZombieRenderer.draw(ctx,pose);
          ctx.fillStyle = '#e9e5d9'; ctx.font = '14px sans-serif'; ctx.fillText(`${kind} ${t.toFixed(3)}s`, col*180+12,row*200+30);
          ctx.fillText(pose.attack.phase,col*180+12,row*200+53);
          samples.push({ phase:pose.attack.phase, stable:before===JSON.stringify(pose), parts:ZombieRenderer.parts(pose) });
        });
      }
      return samples;
    });
    assert.ok(poses.every(p => p.stable)); assert.ok(poses.some(p => p.phase === 'strike')); assert.ok(poses.some(p => p.phase === 'followThrough'));
    assert.notDeepEqual(poses[1].parts,poses[3].parts,'windup and impact have visibly distinct geometry');
    await page.screenshot({ path: `${output}/attack-sequence.png` }); cases++; await page.close();
  }
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width:1280,height:720 }, deviceScaleFactor:dpr });
    const page = await context.newPage(), errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0`); await page.waitForFunction(()=>window.fixture);
    const immediate = await page.evaluate(()=>{
      const f=window.fixture,p=f.scene.getPlayer(),v=p.getVisionState(),c=p.getCollider().pose;
      const z=f.addEnemy('runner',c.x+Math.cos(v.direction)*85,c.y+Math.sin(v.direction)*85,0);
      f.scene.updatePerception(.4); f.scene.draw(f.game.renderer.ctx);
      const before=f.scene.getZombieDebugState().actors;
      const impact={damage:1000,point:z.getCenter(),direction:{x:1,y:0},impulse:200,impactSpeed:100,initialSpeed:100,traveledDistance:1,source:'bullet'};
      f.scene.getEnemySystem().receiveHit(z,impact);
      const after=f.scene.getZombieDebugState().actors;
      f.tick(1,0); const first=f.scene.getCombatFeedbackState();
      f.scene.getEnemySystem().receiveHit(z,impact); f.tick(1,0);
      return {before,after,life:z.getLifeState(),first,again:f.scene.getCombatFeedbackMetrics()};
    });
    assert.equal(immediate.before-immediate.after,1); assert.equal(immediate.life,'removed');
    assert.equal(immediate.first.gore.flying.length,6); assert.equal(immediate.again.flying,6); assert.equal(immediate.again.blood,1);
    await page.screenshot({path:`${output}/remains-flash-dpr-${dpr}.png`});
    await page.evaluate(()=>window.fixture.tick(1,.18)); await page.screenshot({path:`${output}/remains-flight-dpr-${dpr}.png`});
    await page.keyboard.press('F2'); await page.evaluate(()=>window.fixture.tick());
    const frozen=await page.evaluate(()=>JSON.stringify(window.fixture.scene.getCombatFeedbackState()));
    await page.evaluate(()=>window.fixture.tick(180,1/30));
    assert.equal(await page.evaluate(()=>JSON.stringify(window.fixture.scene.getCombatFeedbackState())),frozen,'flying remains and permanent decals freeze');
    await page.keyboard.press('F2'); await page.evaluate(()=>window.fixture.tick(1,.7));
    assert.equal(await page.evaluate(()=>window.fixture.scene.getCombatFeedbackMetrics().settled),6);
    await page.screenshot({path:`${output}/remains-ground-dpr-${dpr}.png`});
    const hidden=await page.evaluate(()=>{
      const f=window.fixture,s=f.scene,z=f.addEnemy('shambler',1250,750,0);s.updatePerception(.4);s.draw(f.game.renderer.ctx);
      const v=s.displayedView,ctx=s.worldContext,x=Math.max(0,Math.round(1170-v.x)),y=Math.max(0,Math.round(670-v.y));
      const w=Math.min(160,ctx.canvas.width-x),h=Math.min(160,ctx.canvas.height-y);
      const before=[...ctx.getImageData(x,y,w,h).data], identifiable=s.perception.canIdentify('player',1250,750);
      s.getEnemySystem().receiveHit(z,{damage:1000,point:z.getCenter(),direction:{x:1,y:0},impulse:200,impactSpeed:100,initialSpeed:100,traveledDistance:1,source:'bullet'});f.tick(1,0);
      return {identifiable,unchanged:JSON.stringify(before)===JSON.stringify([...ctx.getImageData(x,y,w,h).data])};
    });
    assert.equal(hidden.identifiable,false); assert.equal(hidden.unchanged,true,'hidden death gives no blood, flash or fragment detail');
    const cleared=await page.evaluate(()=>{const s=window.fixture.scene;s.onExit();return s.getCombatFeedbackState();});
    assert.deepEqual(cleared.player,[]);assert.deepEqual(cleared.gore,{drops:[],flying:[],settled:[]});assert.deepEqual(cleared.blood,{zombies:[],chickens:[]});
    assert.deepEqual(errors,[]);cases++;await context.close();
  }
  console.log(`Combat feedback browser: ${cases} DPR/layout, directional glow, strike, gore, visibility, pause and cleanup cases passed.`);
} finally { await browser.close(); }
