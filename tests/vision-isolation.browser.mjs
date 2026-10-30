// 三层视野图层隔离诊断（临时脚本，不属于 test:browser 长链）。
// 目的：在相同地图/角色位置/手电方向下分别截取各合成层，量化墙顶与 25px 探索网格的
// 对齐色块，并对照 maskScale、手电旋转、玩家靠近墙三种情形。修复前后各跑一次即可对比。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.SCREENSHOT_DIR || '.review';
const tag = process.env.ISOLATION_TAG || 'before';
mkdirSync(output, { recursive: true });
const layers = ['world', 'outline', 'memory', 'near', 'light', 'grid'];
const report = { tag, layers: {}, profiles: [], memory: null };

function cellMeans(profile, cell = 25) {
  const means = [];
  for (let i = 0; i + cell <= profile.length; i += cell) {
    let sum = 0;
    for (let j = 0; j < cell; j++) sum += profile[i + j];
    means.push({ at: i, mean: +(sum / cell).toFixed(2) });
  }
  return means;
}

function profileStats(profile) {
  let jump = 0, jumpAt = -1;
  for (let i = 1; i < profile.length; i++) {
    const d = Math.abs(profile[i] - profile[i - 1]);
    if (d > jump) { jump = d; jumpAt = i; }
  }
  const cells = cellMeans(profile);
  let cellJump = 0, cellJumpAt = -1;
  for (let i = 1; i < cells.length; i++) {
    const d = Math.abs(cells[i].mean - cells[i - 1].mean);
    if (d > cellJump) { cellJump = d; cellJumpAt = cells[i - 1].at; }
  }
  return {
    maxAdjacentJump: jump, maxAdjacentJumpAt: jumpAt,
    maxCellMeanJump: +cellJump.toFixed(2), maxCellMeanJumpAt: cellJumpAt,
    cells,
  };
}

