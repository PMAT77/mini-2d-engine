import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });

const CARD_WIDTH = 336;
const CARD_HEIGHT = 132;
const COMPACT_HEIGHT = 92;
const MARGIN = 24;
const BRASS = [240, 198, 116];
const AMBER = [255, 206, 107];
const LAMP_ON = [255, 206, 107];
const LAMP_OFF = [91, 116, 128];
const nearColor = (pixel, expected, tolerance = 14) => expected.every((value, index) => Math.abs(pixel[index] - value) <= tolerance);

let scenarios = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      // Vite 可能给入口 URL 加时间戳：用页面正在跑的那个模块，避免第二个游戏实例。
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.weaponHudGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => {
      const scene = window.weaponHudGame.sceneManager.getCurrentScene();
      return scene?.constructor.name === 'GameScene' && scene.loaded;
    });
    await page.keyboard.up('Enter');

    // 固定地图、停掉 rAF、手动步进，保证采样的是真实渲染管线而不是模拟值。
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
      const game = window.weaponHudGame, scene = game.sceneManager.getCurrentScene();
      scene.map = new scene.map.constructor(60, 40, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.pickupItems = [];
      scene.player.x = 200;
      scene.player.y = 250;
      window.weaponHudTest = {
        scene,
        step(delta = 1 / 60) { scene.update(delta, game.input); scene.draw(game.renderer.ctx); },
        size() {
          const d = window.devicePixelRatio || 1;
          return { width: game.renderer.ctx.canvas.width / d, height: game.renderer.ctx.canvas.height / d };
        },
        pixel(x, y) {
          const d = window.devicePixelRatio || 1;
          return [...game.renderer.ctx.getImageData(Math.floor(x * d), Math.floor(y * d), 1, 1).data];
        },
        brightPixels(x, y, width, height, threshold = 140) {
          const d = window.devicePixelRatio || 1;
          const data = game.renderer.ctx.getImageData(Math.floor(x * d), Math.floor(y * d), Math.ceil(width * d), Math.ceil(height * d)).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if ((data[i] + data[i + 1] + data[i + 2]) / 3 > threshold) count += 1;
          }
          return count;
        },
        setAmmo(magazineAmmo, chambered) { scene.player.setDebugState({ magazineAmmo, chambered }); },
        reload() { scene.player.requestReload(); },
        status() { return scene.weaponHud.getLastStatus(); },
      };
    });

    const size = await page.evaluate(() => weaponHudTest.size());
    const card = { x: size.width - MARGIN - CARD_WIDTH, y: size.height - MARGIN - CARD_HEIGHT };
    const chip = { x: card.x + CARD_WIDTH - 96, y: card.y - 34 };
    // 弹匣槽从左往右排：i=5 是最靠右的一格（贴膛内槽），6/6 时亮着。
    const slotWidth = Math.min(14, (96 - 5 * 4) / 6);
    const slotCenter = index => card.x + 196 + index * (slotWidth + 4) + slotWidth / 2;
    const slotY = card.y + 102;

    await page.evaluate(() => weaponHudTest.step());
    assert.deepEqual(await page.evaluate(() => weaponHudTest.status().ammoText), '6/6');
    assert.equal(await page.evaluate(() => weaponHudTest.status().pillText), '副');
    const brass = await page.evaluate(([x, y]) => weaponHudTest.pixel(x, y), [slotCenter(5), slotY]);
    assert.ok(nearColor(brass, BRASS), `rightmost magazine slot should be brass, got ${brass}`);
    // 卡片贴右下角：弹槽亮色像素只可能来自卡片内部。
    assert.ok(card.x > size.width / 2 && card.y > size.height / 2);
    const textPixels = await page.evaluate(([x, y]) => weaponHudTest.brightPixels(x, y, 96, 20), [card.x + 196, card.y + 92]);
    assert.ok(textPixels > 80, `full magazine should light most of the strip, got ${textPixels}`);
    // 默认手电开启：胶囊状态灯为暖琥珀。
    const lampOn = await page.evaluate(([x, y]) => weaponHudTest.pixel(x, y), [chip.x + 12, chip.y + 13]);
    assert.ok(nearColor(lampOn, LAMP_ON), `flashlight lamp should be amber while on, got ${lampOn}`);
    await page.screenshot({ path: `${output}/weapon-hud-dpr${dpr}.png` });

    // 空仓：同一格变暗，状态机和文案同步。
    await page.evaluate(() => { weaponHudTest.setAmmo(0, false); weaponHudTest.step(); });
    const status = await page.evaluate(() => weaponHudTest.status());
    assert.equal(status.phase, 'empty');
    assert.equal(status.ammoText, '0/6');
    assert.equal(status.tagText, 'R 换弹');
    const empty = await page.evaluate(([x, y]) => weaponHudTest.pixel(x, y), [slotCenter(5), slotY]);
    assert.ok(!nearColor(empty, BRASS), `empty slot must not stay brass, got ${empty}`);
    assert.ok(empty[0] + empty[1] + empty[2] < 240, `empty slot should be dark, got ${empty}`);

    // 换弹中：进度约 50%，最左边一格已经填成琥珀色。
    await page.evaluate(() => { weaponHudTest.reload(); weaponHudTest.step(0.7); });
    const progress = await page.evaluate(() => weaponHudTest.scene.player.getReloadProgress());
    assert.ok(progress > 0.45 && progress < 0.55, `reload progress ${progress} should be around 50%`);
    assert.equal(await page.evaluate(() => weaponHudTest.status().phase), 'reloading');
    const reloading = await page.evaluate(([x, y]) => weaponHudTest.pixel(x, y), [slotCenter(0), slotY]);
    assert.ok(nearColor(reloading, AMBER), `leftmost slot should fill amber while reloading, got ${reloading}`);
    await page.screenshot({ path: `${output}/weapon-hud-reload-dpr${dpr}.png` });
    // 收完这一轮换弹，让后续切枪检查从满弹匣开始。
    await page.evaluate(() => weaponHudTest.step(0.9));
    assert.equal(await page.evaluate(() => weaponHudTest.status().phase), 'normal');

    // 调试面板是居中弹窗，不再为 HUD 让位；这里只确认开关不破坏 HUD。
    await page.keyboard.press('F2');
    const panel = page.getByRole('dialog', { name: '调试面板' });
    await panel.waitFor({ state: 'visible' });
    assert.ok(await panel.boundingBox(), 'debug dialog should render');
    await page.keyboard.press('F2');

    // 边沿输入每次 step 才采样，按下/释放都要各步进一帧。
    const press = async key => {
      await page.keyboard.down(key);
      await page.evaluate(() => weaponHudTest.step());
      await page.keyboard.up(key);
      await page.evaluate(() => weaponHudTest.step());
    };

    // G 关掉手电：状态灯转为冷灰。
    await press('g');
    const lampOff = await page.evaluate(([x, y]) => weaponHudTest.pixel(x, y), [chip.x + 12, chip.y + 13]);
    assert.ok(nearColor(lampOff, LAMP_OFF), `flashlight lamp should be muted while off, got ${lampOff}`);
    await page.screenshot({ path: `${output}/weapon-hud-flashlight-off-dpr${dpr}.png` });

    // C 收枪：卡片变矮、没有弹药，提示 Q/E 拔枪。
    await press('c');
    const unarmed = await page.evaluate(() => weaponHudTest.status());
    assert.equal(unarmed.phase, 'unarmed');
    assert.equal(unarmed.tagText, '空手');
    assert.equal(unarmed.pillText, '空手');
    assert.equal(unarmed.showAmmo, false);
    const compactTop = size.height - MARGIN - COMPACT_HEIGHT;
    const compactCard = { x: card.x, y: compactTop };
    const compactChip = { x: compactCard.x + CARD_WIDTH - 96, y: compactTop - 34 };
    assert.ok(compactChip.y > 0);
    const unarmedPixels = await page.evaluate(([x, y]) => weaponHudTest.brightPixels(x, y, 96, 20), [compactCard.x + 196, compactCard.y + 88]);
    assert.ok(unarmedPixels < 10, `unarmed compact card must not draw ammunition, got ${unarmedPixels} bright pixels`);
    await page.screenshot({ path: `${output}/weapon-hud-unarmed-dpr${dpr}.png` });

    // E 从空手回到上次枪械（手枪），再按 E 切到冲锋枪：30 发连续条满格。
    await press('e');
    assert.equal(await page.evaluate(() => weaponHudTest.status().ammoText), '6/6');
    await press('e');
    const smg = await page.evaluate(() => weaponHudTest.status());
    assert.equal(smg.ammoText, '30/30');
    assert.equal(smg.pillText, '主');
    assert.equal(smg.tagText, '备弹 ∞');
    const barPixel = await page.evaluate(([x, y]) => weaponHudTest.pixel(x, y), [card.x + 244, card.y + 102]);
    assert.ok(nearColor(barPixel, BRASS), `SMG capacity bar should be brass, got ${barPixel}`);
    const barPixels = await page.evaluate(([x, y]) => weaponHudTest.brightPixels(x, y, 96, 28), [card.x + 196, card.y + 88]);
    assert.ok(barPixels > 950, `30-round bar should be mostly lit, got ${barPixels}`);
    await page.screenshot({ path: `${output}/weapon-hud-smg-dpr${dpr}.png` });

    // Q 切回手枪，弹药保持；两把枪的枪声与换弹声文件都可被浏览器加载。
    await press('q');
    assert.equal(await page.evaluate(() => weaponHudTest.status().ammoText), '6/6');
    assert.equal(await page.evaluate(() => weaponHudTest.status().pillText), '副');
    for (const sound of [
      '/audio/weapons/Fire/05_Pistol_Type5_Fire.wav',
      '/audio/weapons/Fire/01_Pistol_Type1_Fire.wav',
      '/audio/weapons/Reload/Type_5/Pistol_Reload_Type_5_Full.wav',
      '/audio/weapons/Reload/Type_1/Pistol_Reload_Type_1_Full.wav',
    ]) {
      const status = await page.evaluate(url => fetch(url).then(response => response.status), sound);
      assert.equal(status, 200, `${sound} should be served`);
    }

    // R 键默认行为可切到「装填」：只补缺的 3 发，保留弹匣里的 3 发。
    await page.evaluate(() => { weaponHudTest.setAmmo(3, true); weaponHudTest.step(); });
    await page.keyboard.press('F2');
    await page.locator('[data-debug-field="reload.defaultMode"]').selectOption('load');
    await page.keyboard.press('F2');
    await page.evaluate(() => { weaponHudTest.reload(); weaponHudTest.step(0.5); });
    const loading = await page.evaluate(() => weaponHudTest.status());
    assert.equal(loading.reloadMode, 'load');
    assert.equal(loading.tagText, '装填中');
    assert.equal(loading.ammoText, '4/6');
    await page.screenshot({ path: `${output}/weapon-hud-load-dpr${dpr}.png` });
    await page.evaluate(() => weaponHudTest.step(2));
    assert.equal(await page.evaluate(() => weaponHudTest.status().ammoText), '6/6');

    assert.deepEqual(errors, [], 'no page errors');
    await context.close();
    scenarios += 1;
  }
} finally {
  await browser.close();
}

console.log(`weapon hud browser checks passed for ${scenarios} DPR scenarios`);
