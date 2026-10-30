import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
// 鼠标/射击/准星回归用显式 legacy 模式：三层视野下准星只在目标被有效辨识后才收紧，
// 这里验证的是鼠标输入、弹道与准星绘制管线本身，不重复感知分级。
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = process.env.SCREENSHOT_DIR || '.review'; mkdirSync(output, { recursive: true });
const results = [];
const near = (a, b, tolerance = 1e-3) => assert.ok(Math.abs(a - b) < tolerance, a + ' != ' + b);
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/?vision=legacy`);
    await page.evaluate(async () => { window.shootingGame = (await import('/src/main.ts')).game; });
    assert.equal(await page.locator('canvas').evaluate(c => c.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }))), true);
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => shootingGame.sceneManager.getCurrentScene()?.loaded && document.querySelector('[data-player-debug]'));
    await page.keyboard.up('Enter');
    await page.mouse.move(500, 300);
    await page.screenshot({ path: join(output, 'mouse-gameplay-dpr' + dpr + '.png') });
    await page.evaluate(() => {
      const s = shootingGame.sceneManager.getCurrentScene();
      s.map = new s.map.constructor(100, 100, { generateWater: false }); s.map.tiles.forEach(row => row.fill('default'));
      s.pickupItems = []; s.goldPickups = []; s.player.x = s.player.y = 200.5;
      s.player.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      window.liveShots = 0; s.player.setOnShootCallback(() => liveShots++);
    });
    await page.mouse.move(500, 300); await page.mouse.down();
    await page.waitForFunction(() => liveShots >= 3); await page.mouse.up();
    const live = await page.evaluate(() => ({ shots: liveShots, ammo: shootingGame.sceneManager.getCurrentScene().player.getMagazineAmmo() }));
    assert.ok(live.ammo < 6, 'real running frames fire using mouse input');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const game = shootingGame, scene = game.sceneManager.getCurrentScene(), p = scene.player;
      scene.camera.reset(); scene.camera.x = 37.25; scene.camera.y = 19.75;
      p.x = p.y = 200.5; p.velocity.set(0, 0); p.bullets = []; p.fireCooldown = 0; p.recoil = 0;
      scene.chickens.forEach(c => { c.x = 1200; c.y = 1200; c.velocity.set(0, 0); });
      p.setDebugState({ magazineAmmo: 6, chambered: true }); game.input.clear();
      window.mouseTest = {
        game, scene, shots: 0,
        tick(delta = 0) { scene.update(delta, game.input); scene.draw(game.renderer.ctx); },
        render() { scene.draw(game.renderer.ctx); },
        pump(frames = 3) { for (let i = 0; i < frames; i++) { scene.deltaSinceLastFrame = .1; this.render(); } return scene.crosshairTighten; },
        client(x, y) { const v = scene.displayedView, r = scene.getCanvasViewport(); return { x: r.left + (x - v.x) * r.width / v.width, y: r.top + (y - v.y) * r.height / v.height }; },
        reset() { p.bullets = []; p.fireCooldown = 0; p.recoil = 0; p.setDebugState({ magazineAmmo: 6, chambered: true }); this.shots = 0; },
      };
      p.setOnShootCallback(() => mouseTest.shots++); mouseTest.render();
    });
    await page.mouse.move(500, 300);
    for (const shake of [false, true]) {
      const check = await page.evaluate(shake => {
        const t = mouseTest, c = t.scene.camera;
        c.x = 37.25; c.y = 19.75;
        if (shake) { c.shake(8, 1, .7, 20, 'linear'); c.shakeTime = .08; }
        t.render();
        const r = t.scene.getCanvasViewport(), o = c.getOffset(), target = t.scene.screenToWorld(500, 300);
        const bounds = t.game.renderer.ctx.canvas.getBoundingClientRect();
        const root = document.querySelector('[data-crosshair="root"]'), box = root.getBoundingClientRect();
        const color = selector => getComputedStyle(root.querySelector(selector)).backgroundColor;
        return { target, border: { left: r.left - bounds.left, top: r.top - bounds.top, width: bounds.width - r.width, height: bounds.height - r.height }, expected: { x: o.x + (500 - r.left) * t.scene.worldCanvas.width / r.width, y: o.y + (300 - r.top) * t.scene.worldCanvas.height / r.height }, overlay: { display: getComputedStyle(root).display, x: box.x, y: box.y }, arm: color('[data-crosshair="arm"]'), center: color('[data-crosshair="dot"]'), cursor: t.game.renderer.ctx.canvas.style.cursor };
      }, shake);
      near(check.target.x, check.expected.x); near(check.target.y, check.expected.y);
      assert.deepEqual(check.border, { left: 2, top: 2, width: 4, height: 4 }, 'the bitmap excludes the existing canvas border');
      // The reticle is a DOM layer at the pointer position, so zoom, shake and DPR cannot move it.
      assert.equal(check.overlay.display, 'block', 'the reticle overlay is visible');
      near(check.overlay.x, 500, .75); near(check.overlay.y, 300, .75);
      assert.equal(check.center, 'rgb(216, 250, 255)'); assert.equal(check.arm, 'rgb(216, 250, 255)', 'idle crosshair arms are white'); assert.equal(check.cursor, 'none');
      // 对局内系统指针隐藏（页面级），只留准星；调试面板自己保留可点击指针。
      assert.equal(await page.evaluate(() => document.body.classList.contains('crosshair-active')), true, 'system cursor is hidden while playing');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).cursor), 'none', 'body cursor is suppressed in game');
    }
    await page.screenshot({ path: join(output, 'mouse-aim-dpr' + dpr + '.png') });
    const coords = await page.evaluate(() => { mouseTest.scene.camera.reset(); mouseTest.render(); return mouseTest.client(625, 225); });
    await page.mouse.move(coords.x, coords.y); await page.mouse.down(); await page.mouse.up();
    const click = await page.evaluate(() => {
      const t = mouseTest; t.tick(); const b = t.scene.player.bullets[0];
      if (!b) throw Error('short click was lost');
      const start = b.getPosition(); b.update(10, t.scene.map);
      return { shots: t.shots, body: t.scene.player.currentRotation, x: b.getPosition().x + 5, y: b.getPosition().y + 5, destroyed: b.getIsDestroyed(), start };
    });
    assert.equal(click.shots, 1); near(click.x, 625); near(click.y, 225); assert.equal(click.destroyed, true);
    await page.mouse.down({ button: 'right' });
    const right = await page.evaluate(() => { const t = mouseTest, before = t.scene.player.currentRotation; t.tick(.05); return { before, after: t.scene.player.currentRotation, shots: t.shots }; });
    assert.ok(Math.abs(right.after - right.before) > .01); assert.equal(right.shots, 1);
    await page.mouse.up({ button: 'right' });
    const released = await page.evaluate(() => { const t = mouseTest, before = t.scene.player.currentRotation; t.tick(.05); return { before, after: t.scene.player.currentRotation }; });
    near(released.before, released.after);
    await page.evaluate(() => mouseTest.reset());
    await page.mouse.down({ button: 'right' }); await page.mouse.down();
    const chord = await page.evaluate(() => { mouseTest.tick(); return { pointer: mouseTest.game.input.getPointerState(), shots: mouseTest.shots }; });
    assert.equal(chord.pointer.leftDown && chord.pointer.rightDown, true, 'pressing left while right is held acquires both buttons');
    assert.equal(chord.shots, 1);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => mouseTest.game.input.getPointerState().rightDown), true);
    await page.mouse.up({ button: 'right' });
    await page.evaluate(() => mouseTest.reset());
    await page.mouse.down(); await page.mouse.down({ button: 'right' });
    await page.evaluate(() => mouseTest.tick());
    assert.equal(await page.evaluate(() => { const p = mouseTest.game.input.getPointerState(); return p.leftDown && p.rightDown; }), true);
    await page.mouse.up({ button: 'right' });
    assert.equal(await page.evaluate(() => mouseTest.game.input.getPointerState().leftDown), true);
    await page.mouse.up();
    await page.keyboard.press('ArrowRight'); await page.evaluate(() => mouseTest.tick(.3));
    assert.equal(await page.evaluate(() => mouseTest.shots), 1);
    assert.equal(await page.locator('canvas').evaluate(c => c.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }))), false);
    await page.evaluate(() => { const t = mouseTest; t.reset(); t.scene.player.x = t.scene.player.y = 200.5; t.scene.camera.reset(); t.scene.map.tiles[4][6] = 'wall'; t.scene.map.tiles[4][9] = 'mineral'; t.scene.map.tileHp[4][9] = 100; t.render(); });
    const behindWall = await page.evaluate(() => mouseTest.client(725, 225));
    await page.mouse.move(behindWall.x, behindWall.y); await page.mouse.click(behindWall.x, behindWall.y);
    const wall = await page.evaluate(() => { mouseTest.tick(); const b = mouseTest.scene.player.bullets[0]; b.update(.5, mouseTest.scene.map); return { x: b.getPosition().x + 5, hp: mouseTest.scene.map.tileHp[4][9], destroyed: b.getIsDestroyed() }; });
    near(wall.x, 295); assert.equal(wall.hp, 100); assert.equal(wall.destroyed, true);
    await page.mouse.down(); await page.mouse.move(1110, 300); await page.mouse.up();
    assert.equal(await page.evaluate(() => mouseTest.game.input.getPointerState().leftDown), false);
    assert.equal(await page.locator('canvas').evaluate(c => c.style.cursor), '');
    await page.mouse.move(500, 300); await page.mouse.down({ button: 'right' }); await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.evaluate(() => { const p = mouseTest.game.input.getPointerState(); return p.leftDown || p.rightDown || p.leftPressed || p.active; }), false);
    await page.mouse.up(); await page.mouse.up({ button: 'right' });
    await page.keyboard.press('F2');
    await page.getByRole('spinbutton').first().focus();
    assert.equal(await page.evaluate(() => mouseTest.game.input.getPointerState().active), false);
    // Resize and stationary-pointer camera changes both use the newest displayed view.
    await page.keyboard.press('Escape'); await page.setViewportSize({ width: 900, height: 650 }); await page.mouse.move(400, 250);
    const resize = await page.evaluate(() => { const t = mouseTest; t.render(); const a = t.scene.screenToWorld(400, 250); t.scene.camera.x += 70; t.scene.camera.y += 30; t.render(); const b = t.scene.getPointerAim(t.game.input).target; return { dx: b.x - a.x, dy: b.y - a.y }; });
    near(resize.dx, 70); near(resize.dy, 30);
    await page.evaluate(() => {
      const t = mouseTest, s = t.scene, w = s.screenToWorld(400, 250);
      if (!w) throw new Error('missing displayed view');
      const chicken = s.chickens.find(c => c.isAlive());
      if (!chicken) throw new Error('missing live chicken');
      chicken.x = w.x - chicken.getSize() / 2;
      chicken.y = w.y - chicken.getSize() / 2;
      chicken.velocity.set(0, 0);
      s.chickens = [chicken];
    });
    await page.mouse.move(400, 250);
    await page.mouse.down({ button: 'right' });
    assert.ok(await page.evaluate(() => mouseTest.pump()) > 0.9, 'aiming at a live chicken tightens the crosshair');
    const aimed = await page.evaluate(() => {
      const root = document.querySelector('[data-crosshair="root"]');
      return { center: getComputedStyle(root.querySelector('[data-crosshair="dot"]')).backgroundColor,
        arm: getComputedStyle(root.querySelector('[data-crosshair="arm"]')).backgroundColor };
    });
    assert.equal(aimed.center, 'rgb(216, 250, 255)', 'crosshair centre stays white on target');
    assert.equal(aimed.arm, 'rgb(255, 59, 48)', 'crosshair arms turn red on a live chicken');
    await page.screenshot({ path: join(output, 'mouse-crosshair-target-dpr' + dpr + '.png') });
    await page.mouse.move(700, 250);
    assert.ok(await page.evaluate(() => mouseTest.pump()) < 0.1, 'leaving the target relaxes the crosshair');
    const relaxed = await page.evaluate(() => getComputedStyle(document.querySelector('[data-crosshair="arm"]')).backgroundColor);
    assert.equal(relaxed, 'rgb(216, 250, 255)', 'crosshair arms return to white off target');
    await page.mouse.move(400, 250);
    assert.ok(await page.evaluate(() => mouseTest.pump()) > 0.9, 'returning to the target tightens again');
    await page.mouse.up({ button: 'right' });
    assert.ok(await page.evaluate(() => mouseTest.pump()) < 0.1, 'releasing right relaxes the crosshair');
    await page.evaluate(() => mouseTest.scene.onExit());
    assert.equal(await page.locator('canvas').evaluate(c => c.style.cursor), '');
    assert.equal(await page.evaluate(() => document.body.classList.contains('crosshair-active')), false, 'leaving the scene restores the system cursor');
    assert.equal(await page.evaluate(() => document.querySelector('[data-crosshair="root"]')), null, 'leaving the scene removes the reticle');
    assert.deepEqual(errors, []);
    results.push({ dpr, live, click, right, wall, resize }); await context.close();
  }
  writeFileSync(join(output, 'shooting-results.json'), JSON.stringify(results, null, 2));
  console.log('Browser mouse shooting passed: real live fire, quick clicks, right-button turning, first-wall sweeps, DPR/zoom/shake reticle layer, focus/leave/exit and resize.');
} finally { await browser.close(); }
