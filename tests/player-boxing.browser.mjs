import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5182/';
const output = process.env.SCREENSHOT_DIR || '.review'; mkdirSync(output, { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(async () => {
      const { game } = await import('/src/main.ts'); window.requestAnimationFrame = () => 0;
      await new Promise(resolve => setTimeout(resolve, 50));
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      const scene = await createFixedScene(game, 60, 40, 600, 600);
      const assets = await import('/src/ui/WeaponHudAssets.ts');
      const image = new Image(); image.src = '/assets/images/weapons/fist-left-v1.png'; await image.decode();
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      let transparent = 0, opaque = 0, minX = c.width, minY = c.height, maxX = 0, maxY = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const alpha = pixels[(y * c.width + x) * 4 + 3];
        if (!alpha) transparent++;
        if (alpha > 16) { opaque++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      }
      window.boxing = { game, scene, hits: [], image: { transparent, opaque, box: [minX, minY, maxX - minX + 1, maxY - minY + 1] },
        tick(dt = 0) { scene.update(dt, game.input); scene.draw(game.renderer.ctx); },
        client() {
          const v = scene.displayedView, r = scene.getCanvasViewport();
          return { x: r.left + (scene.player.x + scene.player.getSize() / 2 + 220 - v.x) * r.width / v.width,
            y: r.top + (scene.player.y + scene.player.getSize() / 2 - v.y) * r.height / v.height };
        },
        press(timeStamp) {
          const event = new MouseEvent('mousedown', { button: 0, buttons: 3, bubbles: true, cancelable: true });
          Object.defineProperty(event, 'timeStamp', { value: timeStamp });
          game.renderer.ctx.canvas.dispatchEvent(event);
          window.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 2 }));
        },
        combo(times) {
          scene.player.cancelPunch(); scene.player.setDebugState({ stamina: 100 }); this.hits = [];
          let index = 0;
          for (let frame = 0; frame < 120; frame++) {
            while (index < times.length && times[index] <= frame / 60 * 1000 + 1e-8) this.press(times[index++]);
            this.tick(1 / 60);
            const state = scene.player.getPunchSnapshot();
            if (state && ['leftHook', 'uppercut', 'heavyStraight'].includes(state.moveId) && state.progress >= .4) break;
          }
          return { hits: this.hits.slice(), stamina: scene.player.getStamina(), state: scene.player.getPunchSnapshot() };
        },
      };
      const consume = scene.player.consumePunchImpacts.bind(scene.player);
      scene.player.consumePunchImpacts = () => {
        const events = consume(); boxing.hits.push(...events.map(event => event.moveId)); return events;
      };
      assets.weaponHudAssets.preload(['fistLeft']);
      for (let i = 0; i < 20; i++) boxing.tick(1 / 60);
    });
    await page.waitForFunction(() => boxing.scene.weaponListHud && boxing.image.opaque > 0);
    const asset = await page.evaluate(() => boxing.image);
    assert.ok(asset.transparent > 500000 && asset.opaque > 100000, 'the generated icon has real transparent alpha');
    console.log('Fist alpha/content box:', dpr, JSON.stringify(asset));

    const originalSlot = await page.evaluate(() => boxing.scene.player.getActiveWeaponSlot());
    await page.keyboard.press('KeyB');
    assert.equal(await page.evaluate(() => boxing.scene.backpackPanel.isOpen()), false, 'B no longer opens the backpack');
    await page.keyboard.down('Tab');
    assert.equal(await page.evaluate(() => boxing.scene.backpackPanel.isOpen()), true);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', repeat: true, bubbles: true, cancelable: true })));
    assert.equal(await page.evaluate(() => boxing.scene.backpackPanel.isOpen()), true, 'held Tab never toggles repeatedly');
    assert.equal(await page.evaluate(() => boxing.scene.player.getActiveWeaponSlot()), originalSlot);
    await page.keyboard.up('Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => boxing.scene.backpackPanel.isOpen()), false);
    await page.keyboard.press('F2'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => boxing.scene.debugPanel.isOpen() && !boxing.scene.backpackPanel.isOpen()), true, 'debug keeps focus navigation');
    await page.keyboard.press('F2'); await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => boxing.scene.isWorldPaused() && !boxing.scene.backpackPanel.isOpen()), true);
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      const c = boxing.game.renderer.ctx.canvas;
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })); boxing.tick();
    });
    assert.equal(await page.evaluate(() => boxing.scene.player.getActiveWeaponSlot()), 'primary');
    await page.keyboard.down('KeyC'); await page.evaluate(() => boxing.tick()); await page.keyboard.up('KeyC');
    await page.evaluate(() => boxing.tick(.3));
    assert.equal(await page.evaluate(() => boxing.scene.player.getActiveWeaponSlot()), 'melee');

    const point = await page.evaluate(() => boxing.client());
    await page.mouse.move(point.x, point.y);
    await page.mouse.down(); await page.mouse.down({ button: 'right' }); await page.evaluate(() => boxing.tick(.1));
    assert.equal(await page.evaluate(() => boxing.scene.player.getPunchSnapshot()), null, 'left-first chord never punches');
    await page.mouse.up(); await page.mouse.up({ button: 'right' });
    await page.mouse.down({ button: 'right' }); await page.evaluate(() => boxing.tick(.1));
    const guard = await page.evaluate(() => ({ pose: boxing.scene.player.getNormalPose(), hud: boxing.scene.weaponListHud.getLastStatus() }));
    assert.ok(guard.pose.leftHandX > .4 && guard.pose.rightHandX > .3);
    assert.equal(guard.hud.rows.length, 1); assert.equal(guard.hud.rows[0].ammoBox, null); assert.deepEqual(guard.hud.rows[0].bullets, []);
    await page.screenshot({ path: `${output}/boxing-guard-dpr${dpr}.png` });

    for (const [name, times, moves, stamina] of [
      ['XXX', [0, 150, 300], ['jab', 'cross', 'leftHook'], 88],
      ['X-XX', [0, 360, 510], ['jab', 'rightHook', 'uppercut'], 87],
      ['XX-X', [0, 150, 510], ['jab', 'cross', 'heavyStraight'], 86],
    ]) {
      const result = await page.evaluate(times => boxing.combo(times), times);
      assert.deepEqual(result.hits, moves); assert.equal(result.stamina, stamina);
      assert.equal(result.state.moveId, moves[2]);
      const fits = await page.evaluate(async () => {
        const { createPlayerRenderSnapshot } = await import('/src/objects/animation/PlayerVisualAdapter.ts');
        const p = boxing.scene.player, s = createPlayerRenderSnapshot(p), radius = p.getSize() * .1 * s.scale;
        return ['handL', 'handR'].every(id => {
          const hand = s.world.world[id], scale = p.getSize() * s.scale;
          const x = p.wadingCanvas.width / 2 + (hand.x * Math.cos(s.facing) - hand.y * Math.sin(s.facing)) * scale;
          const y = p.wadingCanvas.height / 2 + (hand.x * Math.sin(s.facing) + hand.y * Math.cos(s.facing)) * scale;
          return x > radius + 2 && y > radius + 2 && x + radius + 2 < p.wadingCanvas.width && y + radius + 2 < p.wadingCanvas.height;
        });
      });
      assert.equal(fits, true, 'extended fists fit inside the actual player raster without clipped knuckles');
      await page.screenshot({ path: `${output}/boxing-${name}-dpr${dpr}.png` });
      await page.evaluate(() => boxing.tick(.6));
    }

    await page.evaluate(() => { boxing.scene.player.cancelPunch(); boxing.scene.player.setDebugState({ stamina: 100 }); boxing.hits = []; boxing.press(2000); boxing.tick(.03); });
    await page.mouse.up({ button: 'right' }); await page.evaluate(() => boxing.tick(.3));
    assert.deepEqual(await page.evaluate(() => boxing.hits), [], 'right release cancels an unlanded punch');
    await page.mouse.down({ button: 'right' });
    await page.evaluate(() => { boxing.press(2500); boxing.tick(.03); });
    await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
    await page.evaluate(() => boxing.tick(0));
    assert.equal(await page.evaluate(() => boxing.scene.player.getPunchSnapshot()), null, 'release/repress between frames still cancels the old punch');
    await page.evaluate(() => { boxing.press(3000); boxing.tick(.03); });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => boxing.scene.player.getPunchSnapshot()), null, 'opening backpack cancels immediately');
    await page.evaluate(() => boxing.tick(.5)); await page.keyboard.press('Tab'); await page.evaluate(() => boxing.tick(.5));
    assert.deepEqual(await page.evaluate(() => boxing.hits), [], 'closing backpack cannot replay a click');
    await page.mouse.up({ button: 'right' });

    const target = await page.evaluate(() => boxing.client()); await page.mouse.move(target.x, target.y);
    await page.mouse.down({ button: 'right' });
    await page.evaluate(() => {
      const p = boxing.scene.player, center = { x: p.x + p.getSize() / 2 + 60, y: p.y + p.getSize() / 2 };
      boxing.zombie = boxing.scene.getEnemySystem().add('runner', center, 0);
      boxing.press(4000); boxing.tick(.1);
    });
    assert.equal(await page.evaluate(() => boxing.zombie.getHealth()), 32, 'a real scene jab damages the target once');
    await page.evaluate(() => boxing.tick(.15));
    assert.equal(await page.evaluate(() => boxing.zombie.getHealth()), 32, 'held input does not repeat a punch');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Boxing: Tab/B ownership, guard, generated alpha, three rhythms, stamina, damage and input handoff passed at DPR 1/1.25/2.');
} finally { await browser.close(); }
