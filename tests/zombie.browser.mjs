import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review/zombie'; mkdirSync(output, { recursive: true });
let cases = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html`);
    await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(() => {
      const f = window.fixture, enemy = f.scene.getEnemySystem();
      const initial = enemy.snapshot();
      f.addEnemy('shambler', 700, 750, 0); f.addEnemy('runner', 670, 710, 0);
      f.tick(40);
      return { initial, after: enemy.snapshot(), budget: enemy.navigation.stats };
    });
    assert.equal(result.initial.length, 4); assert.equal(result.after.length, 6);
    assert.ok(result.budget.lastExpanded <= 512); assert.ok(result.after.some(z => z.state === 'chase'));
    await page.screenshot({ path: `${output}/encounter-dpr-${dpr}.png` });
    assert.deepEqual(errors, []); cases++; await page.close();
  }
  for (const [width, height] of [[360, 640], [640, 360], [1280, 720]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0`);
    await page.waitForFunction(() => window.fixture);
    const initial = await page.evaluate(() => {
      const f = window.fixture, vaccines = f.scene.getVaccinePickups(), p = f.scene.getPlayer(), anchor = vaccines[0].getPickupAnchor();
      p.x = anchor.x - p.getSize()/2 - 45; p.y = anchor.y - p.getSize()/2; f.tick(20);
      return { count: vaccines.length, status: f.scene.getSurvivalSystem().snapshot(), pickup: f.scene.getPickupDebugState() };
    });
    assert.equal(initial.count, 2); assert.equal(initial.status.vaccines, 0); assert.equal(initial.pickup.state, 'focused');
    await page.screenshot({ path: `${output}/vaccine-prompt-${width}x${height}.png` });
    await page.keyboard.down('e'); await page.evaluate(() => window.fixture.tick(31));
    assert.equal(await page.evaluate(() => window.fixture.scene.getSurvivalSystem().snapshot().vaccines), 1);
    await page.evaluate(() => window.fixture.tick(40));
    assert.equal(await page.evaluate(() => window.fixture.scene.getSurvivalSystem().snapshot().vaccines), 1, 'one item per hold');
    await page.keyboard.up('e'); await page.evaluate(() => { window.fixture.tick(); window.fixture.scene.getSurvivalSystem().infection.infect(); });
    await page.keyboard.down('r'); await page.keyboard.down('v'); await page.evaluate(() => window.fixture.tick());
    assert.equal(await page.evaluate(() => window.fixture.scene.getSurvivalSystem().snapshot().vaccines), 1, 'same-frame R has priority over vaccine');
    await page.keyboard.up('r'); await page.keyboard.up('v'); await page.evaluate(() => window.fixture.tick());
    await page.keyboard.down('v'); await page.evaluate(() => window.fixture.tick()); await page.keyboard.up('v');
    const treated = await page.evaluate(() => ({ status: window.fixture.scene.getSurvivalSystem().snapshot(), hp: window.fixture.scene.getPlayer().getHealth() }));
    assert.equal(treated.status.vaccines, 0); assert.equal(treated.status.infected, false); assert.equal(treated.hp, 100);
    await page.screenshot({ path: `${output}/status-${width}x${height}.png` });
    assert.deepEqual(errors, []); cases++; await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html`);
    await page.waitForFunction(() => window.fixture);
    await page.evaluate(() => {
      const f = window.fixture, p = f.scene.getPlayer(), s = f.scene.getSurvivalSystem();
      s.infection.infect(); s.inventory.addVaccines(); p.shootAt({ x: 300, y: 750 }, 10, f.map);
      p.addModifier('damage', .5, 5, true);
      const dying = f.addEnemy('runner', 700, 650, 0);
      f.scene.getEnemySystem().receiveHit(dying, { damage: 100, point: dying.getCenter(), direction: { x: 1, y: 0 }, impulse: 200, initialSpeed: 100, impactSpeed: 100, traveledDistance: 1, source: 'bullet' });
      f.map.tiles[13][18] = 'mineral'; f.map.tileHp[13][18] = 100; f.map.invalidateNavigation(); f.map.damageTile(18, 13, 1);
      f.tick();
      window.pauseSnapshot = () => JSON.stringify({ enemy: f.scene.getZombieDebugState(), hp: p.getHealth(), x: p.x, y: p.y, stamina: p.getStamina(),
        weapon: p.getWeaponLoadoutView(), bullets: p.getBullets().map(b => b.getPosition()), survival: s.snapshot(),
        noises: f.scene.getNoiseSystem().getEvents(), highlight: f.map.tileHighlight[13][18] });
    });
    await page.keyboard.press('F2'); await page.evaluate(() => window.fixture.tick());
    assert.equal(await page.evaluate(() => window.fixture.scene.isWorldPaused()), true);
    assert.equal(await page.evaluate(() => window.fixture.scene.getZombieDebugState().audioPaused), true);
    const frozen = await page.evaluate(() => window.pauseSnapshot());
    await page.keyboard.down('e'); await page.keyboard.down('v'); await page.evaluate(() => window.fixture.tick(180, 1/30));
    assert.equal(await page.evaluate(() => window.pauseSnapshot()), frozen, 'all sampled gameplay state, render highlight and audio state are frozen');
    await page.keyboard.press('F2'); await page.evaluate(() => window.fixture.tick(120));
    assert.equal(await page.evaluate(() => window.fixture.scene.getSurvivalSystem().snapshot().vaccines), 1, 'held V is not replayed after resume');
    assert.equal(await page.evaluate(() => window.fixture.scene.getPickupDebugState().progress), 0);
    await page.keyboard.up('e'); await page.keyboard.up('v'); await page.evaluate(() => window.fixture.tick());
    await page.keyboard.down('v'); await page.evaluate(() => window.fixture.tick()); await page.keyboard.up('v');
    assert.equal(await page.evaluate(() => window.fixture.scene.getSurvivalSystem().snapshot().infected), false);
    const death = await page.evaluate(() => {
      const f = window.fixture, p = f.scene.getPlayer(); p.shootAt({ x: 100, y: 750 }, 10, f.map);
      const bullet = p.getBullets().at(-1), before = bullet?.getPosition(); p.takeDamage(1000); f.tick();
      return { before, after: bullet?.getPosition(), alive: p.isAlive() };
    });
    assert.equal(death.alive, false); assert.notDeepEqual(death.before, death.after, 'old bullet continues after death');
    await page.screenshot({ path: `${output}/death-dpr-1.25.png` });
    await page.keyboard.down('Enter'); await page.evaluate(() => window.fixture.tick());
    assert.equal(await page.evaluate(() => window.fixture.game.sceneManager.getCurrentScene().constructor.name), 'MenuScene');
    assert.equal(await page.locator('[data-player-debug]').count(), 0);
    await page.evaluate(() => window.fixture.tick(30));
    assert.equal(await page.evaluate(() => window.fixture.game.sceneManager.getCurrentScene().constructor.name), 'MenuScene', 'held Enter does not start new run');
    await page.keyboard.up('Enter'); await page.evaluate(() => window.fixture.tick());
    await page.keyboard.down('Enter'); await page.evaluate(() => window.fixture.tick()); await page.keyboard.up('Enter');
    await page.waitForFunction(() => typeof window.fixture.game.sceneManager.getCurrentScene()?.getEnemySystem === 'function');
    await page.waitForSelector('[data-player-debug]');
    const fresh = await page.evaluate(() => {
      const next = window.fixture.game.sceneManager.getCurrentScene();
      return { newInstance: next !== window.fixture.scene, status: next.getSurvivalSystem().snapshot(), spawns: next.getEnemySystem().spawnReports,
        oldEnemies: window.fixture.scene.getEnemySystem().zombies.length, oldNoise: window.fixture.scene.getNoiseSystem().getEvents().length };
    });
    assert.equal(fresh.newInstance, true); assert.equal(fresh.status.infected, false); assert.equal(fresh.status.vaccines, 0); assert.equal(fresh.oldEnemies, 0); assert.equal(fresh.oldNoise, 0);
    assert.equal(fresh.spawns.find(r => r.kind === 'vaccine').spawned, 2);
    assert.equal(await page.locator('[data-player-debug]').count(), 1);
    assert.deepEqual(errors, []); cases++; await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0&seed=8`);
    await page.waitForFunction(() => window.fixture);
    const infected = await page.evaluate(() => {
      const f = window.fixture; window.attackingZombie = f.addEnemy('runner', 750, 750, 0);
      f.tick(36);
      return { status: f.scene.getSurvivalSystem().snapshot(), hp: f.scene.getPlayer().getHealth() };
    });
    assert.equal(infected.hp, 91); assert.equal(infected.status.infected, true, 'default 18% Runner infection occurs from an actual seeded melee hit');
    assert.ok(infected.status.infectionRemainder < .2, 'new infection starts after its melee frame');
    await page.screenshot({ path: `${output}/actual-melee-infection.png` });
    const shot = await page.evaluate(() => {
      const f = window.fixture, p = f.scene.getPlayer(), z = window.attackingZombie;
      p.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      for (let i=0; i<7 && z.isAlive(); i++) { p.shootAt(z.getCenter(), 10, f.map); f.tick(13); }
      f.tick(45);
      const vaccine = f.scene.getVaccinePickups()[0].getPickupAnchor();
      p.x = vaccine.x - p.getSize()/2 - 45; p.y = vaccine.y - p.getSize()/2; f.tick(20);
      return { life: z.getLifeState(), vaccines: f.scene.getVaccinePickups().length };
    });
    assert.equal(shot.life, 'removed'); assert.equal(shot.vaccines, 2, 'a zombie death adds no vaccine');
    await page.keyboard.down('e'); await page.evaluate(() => window.fixture.tick(31)); await page.keyboard.up('e'); await page.evaluate(() => window.fixture.tick());
    const beforeUse = await page.evaluate(() => ({ hp: window.fixture.scene.getPlayer().getHealth(), status: window.fixture.scene.getSurvivalSystem().snapshot() }));
    assert.equal(beforeUse.status.vaccines, 1); assert.equal(beforeUse.status.infected, true);
    await page.keyboard.down('v'); await page.evaluate(() => window.fixture.tick()); await page.keyboard.up('v');
    const cured = await page.evaluate(() => ({ hp: window.fixture.scene.getPlayer().getHealth(), status: window.fixture.scene.getSurvivalSystem().snapshot() }));
    assert.equal(cured.hp, beforeUse.hp); assert.equal(cured.status.infected, false); assert.equal(cured.status.vaccines, 0);
    assert.deepEqual(errors, []); cases++; await page.close();
  }
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0`);
    await page.waitForFunction(() => window.fixture);
    await page.evaluate(() => { window.exposedZombie = window.fixture.addEnemy('shambler', 640, 750, 0); });
    await page.keyboard.down('g'); await page.evaluate(() => window.fixture.tick(1, .3)); await page.keyboard.up('g'); await page.evaluate(() => window.fixture.tick(1, 0));
    assert.equal(await page.evaluate(() => window.fixture.scene.getEnemySystem().snapshot()[0].state), 'wander');
    await page.keyboard.down('g'); await page.evaluate(() => window.fixture.tick(1, .3)); await page.keyboard.up('g');
    assert.equal(await page.evaluate(() => window.fixture.scene.getEnemySystem().snapshot()[0].state), 'chase', 'G exposes the player in the same frame');
    const clientPoint = async (x,y) => page.evaluate(([x,y]) => { const f=window.fixture, v=f.scene.displayedView, r=f.game.renderer.ctx.canvas.getBoundingClientRect(); return {x:r.left+(x-v.x)*r.width/v.width,y:r.top+(y-v.y)*r.height/v.height}; }, [x,y]);
    const targetPoint = async () => { const p = await page.evaluate(() => window.exposedZombie.getCenter()); return clientPoint(p.x, p.y); };
    let point = await targetPoint(); await page.mouse.move(point.x,point.y); await page.mouse.down({ button: 'right' }); await page.evaluate(() => window.fixture.tick(1,0));
    assert.equal(await page.locator('[data-crosshair="root"]').getAttribute('data-crosshair-target'), '1');
    await page.evaluate(() => { window.fixture.addEnemy('runner',1200,750,Math.PI); window.fixture.tick(1,0); });
    point = await clientPoint(1200,750); await page.mouse.move(point.x,point.y); await page.evaluate(() => window.fixture.tick(1,0));
    assert.equal(await page.locator('[data-crosshair="root"]').getAttribute('data-crosshair-target'), '0', 'hidden enemies do not reveal themselves through the reticle');
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('F2'); await page.getByRole('tab', { name: '画面', exact: true }).click();
    const zoom = page.locator('[data-debug-field="graphics.camera.zoom"]'); await zoom.fill('1.2'); await zoom.press('Enter'); await page.keyboard.press('F2');
    await page.evaluate(() => { window.fixture.scene.camera.shake(12,.5,.7); window.fixture.tick(1,0); });
    point = await targetPoint(); await page.mouse.move(point.x,point.y); await page.mouse.down({ button: 'right' }); await page.evaluate(() => window.fixture.tick(1,0));
    assert.equal(await page.locator('[data-crosshair="root"]').getAttribute('data-crosshair-target'), '1', 'recognized target feedback survives zoom and camera shake');
    await page.mouse.up({ button: 'right' });
    const wall = await page.evaluate(() => {
      const f=window.fixture,p=f.scene.getPlayer(); p.x=1000-24.5;p.y=750-24.5;
      const z=f.addEnemy('shambler',1075,750,0); f.tick(1,0); f.scene.updatePerception(.3); f.scene.draw(f.game.renderer.ctx);
      const before=z.getPose(), view=f.scene.getPerceptionView(z), v=f.scene.displayedView;
      const alpha=f.scene.unitContext.getImageData(Math.round(1110-v.x),Math.round(750-v.y),1,1).data[3];
      f.scene.draw(f.game.renderer.ctx); return {before,after:z.getPose(),view,alpha};
    });
    assert.equal(wall.alpha,0,'partially occluded body details never paint onto the wall top'); assert.deepEqual(wall.before,wall.after,'drawing does not advance enemy pose');
    assert.ok(wall.view.alpha > 0 || wall.view.silhouette > 0);
    await page.screenshot({ path: `${output}/wall-occlusion-zoom-shake-dpr-${dpr}.png` });
    assert.deepEqual(errors, []); cases++; await page.close();
  }
  console.log(`Zombie browser: ${cases} encounter, combat/infection/cure, rendering, pause and lifecycle cases passed.`);
} finally { await browser.close(); }
