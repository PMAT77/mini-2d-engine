import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const DT = 1 / 60;
const DETAIL_STEP = DT / 0.12 + 1e-6;
const FADE_STEP = DT / 0.25 + 1e-6;
const results = [];

const assertSmoothWeights = (frames, label, { allowBlock = false } = {}) => {
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    if (allowBlock && b.hardBlocked) continue;
    assert.ok(Math.abs(b.alpha - a.alpha) <= DETAIL_STEP,
      `${label}: detail weight jumped between frames ${i - 1} and ${i}, ${JSON.stringify({ a, b })}`);
    assert.ok(Math.abs(b.silhouette - a.silhouette) <= FADE_STEP,
      `${label}: silhouette weight jumped between frames ${i - 1} and ${i}, ${JSON.stringify({ a, b })}`);
  }
};

const assertNearCoverage = (frames, label, minCoverage = 0.6) => {
  let started = false;
  for (const frame of frames) {
    if (frame.alpha >= 0.7 || frame.silhouette >= 0.9) started = true;
    if (!started || !frame.near || frame.hardBlocked) continue;
    const coverage = 1 - (1 - frame.alpha) * (1 - frame.silhouette);
    assert.ok(coverage >= minCoverage,
      `${label}: near target should stay readable while cross-fading, got ${JSON.stringify(frame)}`);
  }
};

const assertPixelSmooth = (frames, label, maxStep = 48) => {
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1].pixel;
    const b = frames[i].pixel;
    if (!a || !b) continue;
    // 开关手电本身会立即改变地面光照；这里只校验“同一光照状态内”的渲染连续性。
    if (frames[i - 1].lightOn !== frames[i].lightOn) continue;
    assert.ok(Math.abs(b[0] - a[0]) <= maxStep && Math.abs(b[1] - a[1]) <= maxStep && Math.abs(b[2] - a[2]) <= maxStep,
      `${label}: rendered pixel changed abruptly between frames ${i - 1} and ${i}, ${JSON.stringify({ a, b })}`);
  }
};

