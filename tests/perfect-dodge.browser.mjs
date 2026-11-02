import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review/perfect-dodge'; mkdirSync(output, { recursive: true });
const baseUrl = (process.env.TEST_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
try {
  for (const fps of [30, 60, 144]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseUrl}/tests/zombie-fixture.html?count=0`); await page.waitForFunction(() => window.fixture);
    await page.evaluate(fps => {
      const f = window.fixture, s = f.scene, enemies = s.getEnemySystem(), p = s.getPlayer();
      window.dodgeCheck = {
        kicks: 0,
        attack(delay, side = 'left') {
          const c = p.getCollider().pose;
          const z = side === 'left' ? f.addEnemy('shambler', c.x - 60, c.y, 0) : f.addEnemy('shambler', c.x, c.y - 60, Math.PI / 2);
          z.attack.start(enemies.time + delay - z.config.windup, side === 'left' ? 0 : Math.PI / 2);
        },
        state() {
          return { health: p.getHealth(), stamina: p.getStamina(), rolling: p.isRolling(),
            texts: s.floatingTexts.getTexts().filter(t => t.text === '完美闪避').map(t => ({ ...t })),
            window: p.perfectDodgeTimeLeft, infected: s.getSurvivalSystem().snapshot().infected,
            damage: s.getCombatFeedbackState().player, kicks: this.kicks, hitReact: p.getHitReactProgress() };
        },
      };
      const kick = s.camera.kickFromDamage.bind(s.camera);
      s.camera.kickFromDamage = angle => { window.dodgeCheck.kicks++; kick(angle); };
      window.dodgeCheck.attack(2 / fps); window.dodgeCheck.attack(2 / fps, 'above');
    }, fps);
    await page.keyboard.down('d'); await page.keyboard.down('Space');
    const start = await page.evaluate(fps => { window.fixture.tick(1, 1 / fps); return window.dodgeCheck.state(); }, fps);
    assert.equal(start.rolling, true); assert.equal(start.stamina, 90); assert.equal(start.texts.length, 0);
    const success = await page.evaluate(fps => { window.fixture.tick(1, 1 / fps); return window.dodgeCheck.state(); }, fps);
    assert.equal(success.health, 100); assert.equal(success.stamina, 95); assert.equal(success.texts.length, 1);
    assert.equal(success.infected, false); assert.deepEqual(success.damage, []); assert.equal(success.kicks, 0); assert.equal(success.hitReact, 0);
    await page.evaluate(fps => { window.dodgeCheck.attack(1 / fps, 'above'); window.fixture.tick(1, 1 / fps); }, fps);
    const repeat = await page.evaluate(() => window.dodgeCheck.state());
    assert.equal(repeat.health, 100); assert.equal(repeat.stamina, 95); assert.equal(repeat.texts.length, 1);
    await page.keyboard.up('d'); await page.keyboard.up('Space');
    await page.screenshot({ path: `${output}/success-${fps}fps.png` });

    await page.keyboard.press('F2');
    await page.locator('[data-debug-field="roll.perfectDodgeWindow"]').fill('0.2');
    await page.locator('[data-debug-field="roll.perfectDodgeWindow"]').press('Enter');
    await page.locator('[data-debug-field="roll.perfectDodgeStaminaReward"]').fill('7');
    await page.locator('[data-debug-field="roll.perfectDodgeStaminaReward"]').press('Enter');
    const frozen = await page.evaluate(() => window.dodgeCheck.state());
    await page.evaluate(() => window.fixture.tick(180, 1 / 30));
    assert.deepEqual(await page.evaluate(() => window.dodgeCheck.state()), frozen, 'pause freezes window, feedback and stamina');
    assert.equal(await page.evaluate(() => window.fixture.scene.getPlayer().getConfigSnapshot().roll.perfectDodgeWindow), .2);
    await page.keyboard.press('F2');

    const expired = await page.evaluate(fps => {
      const f = window.fixture; let left = .151 - 2 / fps;
      while (left > 1e-9) { const dt = Math.min(left, 1 / fps); f.tick(1, dt); left -= dt; }
      window.dodgeCheck.attack(.001); f.tick(1, .001);
      return window.dodgeCheck.state();
    }, fps);
    assert.equal(expired.health, 88, 'editing window while paused does not extend the active roll');
    assert.equal(expired.stamina, 95); assert.equal(expired.texts.length, 1); assert.equal(expired.kicks, 1);

    await page.evaluate(fps => {
      const f = window.fixture, p = f.scene.getPlayer();
      f.scene.getEnemySystem().dispose(); p.resetLifeState(); f.tick(1, 1.5); p.setDebugState({ stamina: 100 });
      p.x = 800 - p.getSize() / 2; p.y = 750 - p.getSize() / 2;
      window.dodgeCheck.attack(2 / fps);
    }, fps);
    await page.keyboard.down('Space'); await page.evaluate(fps => window.fixture.tick(1, 1 / fps), fps);
    const next = await page.evaluate(fps => { window.fixture.tick(1, 1 / fps); return window.dodgeCheck.state(); }, fps);
    await page.keyboard.up('Space');
    assert.equal(next.health, 100); assert.equal(next.stamina, 97, 'next roll uses the edited 7-point reward');
    assert.equal(next.texts.length, 1, 'previous floating text expired before the new success');
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Perfect dodge browser: 30/60/144 FPS input, multi-hit, single feedback, pause, F2 settings and next-roll rewards passed.');
} finally { await browser.close(); }
