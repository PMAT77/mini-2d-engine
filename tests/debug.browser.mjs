import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
let scenarios = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.debugGame = (await import(entry.src)).game;
    });
    assert.equal(await page.locator('[data-player-debug]').count(), 0, 'no debug overlay in menu');
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(async () => {
      window.requestAnimationFrame = () => 0;
      const { TileMap } = await import('/src/map/TileMap.ts');
      const scene = debugGame.sceneManager.getCurrentScene();
      scene.map = new TileMap(40, 30, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.pickupItems = [];
      scene.torches.forEach(torch => scene.lightingSystem.removeLightSource(torch.light)); scene.torches = [];
      scene.player.x = 200; scene.player.y = 250;
      window.debugTest = {
        scene,
        initialSpeed: scene.player.getConfigSnapshot().base.maxSpeed,
        initialLight: { radius: scene.playerLight.getRadius(), intensity: scene.playerLight.getIntensity() },
        brightness() {
          scene.draw(debugGame.renderer.ctx);
          const offset = scene.displayedView, v = scene.player.getVisionState();
          // Sample visible ground in world pixels; screen coordinates include DPR and zoom.
          const data = scene.worldContext.getImageData(Math.round(v.x + Math.cos(v.direction) * 220 - offset.x) - 4,
            Math.round(v.y + Math.sin(v.direction) * 220 - offset.y) - 4, 8, 8).data;
          return data.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0);
        },
        tick(delta = 0) { scene.update(delta, debugGame.input); scene.draw(debugGame.renderer.ctx); },
        advance(seconds) { for (let left = seconds; left > 1e-9; left -= 0.02) this.tick(Math.min(left, 0.02)); },
      };
    });
    const panel = page.getByRole('complementary', { name: '角色属性调试' });
    const field = name => page.locator(`[data-debug-field="${name}"]`);
    const edit = async (name, value) => { await field(name).fill(String(value)); await field(name).press('Enter'); };
    assert.equal(await panel.isVisible(), false);
    await page.keyboard.press('F2'); assert.equal(await panel.isVisible(), true);
    await page.keyboard.down('F2'); // a held key's repeat must not close/reopen the panel
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', repeat: true, bubbles: true })));
    await page.keyboard.up('F2');
    // The preceding fresh keydown toggles closed once; repeating leaves it closed.
    assert.equal(await panel.isVisible(), false); await page.getByRole('button', { name: '调试 · F2' }).click();

    assert.equal(await field('light.radius').inputValue(), '100', 'glow radius defaults to 100');
    assert.equal(await field('light.intensity').inputValue(), '0.5', 'glow intensity defaults to 0.5');
    assert.equal(await field('flashlight.intensity').inputValue(), '0.8', 'flashlight intensity defaults to 0.8');

    await edit('base.maxHealth', 200); await edit('health', 45);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getHealth()), 45);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getMaxHealth()), 200);
    await page.getByRole('button', { name: '血量回满', exact: true }).click();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getHealth()), 200);
    await field('base.maxHealth').fill('-2'); await field('base.maxHealth').press('Enter');
    assert.equal(await field('base.maxHealth').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => debugTest.scene.player.getMaxHealth()), 200);
    await edit('base.maxHealth', 200);
    await field('shooting.damage').fill('35'); await field('shooting.bulletSpeed').focus(); // blur commits too
    await edit('shooting.fireRate', 10); await edit('shooting.bulletSpeed', 1000);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getFireRate()), 0.1);
    assert.equal(await field('shooting.aimTurnDuration').count(), 0);
    await edit('shooting.maxRange', 600);
    await edit('shooting.spreadHorizontal', 1.2); await edit('shooting.spreadVertical', .8);
    await edit('shooting.maxSpreadHorizontal', 4); await edit('shooting.maxSpreadVertical', 3);
    await edit('shooting.recoilPerShot', .3); await edit('shooting.recoilRecoveryDelay', .4); await edit('shooting.recoilRecoveryDuration', 1.2);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getConfigSnapshot().shooting.maxRange), 600);
    await edit('shooting.maxSpreadHorizontal', .5);
    assert.equal(await field('shooting.maxSpreadHorizontal').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => debugTest.scene.player.getConfigSnapshot().shooting.maxSpreadHorizontal), 4);
    await edit('shooting.maxSpreadHorizontal', 4);
    await field('shooting.damage').fill('42');
    await page.evaluate(() => debugTest.advance(0.2));
    assert.equal(await field('shooting.damage').inputValue(), '42', 'refresh must not overwrite a draft');
    assert.equal(await page.evaluate(() => debugTest.scene.player.getDebugState().effectiveDamage), 35);
    await field('shooting.damage').press('Enter');

    await edit('base.maxSpeed', 500); await edit('sprint.speedMultiplier', 2);
    await edit('movement.startSpeedRatio', 0.4); await edit('movement.startupDuration', 0.2);
    await edit('movement.stopDuration', 0.4); await edit('sprint.rampDuration', 0);
    await page.locator('canvas').click({ position: { x: 120, y: 120 } });
    await page.keyboard.down('d');
    await page.evaluate(() => debugTest.tick(0.05));
    const startingSpeed = await page.evaluate(() => debugTest.scene.player.getVelocity().length());
    assert.ok(startingSpeed > 200 && startingSpeed < 500);
    await page.evaluate(() => debugTest.advance(0.4));
    assert.equal(await page.evaluate(() => debugTest.scene.player.getVelocity().length()), 500);
    await page.keyboard.down('Shift'); await page.evaluate(() => debugTest.tick(0.02));
    assert.equal(await page.evaluate(() => debugTest.scene.player.getVelocity().length()), 1000);
    await page.keyboard.up('Shift'); await page.keyboard.up('d');
    await page.evaluate(() => debugTest.tick(0.1));
    const coasting = await page.evaluate(() => debugTest.scene.player.getVelocity().length());
    assert.ok(coasting > 0 && coasting < 1000);
    await page.evaluate(() => debugTest.advance(0.4));

    await page.keyboard.down('d'); await page.mouse.down();
    await field('shooting.damage').focus();
    assert.equal(await page.evaluate(() => debugGame.input.isKeyDown('d') || debugGame.input.getPointerState().leftDown), false);
    await page.keyboard.up('d'); await page.mouse.up();
    await page.evaluate(() => { debugTest.advance(0.5); debugTest.scene.player.bullets = []; });
    const beforeEditX = await page.evaluate(() => debugTest.scene.player.x);
    await field('shooting.damage').press('ArrowUp'); await page.keyboard.press('w');
    await page.evaluate(() => debugTest.advance(0.2));
    assert.equal(await page.evaluate(() => debugTest.scene.player.x), beforeEditX);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getBullets().length), 0);
    await edit('shooting.damage', 42);
    await page.locator('canvas').click({ position: { x: 120, y: 120 } });
    await page.mouse.down(); await page.evaluate(() => debugTest.tick(0.01));
    assert.equal(await page.evaluate(() => debugTest.scene.player.getBullets()[0].getDamage()), 42);
    assert.ok(Math.abs(await page.evaluate(() => debugTest.scene.player.getBullets()[0].velocity.length()) - 1000) < 1e-8);
    await page.mouse.up();

    await edit('sprint.maxStamina', 200); await edit('stamina', 0);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getDebugState().exhausted), true);
    await page.getByRole('button', { name: '体力回满', exact: true }).click();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getStamina()), 200);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getDebugState().exhausted), false);
    await edit('sprint.drainPerSecond', 50); await edit('sprint.regenPerSecond', 20);
    await edit('sprint.regenDelay', 0.3); await edit('sprint.restartThreshold', 0.25);
    await edit('shooting.magazineSize', 8); await edit('shooting.reloadDuration', 2);
    await edit('magazineAmmo', 0); await edit('chambered', 0);
    await edit('reloadProgress', 50);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getIsReloading()), true);
    await page.evaluate(() => debugTest.tick(0.5));
    assert.ok(Math.abs(await page.evaluate(() => debugTest.scene.player.getReloadProgress()) - .75) < 1e-6);
    await page.getByRole('button', { name: '打空弹匣', exact: true }).click();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getMagazineAmmo()), 0);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getIsReloading()), false);
    await page.getByRole('button', { name: '立即换弹', exact: true }).click();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getIsReloading()), true);
    await page.getByRole('button', { name: '补满弹匣', exact: true }).click();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getMagazineAmmo()), 8);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getChambered()), true);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getIsReloading()), false);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getAutoReload()), false);
    await field('autoReload').check();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getAutoReload()), true);
    await page.getByRole('button', { name: '打空弹匣', exact: true }).click();
    await page.evaluate(() => debugTest.tick(0.01));
    assert.equal(await page.evaluate(() => debugTest.scene.player.getIsReloading()), true);
    await field('autoReload').uncheck();
    assert.equal(await page.evaluate(() => debugTest.scene.player.getAutoReload()), false);
    await page.getByRole('button', { name: '补满弹匣', exact: true }).click();

    await edit('light.radius', 80); await edit('light.intensity', 1);
    const smallLight = await page.evaluate(() => debugTest.brightness());
    await edit('light.radius', 600);
    const wideLight = await page.evaluate(() => debugTest.brightness());
    assert.ok(wideLight > smallLight, 'larger radius lights previously dark ground');
    await edit('light.intensity', 0);
    const unlit = await page.evaluate(() => debugTest.brightness());
    await edit('light.intensity', 2);
    const brightLight = await page.evaluate(() => debugTest.brightness());
    assert.ok(brightLight > wideLight && wideLight > unlit, 'intensity changes the rendered ground brightness');
    await edit('light.intensity', 3);
    assert.equal(await field('light.intensity').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => debugTest.scene.playerLight.getIntensity()), 2);
    await edit('light.radius', -1);
    assert.equal(await field('light.radius').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => debugTest.scene.playerLight.getRadius()), 600);
    await edit('light.radius', 0); await page.evaluate(() => debugTest.brightness());
    assert.equal(await page.evaluate(() => debugTest.scene.playerLight.getRadius()), 0);

    await edit('vision.range', 700);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getVisionRange()), 700);
    await edit('vision.range', 50);
    assert.equal(await field('vision.range').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => debugTest.scene.player.getVisionRange()), 700);
    await edit('vision.range', 400);

    await edit('flashlight.radius', 650);
    assert.equal(await page.evaluate(() => debugTest.scene.flashlight.getRadius()), 650);
    await edit('flashlight.intensity', 1.2);
    assert.equal(await page.evaluate(() => debugTest.scene.flashlight.getIntensity()), 1.2);
    await edit('flashlight.intensity', 3);
    assert.equal(await field('flashlight.intensity').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => debugTest.scene.flashlight.getIntensity()), 1.2);
    await edit('flashlight.radius', 400); await edit('flashlight.intensity', 0.9);

    for (const [key, initial, tuned, type] of [['shallow',40,20,'shallow_water'],['water',80,30,'water'],['deep',160,40,'deep_water'],['ultraDeep',320,50,'ultra_deep_water']]) {
      const id=`bulletWaterDrag.${key}`;
      assert.equal(await field(id).inputValue(),String(initial));
      assert.equal(await page.getByLabel(({shallow:'浅水减速',water:'普通水减速',deep:'深水减速',ultraDeep:'极深水减速'})[key],{exact:true}).count(),1);
      await edit(id,tuned);
      const actual=await page.evaluate(async({key,type})=>{
        const {Vector2}=await import('/src/math/Vector2.ts');
        const {scene}=debugTest,p=scene.player;
        scene.map.tiles.forEach(row=>row.fill(type));p.bullets=[];p.setDebugState({magazineAmmo:p.getMagazineSize(),chambered:true});p.fireCooldown=0;
        p.update(0,{isKeyDown:()=>false},scene.map);p.shoot(new Vector2(1,0));
        const bullet=p.getBullets()[0];bullet.update(.1,scene.map);
        return{rate:p.getConfigSnapshot().bulletWaterDrag[key],ratio:bullet.velocity.length()/p.getBulletSpeed()};
      },{key,type});
      assert.equal(actual.rate,tuned/100);assert.ok(Math.abs(actual.ratio-(1-tuned/1000))<1e-8);
    }
    await edit('bulletWaterDrag.deep',-1);
    assert.equal(await field('bulletWaterDrag.deep').getAttribute('aria-invalid'),'true');
    assert.equal(await page.evaluate(()=>debugTest.scene.player.getConfigSnapshot().bulletWaterDrag.deep),.4);
    await edit('bulletWaterDrag.deep',0);
    const zeroSpeed=await page.evaluate(async()=>{
      const {Vector2}=await import('/src/math/Vector2.ts');const {scene}=debugTest,p=scene.player;
      scene.map.tiles.forEach(row=>row.fill('deep_water'));p.bullets=[];p.fireCooldown=0;p.update(0,{isKeyDown:()=>false},scene.map);p.shoot(new Vector2(1,0));
      const bullet=p.getBullets()[0];bullet.update(.2,scene.map);
      const ratio=bullet.velocity.length()/p.getBulletSpeed();
      scene.map.tiles.forEach(row=>row.fill('default'));p.bullets=[];p.update(0,{isKeyDown:()=>false},scene.map);return ratio;
    });
    assert.ok(Math.abs(zeroSpeed - 1) < 1e-8, 'zero water drag preserves speed for arbitrary mouse shot angles');
    await panel.locator('section').filter({has:page.getByRole('heading',{name:'子弹水体阻力',exact:true})}).scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,`debug-water-drag-dpr-${dpr}.png`)});

    await page.evaluate(() => debugTest.scene.player.addModifier('maxSpeed', 0.5, 0, true));
    await page.getByRole('button', { name: '恢复初始参数', exact: true }).click();
    const initialSpeed = await page.evaluate(() => debugTest.initialSpeed);
    assert.equal(await field('base.maxSpeed').inputValue(), String(initialSpeed));
    assert.equal(await field('shooting.damage').inputValue(), '10');
    assert.equal(await field('shooting.maxRange').inputValue(), '1000');
    assert.equal(await field('shooting.spreadHorizontal').inputValue(), '0.6');
    for(const [key,value] of [['shallow',40],['water',80],['deep',160],['ultraDeep',320]]) assert.equal(await field(`bulletWaterDrag.${key}`).inputValue(),String(value));
    assert.equal(await page.evaluate(() => debugTest.scene.player.getMaxSpeed()), initialSpeed * 1.5);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getHealth()), 100);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getStamina()), 100);
    assert.equal(await page.evaluate(() => debugTest.scene.player.getIsReloading()), false);
    assert.deepEqual(await page.evaluate(() => ({ radius: debugTest.scene.playerLight.getRadius(), intensity: debugTest.scene.playerLight.getIntensity() })),
      await page.evaluate(() => debugTest.initialLight));
    assert.equal(await field('vision.range').inputValue(), '400', 'reset restores the fog radius baseline');
    assert.equal(await field('flashlight.radius').inputValue(), '400', 'reset restores the flashlight range baseline');
    assert.equal(await field('flashlight.intensity').inputValue(), '0.8', 'reset restores the flashlight intensity baseline');
    assert.ok((await panel.innerText()).includes(`实际 ${initialSpeed * 1.5}`));
    await panel.locator('.debug-content').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: join(output, `debug-panel-dpr-${dpr}.png`) });

    await page.keyboard.press('Escape'); assert.equal(await panel.isVisible(), false);
    await page.keyboard.press('d');
    assert.equal(await page.evaluate(() => debugGame.input.isKeyDown('d')), false, 'keyup after close leaves no stuck key');
    await page.evaluate(async () => {
      const { MenuScene } = await import('/src/scenes/MenuScene.ts');
      debugGame.sceneManager.changeScene(new MenuScene(), 0);
    });
    assert.equal(await page.locator('[data-player-debug]').count(), 0);
    await page.evaluate(() => debugTest.scene.playerLight.setRadius(900));
    await page.evaluate(async () => { await debugGame.sceneManager.changeScene(debugTest.scene, 0); });
    await page.waitForSelector('[data-player-debug]');
    assert.equal(await page.locator('[data-player-debug]').count(), 1);
    await page.keyboard.press('F2'); assert.equal(await panel.isVisible(), true);
    await page.getByRole('button', { name: '恢复初始参数', exact: true }).click();
    assert.equal(await field('base.maxSpeed').inputValue(), String(initialSpeed), 'reentry retains original reset baseline');
    assert.equal(await field('light.radius').inputValue(), String(await page.evaluate(() => debugTest.initialLight.radius)));

    await page.setViewportSize({ width: 360, height: 640 });
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 640);
    assert.ok(await panel.locator('.debug-content').evaluate(element => element.scrollHeight > element.clientHeight));
    await panel.locator('.debug-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: join(output, `debug-panel-narrow-dpr-${dpr}.png`) });
    assert.deepEqual(errors, []);
    scenarios += 22;
    await context.close();
  }
  console.log(`Debug panel: ${scenarios} scenarios passed across DPR 1 / 1.25 / 2`);
} finally { await browser.close(); }