try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(`${base}/?vision=three-layer`);
    await page.evaluate(async () => { window.visionGame = (await import('/src/main.ts')).game; });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

    await page.evaluate(async () => {
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

      // 墙体在渲染器构造前写入：未知轮廓使用建图时的静态快照。
      for (const col of [18, 19, 20, 21, 22]) {
        scene.map.tiles[13][col] = 'wall';
        scene.map.tileHp[13][col] = 100;
      }
      scene.map.tiles[15][21] = 'wall';
      scene.map.tileHp[15][21] = 100;

      const size = scene.map.tileSize;
      const px = 20.5 * size, py = 15.5 * size;
      const placePlayer = (x, y, facing = Math.PI / 2) => {
        scene.player.x = x - 24.5;
        scene.player.y = y - 24.5;
        scene.player.currentRotation = facing;
        scene.playerLight.getPosition().set(x, y);
        scene.flashlight.getPosition().set(x, y);
      };
      placePlayer(px, py);
      scene.flashlight.setDirection(0);
      scene.flashlight.setActive(false);
      scene.camera.x = px - scene.camera.width / 2;
      scene.camera.y = py - scene.camera.height / 2;

      scene.perception = new PerceptionSystem({ map: scene.map, terrain: scene.map, rules: scene.visionRules });
      const observer = {
        id: 'player', x: px, y: py, facing: Math.PI / 2,
        nearSenseRadius: scene.visionRules.nearSenseRadius,
        maxObservationRange: scene.visionRules.maxObservationRange,
      };
      scene.perceptionObserver = observer;
      scene.perceptionRenderer = new PerceptionRenderer(scene.map, scene.map,
        scene.visionRules, scene.graphics.visibility);
      scene.perceptionRenderer.resize(scene.worldCanvas.width, scene.worldCanvas.height,
        scene.graphics.visibility);

      const dt = 1 / 60;
      const step = () => {
        scene.updatePerception(dt);
        scene.draw(game.renderer.ctx);
      };
      const pixel = (x, y) => {
        const view = scene.displayedView;
        return [...scene.worldContext.getImageData(Math.round(x - view.x), Math.round(y - view.y), 1, 1).data];
      };
      const makeBird = (cx, cy) => {
        const bird = new Chicken(0, 0, () => 0.5);
        bird.x = cx - bird.size / 2;
        bird.y = cy - bird.size / 2;
        scene.chickens = [bird];
        return bird;
      };
      const placeBird = (bird, cx, cy) => {
        bird.x = cx - bird.size / 2;
        bird.y = cy - bird.size / 2;
      };
      const viewOf = (bird, hardBlocked = false) => {
        const view = scene.getPerceptionView(bird);
        const ob = scene.perceptionObserver;
        const cx = bird.x + bird.size / 2;
        const cy = bird.y + bird.size / 2;
        const dist = Math.hypot(cx - ob.x, cy - ob.y);
        return {
          level: view.level,
          alpha: view.alpha,
          silhouette: view.silhouette,
          dist,
          near: dist <= scene.visionRules.nearSenseRadius,
          hardBlocked,
          lightOn: scene.flashlight.isLightActive(),
          pixel: pixel(cx, cy),
        };
      };
      const setLight = (active, direction) => {
        scene.flashlight.setActive(active);
        if (direction !== undefined) scene.flashlight.setDirection(direction);
      };
      const profileWallTop = () => {
        const y = 13 * size + 25;
        const startX = 18 * size;
        const cells = [];
        for (let i = 0; i < 10; i += 1) {
          let sum = 0;
          for (let k = 0; k < 25; k += 1) sum += pixel(startX + i * 25 + k, y)[0];
          cells.push(sum / 25);
        }
        // 跳过墙两端圆角所在的首尾单元，只比较墙顶内部单元。
        let interiorJump = 0;
        for (let i = 2; i < cells.length - 1; i += 1) {
          interiorJump = Math.max(interiorJump, Math.abs(cells[i] - cells[i - 1]));
        }
        // 纵向：墙顶内部两个 25px 单元均值差（修复前这里是 33 与 9 的硬台阶）。
        const x = 20 * size + 25;
        let top = 0;
        let bottom = 0;
        for (let k = 0; k < 25; k += 1) {
          top += pixel(x, 13 * size + k)[0];
          bottom += pixel(x, 13 * size + 25 + k)[0];
        }
        const verticalJump = Math.abs(top / 25 - bottom / 25);
        return { cells, interiorJump, verticalJump };
      };

      window.continuityTest = { scene, px, py, size };

      const runCrossfade = (bird) => {
        scene.chickens = [bird];
        const frames = [];
        setLight(true, Math.atan2(-50, -70));
        for (let i = 0; i < 12; i += 1) { step(); frames.push(viewOf(bird)); }
        setLight(false);
        for (let i = 0; i < 24; i += 1) { step(); frames.push(viewOf(bird)); }
        return frames;
      };

      window.runContinuity = (mode) => {
        const out = {};
        const nearBird = makeBird(px - 70, py - 50);

        if (mode === 'full') {
          // 1. 手电关闭，鸡进入/离开近身范围。
          setLight(false);
          const enterExit = [];
          for (let i = 0; i < 90; i += 1) {
            placeBird(nearBird, px - 160 + i * (120 / 90), py);
            step();
            enterExit.push(viewOf(nearBird));
          }
          for (let i = 0; i < 90; i += 1) {
            placeBird(nearBird, px - 40 - i * (120 / 90), py);
            step();
            enterExit.push(viewOf(nearBird));
          }
          out.enterExit = enterExit;

          // 2. 手电缓慢扫过近身目标。
          placeBird(nearBird, px - 70, py - 50);
          const sweepSlow = [];
          setLight(true, -3.0);
          for (let i = 0; i < 180; i += 1) {
            scene.flashlight.setDirection(-3.0 + (1.2 * i) / 180);
            step();
            sweepSlow.push(viewOf(nearBird));
          }
          out.sweepSlow = sweepSlow;

          // 3. 手电快速扫过，确认确认时间与权重仍平滑。
          const sweepFast = [];
          for (let i = 0; i < 24; i += 1) {
            scene.flashlight.setDirection(-3.0 + (1.2 * i) / 24);
            step();
            sweepFast.push(viewOf(nearBird));
          }
          out.sweepFast = sweepFast;

          // 4. 手电停留足够时间完成辨识（用新的目标实例从零状态计时）。
          const dwellBird = makeBird(px - 70, py - 50);
          const dwell = [];
          setLight(true, Math.atan2(-50, -70));
          for (let i = 0; i < 30; i += 1) { step(); dwell.push(viewOf(dwellBird)); }
          out.dwell = dwell;
          scene.chickens = [nearBird];

          // 5. 手电移开，完整形象连续过渡为剪影。
          out.crossfade = runCrossfade(nearBird);

          // 6. 柔边抖动：方向在光束边缘小幅摆动。
          const softEdge = [];
          setLight(true, Math.atan2(-50, -70));
          for (let i = 0; i < 60; i += 1) {
            scene.flashlight.setDirection(Math.atan2(-50, -70) + 0.30 * Math.sin(i * 0.35));
            step();
            softEdge.push(viewOf(nearBird));
          }
          out.softEdge = softEdge;

          // 7. 墙后立即隐藏：先让剪影权重接近 1，再瞬间加回被拆掉的墙。
          const hiddenBird = makeBird(px + 95, py + 20);
          scene.map.breakTile(21, 15);
          scene.goldPickups = [];
          const beforeWall = [];
          for (let i = 0; i < 20; i += 1) { step(); beforeWall.push(viewOf(hiddenBird)); }
          scene.map.tiles[15][21] = 'wall';
          scene.map.tileHp[15][21] = 100;
          step();
          const afterWall = viewOf(hiddenBird);
          out.wallBlock = { beforeWall, afterWall };

          // 8. 部分身体露出：剪影不得画到墙顶上。
          const partialBird = makeBird(0, 0);
          placeBird(partialBird, 21 * size, py);
          placePlayer(px - 65, py);
          setLight(false);
          for (let i = 0; i < 30; i += 1) step();
          // 采样点必须同时落在墙体所在半边、且位于鸡的身体轮廓内：
          // 裁剪生效时这些像素不应出现剪影，裁剪丢失时会立刻在差值里暴露。
          const withChicken = pixel(21 * size + 8, py);
          const groundSide = pixel(21 * size - 6, py);
          scene.chickens = [];
          step();
          const withoutChicken = pixel(21 * size + 8, py);
          out.partial = { withChicken, withoutChicken, groundSide };
          scene.chickens = [nearBird];

          // 10a. 先近身探索墙顶，再移开让近身光晕离开墙体：
          // 此时墙顶明暗只能来自探索/记忆，25px 阶级会暴露成横向条带。
          scene.chickens = [];
          setLight(false);
          for (let i = 0; i < 30; i += 1) step();
          placePlayer(px, py + 160);
          for (let i = 0; i < 30; i += 1) step();
          out.wallStatic = profileWallTop();
          placePlayer(px, py);
          step();

          // 10b. 玩家移动 + 手电旋转时，墙顶只能连续变化，不能成块跳变。
          setLight(true, -Math.PI / 2);
          const wallFrames = [];
          for (let i = 0; i < 40; i += 1) {
            const y = py - Math.min(65, i * 1.7);
            placePlayer(px, y);
            scene.flashlight.setDirection(-Math.PI / 2 + 0.3 * Math.sin(i / 4));
            step();
            wallFrames.push(profileWallTop());
          }
          out.wallGrid = wallFrames;
        } else {
          // 紧凑模式：只覆盖交叉淡化 + 墙顶网格，用于不同 DPR / maskScale 复核。
          out.crossfade = runCrossfade(nearBird);
          scene.chickens = [];
          setLight(false);
          for (let i = 0; i < 30; i += 1) step();
          placePlayer(px, py + 160);
          for (let i = 0; i < 30; i += 1) step();
          out.wallStatic = profileWallTop();
          placePlayer(px, py);
          step();
          setLight(true, -Math.PI / 2);
          const wallFrames = [];
          for (let i = 0; i < 24; i += 1) {
            const y = py - Math.min(65, i * 2.8);
            placePlayer(px, y);
            scene.flashlight.setDirection(-Math.PI / 2 + 0.3 * Math.sin(i / 3));
            step();
            wallFrames.push(profileWallTop());
          }
          out.wallGrid = wallFrames;

          // maskScale 1.0 下再跑一次墙顶剖面，确认半分辨率采样不是网格来源。
          scene.graphics.visibility.maskScale = 1;
          scene.perceptionRenderer.configure(scene.graphics.visibility);
          scene.perceptionRenderer.resize(scene.worldCanvas.width, scene.worldCanvas.height,
            scene.graphics.visibility);
          setLight(false);
          placePlayer(px, py + 160);
          for (let i = 0; i < 30; i += 1) step();
          out.wallStaticFullRes = profileWallTop();
          placePlayer(px, py);
          step();
          setLight(true, -Math.PI / 2);
          const fullRes = [];
          for (let i = 0; i < 24; i += 1) {
            const y = py - Math.min(65, i * 2.8);
            placePlayer(px, y);
            scene.flashlight.setDirection(-Math.PI / 2 + 0.3 * Math.sin(i / 3));
            step();
            fullRes.push(profileWallTop());
          }
          out.wallGridFullRes = fullRes;
        }
        return out;
      };
    });

    const mode = dpr === 1 ? 'full' : 'compact';
    const data = await page.evaluate(modeName => window.runContinuity(modeName), mode);

    assertSmoothWeights(data.crossfade, `dpr ${dpr} crossfade`);
    assertNearCoverage(data.crossfade, `dpr ${dpr} crossfade`);
    assertPixelSmooth(data.crossfade, `dpr ${dpr} crossfade`);

    const assertWallStatic = (profile, label) => {
      assert.ok(profile.verticalJump <= 6,
        `${label}: wall top is split into 25px horizontal bands, vertical jump ${profile.verticalJump.toFixed(2)}`);
      assert.ok(profile.interiorJump <= 6,
        `${label}: wall top has a 25px vertical step, interior jump ${profile.interiorJump.toFixed(2)}`);
    };
    const assertWallMotion = (frames, label) => {
      for (let t = 1; t < frames.length; t += 1) {
        for (let i = 0; i < frames[t].cells.length; i += 1) {
          const delta = Math.abs(frames[t].cells[i] - frames[t - 1].cells[i]);
          assert.ok(delta <= 6,
            `${label}: wall top changed in a block between frames ${t - 1} and ${t} at cell ${i} (${delta.toFixed(2)})`);
        }
      }
    };
    assertWallStatic(data.wallStatic, `dpr ${dpr}`);
    assertWallMotion(data.wallGrid, `dpr ${dpr}`);
    if (data.wallGridFullRes) {
      assertWallStatic(data.wallStaticFullRes, `dpr ${dpr} maskScale 1.0`);
      assertWallMotion(data.wallGridFullRes, `dpr ${dpr} maskScale 1.0`);
    }

    if (mode === 'full') {
      assertSmoothWeights(data.enterExit, 'near enter/exit');
      for (const frame of data.enterExit) {
        assert.notEqual(frame.level, 'identified', `dark near target must not identify, got ${JSON.stringify(frame)}`);
        assert.equal(frame.alpha, 0);
      }
      const entered = data.enterExit.filter(frame => frame.near);
      assert.ok(entered.some(frame => frame.silhouette > 0.8), 'entering near range should reveal a silhouette');
      assert.ok(data.enterExit.slice(-10).every(frame => frame.level === 'hidden'),
        'leaving near range again should hide the target');

      assertSmoothWeights(data.sweepSlow, 'slow sweep');
      assertNearCoverage(data.sweepSlow, 'slow sweep');
      assertPixelSmooth(data.sweepSlow, 'slow sweep');
      assertSmoothWeights(data.sweepFast, 'fast sweep');
      assertNearCoverage(data.sweepFast, 'fast sweep');
      assert.ok(data.sweepFast.every(frame => frame.level !== 'hidden'),
        'a fast sweep must not make a near chicken vanish');

      assertSmoothWeights(data.dwell, 'dwell');
      const firstIdentified = data.dwell.findIndex(frame => frame.level === 'identified');
      assert.ok(firstIdentified >= 7 && firstIdentified <= 10,
        `identification must wait for the dwell time, first identified frame ${firstIdentified}`);
      assert.ok(Math.abs(data.dwell[firstIdentified].alpha - 1) < 1e-6,
        'identified state should only appear once the detail weight reaches 1');

      const off = data.crossfade.slice(12);
      assert.ok(off.length > 10);
      for (let i = 1; i < off.length; i += 1) {
        assert.ok(off[i].alpha <= off[i - 1].alpha + 1e-9, 'detail weight must decay monotonically after light loss');
        assert.ok(off[i].silhouette >= off[i - 1].silhouette - 1e-9, 'silhouette weight must grow monotonically');
        assert.ok(Math.abs(off[i].alpha + off[i].silhouette - 1) < 1e-6,
          `near cross-fade must stay complementary, got ${JSON.stringify(off[i])}`);
        assert.notEqual(off[i].level, 'hidden', 'target must not disappear during the cross-fade');
      }
      assert.equal(off[off.length - 1].level, 'silhouette');
      assert.ok(Math.abs(off[off.length - 1].silhouette - 1) < 1e-6);

      const softLevels = data.softEdge.map(frame => frame.level);
      let flips = 0;
      for (let i = 1; i < softLevels.length; i += 1) if (softLevels[i] !== softLevels[i - 1]) flips += 1;
      assert.ok(flips <= 3, `soft-edge jitter must not flicker, saw ${flips} level flips`);
      assertSmoothWeights(data.softEdge, 'soft edge');
      assertNearCoverage(data.softEdge, 'soft edge');

      assertSmoothWeights(data.wallBlock.beforeWall, 'before wall');
      assert.equal(data.wallBlock.afterWall.level, 'hidden');
      assert.equal(data.wallBlock.afterWall.alpha, 0);
      assert.equal(data.wallBlock.afterWall.silhouette, 0,
        `hard occlusion must zero both weights immediately, got ${JSON.stringify(data.wallBlock.afterWall)}`);

      const leak = Math.abs(data.partial.withChicken[0] - data.partial.withoutChicken[0])
        + Math.abs(data.partial.withChicken[1] - data.partial.withoutChicken[1])
        + Math.abs(data.partial.withChicken[2] - data.partial.withoutChicken[2]);
      assert.ok(leak <= 3, `a partially hidden chicken must not paint over the wall top, got ${JSON.stringify(data.partial)}`);
      assert.ok(data.partial.groundSide[2] > data.partial.groundSide[0],
        `the visible part should still read as a cold grey silhouette, got ${JSON.stringify(data.partial.groundSide)}`);
    }

    await page.screenshot({ path: `${output}/perception-continuity-dpr${dpr}.png` });
    assert.deepEqual(errors, []);
    results.push({
      dpr, mode,
      crossfade: data.crossfade,
      wallStatic: data.wallStatic,
      wallGridMaxFrameDelta: Math.max(...data.wallGrid.map((frame, index) => index === 0 ? 0
        : Math.max(...frame.cells.map((value, cell) => Math.abs(value - data.wallGrid[index - 1].cells[cell]))))),
    });
    console.log(`DPR ${dpr} (${mode}): continuity, wall-top profile and cross-fade weights passed.`);
    await context.close();
  }
  writeFileSync(`${output}/perception-continuity.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('Perception continuity checks passed.');
} finally {
  await browser.close();
}