const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
  await page.goto(`${base}/?vision=three-layer`);
  await page.evaluate(async () => { window.visionGame = (await import('/src/main.ts')).game; });
  await page.keyboard.down('Enter');
  await page.waitForSelector('[data-player-debug]');
  await page.keyboard.up('Enter');
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  await page.evaluate(async () => {
    const { TileMap } = await import('/src/map/TileMap.ts');
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
    const px = 20.5 * size, py = 15.6 * size;
    scene.player.x = px - 24.5;
    scene.player.y = py - 24.5;
    scene.player.currentRotation = Math.PI / 2;
    scene.playerLight.getPosition().set(px, py);
    scene.flashlight.getPosition().set(px, py);
    scene.flashlight.setDirection(-Math.PI / 2);
    scene.flashlight.setActive(false);
    scene.camera.x = px - scene.camera.width / 2;
    scene.camera.y = py - scene.camera.height / 2;

    // 一段横向墙体：底部一行瓦片被近身观察后进入记忆，顶部一行仍留在未知轮廓，
    // 25px 探索单元与 50px 瓦片错位会在墙顶留下可见的矩形条带。
    for (let col = 18; col <= 22; col++) {
      scene.map.tiles[13][col] = 'wall';
      scene.map.tileHp[13][col] = 100;
    }

    scene.perception = new PerceptionSystem({ map: scene.map, terrain: scene.map, rules: scene.visionRules });
    scene.perceptionObserver = {
      id: 'player', x: px, y: py, facing: -Math.PI / 2,
      nearSenseRadius: scene.visionRules.nearSenseRadius,
      maxObservationRange: scene.visionRules.maxObservationRange,
    };
    scene.perceptionRenderer = new PerceptionRenderer(scene.map, scene.map,
      scene.visionRules, scene.graphics.visibility);
    scene.perceptionRenderer.resize(scene.worldCanvas.width, scene.worldCanvas.height,
      scene.graphics.visibility);

    window.isolationTest = {
      scene, px, py, size,
      draw() { scene.draw(game.renderer.ctx); },
      update(dt) { scene.updatePerception(dt); },
      setLayer(layer) { scene.perceptionRenderer.setDebugLayer(layer || null); },
      configure(maskScale) {
        const config = { ...scene.graphics.visibility, maskScale };
        scene.graphics.visibility = config;
        scene.perceptionRenderer.resize(scene.worldCanvas.width, scene.worldCanvas.height, config);
      },
      pixel(x, y) {
        const view = scene.displayedView;
        return [...scene.worldContext.getImageData(
          Math.round(x - view.x), Math.round(y - view.y), 1, 1).data];
      },
      strip(y, x0, x1) {
        const view = scene.displayedView;
        const width = Math.max(1, Math.round(x1 - x0));
        const data = scene.worldContext.getImageData(
          Math.round(x0 - view.x), Math.round(y - view.y), width, 1).data;
        const out = [];
        for (let i = 0; i < width; i++) out.push(data[i * 4]);
        return out;
      },
      stripVertical(x, y0, y1) {
        const view = scene.displayedView;
        const height = Math.max(1, Math.round(y1 - y0));
        const data = scene.worldContext.getImageData(
          Math.round(x - view.x), Math.round(y0 - view.y), 1, height).data;
        const out = [];
        for (let i = 0; i < height; i++) out.push(data[i * 4]);
        return out;
      },
      memoryStats() {
        const memory = scene.perception.getTerrainMemory('player');
        let captured = 0;
        for (let row = 0; row < scene.map.height; row++) {
          for (let col = 0; col < scene.map.width; col++) {
            if (memory.isCaptured(col, row)) captured++;
          }
        }
        return { revision: memory.revision, captured };
      },
      view(x, y) { return scene.perception.getTerrainRecall('player', x, y); },
    };
    window.isolationTest.update(0.3);
    window.isolationTest.draw();
  });

  const shot = async (name) => {
    const path = `${output}/vision-isolation-${tag}-${name}.png`;
    await page.screenshot({ path });
    return path;
  };
  // 1. 图层隔离：同一状态下的六个视图。
  for (const layer of layers) {
    await page.evaluate((l) => { window.isolationTest.setLayer(l); window.isolationTest.draw(); }, layer);
    const path = await shot(`layer-${layer}`);
    const sample = await page.evaluate(() => {
      const t = window.isolationTest;
      return {
        wallA: t.pixel(20 * t.size + 25, 13 * t.size + 12),
        wallB: t.pixel(20 * t.size + 25, 13 * t.size + 37),
        ground: t.pixel(20 * t.size + 25, 15 * t.size + 30),
      };
    });
    report.layers[layer] = { path, ...sample };
  }
  await page.evaluate(() => { window.isolationTest.setLayer(null); window.isolationTest.draw(); });
  report.layers.normal = { path: await shot('layer-normal') };

  // 2. 墙顶剖面：横向扫描墙顶（上/下两行），并纵向跨过整块墙，记录 25px 对齐的阶跃。
  const gather = () => page.evaluate(() => {
    const t = window.isolationTest;
    const x0 = 18 * t.size, x1 = 23 * t.size;
    return {
      top: t.strip(13 * t.size + 12, x0, x1),
      bottom: t.strip(13 * t.size + 37, x0, x1),
      vertical: t.stripVertical(20 * t.size + 25, 13 * t.size, 14 * t.size),
      recallTop: t.view(20 * t.size + 25, 13 * t.size + 12),
      recallBottom: t.view(20 * t.size + 25, 13 * t.size + 37),
      memory: t.memoryStats(),
    };
  });
  await page.evaluate(() => { window.isolationTest.update(0.3); window.isolationTest.draw(); });
  const profile = await gather();
  report.profiles.push({ name: 'wall-top', stats: profileStats(profile.top), profile: profile.top });
  report.profiles.push({ name: 'wall-bottom', stats: profileStats(profile.bottom), profile: profile.bottom });
  report.profiles.push({ name: 'wall-vertical', stats: profileStats(profile.vertical), profile: profile.vertical });
  report.memory = profile.memory;
  report.recall = { top: profile.recallTop, bottom: profile.recallBottom };

  // 3. maskScale 1.0 对照。
  await page.evaluate(() => { window.isolationTest.configure(1); window.isolationTest.draw(); });
  report.maskScaleFull = { path: await shot('layer-normal-scale1') };
  const scaled = await gather();
  report.maskScaleFull.top = profileStats(scaled.top);
  report.maskScaleFull.bottom = profileStats(scaled.bottom);
  report.maskScaleFull.vertical = profileStats(scaled.vertical);
  report.maskScaleFull.profile = scaled.vertical;
  await page.evaluate(() => { window.isolationTest.configure(0.5); });

  // 4. 固定玩家，只旋转手电：每一步记录墙顶剖面阶跃。
  for (let step = 0; step < 8; step++) {
    const direction = -Math.PI / 2 - 0.5 + step * 0.14;
    await page.evaluate((dir) => {
      const t = window.isolationTest, scene = t.scene;
      scene.flashlight.setActive(true);
      scene.flashlight.setDirection(dir);
      t.update(0.3);
      t.draw();
    }, direction);
    const data = await gather();
    report.profiles.push({
      name: `sweep-${step}`, direction: +direction.toFixed(3),
      stats: profileStats(data.top), vertical: profileStats(data.vertical),
      profile: data.top, verticalProfile: data.vertical,
    });
    if (step === 2 || step === 5) await shot(`sweep-${step}`);
  }

  // 5. 手电关闭，仅让玩家靠近墙体。
  for (let step = 0; step < 6; step++) {
    const py = 15.6 * 50 - step * 12.5;
    await page.evaluate((y) => {
      const t = window.isolationTest, scene = t.scene;
      scene.flashlight.setActive(false);
      scene.player.y = y - 24.5;
      scene.playerLight.getPosition().set(t.px, y);
      scene.flashlight.getPosition().set(t.px, y);
      t.update(0.3);
      t.draw();
    }, py);
    const data = await gather();
    report.profiles.push({
      name: `approach-${step}`, playerY: +py.toFixed(1),
      stats: profileStats(data.top), vertical: profileStats(data.vertical),
      profile: data.top, verticalProfile: data.vertical,
    });
    if (step === 2 || step === 5) await shot(`approach-${step}`);
  }

  report.memoryAfter = await page.evaluate(() => window.isolationTest.memoryStats());
  report.errors = errors;
  writeFileSync(`${output}/vision-isolation-${tag}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`Isolation [${tag}] done: ${layers.length} layers, ${report.profiles.length} profiles.`);
  for (const item of report.profiles) {
    const v = item.vertical
      ? `, verticalJump=${item.vertical.maxCellMeanJump}`
      : '';
    console.log(`  ${item.name}: maxAdjacentJump=${item.stats.maxAdjacentJump} @${item.stats.maxAdjacentJumpAt}, ` +
      `maxCellMeanJump=${item.stats.maxCellMeanJump} @${item.stats.maxCellMeanJumpAt}${v}`);
  }
} finally {
  await browser.close();
}
