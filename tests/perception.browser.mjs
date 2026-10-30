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
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(`${base}/`);
    await page.evaluate(async () => { window.visionGame = (await import('/src/main.ts')).game; });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    assert.equal(
      await page.evaluate(() => window.visionGame.sceneManager.getCurrentScene().visionMode),
      'three-layer',
      'the root URL must boot the default three-layer vision',
    );

    const setup = await page.evaluate(async () => {
      const { TileMap } = await import('/src/map/TileMap.ts');
      const { Chicken } = await import('/src/objects/Chicken.ts');
      const { PerceptionSystem } = await import('/src/vision/PerceptionSystem.ts');
      const { PerceptionRenderer } = await import('/src/vision/PerceptionRenderer.ts');

      const game = window.visionGame;
      const scene = game.sceneManager.getCurrentScene();
      scene.map = new TileMap(40, 30, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tileHp.forEach(row => row.fill(0));
      scene.map.water = undefined;
      scene.torches.forEach(torch => scene.lightingSystem.removeLightSource(torch.light));
      scene.torches = [];
      scene.goldPickups = [];
      scene.meatPickups = [];
      scene.pickupItems = [];
      scene.chickens = [];
      scene.particleSystem.clear();

      const size = scene.map.tileSize;
      const px = 20.5 * size, py = 15.5 * size;
      scene.player.x = px - 24.5;
      scene.player.y = py - 24.5;
      scene.player.currentRotation = Math.PI / 2;
      scene.playerLight.getPosition().set(px, py);
      scene.flashlight.getPosition().set(px, py);
      scene.flashlight.setDirection(0);
      scene.flashlight.setActive(false);
      scene.camera.x = px - scene.camera.width / 2;
      scene.camera.y = py - scene.camera.height / 2;

      // 这个墙块必须在渲染器构造前写入：未知轮廓刻意使用建图时的静态快照。
      scene.map.tiles[8][30] = 'wall';
      scene.map.tileHp[8][30] = 100;

      scene.perception = new PerceptionSystem({ map: scene.map, terrain: scene.map, rules: scene.visionRules });
      scene.perceptionObserver = {
        id: 'player', x: px, y: py, facing: Math.PI / 2,
        nearSenseRadius: scene.visionRules.nearSenseRadius,
        maxObservationRange: scene.visionRules.maxObservationRange,
      };
      scene.perceptionRenderer = new PerceptionRenderer(scene.map, scene.map,
        scene.visionRules, scene.graphics.visibility);
      scene.perceptionRenderer.resize(scene.worldCanvas.width, scene.worldCanvas.height,
        scene.graphics.visibility);

      window.perceptionTest = {
        scene, px, py, size,
        draw() { scene.draw(game.renderer.ctx); },
        update(dt) { scene.updatePerception(dt); },
        view(target) { return scene.getPerceptionView(target); },
        visibility(target) { return scene.getEntityVisibility(target); },
        alpha(target) { return scene.getEntityAlpha(target); },
        pixel(x, y, canvas = scene.worldContext) {
          const view = scene.displayedView;
          return [...canvas.getImageData(Math.round(x - view.x), Math.round(y - view.y), 1, 1).data];
        },
      };
      return {
        size, px, py,
        visibility: scene.visionMode,
        rules: scene.visionRules,
        maskScale: scene.graphics.visibility.maskScale,
        canvas: [scene.worldCanvas.width, scene.worldCanvas.height],
        overlay: [scene.perceptionRenderer.overlay.width, scene.perceptionRenderer.overlay.height],
        playerView: scene.player.getVisionState(),
      };
    });

    assert.equal(setup.visibility, 'three-layer');
    assert.equal(setup.overlay[0], Math.ceil(setup.canvas[0] * setup.maskScale));
    assert.equal(setup.overlay[1], Math.ceil(setup.canvas[1] * setup.maskScale));

    // 1. 未知区轮廓复用圆角几何：孤立的墙块中心有轮廓，圆角外侧保持未知底色。
    const outline = await page.evaluate(() => {
      const t = window.perceptionTest, scene = t.scene;
      scene.map.tiles[8][30] = 'wall';
      scene.map.tileHp[8][30] = 100;
      t.update(0.3);
      t.draw();
      const center = t.pixel(30 * t.size + 25, 8 * t.size + 25);
      const corner = t.pixel(30 * t.size + 2, 8 * t.size + 2);
      const ground = t.pixel(20 * t.size + 25, 8 * t.size + 25);
      return { center, corner, ground };
    });
    assert.ok(outline.center[0] > outline.corner[0] + 8,
      `unknown wall center should read as an outline, got ${JSON.stringify(outline)}`);
    assert.ok(outline.corner[0] <= outline.ground[0] + 4,
      `rounded outer corner should not be filled as a square, got ${JSON.stringify(outline)}`);

    // 2. 未知轮廓是静态快照：破坏远处墙后，未探索区轮廓仍保持旧形状。
    const staticOutline = await page.evaluate(() => {
      const t = window.perceptionTest, scene = t.scene;
      const before = t.pixel(30 * t.size + 25, 8 * t.size + 25);
      scene.map.breakTile(30, 8);
      scene.goldPickups = [];
      t.draw();
      const after = t.pixel(30 * t.size + 25, 8 * t.size + 25);
      return { before, after };
    });
    assert.ok(Math.abs(staticOutline.before[0] - staticOutline.after[0]) <= 6,
      `unexplored outline must not follow distant destruction, got ${JSON.stringify(staticOutline)}`);

    // 3. 鸡剪影：低饱和冷灰、可读但不显示身份细节；墙后保持不可见。
    const chicken = await page.evaluate(async () => {
      const { Chicken } = await import('/src/objects/Chicken.ts');
      const t = window.perceptionTest, scene = t.scene;
      scene.map.tiles[8][30] = 'default';
      scene.map.breakTile(30, 8);
      const bird = new Chicken(t.px + 62, t.py - 11, () => 0.5);
      scene.chickens = [bird];
      scene.flashlight.setActive(false);
      // 0.3s 让近身剪影权重到满，采样“剪影本体”的冷灰色，而不是过渡中间帧。
      t.update(0.3);
      t.draw();
      const silhouette = t.pixel(t.px + 62 + 11, t.py);
      const view = t.view(bird);
      return { silhouette, view, visibility: t.visibility(bird) };
    });
    assert.equal(chicken.visibility, 'silhouette');
    assert.ok(chicken.silhouette[2] > chicken.silhouette[0] + 8,
      `silhouette should be a cold grey-blue, got ${JSON.stringify(chicken)}`);
    assert.ok(chicken.silhouette[0] > 16,
      `silhouette should be readable against the dark background, got ${JSON.stringify(chicken)}`);

    const blocked = await page.evaluate(() => {
      const t = window.perceptionTest, scene = t.scene;
      scene.chickens[0].x = t.px + 62;
      scene.chickens[0].y = t.py - 11;
      scene.map.tiles[15][21] = 'wall';
      scene.map.tileHp[15][21] = 100;
      t.update(0.2);
      t.draw();
      const withChicken = t.pixel(t.px + 62 + 11, t.py);
      const view = t.view(scene.chickens[0]);
      scene.chickens = [];
      t.draw();
      const withoutChicken = t.pixel(t.px + 62 + 11, t.py);
      return { view, withChicken, withoutChicken };
    });
    assert.equal(blocked.view.level, 'hidden');
    assert.equal(blocked.view.silhouette, 0);
    // 采样点落在墙顶，因此用“移除鸡前后的像素差”判断是否泄漏剪影，
    // 而不是依赖旧实现的绝对亮度阈值（墙体亮度已随统一轮廓改变）。
    const leaked = Math.abs(blocked.withChicken[0] - blocked.withoutChicken[0])
      + Math.abs(blocked.withChicken[1] - blocked.withoutChicken[1])
      + Math.abs(blocked.withChicken[2] - blocked.withoutChicken[2]);
    assert.ok(leaked <= 3,
      `a chicken behind a wall must not leak a silhouette, got ${JSON.stringify(blocked)}`);

    // 4. 手电锥形软边：中心亮、锥内边缘更暗、锥外接近黑暗。
    const cone = await page.evaluate(() => {
      const t = window.perceptionTest, scene = t.scene;
      scene.map.tiles[15][21] = 'default';
      scene.map.breakTile(21, 15);
      scene.chickens = [];
      scene.flashlight.setActive(true);
      scene.flashlight.setDirection(0);
      t.update(0.2);
      t.draw();
      const sample = (degrees, distance) => {
        const angle = degrees * Math.PI / 180;
        return t.pixel(t.px + Math.cos(angle) * distance, t.py + Math.sin(angle) * distance);
      };
      return { center: sample(0, 120), edge: sample(40, 120), outside: sample(72, 120) };
    });
    assert.ok(cone.center[0] > cone.edge[0] + 8,
      `flashlight center should be brighter than the soft edge, got ${JSON.stringify(cone)}`);
    assert.ok(cone.edge[0] > cone.outside[0] + 1,
      `flashlight soft edge should fall off before the cone boundary, got ${JSON.stringify(cone)}`);

    // 5. alpha 渐隐与硬遮挡：关灯后仍有 LOS 时平滑淡出；墙后立即隐藏。
    const fade = await page.evaluate(async () => {
      const { Chicken } = await import('/src/objects/Chicken.ts');
      const t = window.perceptionTest, scene = t.scene;
      const bird = new Chicken(t.px + 70, t.py - 11, () => 0.5);
      scene.chickens = [bird];
      scene.flashlight.setActive(true);
      scene.flashlight.setDirection(0);
      t.update(0.5);
      const identified = t.view(bird);
      scene.flashlight.setActive(false);
      t.update(0.08);
      const fading = t.view(bird);
      t.update(0.4);
      const settled = t.view(bird);
      return { identified, fading, settled };
    });
    assert.equal(fade.identified.level, 'identified');
    assert.ok(fade.fading.level === 'identified' && fade.fading.alpha > 0 && fade.fading.alpha < 1,
      `identified should fade smoothly after light loss, got ${JSON.stringify(fade)}`);
    assert.notEqual(fade.settled.level, 'identified');

    // 6. 探索记忆：近身观察会记下相邻墙体；离开后拆墙不泄漏远处变化，重新观察才更新。
    const memory = await page.evaluate(async () => {
      const { MEMORY_TILE_ORDER } = await import('/src/vision/TerrainMemory.ts');
      const t = window.perceptionTest, scene = t.scene;
      const memory = scene.perception.getTerrainMemory('player');
      const wallIndex = MEMORY_TILE_ORDER.indexOf('wall');
      const defaultIndex = MEMORY_TILE_ORDER.indexOf('default');

      scene.map.tiles[15][21] = 'wall';
      scene.map.tileHp[15][21] = 100;
      t.update(0.3);
      const observed = memory.get(21, 15);

      scene.map.breakTile(21, 15);
      scene.goldPickups = [];
      const farObserver = { ...scene.perceptionObserver, x: 1775, y: 775 };
      scene.perception.update(0.3, [farObserver], [], []);
      const remembered = memory.get(21, 15);

      scene.perception.update(0.3, [scene.perceptionObserver], [], []);
      const refreshed = memory.get(21, 15);
      return { observed, remembered, refreshed, wallIndex, defaultIndex };
    });
    assert.equal(memory.observed?.typeIndex, memory.wallIndex);
    assert.equal(memory.remembered?.typeIndex, memory.wallIndex,
      `destroying a wall far from the observer must not rewrite memory, got ${JSON.stringify(memory)}`);
    assert.equal(memory.refreshed?.typeIndex, memory.defaultIndex,
      `re-observing the broken wall must update memory, got ${JSON.stringify(memory)}`);

    // 7. 墙顶不被地面阴影污染：开灯只能让墙顶更亮或保持原样，不能压出黑三角。
    const wallTop = await page.evaluate(() => {
      const t = window.perceptionTest, scene = t.scene;
      scene.map.tiles[15][22] = 'wall';
      scene.map.tileHp[15][22] = 100;
      scene.flashlight.setActive(false);
      t.update(0.2);
      t.draw();
      const off = t.pixel(22 * t.size + 25, 15 * t.size + 25);
      scene.flashlight.setActive(true);
      scene.flashlight.setDirection(0);
      t.update(0.2);
      t.draw();
      const on = t.pixel(22 * t.size + 25, 15 * t.size + 25);
      scene.map.breakTile(22, 15);
      scene.goldPickups = [];
      return { off, on };
    });
    assert.ok(wallTop.on[0] + 2 >= wallTop.off[0],
      `ground shadows must not darken a visible wall top, got ${JSON.stringify(wallTop)}`);
    assert.ok(wallTop.on[0] > 8, `wall top should remain visible, got ${JSON.stringify(wallTop)}`);

    // 8. 合成对齐：相机偏移/缩放后，遮蔽层仍按世界画布尺寸采样。
    const alignment = await page.evaluate(() => {
      const t = window.perceptionTest, scene = t.scene;
      scene.camera.shake(4, 1, 0.4, 12, 'linear');
      scene.camera.follow(t.px, t.py, 0.01);
      t.draw();
      const renderer = scene.perceptionRenderer;
      return {
        view: scene.displayedView,
        world: [scene.worldCanvas.width, scene.worldCanvas.height],
        overlay: [renderer.overlay.width, renderer.overlay.height],
        scale: renderer.scale,
      };
    });
    assert.equal(alignment.overlay[0], Math.ceil(alignment.world[0] * alignment.scale));
    assert.equal(alignment.overlay[1], Math.ceil(alignment.world[1] * alignment.scale));

    await page.screenshot({ path: `${output}/perception-three-layer-dpr${dpr}.png` });
    assert.deepEqual(errors, []);
    results.push({ dpr, setup, outline, staticOutline, chicken, blocked, cone, fade, alignment });
    console.log(`DPR ${dpr}: outline, memory snapshot/refresh, silhouette, cone edge, wall top and alpha fade passed.`);
    await context.close();
  }
  writeFileSync(`${output}/perception-pixels.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('Perception browser checks passed: rounded unknown outline, static snapshot, silhouette occlusion, soft cone, alpha fade, mask alignment.');
} finally {
  await browser.close();
}
