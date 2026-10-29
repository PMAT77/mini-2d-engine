import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/lighting-fixture.html`);
    await page.waitForFunction(() => !!window.fixture);
    for (const offset of [[0, 0], [.35, .65], [37.25, 19.75]]) {
      const result = await page.evaluate(async ([ox, oy]) => {
        const f = window.fixture, scale = devicePixelRatio;
        const { Torch } = await import('/src/objects/Torch.ts');
        const { LightSource } = await import('/src/core/LightSource.ts');
        const { Vector2 } = await import('/src/math/Vector2.ts');
        f.setup('empty'); f.lighting.clearAllLights();
        const torch = new Torch(320 * scale, 275 * scale);
        torch.light.setRadius(180 * scale); torch.light.setSourceRadius(4 * scale);
        f.lighting.addLightSource(torch.light);
        f.offset(ox, oy);
        const sample = (x, y = 275) => [...f.lighting.shadowCtx.getImageData(Math.round((x - ox) * scale), Math.round((y - oy) * scale), 1, 1).data];
        // 隔着一块墙的地面、矿石顶面都应被挡住，迎光的第一块墙仍受照明。
        f.map.tiles[5][7] = 'wall'; f.map.tiles[5][9] = 'mineral'; f.map.tileHp[5][9] = 100;
        f.render();
        const blocked = { front: sample(340), wall: sample(375), floor: sample(425), ore: sample(455) };
        torch.light.setActive(false); f.render(); const dark = sample(455);
        torch.light.setActive(true);
        f.map.tiles[5][7] = 'mineral'; f.map.tileHp[5][7] = 100; f.render(); const mineral = sample(455);
        f.map.damageTile(7, 5, 100); f.render(); const destroyed = sample(455);
        f.map.tiles[5][7] = 'wall'; f.render(); const restored = sample(455);
        // 第二个光源只能补亮它实际看得到的一侧，不能破坏第一支火炬的遮挡。
        const fill = new LightSource(new Vector2(470 * scale, 350 * scale), 180 * scale, '#99CCFF', .4, 4 * scale);
        fill.shadowTerrain = true; f.lighting.addLightSource(fill); f.render();
        const combined = sample(455); torch.light.setActive(false); f.render(); const fillOnly = sample(455);
        torch.light.setActive(true); fill.setActive(false);
        let maxLeak = 0;
        // 晃动时阴影随位置更新，实心遮挡背后持续保持环境光亮度。
        for (let frame = 0; frame < 180; frame++) {
          torch.update(1 / 30); f.render();
          maxLeak = Math.max(maxLeak, sample(455)[0] - dark[0]);
        }
        const flicker = sample(455);
        return { blocked, dark, mineral, destroyed, restored, combined, fillOnly, flicker, maxLeak };
      }, offset);
      assert.ok(result.blocked.front[0] > result.dark[0] + 80);
      assert.ok(result.blocked.wall[0] > result.dark[0] + 80);
      for (const pixel of [result.blocked.floor, result.blocked.ore, result.mineral, result.restored, result.flicker]) {
        pixel.forEach((value, i) => assert.ok(Math.abs(value - result.dark[i]) <= 2, `DPR ${dpr}, camera ${offset}: blocked ${pixel}, ambient ${result.dark}`));
      }
      assert.ok(result.destroyed[0] > result.dark[0] + 60, 'destroying the blocker immediately restores torch light');
      assert.ok(result.maxLeak <= 2, 'sway must not leak light through the wall');
      result.combined.forEach((value, i) => assert.ok(Math.abs(value - result.fillOnly[i]) <= 2, 'occluded torch contributes no light behind the wall'));
    }
    await page.screenshot({ path: `${output}/torch-occlusion-${dpr}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ dpr, torchOcclusion: 'passed' }));
    await page.close();
  }
} finally { await browser.close(); }
