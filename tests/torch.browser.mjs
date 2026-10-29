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
        // 火把只照地面：墙、矿石的顶面保持环境光；墙后的地面仍被遮住。
        f.map.tiles[5][7] = 'wall'; f.map.tiles[5][9] = 'mineral'; f.map.tileHp[5][9] = 100;
        f.render();
        const blocked = { front: sample(340), wall: sample(375), floor: sample(425), ore: sample(455) };
        torch.light.setActive(false); f.render(); const dark = sample(425);
        torch.light.setActive(true);
        f.map.tiles[5][7] = 'mineral'; f.map.tileHp[5][7] = 100; f.render(); const mineral = sample(425);
        f.map.damageTile(7, 5, 100); f.render(); const destroyed = sample(425);
        f.map.tiles[5][7] = 'wall'; f.render(); const restored = sample(425);
        // 第二个光源只能补亮它实际看得到的一侧，不能破坏第一支火炬的遮挡。
        const fill = new LightSource(new Vector2(470 * scale, 350 * scale), 180 * scale, '#99CCFF', .4, 4 * scale);
        f.lighting.addLightSource(fill); f.render();
        const combined = sample(425); torch.light.setActive(false); f.render(); const fillOnly = sample(425);
        torch.light.setActive(true); fill.setActive(false);
        let maxLeak = 0;
        // 晃动时阴影随位置更新，实心遮挡背后的地面持续保持环境光亮度。
        for (let frame = 0; frame < 180; frame++) {
          torch.update(1 / 30); f.render();
          maxLeak = Math.max(maxLeak, sample(425)[0] - dark[0]);
        }
        const flicker = sample(425), top = sample(455);
        return { blocked, dark, mineral, destroyed, restored, combined, fillOnly, flicker, maxLeak, top };
      }, offset);
      assert.ok(result.blocked.front[0] > result.dark[0] + 80);
      assert.equal(result.blocked.wall[3], 255);
      for (const pixel of [result.blocked.wall, result.blocked.ore, result.mineral, result.restored, result.flicker]) {
        pixel.forEach((value, i) => assert.ok(Math.abs(value - result.dark[i]) <= 2, `DPR ${dpr}, camera ${offset}: terrain top ${pixel} must stay ambient ${result.dark}`));
      }
      assert.ok(result.blocked.floor[0] <= result.dark[0] + 2, 'ground behind the wall stays occluded');
      assert.ok(result.destroyed[0] > result.dark[0] + 60, 'destroying the blocker immediately restores torch light');
      assert.ok(result.maxLeak <= 2, 'sway must not leak light through the wall');
      result.combined.forEach((value, i) => assert.ok(Math.abs(value - result.fillOnly[i]) <= 2, 'occluded torch contributes no light behind the wall'));
      result.top.forEach((value, i) => assert.ok(Math.abs(value - result.dark[i]) <= 2, 'a unit light never brightens a terrain top'));
    }
    await page.screenshot({ path: `${output}/torch-occlusion-${dpr}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ dpr, torchOcclusion: 'passed' }));
    await page.close();
  }
} finally { await browser.close(); }
