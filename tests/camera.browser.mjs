import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.cameraGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    // Let the one outstanding animation frame finish before controlled rendering.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    // Damage glow is an intentional screen overlay; exercise it in the independent composition too.
    await page.evaluate(() => {
      const scene = cameraGame.sceneManager.getCurrentScene(), player = scene.getPlayer(), c = player.getCollider().pose;
      player.resetLifeState(); player.applyDamage({ kind:'melee',amount:1,sourcePosition:{x:c.x+50,y:c.y-50} });
      scene.update(0,cameraGame.input);
    });
    for (const viewport of [{ width: 1280, height: 720 }, { width: 900, height: 600 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => cameraGame.renderer.width === width * devicePixelRatio
        && cameraGame.renderer.height === height * devicePixelRatio, viewport);
      const result = await page.evaluate(async () => {
        const [{ getWeaponListLayout }, { getPlayerStatusHudRect }, { getBackpackHudRect },
          { getPlayerVitalsHudRect, drawPlayerVitalsHud }] = await Promise.all([
          import('/src/ui/WeaponListHud.ts'), import('/src/ui/PlayerStatusHud.ts'),
          import('/src/ui/BackpackHud.ts'), import('/src/ui/PlayerVitalsHud.ts'),
        ]);
        const scene = cameraGame.sceneManager.getCurrentScene(), screen = cameraGame.renderer.ctx;
        await scene.statusHud.ready;
        scene.handleResize();
        const { camera, player, worldCanvas, lightingSystem } = scene;
        const centered = Math.abs(player.x + player.getSize() / 2 - camera.x - camera.width / 2) < 1e-8
          && Math.abs(player.y + player.getSize() / 2 - camera.y - camera.height / 2) < 1e-8;
        const colliderSize = player.getCollider().pose.size;
        scene.draw(screen);
        // Independent composition catches stretched or displaced lighting, clipped edges,
        // and accidental transforms leaking from world rendering into the screen HUD.
        const expected = document.createElement('canvas');
        expected.width = screen.canvas.width; expected.height = screen.canvas.height;
        const expectedContext = expected.getContext('2d');
        expectedContext.drawImage(worldCanvas, 0, 0, expected.width, expected.height);
        expectedContext.save(); expectedContext.scale(devicePixelRatio,devicePixelRatio);
        scene.damageFeedback.draw(expectedContext,expected.width/devicePixelRatio,expected.height/devicePixelRatio);
        const view = scene.displayedView;
        scene.floatingTexts.draw(expectedContext, view.x, view.y,
          (expected.width/devicePixelRatio)/scene.camera.width);
        scene.killIndicator?.draw(expectedContext,expected.width/devicePixelRatio,expected.height/devicePixelRatio);
        // The status, vitals and quick slots also occupy the world-comparison region.
        const width = expected.width / devicePixelRatio, height = expected.height / devicePixelRatio;
        const area = getWeaponListLayout(width, height).area;
        scene.statusHud.draw(expectedContext, scene.survival.snapshot(), width, height, area);
        const reserved = [getPlayerStatusHudRect(width, height, area), getBackpackHudRect(width, height, area), area];
        const vitals = getPlayerVitalsHudRect(width, height, reserved);
        drawPlayerVitalsHud(expectedContext, player, vitals, devicePixelRatio);
        const inventory = scene.getBackpackView();
        scene.quickSlotHud.draw(expectedContext, width, height, [...reserved, vitals],
          scene.quickSlotBindings.map(id => inventory.items.find(item => item.id === id) ?? null));
        expectedContext.restore();
        scene.drawPickupPrompts(expectedContext, scene.camera.getOffset());
        // Below the minimap HUD (circle + gold counter) the screen must be the world composite.
        // The weapon list HUD is a screen-space overlay pinned to the right edge, so the compared
        // columns stop left of it instead of assuming every pixel below the minimap is world.
        const hudBottom = 280 * devicePixelRatio;
        const rows = scene.weaponListHud.getLastStatus()?.rows ?? [];
        const weaponHudLeft = rows.length
          ? Math.min(...rows.map(row => row.brushRect.x)) - 8
          : expected.width;
        const compareWidth = Math.max(1, Math.min(expected.width, Math.floor(weaponHudLeft)));
        const actualPixels = screen.getImageData(0, hudBottom,
          compareWidth, expected.height - hudBottom).data;
        const expectedPixels = expectedContext.getImageData(0, hudBottom,
          compareWidth, expected.height - hudBottom).data;
        const samePixels = actualPixels.every((value, i) => value === expectedPixels[i]);
        const differences = [];
        if (!samePixels) for (let i=0;i<actualPixels.length && differences.length<4;i+=4) {
          if (actualPixels.slice(i,i+4).some((v,k)=>v!==expectedPixels[i+k])) differences.push({
            x:(i/4)%compareWidth,y:Math.floor(i/4/compareWidth)+hudBottom,
            actual:[...actualPixels.slice(i,i+4)],expected:[...expectedPixels.slice(i,i+4)],
          });
        }
        // The gold counter sits under the circular minimap, whose size follows the viewport, so
        // look the marker colour up in the HUD corner instead of sampling one fixed pixel.
        const hudRegion = screen.getImageData(0, 0, Math.min(screen.canvas.width, 200 * devicePixelRatio),
          Math.min(screen.canvas.height, 340 * devicePixelRatio)).data;
        let hudMarkers = 0;
        for (let i = 0; i < hudRegion.length; i += 4) {
          if (hudRegion[i] === 255 && hudRegion[i + 1] === 215 && hudRegion[i + 2] === 0) hudMarkers++;
        }
        const hud = [hudMarkers];
        const x = camera.x, y = camera.y;
        camera.follow(x + camera.width / 2 + 201, y + camera.height / 2 + 126, 1 / 60);
        const follows = camera.x > x && camera.y > y;
        const transform = screen.getTransform();
        return { centered, samePixels, differences, hud, follows, colliderSize, zoom: scene.graphics.camera.zoom,
          viewport: [camera.width, camera.height], world: [worldCanvas.width, worldCanvas.height],
          lighting: [lightingSystem.shadowCanvas.width, lightingSystem.shadowCanvas.height],
          deadZone: [camera.deadZoneWidth, camera.deadZoneHeight],
          transform: [transform.a, transform.d, transform.e, transform.f] };
      });
      const worldSize = [Math.ceil(Math.floor(viewport.width * dpr) / result.zoom), Math.ceil(Math.floor(viewport.height * dpr) / result.zoom)];
      assert.deepEqual(result.viewport, worldSize);
      assert.deepEqual(result.world, worldSize);
      assert.deepEqual(result.lighting, worldSize);
      assert.deepEqual(result.deadZone, [400, 250]);
      assert.deepEqual(result.transform, [1, 1, 0, 0]);
      assert.ok(result.hud[0] > 40, `gold counter markers: ${result.hud[0]}`);
      assert.equal(result.colliderSize, 49);
      assert.ok(result.centered && result.samePixels && result.follows, JSON.stringify(result));
    }
    await page.mouse.move(750, 300); await page.mouse.down({ button: 'right' });
    const feedback = await page.evaluate(() => {
      const scene = cameraGame.sceneManager.getCurrentScene(), c = scene.camera, p = scene.player;
      p.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      const shake = c.shake.bind(c), shots = [], results = [];
      c.shake = (...args) => { shots.push(args); shake(...args); };
      try {
        for (const zoom of [.5, 1, 2]) {
          scene.applyGraphics({ ...scene.graphics, camera: { zoom } });
          c.clearDamageKick(); shake(0, 0);
          const rect = scene.getCanvasViewport(), scale = c.width / rect.width, base = { x: c.x, y: c.y };
          scene.updateAimCamera(1, cameraGame.input);
          const first = (c.getOffset().x - c.x) / scale;
          for (let i = 0; i < 30; i++) scene.updateAimCamera(.1, cameraGame.input);
          const stable = (c.getOffset().x - c.x) / scale;
          const profiles = [];
          for (const slot of ['primary', 'secondary']) {
            p.switchWeapon(slot); p.fireCooldown = 0; p.setDebugState({ magazineAmmo: 6, chambered: true });
            p.shootAt({ x: p.x + p.getSize() / 2 + 500, y: p.y + p.getSize() / 2 });
            const [magnitude, duration, angle, frequency, decay] = shots.pop();
            profiles.push({ slot, magnitude: magnitude / scale, duration, angle, frequency, decay });
          }
          scene.draw(cameraGame.renderer.ctx);
          const pointer = cameraGame.input.getPointerState(), target = scene.screenToWorld(pointer.clientX, pointer.clientY);
          const expected = { x: c.getOffset().x + (pointer.clientX - rect.left) * c.width / rect.width,
            y: c.getOffset().y + (pointer.clientY - rect.top) * c.height / rect.height };
          results.push({ zoom, first, stable, profiles, target, expected, baseStable: c.x === base.x && c.y === base.y });
        }
        scene.setWorldPaused(true);
        const frozen = c.getOffset(); scene.update(.25, cameraGame.input);
        results.push({ paused: JSON.stringify(c.getOffset()) === JSON.stringify(frozen) });
        scene.setWorldPaused(false);
        shake(0, 0); scene.updateAimCamera(1, cameraGame.input);
        results.push({ returned: Math.hypot(c.getOffset().x - c.x, c.getOffset().y - c.y) / (c.width / scene.getCanvasViewport().width) });
        scene.handleResize();
        results.push({ cleared: c.getOffset().x === c.x && c.getOffset().y === c.y });
      } finally { c.shake = shake; }
      return results;
    });
    for (const sample of feedback.slice(0, 3)) {
      assert.ok(sample.first > 89 && sample.first < 91 && Math.abs(sample.stable - 90) < .02, JSON.stringify(sample));
      assert.equal(sample.baseStable, true, 'aim offset never feeds back into base follow');
      assert.ok(Math.abs(sample.target.x - sample.expected.x) < 1e-7 && Math.abs(sample.target.y - sample.expected.y) < 1e-7);
      for (const profile of sample.profiles) {
        assert.ok(Math.abs(profile.magnitude - (profile.slot === 'primary' ? 6.5 : 8)) < 1e-7, JSON.stringify(profile));
        assert.ok(profile.duration >= .06 && profile.duration <= .14);
        assert.ok(Math.abs(profile.angle - Math.PI) <= Math.PI / 12 + 1e-7, JSON.stringify(profile));
        assert.equal(profile.frequency, 50); assert.equal(profile.decay, 'linear');
      }
    }
    assert.equal(feedback[3].paused, true); assert.ok(feedback[4].returned < .01); assert.equal(feedback[5].cleared, true);
    await page.mouse.up({ button: 'right' });
    await page.screenshot({ path: `.review/camera-zoom-${dpr}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Camera passed: DPR 1 / 1.25 / 2, zoom .5 / 1 / 2, aim offset stability, recoil scale/direction, pause/reset, composition, HUD and follow.');
} finally { await browser.close(); }
