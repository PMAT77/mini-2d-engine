import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });

const UNKNOWN = [8, 13, 18];
const PLAYER = [231, 242, 255];
const GOLD = [255, 215, 0];
const isBright = pixel => pixel[0] >= 200 && pixel[1] >= 200 && pixel[2] >= 200;
const same = (a, b) => a.every((value, index) => value === b[index]);

try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.minimapGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    // Let the one outstanding animation frame finish before controlled rendering.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

    const result = await page.evaluate(() => {
      const sameColor = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      const bright = pixel => pixel[0] >= 200 && pixel[1] >= 200 && pixel[2] >= 200;
      const game = window.minimapGame;
      const scene = game.sceneManager.getCurrentScene(), screen = game.renderer.ctx;
      scene.handleResize();
      const hud = scene.minimap, layout = hud.getLayout();
      // A few simulated frames let perception, exploration and the marker store settle.
      for (let frame = 0; frame < 30; frame += 1) scene.update(1 / 60, game.input);
      scene.draw(screen);

      const boxLeft = layout.left - 2, boxTop = layout.top - 2;
      const boxSize = layout.diameter + 4;
      const readBox = () => {
        const width = Math.round(boxSize * devicePixelRatio);
        const data = screen.getImageData(Math.round(boxLeft * devicePixelRatio),
          Math.round(boxTop * devicePixelRatio), width, width).data;
        return { width, data };
      };
      const pixelAt = (box, cssX, cssY) => {
        const x = Math.round((cssX - boxLeft) * devicePixelRatio);
        const y = Math.round((cssY - boxTop) * devicePixelRatio);
        const index = (y * box.width + x) * 4;
        return [box.data[index], box.data[index + 1], box.data[index + 2], box.data[index + 3]];
      };
      // Only the disk interior is opaque minimap pixels; outside the circle the world shows through.
      const diffInside = (first, second) => {
        let changed = 0;
        for (let offsetY = -layout.radius + 6; offsetY <= layout.radius - 6; offsetY += 1) {
          for (let offsetX = -layout.radius + 6; offsetX <= layout.radius - 6; offsetX += 1) {
            if (offsetX * offsetX + offsetY * offsetY > (layout.radius - 6) ** 2) continue;
            const a = pixelAt(first, layout.centerX + offsetX, layout.centerY + offsetY);
            const b = pixelAt(second, layout.centerX + offsetX, layout.centerY + offsetY);
            if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) changed += 1;
          }
        }
        return changed;
      };

      // 1) Terrain visibility: the spawn area is explored, the rest is still unknown.
      const box = readBox();
      let unknownCells = 0, exploredCells = 0;
      for (let offsetY = -layout.radius + 6; offsetY <= layout.radius - 6; offsetY += 3) {
        for (let offsetX = -layout.radius + 6; offsetX <= layout.radius - 6; offsetX += 3) {
          if (offsetX * offsetX + offsetY * offsetY > (layout.radius - 6) ** 2) continue;
          const pixel = pixelAt(box, layout.centerX + offsetX, layout.centerY + offsetY);
          if (sameColor([pixel[0], pixel[1], pixel[2]], [8, 13, 18])) unknownCells += 1;
          else exploredCells += 1;
        }
      }

      // 2) Circular clipping and the outer border on a blank canvas.
      const probe = document.createElement('canvas');
      probe.width = 240; probe.height = 240;
      const probeContext = probe.getContext('2d');
      hud.draw(probeContext);
      const probePixel = (x, y) => [...probeContext.getImageData(x, y, 1, 1).data];
      const clip = {
        corner: probePixel(1, 1),
        aboveDisk: probePixel(Math.round(layout.centerX), layout.top - 3),
        center: probePixel(Math.round(layout.centerX), Math.round(layout.centerY)),
        // 采样点放在外圈描边正中间：半径 100.5、2px 描边时描边覆盖 y 20..22，取整行覆盖的 y=21。
        border: probePixel(Math.round(layout.centerX), layout.top + 1),
      };

      // 3) The player arrow follows the real facing direction, tip forward.
      const directions = [
        { name: 'east', direction: 0 },
        { name: 'south', direction: Math.PI / 2 },
        { name: 'west', direction: Math.PI },
        { name: 'north', direction: -Math.PI / 2 },
      ];
      const unitDirections = [
        { name: 'east', x: 1, y: 0 },
        { name: 'south', x: 0, y: 1 },
        { name: 'west', x: -1, y: 0 },
        { name: 'north', x: 0, y: -1 },
      ];
      const arrows = directions.map(({ name, direction }) => {
        // Player.direction = currentRotation - PI.
        scene.player.currentRotation = direction + Math.PI;
        scene.updateMinimap(1 / 60);
        scene.draw(screen);
        const arrowBox = readBox();
        // 箭头是圆盘里唯一的白色物体。它前端是窄尖、后端是两侧翼，所以对某个方向 d：
        // d 前方的亮像素离轴更近（meanLateral 小），后方亮像素离轴更远（翼展开）。
        // 这个横向宽度差对单像素抗锯齿不敏感，比点采样稳。
        const stats = {};
        for (const unit of unitDirections) {
          stats[unit.name] = { front: [0, 0], rear: [0, 0] };
        }
        for (let row = 0; row < 22; row += 1) {
          for (let column = 0; column < 22; column += 1) {
            const offsetX = column - 10.5;
            const offsetY = row - 10.5;
            if (Math.hypot(offsetX, offsetY) > 10) continue;
            const pixel = pixelAt(arrowBox, layout.centerX + offsetX, layout.centerY + offsetY);
            const luminance = Math.min(pixel[0], pixel[1], pixel[2]) / 255;
            if (luminance < 0.5) continue;
            for (const unit of unitDirections) {
              const along = offsetX * unit.x + offsetY * unit.y;
              const lateral = Math.abs(offsetX * unit.y - offsetY * unit.x);
              const bucket = stats[unit.name];
              if (along >= 1.5) {
                bucket.front[0] += lateral;
                bucket.front[1] += 1;
              } else if (along <= -1.5) {
                bucket.rear[0] += lateral;
                bucket.rear[1] += 1;
              }
            }
          }
        }
        const meanLateral = pair => (pair[1] === 0 ? 0 : pair[0] / pair[1]);
        const front = meanLateral(stats[name].front);
        const rear = meanLateral(stats[name].rear);
        return {
          name,
          front,
          rear,
          center: bright(pixelAt(arrowBox, layout.centerX, layout.centerY)),
        };
      });

      // 4) Camera shake moves the world but never the minimap. Only the camera is touched,
      // so the minimap inputs stay identical and any pixel change would be a leak.
      const calm = readBox();
      const vision = scene.player.getVisionState();
      scene.camera.shake(18, 0.8, 0, 20, 'linear');
      scene.camera.follow(vision.x, vision.y, 0.05);
      const offset = scene.camera.getOffset();
      const shakeApplied = Math.abs(offset.x - scene.camera.x) > 0.5 || Math.abs(offset.y - scene.camera.y) > 0.5;
      scene.draw(screen);
      const shaken = readBox();

      // 5) The gold counter sits below the minimap instead of under it.
      const goldPixel = [...screen.getImageData(Math.round(28 * devicePixelRatio),
        Math.round(241 * devicePixelRatio), 1, 1).data];
      const oldGoldPixel = [...screen.getImageData(Math.round(28 * devicePixelRatio),
        Math.round(30 * devicePixelRatio), 1, 1).data];

      // 6) Moving the player shifts the terrain but keeps the arrow centered.
      scene.camera.shake(0, 0, 0, 0, 'linear');
      scene.player.x += 160;
      scene.updateMinimap(1 / 60);
      scene.draw(screen);
      const moved = readBox();
      const arrowCentered = bright(pixelAt(moved, layout.centerX, layout.centerY));

      // 7) Refresh throttling: per-frame updates must not rebuild the whole cache.
      const before = hud.getStats();
      for (let frame = 0; frame < 20; frame += 1) scene.updateMinimap(1 / 60);
      const after = hud.getStats();
      const drawStart = performance.now();
      for (let frame = 0; frame < 10; frame += 1) hud.draw(screen);
      const drawMs = (performance.now() - drawStart) / 10;

      return {
        layout: { left: layout.left, top: layout.top, diameter: layout.diameter, radius: layout.radius,
          centerX: layout.centerX, centerY: layout.centerY, goldRow: layout.goldRow },
        unknownCells, exploredCells, clip, arrows, shakeApplied,
        minimapStable: diffInside(calm, shaken) === 0,
        terrainShifted: diffInside(calm, moved) > 0,
        arrowCentered, goldPixel, oldGoldPixel,
        stats: after,
        refreshes: after.refreshCount - before.refreshCount,
        drawMs,
        unknownAtSpawn: sameColor([...pixelAt(box, layout.centerX, layout.centerY)].slice(0, 3), [8, 13, 18]),
      };
    });

    assert.deepEqual(errors, []);
    // 720p 下短边 720 × maxViewportFraction 0.28 = 201，配置里的 300 会被收窄到这里。
    assert.deepEqual(result.layout, { left: 20, top: 20, diameter: 201, radius: 100.5,
      centerX: 120.5, centerY: 120.5, goldRow: 235 });
    assert.ok(result.unknownCells > result.exploredCells * 4,
      `unexplored area must dominate: ${JSON.stringify({ unknown: result.unknownCells, explored: result.exploredCells })}`);
    assert.ok(result.exploredCells > 0, 'spawn area should be explored');
    assert.equal(result.unknownAtSpawn, false, 'player arrow must cover the disk centre');
    assert.equal(result.clip.corner[3], 0, `outside the circle must stay transparent: ${JSON.stringify(result.clip)}`);
    assert.equal(result.clip.aboveDisk[3], 0, 'the disk must be clipped to its circle');
    assert.equal(result.clip.center[3], 255, 'the disk centre must be painted');
    // 奇数直径时圆心在 .5 像素上，描边与像素行错开半个像素，覆盖率 254/255 也算已绘制。
    assert.ok(result.clip.border[3] >= 250, `the outer border must be painted: ${JSON.stringify(result.clip.border)}`);
    assert.ok(result.clip.border[0] > 60 && result.clip.border[0] < 170,
      `border should be the muted tactical grey: ${JSON.stringify(result.clip.border)}`);
    for (const arrow of result.arrows) {
      // 前端窄、后端翼宽：正确朝向时前方亮像素的离轴距离明显更小。
      assert.ok(arrow.front + 0.8 < arrow.rear,
        `${arrow.name}: arrow must point forward, got ${JSON.stringify(arrow)}`);
      assert.ok(arrow.center, `${arrow.name}: arrow must cover the centre`);
    }
    assert.ok(result.shakeApplied, 'camera shake should displace the world camera');
    assert.ok(result.minimapStable, 'camera shake must not move the minimap');
    assert.ok(result.terrainShifted && result.arrowCentered, 'terrain shifts while the arrow stays centered');
    assert.deepEqual(result.goldPixel, [255, 215, 0, 255], `gold HUD must sit below the minimap: ${JSON.stringify(result.goldPixel)}`);
    assert.equal(same([result.oldGoldPixel[0], result.oldGoldPixel[1], result.oldGoldPixel[2]], GOLD), false,
      'the old gold position must not be gold any more');
    assert.ok(result.refreshes <= 6, `terrain cache refresh must be throttled: ${result.refreshes} refreshes in ~0.33s`);
    assert.ok(result.stats.refreshMs < 30, `terrain cache refresh took ${result.stats.refreshMs}ms`);
    assert.ok(result.drawMs < 8, `minimap draw took ${result.drawMs.toFixed(2)}ms`);

    // Small screens shrink the minimap instead of dropping it or overlapping other HUD.
    await page.setViewportSize({ width: 420, height: 360 });
    await page.waitForFunction(() => minimapGame.renderer.width === 420 * devicePixelRatio
      && minimapGame.renderer.height === 360 * devicePixelRatio);
    const small = await page.evaluate(() => {
      const scene = minimapGame.sceneManager.getCurrentScene();
      scene.handleResize();
      const layout = scene.minimap.getLayout();
      scene.draw(minimapGame.renderer.ctx);
      return { diameter: layout.diameter, radius: layout.radius, centerX: layout.centerX, centerY: layout.centerY };
    });
    assert.equal(small.diameter, 100, `small screens shrink the minimap: ${JSON.stringify(small)}`);
    assert.equal(small.radius, 50);
    assert.equal(small.centerX, 20 + 50);

    const renderer = page.locator('canvas').first();
    await renderer.screenshot({ path: `.review/minimap-dpr-${dpr}.png` }).catch(async () => {
      await page.screenshot({ path: `.review/minimap-dpr-${dpr}.png` });
    });
    console.log(`Minimap DPR ${dpr}: layout, fog, clipping, arrow, shake, gold HUD, movement, throttling passed.`);
    await context.close();
  }
  console.log('Minimap: circular HUD, exploration memory, markers, player arrow and performance passed.');
} finally {
  await browser.close();
}
