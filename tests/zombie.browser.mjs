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
      f.addEnemy('shambler', 900, 750, Math.PI); f.addEnemy('runner', 740, 800, -Math.PI/2);
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
  console.log(`Zombie browser: ${cases} encounter, pickup, responsive layout, pause and lifecycle cases passed.`);
} finally { await browser.close(); }
