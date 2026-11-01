import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(`${base}/tests/lighting-fixture.html`);
    await page.waitForFunction(() => !!window.fixture);
    for (const camera of [[0, 0], [.35, .65], [37.25, 19.75], [-.5, -.5]]) {
      const result = await page.evaluate(([ox, oy]) => {
        const f = window.fixture, scale = devicePixelRatio;
        f.setup('single'); f.light.setActive(false); f.offset(ox, oy);
        const pixel = (x, y) => [...f.lighting.shadowCtx.getImageData(Math.round((x - ox) * scale), Math.round((y - oy) * scale), 1, 1).data];
        f.terrainLight(false); const original = pixel(100, 100);
        f.terrainLight(true);
        const open = pixel(100, 100), remote = pixel(900, 500), shadow = pixel(505, 280), bottom = pixel(480, 305);
        const beyond = pixel(530, 320), upstream = pixel(440, 275), top = pixel(475, 275), edge = pixel(516, 280);
        const snapshot = [...f.lighting.shadowCtx.getImageData(0, 0, f.canvas.width, f.canvas.height).data];
        for (let i = 0; i < 10; i++) f.render();
        const repeated = f.lighting.shadowCtx.getImageData(0, 0, f.canvas.width, f.canvas.height).data;
        const stable = snapshot.every((value, i) => value === repeated[i]);
        const getEdges = f.map.getShadowEdges.bind(f.map); let query;
        f.map.getShadowEdges = (...args) => { query = args; const edges = getEdges(...args); return [...edges, ...edges]; };
        f.render(); const duplicate = pixel(505, 280); f.map.getShadowEdges = getEdges;
        f.move(650, 350); f.light.setIntensity(.35); f.light.setActive(true); f.terrainLight(false);
        const playerOnly = pixel(505, 280); f.terrainLight(true); const playerCombined = pixel(505, 280);
        f.light.setActive(false); f.light.setIntensity(1); f.render();
        // A neighboring top lies inside the short shadow, including the softened edge.
        f.map.tiles[5][10] = 'mineral'; f.map.tiles[6][9] = 'wall'; f.render();
        const rects = [[450, 250], [500, 250], [450, 300]].map(([x, y]) =>
          [Math.round((x - ox) * scale), Math.round((y - oy) * scale), Math.round((x + 50 - ox) * scale) - Math.round((x - ox) * scale),
            Math.round((y + 50 - oy) * scale) - Math.round((y - oy) * scale)]);
        const tops = rects.map(rect => [...f.lighting.shadowCtx.getImageData(...rect).data]);
        const mask=document.createElement('canvas');mask.width=f.canvas.width;mask.height=f.canvas.height;
        const maskCtx=mask.getContext('2d');maskCtx.beginPath();
        for(const {vertices} of f.map.getBlockingPolygons(ox*scale,oy*scale,mask.width,mask.height)){
          vertices.forEach((p,i)=>i?maskCtx.lineTo(p.x-ox*scale,p.y-oy*scale):maskCtx.moveTo(p.x-ox*scale,p.y-oy*scale));maskCtx.closePath();
        }
        maskCtx.fill();const topMasks=rects.map(rect=>maskCtx.getImageData(...rect).data);
        f.lighting.prepareLightingMask(ox * scale, oy * scale);
        const topChanges = rects.reduce((sum, rect, index) => sum + [...f.lighting.shadowCtx.getImageData(...rect).data]
          .filter((value, i) => topMasks[index][Math.floor(i/4)*4+3]===255 && Math.abs(value-tops[index][i])>1).length, 0);
        f.setup('mineral'); f.offset(ox, oy); f.terrainLight(true);
        const before = pixel(505, 280); f.destroy(); const destroyed = pixel(505, 280);
        const buffer = f.lighting.terrainShadowCanvas;
        return { original, open, remote, shadow, bottom, beyond, upstream, top, edge, stable, duplicate, playerOnly, playerCombined, topChanges, before, destroyed,
          query, buffer: [buffer.width, buffer.height], viewport: [f.canvas.width, f.canvas.height] };
      }, camera);
      for (const field of ['open', 'remote', 'beyond', 'upstream', 'top', 'destroyed']) {
        assert.ok(result[field].every((value, i) => Math.abs(value - result.original[i]) <= 2), `${field} brightness: ${JSON.stringify(result)}`);
      }
      assert.ok(result.shadow[0] < result.open[0] - 6 && result.bottom[0] < result.open[0] - 6, 'right and bottom edges cast faint short shadows');
      assert.ok(result.edge[0] > result.shadow[0] && result.edge[0] < result.open[0], 'short shadow has a soft edge');
      assert.ok(result.destroyed[0] > result.before[0] + 6, 'destroying ore removes its shadow in the same frame');
      assert.deepEqual(result.duplicate, result.shadow, 'overlapping shadows are a union');
      assert.ok(result.playerCombined[0] > result.shadow[0] + 40, 'player light illuminates the terrain-light shadow');
      assert.ok(result.playerCombined.every((value, i) => value >= result.playerOnly[i] - 14), 'terrain shadow only removes weak-light energy');
      assert.equal(result.topChanges, 0, 'solid interiors stay protected within 1/255 raster precision');
      assert.ok(result.stable, 'stationary redraws are identical');
      assert.ok(result.query[2] < Math.hypot(...result.viewport) / 2 + 40 * dpr, 'edge query stays near the viewport');
      assert.ok(result.buffer.every((value, i) => value <= result.viewport[i] + 12 * dpr + 7), 'buffer is viewport-sized');
      results.push({ dpr, camera, ...result });
    }
    await page.evaluate(() => {
      const f = window.fixture;
      f.setup('staircase'); f.light.setActive(false); f.terrainLight(true);
    });
    await page.locator('canvas').screenshot({ path: `${output}/terrain-fixture-dpr${dpr}.png` });
    const boundary = await page.evaluate(() => {
      const f = window.fixture, scale = devicePixelRatio;
      f.setup('single'); f.terrainLight(true); f.offset(500, 250);
      const pixel = (x, y) => f.lighting.shadowCtx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[0];
      const offscreenShadow = pixel(5, 30), open = pixel(100, 100);
      f.canvas.width = 720 * scale; f.canvas.height = 400 * scale;
      f.lighting.initialize(f.canvas.width, f.canvas.height); f.offset(0, 0);
      const resizedShadow = pixel(505, 280), resizedOpen = pixel(100, 100);
      f.terrainLight(false); f.light.setSourceRadius(0); f.light.setActive(true); f.move(-50, 200);
      const outsidePoint = pixel(100, 200);
      f.lighting.prepareLightingMask(0, 0); const outsideWithoutMap = pixel(100, 200);
      return { offscreenShadow, open, resizedShadow, resizedOpen, outsidePoint, outsideWithoutMap };
    });
    assert.ok(boundary.offscreenShadow < boundary.open - 6, 'offscreen terrain still casts into the viewport');
    assert.ok(boundary.resizedShadow < boundary.resizedOpen - 6, 'short shadows survive resize');
    assert.equal(boundary.outsidePoint, 58, 'ordinary off-map point lights stay blocked');
    assert.ok(boundary.outsideWithoutMap > boundary.outsidePoint + 40, 'outside point-light check uses an active in-range source');

    // Capture the actual game with identical terrain/camera, toggling only the lighting change.
    await page.goto(`${base}/`);
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      const { game } = await import(entry.src);
      const { GameScene } = await import('/src/scenes/GameScene.ts');
      window.terrainGame = game;
      game.sceneManager.changeScene(new GameScene({ seed: 8351, generateWater: false }), 0);
    });
    await page.waitForFunction(() => terrainGame.sceneManager.getCurrentScene()?.loaded);
    const config = await page.evaluate(async () => {
      const game = terrainGame, scene = game.sceneManager.getCurrentScene();
      scene.update = () => {};
      scene.map.tiles.forEach(row => row.fill('default'));
      for (let row = 3; row <= 9; row++) scene.map.tiles[row][20] = 'wall';
      for (let row = 7; row <= 9; row++) scene.map.tiles[row][10] = 'wall';
      scene.map.tiles[11][22] = 'mineral'; scene.map.tileHp[11][22] = 100;
      // 火把闪烁用随机相位，跨运行亮度不稳定；这里只要玩家灯，先把地图自带光源摘掉。
      scene.torches.forEach(t => scene.lightingSystem.removeLightSource(t.light)); scene.torches = [];
      scene.player.x = 250; scene.player.y = 370;
      const { Vector2 } = await import('/src/math/Vector2.ts');
      scene.playerLight.setPosition(new Vector2(274.5, 394.5));
      scene.camera.x = 37.25; scene.camera.y = 19.75;
      scene.pickupItems = []; scene.particleSystem.clear();
      window.gameTerrainLight = scene.lightingSystem.terrainLight;
      scene.lightingSystem.setTerrainLight(null); scene.setAmbientLight('#3A4450');
      scene.draw(game.renderer.ctx);
      return gameTerrainLight;
    });
    assert.deepEqual(config.position, { x: -5000, y: -5000 });
    assert.equal(config.shadowLength, 20); assert.equal(config.softness, 2); assert.equal(config.intensity, .06);
    await page.screenshot({ path: `${output}/terrain-game-before-dpr${dpr}.png` });
    const gamePixels = await page.evaluate(() => {
      const game = terrainGame, scene = game.sceneManager.getCurrentScene(), lighting = scene.lightingSystem;
      const pixel = (x, y) => [...lighting.shadowCtx.getImageData(Math.round(x - scene.camera.x), Math.round(y - scene.camera.y), 1, 1).data];
      const before = pixel(1055, 375), originalOpen = pixel(1100, 650);
      lighting.setTerrainLight(gameTerrainLight); scene.setAmbientLight('#2F3843');
      // 首次绘制会带上缩放/尺寸变更后的首帧偏差，画两帧再取样才稳定。
      scene.draw(game.renderer.ctx); scene.draw(game.renderer.ctx);
      return { before, originalOpen, after: pixel(1055, 375), open: pixel(1100, 650), player: pixel(280, 400) };
    });
    await page.screenshot({ path: `${output}/terrain-game-after-dpr${dpr}.png` });
    assert.ok(gamePixels.after[0] < gamePixels.before[0] - 6, 'actual game has a short shadow outside the player light');
    assert.ok(gamePixels.open.every((value, i) => Math.abs(value - gamePixels.originalOpen[i]) <= 2), 'actual game dark regions retain their brightness');
    // 光照遮罩是加色层：近身点比暗部至少亮 40 级、且高出 25%，说明主光源仍是玩家灯。
    const lift = gamePixels.player[0] - gamePixels.open[0];
    assert.ok(lift >= 40 && gamePixels.player[0] >= gamePixels.open[0] * 1.25, `player light remains the main illumination: +${lift} (${gamePixels.player[0]} vs ${gamePixels.open[0]})`);
    const shake = await page.evaluate(() => {
      const game = terrainGame, scene = game.sceneManager.getCurrentScene(), samples = [];
      scene.camera.shake(3, .2, Math.PI / 4, 50, 'linear');
      for (let i = 0; i < 4; i++) {
        scene.camera.follow(scene.camera.x + scene.camera.width / 2, scene.camera.y + scene.camera.height / 2, 1 / 60);
        scene.draw(game.renderer.ctx);
        const camera = scene.camera.getOffset();
        samples.push({ camera, pixel: [...scene.lightingSystem.shadowCtx.getImageData(Math.round(1055 - camera.x), Math.round(375 - camera.y), 1, 1).data] });
      }
      scene.camera.shake(0, 0); scene.draw(game.renderer.ctx);
      return samples;
    });
    assert.ok(shake.some(sample => Math.abs(sample.camera.x - 37.25) > .5), 'game camera actually shakes');
    assert.ok(shake.every(sample => sample.pixel.every((value, i) => Math.abs(value - gamePixels.after[i]) <= 2)), 'world shadow stays aligned during camera shake');
    await page.setViewportSize({ width: 1000, height: 650 });
    const resized = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const game = terrainGame, scene = game.sceneManager.getCurrentScene(), lighting = scene.lightingSystem;
      return { renderer: [game.renderer.width, game.renderer.height], world: [scene.worldCanvas.width, scene.worldCanvas.height], mask: [lighting.shadowCanvas.width, lighting.shadowCanvas.height],
        buffer: [lighting.terrainShadowCanvas.width, lighting.terrainShadowCanvas.height], position: lighting.terrainLight.position };
    });
    assert.deepEqual(resized.mask, resized.world, 'game resize keeps lighting aligned with the zoomed world buffer');
    assert.deepEqual(resized.position, config.position, 'camera/resize never moves the world light');
    assert.ok(resized.buffer[0] <= resized.world[0] + 17 && resized.buffer[1] <= resized.world[1] + 17);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ dpr, cases: 4, boundary, gamePixels, resized }));
    await page.close();
  }
  writeFileSync(`${output}/terrain-light-pixels.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('Terrain light: 12 DPR/camera cases, offscreen blockers, destruction, resize and actual-game comparisons passed.');
} finally { await browser.close(); }
