import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });
const luma = pixel => (pixel[0] + pixel[1] + pixel[2]) / 3;
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.boundaryGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => {
      const scene = window.boundaryGame.sceneManager.getCurrentScene();
      return scene?.constructor.name === 'GameScene' && scene.loaded;
    });
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

    // 先把波纹单独画到一张空画布上：隔离玩家、光照和罩层对像素的干扰。
    const isolated = await page.evaluate(() => {
      const scene = window.boundaryGame.sceneManager.getCurrentScene();
      scene.boundaryRippleSystem.clear();
      scene.boundaryRippleSystem.update(1 / 60, { x: 0, y: 100, width: 50, height: 50 },
        { x: -1, y: 0 }, 1000, 1000);
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, 200, 200);
      scene.boundaryRippleSystem.draw(ctx, -50, -50, 200, 200);
      const data = ctx.getImageData(0, 0, 200, 200).data;
      let warm = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 140 && data[i] > data[i + 2] + 10) warm++;
      }
      return { warm, count: scene.boundaryRippleSystem.getActiveCount() };
    });
    assert.equal(isolated.count, 1);
    assert.ok(isolated.warm > 0, `boundary ripple must paint warm arc pixels: ${JSON.stringify(isolated)}`);

    const result = await page.evaluate(() => {
      const game = window.boundaryGame;
      const scene = game.sceneManager.getCurrentScene();
      scene.map = new scene.map.constructor(20, 20, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tileHighlight.forEach(row => row.fill(0));
      scene.chickens = [];
      scene.pickupItems = []; scene.goldPickups = []; scene.meatPickups = [];
      scene.boundaryRippleSystem.clear();
      scene.player.x = 0; scene.player.y = 400;
      scene.camera.x = -220; scene.camera.y = 50;

      // 走真实 update 路径：贴住左边界并按 A，确认 GameScene 把输入接到了边界反馈上。
      const input = { isKeyDown: key => key === 'a' };
      for (let i = 0; i < 20; i++) scene.update(1 / 60, input);
      scene.camera.x = -220; scene.camera.y = 50;
      scene.draw(game.renderer.ctx);

      const zoom = game.renderer.width / scene.worldCanvas.width;
      const sample = (x, y) => [...game.renderer.ctx.getImageData(
        Math.floor((x - scene.camera.x) * zoom),
        Math.floor((y - scene.camera.y) * zoom), 1, 1).data];
      // 水印是稀疏的浅色文字；取一小片区域里最暗的像素，量的是界外底色。
      const sampleMin = (read, x, y) => {
        let best = null, bestLuma = Infinity;
        for (let dy = -80; dy <= 80; dy += 40) {
          for (let dx = -80; dx <= 80; dx += 40) {
            const pixel = read(x + dx, y + dy);
            const l = (pixel[0] + pixel[1] + pixel[2]) / 3;
            if (l < bestLuma) { bestLuma = l; best = pixel; }
          }
        }
        return best;
      };
      const watermarked = sampleMin(sample, -120, 300);

      const overlayDraw = scene.boundaryOverlay.draw;
      scene.boundaryOverlay.draw = () => {};
      scene.draw(game.renderer.ctx);
      const plain = sampleMin(sample, -120, 300);
      scene.boundaryOverlay.draw = overlayDraw;
      scene.draw(game.renderer.ctx);

      return {
        ripples: scene.boundaryRippleSystem.getActiveCount(),
        edges: scene.boundaryRippleSystem.getRipples().map(ripple => ripple.edge),
        watermarks: scene.boundaryOverlay.getLastWatermarkCount(),
        watermarked, plain,
        viewport: [scene.worldCanvas.width, scene.worldCanvas.height],
      };
    });

    assert.ok(result.ripples > 0, `pressing into the edge spawns a ripple: ${JSON.stringify(result)}`);
    assert.deepEqual([...new Set(result.edges)], ['left']);
    assert.ok(result.watermarks > 0, `watermarks stay visible at DPR ${dpr}`);
    assert.ok(luma(result.watermarked) <= luma(result.plain) + 2,
      `outside the map keeps the map's own dark backdrop: ${JSON.stringify(result)}`);

    await page.screenshot({ path: `.review/boundary-dpr-${dpr}.png` });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`DPR ${dpr}: ${result.ripples} boundary ripple(s), ${result.watermarks} watermarks, `
      + `outside backdrop luma ${luma(result.plain).toFixed(0)} -> ${luma(result.watermarked).toFixed(0)}.`);
  }
  console.log('Boundary feedback: DPR 1 / 1.25 / 2, edge ripple, sparse watermark and no veil passed.');
} finally { await browser.close(); }
