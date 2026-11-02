import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });
try {
  for (const dpr of [1,2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5182/');
    await page.evaluate(async () => {
      const {game} = await import('/src/main.ts'); window.requestAnimationFrame = () => 0;
      await new Promise(r=>setTimeout(r,60));
      const {createFixedScene} = await import('/tests/fixed-scene.ts');
      window.tGame=game;window.tScene=await createFixedScene(game,50,40,900,800);
      tScene.perception.rules.ambientIdentifies=true;
      window.tick=(dt=0)=>{tScene.update(dt,game.input);tScene.draw(game.renderer.ctx);};
      window.advance=seconds=>{for(let n=0;n<Math.round(seconds*120);n++)tScene.update(1/120,game.input);tScene.draw(game.renderer.ctx);};
      tScene.survival.inventory.add('grenade',3);tScene.survival.inventory.add('smokeGrenade',3);
      window.dispatchEvent(new Event('focus'));advance(.5);
    });
    await page.keyboard.press('KeyB');
    const tabs=page.locator('.backpack-tab'); assert.equal(await tabs.count(),4);
    const assets = await page.evaluate(async () => {
      const paths = ['ui/inventory/grenade', 'ui/inventory/smoke-grenade', 'ui/inventory/category-throwables', 'throwables/grenade-world', 'throwables/smoke-grenade-world'];
      const results = [];
      for (const path of paths) {
        const image = new Image(); image.src = `/assets/images/${path}.png`; await image.decode();
        for (const size of [32,48,64]) {
          const canvas = document.createElement('canvas');canvas.width=canvas.height=size;
          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,size,size);
          const pixels=ctx.getImageData(0,0,size,size).data;
          results.push({path,size,clear:pixels.filter((v,i)=>i%4===3&&v===0).length,solid:pixels.filter((v,i)=>i%4===3&&v>200).length});
        }
      }
      return results;
    });
    assert.ok(assets.every(a=>a.clear>a.size*a.size*.4 && a.solid>20),'all five assets retain real alpha and visible small-size silhouettes');
    await tabs.filter({hasText:'投掷物'}).click();
    assert.match(await page.locator('.backpack-properties').innerText(),/120/);
    const row=id=>page.locator(`[data-item-id="${id}"]`);
    for(const [id,slot] of [['grenade',0],['smokeGrenade',1]]) {
      await row(id).click({button:'right'});await page.locator(`[data-bind-slot="${slot}"]`).click();
    }
    await page.evaluate(()=>tick());await page.screenshot({path:`.review/throwables-backpack-dpr${dpr}.png`});
    const keyTap = async key => { await page.keyboard.down(key); await page.evaluate(()=>tick()); await page.keyboard.up(key); await page.evaluate(()=>tick()); };
    await page.keyboard.press('KeyB'); await keyTap('Digit1');
    assert.equal(await page.evaluate(()=>tScene.throwable.held),'grenade');
    const point=await page.evaluate(()=>{
      const p=tScene.player.getVisionState(),c=tScene.camera.getOffset(),v=tScene.getCanvasViewport();
      return {x:v.left+(p.x-c.x+260)*v.width/tScene.camera.width,y:v.top+(p.y-c.y)*v.height/tScene.camera.height};
    });
    await page.mouse.move(point.x,point.y);await page.mouse.down({button:'right'});await page.evaluate(()=>tick());
    await page.mouse.down({button:'left'});await page.evaluate(()=>advance(1));
    const armed=await page.evaluate(()=>({fuse:tScene.throwable.fuse,count:tScene.survival.inventory.getCount('grenade'),locked:tScene.throwable.locked}));
    assert.ok(armed.locked && Math.abs(armed.fuse-3)<.01);assert.equal(armed.count,3);
    await page.screenshot({path:`.review/throwables-aim-dpr${dpr}.png`});
    for(const key of ['Tab','Digit2','KeyC','Space','KeyV','KeyR']) await keyTap(key);
    await page.mouse.wheel(0,120);await page.waitForTimeout(30);await page.evaluate(()=>tick());
    assert.equal(await page.evaluate(()=>tScene.throwable.held),'grenade');assert.equal(await page.evaluate(()=>tScene.player.isRolling()),false);
    await page.keyboard.press('KeyB');await page.evaluate(()=>advance(.5));
    assert.ok(Math.abs(await page.evaluate(()=>tScene.throwable.fuse)-2.5)<.01,'bag does not freeze fuse');
    await tabs.filter({hasText:'投掷物'}).click();await row('grenade').click({button:'right'});
    assert.equal(await page.locator('[data-action="drop"]').isDisabled(),true);
    await page.keyboard.press('Escape');await page.evaluate(()=>advance(5));
    assert.ok(Math.abs(await page.evaluate(()=>tScene.throwable.fuse)-2.5)<.01,'ESC freezes fuse');
    await page.keyboard.press('Escape');
    await page.mouse.up({button:'left'});await page.mouse.up({button:'right'});await page.evaluate(()=>tick());
    assert.equal(await page.evaluate(()=>tScene.throwableBodies.length),0,'modal cleanup does not throw');
    await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});await page.mouse.up({button:'left'});await page.evaluate(()=>tick());
    assert.equal(await page.evaluate(()=>tScene.survival.inventory.getCount('grenade')),2, JSON.stringify(await page.evaluate(()=>({pointer:tGame.input.getPointerState(),paused:tScene.paused,blocked:tGame.input.isBlocked(),held:tScene.throwable,cursor:tScene.cursorVisible,bag:tScene.backpackPanel.isOpen()}))));
    assert.equal(await page.evaluate(()=>tScene.throwableBodies.length),1);
    await page.mouse.up({button:'right'});
    await page.evaluate(()=>advance(3.05));assert.equal(await page.evaluate(()=>tScene.throwableBodies.length),0);
    assert.equal(await page.evaluate(()=>tScene.throwable.held),'grenade');
    await keyTap('Digit2');
    await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});await page.evaluate(()=>advance(5));
    assert.equal(await page.evaluate(()=>tScene.throwable.fuse),4,'smoke has no cooked fuse');
    await page.mouse.up({button:'left'});await page.mouse.up({button:'right'});await page.evaluate(()=>advance(2));
    assert.equal(await page.evaluate(()=>tScene.survival.inventory.getCount('smokeGrenade')),2);
    const smoke=await page.evaluate(()=>{
      const b=tScene.throwableBodies.find(b=>b.kind==='smokeGrenade');return {x:b.x,y:b.y,age:b.smokeAge,density:tScene.smoke.density(b.x,b.y)};
    });assert.ok(smoke.age>1 && smoke.density>.9);
    const visibility=await page.evaluate(({x,y})=>{
      tScene.player.x=x-24.5;tScene.player.y=y-24.5;
      const near=tScene.enemies.add('shambler',{x:x+45,y}),far=tScene.enemies.add('shambler',{x:x+125,y});
      tScene.updatePerception(.1);tick();
      return {near:tScene.getEntityVisibility(near),far:tScene.getEntityVisibility(far),detail:tScene.getEntityAlpha(near),opacity:tScene.map.sightOpacity(x,y,x+200,y)};
    },smoke);
    assert.equal(visibility.near,'silhouette');assert.equal(visibility.far,'hidden');assert.equal(visibility.detail,0);assert.ok(visibility.opacity>.9);
    const beforePickup = await page.evaluate(async () => {
      const { VaccinePickup } = await import('/src/objects/VaccinePickup.ts'); const p = tScene.player.getVisionState();
      tScene.vaccinePickups.push(new VaccinePickup(p.x + 20, p.y - 10)); tick(); return tScene.survival.inventory.getVaccines();
    });
    await page.keyboard.down('KeyE'); await page.evaluate(() => advance(.6)); await page.keyboard.up('KeyE');
    assert.equal(await page.evaluate(() => tScene.survival.inventory.getVaccines()), beforePickup + 1, 'real E interaction works inside smoke');
    await page.screenshot({path:`.review/throwables-smoke-dpr${dpr}.png`});
    await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));});
    const age=await page.evaluate(()=>tScene.throwableBodies[0].smokeAge);await page.evaluate(()=>advance(4));
    assert.equal(await page.evaluate(()=>tScene.throwableBodies[0].smokeAge),age);
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));});await page.keyboard.press('F2');await page.evaluate(()=>advance(4));
    assert.equal(await page.evaluate(()=>tScene.throwableBodies[0].smokeAge),age,'debug also freezes smoke');
    await page.keyboard.press('F2');
    // Stop enemies for visual and expiry checks; gameplay sensing was checked above and by unit tests.
    await page.evaluate(()=>{tScene.enemies.dispose();advance(14);});assert.equal(await page.evaluate(()=>tScene.throwableBodies.length),0);
    await page.keyboard.press('KeyB');await tabs.filter({hasText:'投掷物'}).click();
    const beforeDrop=await page.evaluate(()=>tScene.survival.inventory.getCount('grenade'));
    await row('grenade').click({button:'right'});await page.locator('[data-action="drop"]').click();
    assert.equal(await page.evaluate(()=>tScene.survival.inventory.getCount('grenade')),beforeDrop-1);
    assert.equal(await page.evaluate(()=>tScene.throwableBodies.length),0,'ordinary discard never arms');
    await page.keyboard.press('KeyB');await page.evaluate(()=>advance(.3));
    await page.keyboard.down('KeyE');await page.evaluate(()=>advance(.6));await page.keyboard.up('KeyE');
    assert.equal(await page.evaluate(()=>tScene.survival.inventory.getCount('grenade')),beforeDrop,'E recovers discarded item');
    await page.setViewportSize({width:390,height:844});await page.keyboard.press('KeyB');await page.evaluate(()=>tick());
    await tabs.filter({hasText:'投掷物'}).click();
    const overflow=await page.evaluate(()=>document.querySelector('.backpack-panel').getBoundingClientRect().right>innerWidth || document.querySelector('.backpack-tabs').scrollWidth>document.querySelector('.backpack-tabs').clientWidth);
    assert.equal(overflow,false);await page.screenshot({path:`.review/throwables-mobile-dpr${dpr}.png`});
    await page.keyboard.press('KeyB');await page.evaluate(()=>{tScene.onExit();});
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Throwable browser: mouse chords, locks, pause, smoke, UI and DPR 1/2 passed');
} finally { await browser.close(); }
