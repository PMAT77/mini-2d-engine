import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const overlaps = (a, b) => a.width > 0 && b.width > 0 && a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.statusGame = (await import(entry.src)).game;
      window.requestAnimationFrame = () => 0;
      await new Promise(resolve => setTimeout(resolve, 50));
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      window.statusScene = await createFixedScene(statusGame, 60, 40, 600, 600);
      window.statusModules = {
        status: await import('/src/ui/PlayerStatusHud.ts'),
        vitals: await import('/src/ui/PlayerVitalsHud.ts'),
        weapons: await import('/src/ui/WeaponListHud.ts'),
        backpack: await import('/src/ui/BackpackHud.ts'),
        slots: await import('/src/ui/QuickSlotHud.ts'),
      };
      await statusScene.backpackHud.icon?.decode();
    });

    const states = await page.evaluate(() => {
      const { status } = statusModules;
      const canvas = document.createElement('canvas');
      canvas.width = 1280 * devicePixelRatio; canvas.height = 720 * devicePixelRatio;
      const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
      const rect = status.getPlayerStatusHudRect(1280, 720), diameter = 44;
      const texts = [], originalText = ctx.fillText.bind(ctx);
      ctx.fillText = (text, ...args) => { texts.push(text); originalText(text, ...args); };
      const pixel = (x, y) => [...ctx.getImageData(Math.floor(x * devicePixelRatio), Math.floor(y * devicePixelRatio), 1, 1).data];
      const sampleSegments = row => Array.from({ length: 12 }, (_, i) => {
        const angle = -Math.PI / 2 + (i + .5) * Math.PI / 6;
        return pixel(rect.x + 22 + Math.cos(angle) * 20.5, rect.y + 22 + row * 60 + Math.sin(angle) * 20.5);
      });
      const iconInk = row => {
        const data = ctx.getImageData((rect.x + 8) * devicePixelRatio,
          (rect.y + 8 + row * 60) * devicePixelRatio, 28 * devicePixelRatio, 28 * devicePixelRatio).data;
        let alpha = 0, red = 0, green = 0, blue = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] < 50) continue;
          alpha += data[i + 3]; red += data[i]; green += data[i + 1]; blue += data[i + 2];
        }
        return { alpha, red, green, blue };
      };
      const results = {};
      for (const [name, extra] of [
        ['full', {}], ['half', { satietyRatio: .5, hydrationRatio: .5 }],
        ['empty', { satietyRatio: 0, hydrationRatio: 0 }],
        ['low', { satietyRatio: .25, hydrationRatio: .25 }],
        ['invalid', { satietyRatio: NaN, hydrationRatio: Infinity }],
        ['clamped', { satietyRatio: -1, hydrationRatio: 2 }],
        ['infected', { infected: true }], ['treatable', { infected: true, vaccines: 1 }],
        ['tick', { infected: true, vaccines: 1, infectionRemainder: .99 }],
        ['dead', { alive: false, infected: true, vaccines: 1 }],
      ]) {
        const view = Object.freeze({ alive: true, infected: false, vaccines: 0, infectionRemainder: 0, ...extra });
        texts.length = 0; ctx.clearRect(0, 0, 1280, 720);
        ctx.globalAlpha = .8; ctx.strokeStyle = '#123456'; ctx.lineWidth = 7;
        ctx.globalCompositeOperation = 'source-over';
        statusScene.statusHud.draw(ctx, view, 1280, 720);
        const transform = ctx.getTransform();
        results[name] = { rings: [sampleSegments(0), sampleSegments(1)], icons: [iconInk(0), iconInk(1), iconInk(2)],
          texts: [...texts], transform: [transform.a, transform.d, transform.e, transform.f],
          alpha: ctx.globalAlpha, stroke: ctx.strokeStyle, lineWidth: ctx.lineWidth,
          composite: ctx.globalCompositeOperation };
      }
      return results;
    });
    // 输入 alpha=.8，填充会与底轨混色；容差仍足以区分两种刻度和空轨。
    const filled = (pixels, rgb) => pixels.filter(pixel => rgb.every((value, i) => Math.abs(pixel[i] - value) < 35)).length;
    const colors = [[193, 170, 121], [123, 171, 183]];
    for (let row = 0; row < 2; row++) {
      assert.equal(filled(states.full.rings[row], colors[row]), 12, 'missing needs default to full');
      assert.equal(filled(states.half.rings[row], colors[row]), 6, 'half needs fill six clockwise segments');
      assert.deepEqual(states.half.rings[row].slice(0, 6), states.full.rings[row].slice(0, 6), 'filled half starts at the top');
      assert.deepEqual(states.half.rings[row].slice(6), states.empty.rings[row].slice(6), 'remaining clockwise half stays empty');
      assert.equal(filled(states.empty.rings[row], colors[row]), 0, 'zero needs leave an empty track');
      assert.equal(filled(states.low.rings[row], [207, 116, 106]), 3, 'low needs use three coral segments');
      assert.deepEqual(states.invalid.rings[row], states.full.rings[row], 'non-finite needs default to full');
      assert.ok(states.full.icons[row].alpha > 1000, 'real PNG icon is visible on the first loaded frame');
    }
    assert.deepEqual(states.clamped.rings[0], states.empty.rings[0], 'negative need clamps to zero');
    assert.deepEqual(states.clamped.rings[1], states.full.rings[1], 'excess need clamps to one');
    assert.ok(states.infected.icons[2].red > states.infected.icons[2].green * 1.6, 'infected symbol turns coral');
    assert.ok(states.full.icons[2].red < states.infected.icons[2].red * .7, 'healthy infection symbol remains muted');
    assert.ok(states.dead.icons[0].alpha < states.full.icons[0].alpha * .5, 'death dims the whole HUD');
    assert.deepEqual(states.tick.icons, states.treatable.icons, 'infection tick fraction is not a progress meter');
    for (const [name, state] of Object.entries(states)) {
      assert.deepEqual(state.texts, ['treatable', 'tick'].includes(name) ? ['V'] : [], 'no status names or numeric values');
      assert.deepEqual(state.transform, [dpr, dpr, 0, 0], 'preserves DPR transform');
      assert.equal(state.alpha, .8); assert.equal(state.stroke, '#123456');
      assert.equal(state.lineWidth, 7); assert.equal(state.composite, 'source-over');
    }

    for (const [width, height] of [[2048, 1189], [1280, 720], [800, 600], [650, 360], [640, 360], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(([w, h]) => statusGame.renderer.ctx.canvas.width === Math.floor(w * devicePixelRatio)
        && statusGame.renderer.ctx.canvas.height === Math.floor(h * devicePixelRatio), [width, height], { polling: 50, timeout: 5000 });
      const layout = await page.evaluate(({ width, height }) => {
        const { status, weapons, backpack, vitals, slots } = statusModules;
        const weapon = weapons.getWeaponListLayout(width, height).area;
        const rect = status.getPlayerStatusHudRect(width, height, weapon);
        const bag = backpack.getBackpackHudRect(width, height, weapon);
        const health = vitals.getPlayerVitalsHudRect(width, height, [rect, bag, weapon]);
        const quick = slots.getQuickSlotHudLayout(width, height, [rect, bag, weapon, health]);
        statusScene.draw(statusGame.renderer.ctx);
        return { rect, areas: [bag, weapon, health, quick] };
      }, { width, height });
      const { rect } = layout;
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height, 'inside viewport');
      for (const area of layout.areas) assert.equal(overlaps(rect, area), false, `${width}x${height}: status clears all HUD`);
      assert.equal(rect.x, width < 650 || height <= 600 ? 16 : 50);
      if (width === 2048 || width === 1280) {
        assert.equal(rect.y + rect.height, height - 200, 'desktop matches reference bottom offset');
      }
      await page.screenshot({ path: `${output}/status-${width}x${height}-dpr${dpr}.png` });
    }

    const integration = await page.evaluate(() => {
      const hud = statusScene.statusHud, original = hud.draw.bind(hud);
      const captured = [];
      hud.draw = (ctx, snapshot, ...args) => { captured.push(snapshot); original(ctx, snapshot, ...args); };
      const survival = statusScene.getSurvivalSystem();
      survival.infection.infect(); survival.inventory.addVaccines();
      statusScene.draw(statusGame.renderer.ctx);
      const cured = survival.tryUseVaccine({ paused: false, rolling: false, reloading: false,
        interacting: false, actionInput: false });
      statusScene.draw(statusGame.renderer.ctx);
      const beforeHidden = captured.length, panel = statusScene.backpackPanel;
      const isOpen = panel.isOpen; panel.isOpen = () => true;
      statusScene.draw(statusGame.renderer.ctx); panel.isOpen = isOpen;
      hud.draw = original;
      return { captured, cured, hidden: beforeHidden === captured.length };
    });
    assert.equal(integration.captured[0].infected, true, 'scene uses real infection state');
    assert.equal(integration.captured[0].vaccines, 1);
    assert.equal(integration.cured, true);
    assert.equal(integration.captured[1].infected, false, 'curing restores healthy icon');
    assert.equal(integration.captured[1].vaccines, 0);
    assert.equal(integration.hidden, true, 'status hides alongside HUD when backpack opens');
    assert.deepEqual(errors, [], 'no browser runtime errors');
    await context.close();
  }
  console.log('Survival status HUD: original PNGs, segmented needs, infection/cure, responsive layout and DPR 1/1.25/2 passed.');
} finally {
  await browser.close();
}
