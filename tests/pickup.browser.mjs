import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });

const brightness = pixel => (pixel[0] + pixel[1] + pixel[2]) / 3;

let scenarios = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://localhost:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      const game = (await import(entry.src)).game;
      window.pickupGame = game;
      window.meatModule = await import(new URL('objects/MeatPickup.ts', entry.src).href);
      window.goldModule = await import(new URL('objects/GoldPickup.ts', entry.src).href);
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => {
      const scene = window.pickupGame.sceneManager.getCurrentScene();
      return scene?.constructor.name === 'GameScene' && scene.loaded;
    });
    await page.keyboard.up('Enter');

    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
      const game = window.pickupGame;
      const scene = game.sceneManager.getCurrentScene();
      // 固定地图与感知，避免种子生成的水/墙/火把随机影响采样。
      scene.map = new scene.map.constructor(60, 40, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.perception = new scene.perception.constructor({
        map: scene.map,
        terrain: scene.map,
        rules: scene.visionRules,
      });
      // 环境照明直接揭示细节；墙体遮挡仍必须由 LOS 挡住。
      scene.visionRules.ambientIdentifies = true;
      scene.chickens = [];
      scene.pickupItems = [];
      scene.goldPickups = [];
      scene.meatPickups = [];
      scene.player.x = 400;
      scene.player.y = 400;
      scene.player.takeDamage(30);

      const canvas = game.renderer.ctx.canvas;
      window.pickupTest = {
        scene,
        step(delta = 1 / 60) { scene.update(delta, game.input); scene.draw(game.renderer.ctx); },
        state() { return scene.getPickupDebugState(); },
        center() { const vision = scene.player.getVisionState(); return { x: vision.x, y: vision.y }; },
        health() { return scene.player.getHealth(); },
        reset() { scene.meatPickups.length = 0; scene.goldPickups.length = 0; },
        spawnMeat(worldX, worldY) {
          const meat = new window.meatModule.MeatPickup(worldX - 8, worldY - 8);
          scene.meatPickups.push(meat);
          return meat;
        },
        spawnGold(worldX, worldY) {
          const gold = new window.goldModule.GoldPickup(worldX, worldY, worldX, worldY);
          scene.goldPickups.push(gold);
          return gold;
        },
        screen(worldX, worldY) {
          const d = window.devicePixelRatio || 1;
          const offset = scene.camera.getOffset();
          const scale = (canvas.width / d) / scene.camera.width;
          return { x: (worldX - offset.x) * scale, y: (worldY - offset.y) * scale };
        },
        maxBrightness(x, y, radius = 2) {
          const d = window.devicePixelRatio || 1;
          const size = radius * 2 + 1;
          const data = game.renderer.ctx.getImageData(
            Math.floor((x - radius) * d), Math.floor((y - radius) * d), Math.ceil(size * d), Math.ceil(size * d),
          ).data;
          let max = 0;
          for (let i = 0; i < data.length; i += 4) max = Math.max(max, (data[i] + data[i + 1] + data[i + 2]) / 3);
          return max;
        },
        brightCount(x, y, width, height, threshold = 200) {
          const d = window.devicePixelRatio || 1;
          const data = game.renderer.ctx.getImageData(
            Math.floor(x * d), Math.floor(y * d), Math.ceil(width * d), Math.ceil(height * d),
          ).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if ((data[i] + data[i + 1] + data[i + 2]) / 3 > threshold) count += 1;
          }
          return count;
        },
        /** 进度环所在半径 23px 处四个轴向上的最大亮度（避开键帽四角）。 */
        ringAxes(centerX, centerY) {
          return {
            right: this.maxBrightness(centerX + 23, centerY, 1),
            left: this.maxBrightness(centerX - 23, centerY, 1),
            top: this.maxBrightness(centerX, centerY - 23, 1),
            bottom: this.maxBrightness(centerX, centerY + 23, 1),
          };
        },
      };
    });

    const step = async (frames = 1, delta = 1 / 60) => {
      for (let i = 0; i < frames; i += 1) await page.evaluate(([d]) => pickupTest.step(d), [delta]);
    };
    const hold = async frames => {
      await page.keyboard.down('e');
      await step(frames);
    };
    const release = async () => {
      await page.keyboard.up('e');
      await step(1);
    };

    await step(2);
    const origin = await page.evaluate(() => pickupTest.center());

    // 1) 墙后的肉块永远不显示高亮点，即使已进入发现半径。
    await page.evaluate(([cx, cy]) => {
      // 玩家中心在 x = cx；墙体填在玩家与肉块之间的整列。
      const col = Math.floor((cx + 50) / 50);
      for (let row = 0; row < 40; row += 1) pickupTest.scene.map.tiles[row][col] = 'wall';
      pickupTest.spawnMeat(cx + 120, cy);
    }, [origin.x, origin.y]);
    await step(20);
    let state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.markerCount, 0, 'a wall must hide the drop marker');
    assert.equal(state.state, 'idle');
    await page.screenshot({ path: `${output}/pickup-wall-hidden-dpr${dpr}.png` });
    await page.evaluate(() => pickupTest.reset());

    // 2) 移除墙后同一位置出现白色高亮点，并且允许发现但不允许交互。
    await page.evaluate(([cx, cy]) => {
      pickupTest.scene.map.tiles.forEach(row => row.fill('default'));
      pickupTest.spawnMeat(cx + 120, cy);
    }, [origin.x, origin.y]);
    await step(20);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.markerCount, 1, 'identified loot inside discoveryRadius shows a marker');
    assert.equal(state.candidateCount, 0, 'loot outside interactionRadius is not interactable');
    let markerPoint = await page.evaluate(([x, y]) => {
      const point = pickupTest.screen(x, y);
      return { x: point.x, y: point.y - 18 };
    }, [state.markers[0].x, state.markers[0].y]);
    let markerBrightness = await page.evaluate(([x, y]) => pickupTest.maxBrightness(x, y, 3), [markerPoint.x, markerPoint.y]);
    assert.ok(markerBrightness > brightness([150, 150, 150]), `the white dot should be drawn, got ${markerBrightness}`);
    await page.screenshot({ path: `${output}/pickup-marker-dpr${dpr}.png` });
    await page.evaluate(() => pickupTest.reset());

    // 3) 进入交互距离后出现 E 提示；高亮点仍在，且此时没有进度环。
    await page.evaluate(([cx, cy]) => pickupTest.spawnMeat(cx + 50, cy), [origin.x, origin.y]);
    await step(20);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.state, 'focused');
    assert.equal(state.candidateCount, 1);
    assert.equal(state.markerCount, 1);
    const promptWorld = await page.evaluate(() => {
      const markers = pickupTest.state().markers;
      return { x: markers[0].x, y: markers[0].y };
    });
    const iconPoint = await page.evaluate(([x, y]) => {
      const point = pickupTest.screen(x, y);
      return { x: point.x, y: point.y - 34 };
    }, [promptWorld.x, promptWorld.y]);
    const iconPixels = await page.evaluate(([x, y]) => pickupTest.brightCount(x - 20, y - 20, 40, 40, 170), [iconPoint.x, iconPoint.y]);
    assert.ok(iconPixels > 100, `the E keycap should be drawn, got ${iconPixels} bright pixels`);
    const ringIdle = await page.evaluate(([x, y]) => pickupTest.ringAxes(x, y), [iconPoint.x, iconPoint.y]);
    await page.screenshot({ path: `${output}/pickup-prompt-dpr${dpr}.png` });

    // 4) 按住 0.25s：进度 50%，白色环从 12 点方向顺时针出现。
    await page.keyboard.down('e');
    await step(15);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.state, 'holding');
    assert.ok(Math.abs(state.progress - 0.5) < 0.02, `expected 50% progress, got ${state.progress}`);
    const ringHold = await page.evaluate(([x, y]) => pickupTest.ringAxes(x, y), [iconPoint.x, iconPoint.y]);
    for (const axis of ['right', 'top']) {
      assert.ok(ringHold[axis] > ringIdle[axis] + 8,
        `the white arc should brighten the ${axis} side (${ringIdle[axis]} -> ${ringHold[axis]})`);
    }
    assert.ok(ringHold.right > 240, `the arc should be pure white at the right side, got ${ringHold.right}`);
    assert.ok(ringHold.right > ringHold.left + 10,
      `only the right half is filled at 50% (right ${ringHold.right}, left ${ringHold.left})`);
    await page.screenshot({ path: `${output}/pickup-ring-half-dpr${dpr}.png` });

    // 5) 相机震动后标记仍跟物品对齐（位置换算必须使用含震动的 getOffset）。
    const healthBefore = await page.evaluate(() => pickupTest.health());
    await page.evaluate(() => pickupTest.scene.camera.shake(18, 0.5, 0.7));
    await step(15);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.meatCount, 0, 'holding 0.5s collects exactly once');
    assert.equal(state.markerCount, 0, 'a collected item must not leave a marker in the same frame');
    assert.equal(state.candidateCount, 0, 'a collected item must not leave a prompt candidate');
    const healthAfter = await page.evaluate(() => pickupTest.health());
    assert.equal(healthAfter, healthBefore + 5, `meat heals 5 HP, ${healthBefore} -> ${healthAfter}`);
    await page.keyboard.up('e');
    await step(1);
    await page.screenshot({ path: `${output}/pickup-collected-dpr${dpr}.png` });

    // 6) 提前松开取消进度，且松开当帧仍保留提示。
    await page.evaluate(([cx, cy]) => pickupTest.spawnMeat(cx + 50, cy), [origin.x, origin.y]);
    await step(20);
    await page.keyboard.down('e');
    await step(12);
    let mid = await page.evaluate(() => pickupTest.state());
    assert.ok(mid.progress > 0.3, 'holding accumulates progress');
    await page.keyboard.up('e');
    await step(1);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.progress, 0, 'releasing resets progress immediately');
    assert.equal(state.state, 'focused');
    assert.equal(state.meatCount, 1, 'releasing must not collect');
    await step(10);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.meatCount, 1, 'walking away from the key does not continue the pickup');

    // 7) 按住时切枪（Tab）取消交互，且不会连续拾取。
    await page.keyboard.down('e');
    await step(12);
    await page.keyboard.down('Tab');
    await step(1);
    await page.keyboard.up('Tab');
    await step(10);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.meatCount, 1, 'switching weapons cancels the hold');
    assert.equal(state.state !== 'holding', true);
    await page.keyboard.up('e');
    await step(2);
    await page.screenshot({ path: `${output}/pickup-cancelled-dpr${dpr}.png` });

    // 8) 打开 F2 调试面板：取消进度、不产生幽灵拾取，Tab 交给面板做焦点导航。
    await page.keyboard.down('e');
    await step(12);
    await page.keyboard.press('F2');
    await step(10);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.state, 'idle', 'opening the debug panel cancels the interaction');
    assert.equal(state.progress, 0);
    assert.equal(state.meatCount, 1, 'the debug panel must not cause a ghost pickup');
    await page.keyboard.press('F2');
    await page.keyboard.up('e');
    await step(2);
    await page.evaluate(() => pickupTest.reset());

    // 9) 黄金碎块保持碰撞自动拾取：在远处有金色发现点但不进入交互状态，碰到即收。
    await page.evaluate(([cx, cy]) => pickupTest.spawnGold(cx + 100, cy), [origin.x, origin.y]);
    await step(20);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.markerCount, 1, 'gold still shows its calm gold marker');
    assert.equal(state.candidateCount, 0, 'gold never enters the E interaction candidates');
    const goldMarkerPoint = await page.evaluate(([x, y]) => {
      const point = pickupTest.screen(x, y);
      return { x: point.x, y: point.y - 18 };
    }, [state.markers[0].x, state.markers[0].y]);
    assert.ok(await page.evaluate(([x, y]) => pickupTest.maxBrightness(x, y, 3), [goldMarkerPoint.x, goldMarkerPoint.y]) > 100);
    // 换一块直接落在玩家身上的黄金：散落动画结束后由碰撞自动收集，不需要按 E。
    await page.evaluate(([cx, cy]) => {
      pickupTest.reset();
      pickupTest.spawnGold(cx, cy);
    }, [origin.x, origin.y]);
    await step(30);
    state = await page.evaluate(() => pickupTest.state());
    assert.equal(state.markerCount, 0, 'collected gold leaves no marker');
    assert.equal(state.candidateCount, 0, 'gold never produces an E prompt');
    assert.equal(await page.evaluate(() => pickupTest.scene.goldPickups.length), 0, 'gold is collected on contact');
    await page.evaluate(() => pickupTest.reset());

    // 10) 相机震动时标记必须跟着世界坐标走：换算要使用含震动偏移的 getOffset。
    await page.evaluate(([cx, cy]) => pickupTest.spawnMeat(cx + 50, cy), [origin.x, origin.y]);
    await step(20);
    await page.evaluate(() => pickupTest.scene.camera.shake(18, 0.5, 0.7));
    await step(1);
    const shaken = await page.evaluate(() => {
      const state = pickupTest.state();
      const offset = pickupTest.scene.camera.getOffset();
      const camera = pickupTest.scene.camera;
      const point = pickupTest.screen(state.markers[0].x, state.markers[0].y);
      return { x: point.x, y: point.y - 18, offsetX: offset.x - camera.x, offsetY: offset.y - camera.y };
    });
    assert.ok(Math.hypot(shaken.offsetX, shaken.offsetY) > 3,
      `camera shake should be active, got ${shaken.offsetX},${shaken.offsetY}`);
    const shakenBrightness = await page.evaluate(([x, y]) => pickupTest.maxBrightness(x, y, 3), [shaken.x, shaken.y]);
    assert.ok(shakenBrightness > 150, `the marker must follow the shaken camera, got ${shakenBrightness}`);
    await page.evaluate(() => pickupTest.reset());

    // 11) 30/60/144 FPS 下用游戏 delta 累计，完成时间都落在 0.5s ± 1 帧。
    for (const fps of [30, 60, 144]) {
      await page.evaluate(([cx, cy]) => pickupTest.spawnMeat(cx + 50, cy), [origin.x, origin.y]);
      // 等肉块落地并锁定目标后，再按住 E 计时。
      await step(20);
      const focused = await page.evaluate(() => pickupTest.state().state);
      assert.equal(focused, 'focused', `${fps} FPS: the landed meat should be focused`);
      await page.keyboard.down('e');
      let elapsed = 0;
      let frames = 0;
      for (; frames < 400; frames += 1) {
        const before = await page.evaluate(() => pickupTest.state().meatCount);
        await step(1, 1 / fps);
        elapsed += 1 / fps;
        if (before === 1 && await page.evaluate(() => pickupTest.state().meatCount === 0)) break;
      }
      await page.keyboard.up('e');
      await step(1);
      assert.ok(Math.abs(elapsed - 0.5) <= 1 / fps + 1e-6,
        `${fps} FPS: pickup took ${elapsed.toFixed(3)}s, expected 0.5s ± one frame`);
      await page.evaluate(() => pickupTest.reset());
    }

    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    scenarios += 1;
    await context.close();
  }
  console.log(`pickup browser acceptance passed for ${scenarios} DPR scenarios`);
} finally {
  await browser.close();
}
