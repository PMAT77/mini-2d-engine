import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5173/';
const LAMP_ON = [255, 206, 107];
const LAMP_OFF = [91, 116, 128];
const nearColor = (pixel, expected, tolerance = 14) => expected.every((value, index) => Math.abs(pixel[index] - value) <= tolerance);
const brightness = pixel => (pixel[0] + pixel[1] + pixel[2]) / 3;

/** 进入主场景并停掉 rAF，之后所有帧都由测试逐步驱动。 */
async function openGame({ dpr = 1, width = 1100, height = 800, failImages = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (failImages) {
    // 素材故障：让 HUD 的可选装饰图全部 404，验证矢量回退与布局不依赖加载结果。
    await page.route('**/assets/images/weapons/*.png', route => route.abort());
  }
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    // Vite 可能给入口 URL 加时间戳：用页面正在跑的模块，避免第二个游戏实例。
    const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
    window.hudGame = (await import(entry.src)).game;
    const ui = new URL('./ui/', entry.src);
    window.hudModules = {
      list: await import(new URL('WeaponListHud.ts', ui).href),
      flashlight: await import(new URL('FlashlightHud.ts', ui).href),
      assets: await import(new URL('WeaponHudAssets.ts', ui).href),
    };
  });
  await page.keyboard.down('Enter');
  await page.waitForFunction(() => {
    const scene = window.hudGame.sceneManager.getCurrentScene();
    return scene?.constructor.name === 'GameScene' && scene.loaded;
  });
  await page.keyboard.up('Enter');

  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const game = window.hudGame;
    const scene = game.sceneManager.getCurrentScene();
    scene.map = new scene.map.constructor(60, 40, { generateWater: false });
    scene.map.tiles.forEach(row => row.fill('default'));
    scene.pickupItems = [];
    scene.player.x = 200;
    scene.player.y = 250;

    const readRect = (ctx, rect) => {
      const d = window.devicePixelRatio || 1;
      const x = Math.max(0, Math.floor(rect.x * d));
      const y = Math.max(0, Math.floor(rect.y * d));
      const w = Math.max(1, Math.ceil(rect.width * d));
      const h = Math.max(1, Math.ceil(rect.height * d));
      return ctx.getImageData(x, y, w, h).data;
    };
    const meanOf = (ctx, rect) => {
      const data = readRect(ctx, rect);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      return sum / Math.max(1, data.length / 4);
    };
    const countBright = (ctx, rect, threshold) => {
      const data = readRect(ctx, rect);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > threshold) count += 1;
      }
      return count;
    };
    const maxBright = (ctx, rect) => {
      const data = readRect(ctx, rect);
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (value > max) max = value;
      }
      return Math.round(max);
    };
    const spanOf = (rects, fallback) => {
      if (!rects || rects.length === 0) return fallback;
      const first = rects[0];
      const last = rects[rects.length - 1];
      return {
        x: first.x,
        y: first.y,
        width: last.x + last.width - first.x,
        height: Math.max(...rects.map(rect => rect.height)),
      };
    };

    window.hudTest = {
      scene,
      readRect,
      countBright,
      meanOf,
      spanOf,
      step(delta = 1 / 60) {
        scene.update(delta, game.input);
        scene.draw(game.renderer.ctx);
      },
      size() {
        const d = window.devicePixelRatio || 1;
        return { width: game.renderer.ctx.canvas.width / d, height: game.renderer.ctx.canvas.height / d };
      },
      pixel(x, y) {
        const d = window.devicePixelRatio || 1;
        return [...game.renderer.ctx.getImageData(Math.floor(x * d), Math.floor(y * d), 1, 1).data];
      },
      rowStats(rect) {
        const ctx = game.renderer.ctx;
        return {
          bright: countBright(ctx, rect, 168),
          mean: meanOf(ctx, rect),
        };
      },
      setAmmo(magazineAmmo, chambered) { scene.player.setDebugState({ magazineAmmo, chambered }); },
      reload() { scene.player.requestReload(); },
      listLayout() {
        const { width, height } = this.size();
        return window.hudModules.list.getWeaponListLayout(width, height);
      },
      flashlightRect() { return window.hudModules.flashlight.getFlashlightHudRect(this.listLayout().area); },
      listStatus() { return scene.weaponListHud.getLastStatus(); },
      view() { return scene.player.getWeaponView(); },
      activeSlot() { return scene.player.getActiveWeaponSlot(); },
      assets() {
        const assets = window.hudModules.assets.weaponHudAssets;
        const statuses = {};
        for (const id of window.hudModules.assets.WEAPON_HUD_SPRITE_IDS) statuses[id] = assets.getStatus(id);
        return { settled: assets.isSettled(), statuses, stats: assets.stats() };
      },
      /**
       * 隔离 HUD 的像素探针：纯色底上只画武器 HUD，排除地形与手电光对亮度断言的干扰。
       * 背景取中灰，笔刷越强该区域越暗，便于比较选中/未选中。
       */
      probe(activeSlot) {
        const dpr = window.devicePixelRatio || 1;
        const { width, height } = this.size();
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        const probeCtx = canvas.getContext('2d');
        probeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        probeCtx.fillStyle = '#4a525a';
        probeCtx.fillRect(0, 0, width, height);
        const loadout = Object.assign({}, scene.player.getWeaponLoadoutView(), { activeSlot });
        const hud = new window.hudModules.list.WeaponListHud();
        hud.update(1, loadout);
        hud.draw(probeCtx, loadout, width, height);
        const status = hud.getLastStatus();
        const rows = status.rows.map(row => {
          const gapLeft = row.gunRect.x + row.gunRect.width;
          const gapRight = row.ammoBox
            ? row.ammoBox.x + (row.ammoBox.width > 0 ? row.ammoBox.width : 0)
            : row.rect.x + row.rect.width;
          const brushStrip = {
            x: gapLeft + 3,
            y: row.brushRect.y + row.brushRect.height / 2 - 5,
            width: Math.max(3, Math.min(gapRight - gapLeft - 6, 26)),
            height: 10,
          };
          return {
            slot: row.slot,
            active: row.active,
            highlight: row.highlight,
            gunBright: countBright(probeCtx, row.gunRect, 150),
            gunMax: maxBright(probeCtx, row.gunRect),
            gunMean: Math.round(meanOf(probeCtx, row.gunRect) * 10) / 10,
            ammoMax: row.ammoBox ? maxBright(probeCtx, row.ammoBox) : 0,
            bulletMax: row.bullets.length ? maxBright(probeCtx, spanOf(row.bullets)) : 0,
            brushMean: Math.round(meanOf(probeCtx, brushStrip) * 10) / 10,
            brushWidth: Math.round(row.brushRect.width * 10) / 10,
          };
        });
        return { status, rows, background: 82.3 };
      },
    };
  });
  return { context, page, errors };
}

let scenarios = 0;
try {
  for (const dpr of [1, 1.25, 2]) {
    const suffix = dpr === 1 ? '' : `-dpr${String(dpr).replace('.', '_')}`;
    const shot = name => `${output}/weapon-hud-${name}${suffix}.png`;
    const { context, page, errors } = await openGame({ dpr, width: 1100, height: 800 });

    const list = await page.evaluate(() => hudTest.listLayout());
    const chip = await page.evaluate(() => hudTest.flashlightRect());
    const press = async (key, delta = 1 / 60) => {
      await page.keyboard.down(key);
      await page.evaluate(value => hudTest.step(value), delta);
      await page.keyboard.up(key);
      await page.evaluate(value => hudTest.step(value), delta);
    };
    const status = () => page.evaluate(() => hudTest.listStatus());
    const sample = (x, y) => page.evaluate(([x, y]) => hudTest.pixel(x, y), [x, y]);
    const probe = slot => page.evaluate(value => hudTest.probe(value), slot);

    // 等素材落定，保证截图看到的是 PNG 而不是加载中的矢量回退。
    await page.waitForFunction(() => hudTest.assets().settled, null, { timeout: 15000 });
    const assets = await page.evaluate(() => hudTest.assets());
    assert.equal(assets.statuses.smgTactical, 'ready', 'SMG 素材应加载成功');
    assert.equal(assets.statuses.pistolGlock, 'ready', '手枪素材应加载成功');
    assert.equal(assets.statuses.ammoRifle, 'ready', '步枪弹素材应加载成功');
    assert.equal(assets.statuses.ammoPistol, 'ready', '手枪弹素材应加载成功');

    // 初始状态：默认副武器（手枪）在上方并被选中。
    await page.evaluate(() => hudTest.step(0.3));
    let current = await status();
    let view = await page.evaluate(() => hudTest.view());
    assert.equal(view.kind, 'firearm');
    assert.equal(view.magazineAmmo, 6);
    assert.equal(current.mode, 'firearms');
    assert.deepEqual(current.rows.map(row => row.slot), ['secondary', 'primary']);
    assert.equal(current.rows[0].active, true);
    assert.equal(current.rows[0].rect.y, list.area.y);
    assert.equal(current.rows[1].active, false);
    assert.equal(current.rows[1].rect.y, list.bottomRow.y);
    assert.equal(current.rows[0].highlight, 1);
    assert.equal(current.rows[1].highlight, 0);

    // 行尺寸遵循新规范：大行高、无圆角底板、笔刷独立成矩形。
    assert.ok(Math.abs(list.area.width - 396) < 1.5, `HUD 宽度约 396，实际 ${list.area.width}`);
    assert.ok(list.metrics.rowHeight >= 86 && list.metrics.rowHeight <= 96,
      `行高应在 86~96，实际 ${list.metrics.rowHeight}`);
    assert.ok(list.metrics.magFontSize >= 30 && list.metrics.magFontSize <= 36,
      `弹匣字号应在 30~36，实际 ${list.metrics.magFontSize}`);
    assert.ok(list.metrics.reserveFontSize >= 16 && list.metrics.reserveFontSize <= 19,
      `备弹字号应在 16~19，实际 ${list.metrics.reserveFontSize}`);
    assert.ok(list.metrics.bulletHeight >= 22 && list.metrics.bulletHeight <= 34,
      `子弹高度应在 22~34，实际 ${list.metrics.bulletHeight}`);
    for (const row of current.rows) {
      assert.ok(row.brushRect.width > 0 && row.brushRect.width < row.rect.width,
        '笔刷是行内独立矩形，不是整行底板');
      // 手枪笔刷比冲锋枪短：左侧起点由枪身决定。
      assert.ok(row.gunRect.x >= row.rect.x, '枪械不越出行区域');
      assert.ok(row.gunRect.x + row.gunRect.width <= row.brushRect.x + row.brushRect.width + 1,
        '枪械应落在自己这一行的笔刷范围内');
    }
    // 两把枪共用同一个右锚点。
    const [pistolRow, smgRowAsSecond] = current.rows;
    assert.ok(Math.abs((pistolRow.gunRect.x + pistolRow.gunRect.width)
      - (smgRowAsSecond.gunRect.x + smgRowAsSecond.gunRect.width)) < 1e-6,
    '主副武器枪身右端共用锚点');

    // 右侧没有旧的高亮竖线：行左缘必须是暗的（笔刷边缘），不是 200+ 的白色竖条。
    const leftEdge = await sample(pistolRow.rect.x + 1, pistolRow.rect.y + pistolRow.rect.height / 2);
    assert.ok(brightness(leftEdge) < 150, `行左缘不应再画高亮竖线，实际亮度 ${brightness(leftEdge)}`);

    // 隔离 HUD 探针：选中行枪身更亮、笔刷更重；未选中行整体减弱但仍在。
    const pistolProbe = await probe('secondary');
    console.log(`[probe dpr${dpr}]`, JSON.stringify(pistolProbe.rows));
    const probeActive = pistolProbe.rows.find(row => row.slot === 'secondary');
    const probeInactive = pistolProbe.rows.find(row => row.slot === 'primary');
    assert.ok(probeActive.active && !probeInactive.active);
    assert.ok(probeActive.gunMax > 200, `选中枪身应保持原图亮度，实际 ${probeActive.gunMax}`);
    assert.ok(probeInactive.gunMax > 120 && probeInactive.gunMax < probeActive.gunMax - 40,
      `未选中枪身应减淡而不是消失: ${probeInactive.gunMax} vs ${probeActive.gunMax}`);
    assert.ok(probeActive.gunMean > probeInactive.gunMean + 12,
      `选中枪身平均亮度应更高: ${probeActive.gunMean} vs ${probeInactive.gunMean}`);
    assert.ok(probeActive.ammoMax > 200 && probeInactive.ammoMax < probeActive.ammoMax - 25,
      `弹药数字应同步减弱: ${probeInactive.ammoMax} vs ${probeActive.ammoMax}`);
    assert.ok(probeActive.bulletMax > 180 && probeInactive.bulletMax < probeActive.bulletMax - 20,
      `子弹图标应同步减弱: ${probeInactive.bulletMax} vs ${probeActive.bulletMax}`);
    assert.ok(probeInactive.bulletMax > 100, '未选中行子弹仍然可见');
    // 墨色是比近黑场景更亮的板蓝灰：探针底为中灰时，选中的笔刷应把均值压得更低，
    // 且必须明显区别于探针底色（#4a525a 的均值约 82）。
    assert.ok(probeActive.brushMean < probeInactive.brushMean - 5,
      `选中行笔刷应更实: ${probeActive.brushMean} vs ${probeInactive.brushMean}`);
    assert.ok(probeActive.brushMean < 72, `选中行笔刷应明显改变背景，实际 ${probeActive.brushMean}`);
    assert.ok(probeInactive.brushMean > 70, `未选中行笔刷应显著减弱，实际 ${probeInactive.brushMean}`);

    // 冲锋枪的笔刷比手枪长：左侧起点更靠左。
    const smgProbe = await probe('primary');
    const smgRow = smgProbe.rows.find(row => row.slot === 'primary');
    const pistolRowProbe = smgProbe.rows.find(row => row.slot === 'secondary');
    assert.ok(smgRow.brushWidth > pistolRowProbe.brushWidth + 20,
      `冲锋枪笔刷应明显更长: ${smgRow.brushWidth} vs ${pistolRowProbe.brushWidth}`);
    assert.ok(smgRow.brushMean < 72, `选中行笔刷应改变背景，实际 ${smgRow.brushMean}`);

    // 真实场景合成：选中行枪身与数字都比未选中行亮。
    const activeGun = await page.evaluate(rect => hudTest.rowStats(rect), current.rows[0].gunRect);
    const inactiveGun = await page.evaluate(rect => hudTest.rowStats(rect), current.rows[1].gunRect);
    assert.ok(activeGun.bright > 200, `主场景里选中枪身应有大量亮像素，实际 ${activeGun.bright}`);
    assert.ok(activeGun.bright > inactiveGun.bright * 1.4,
      `选中/未选中枪身亮度应拉开: ${activeGun.bright} vs ${inactiveGun.bright}`);
    const activeAmmo = await page.evaluate(rect => hudTest.rowStats(rect), current.rows[0].ammoBox);
    const inactiveAmmo = await page.evaluate(rect => hudTest.rowStats(rect), current.rows[1].ammoBox);
    assert.ok(activeAmmo.bright > 20, `选中行应能看见弹药数字，实际 ${activeAmmo.bright}`);
    assert.ok(activeAmmo.bright > inactiveAmmo.bright, '未选中行数字应更暗');

    // 读数顺序是「弹匣余弹 / 备用弹药」：大号白数字在左，小号冷灰数字在右。
    const ammoText = current.rows[0].ammoBox;
    const ammoHalf = Math.max(1, (current.rows[0].bullets[0].x - ammoText.x) / 2);
    const textLeft = await page.evaluate(
      rect => hudTest.rowStats(rect),
      { x: ammoText.x, y: ammoText.y, width: ammoHalf, height: ammoText.height },
    );
    const textRight = await page.evaluate(
      rect => hudTest.rowStats(rect),
      { x: ammoText.x + ammoHalf, y: ammoText.y, width: ammoHalf, height: ammoText.height },
    );
    assert.ok(textLeft.bright > textRight.bright * 1.3,
      `大号弹匣数字应位于斜杠左侧: 左 ${textLeft.bright} vs 右 ${textRight.bright}`);

    // 手电胶囊仍在列表上方，且不压住第一行。
    assert.equal(chip.y, list.area.y - 34);
    assert.equal(chip.x, list.area.x + list.area.width - 96);
    assert.ok(chip.y + chip.height <= list.area.y, '手电胶囊不能覆盖武器栏');
    const lampOn = await sample(chip.x + 12, chip.y + 13);
    assert.ok(nearColor(lampOn, LAMP_ON), `手电开着时灯色应为琥珀，实际 ${lampOn}`);

    await page.screenshot({ path: shot('pistol-active') });

    // 空弹匣：数字显示 0，三枚子弹不受影响（它们是弹药类型装饰）。
    await page.evaluate(() => { hudTest.setAmmo(0, false); hudTest.step(0.3); });
    let empty = await status();
    assert.equal(empty.rows[0].view.magazineAmmo, 0);
    const emptyBullets = await page.evaluate(rect => hudTest.rowStats(rect), empty.rows[0].bullets[0]);
    assert.ok(emptyBullets.bright >= 0);
    const emptyTexts = await page.evaluate(() => {
      const row = hudTest.listStatus().rows[0];
      return { ammoBox: row.ammoBox, bullets: row.bullets.length };
    });
    assert.equal(emptyTexts.bullets, 3, '空弹匣时三枚子弹仍然保留');
    assert.ok((await page.evaluate(rect => hudTest.rowStats(rect), emptyTexts.ammoBox)).bright > 10,
      '空弹匣仍要画出 0');

    // R 装填（load 模式）：数字随换弹进度更新，暂停在中途截图。
    await page.evaluate(() => { hudTest.setAmmo(3, true); hudTest.step(0.3); });
    await page.keyboard.press('F2');
    await page.locator('[data-debug-field="reload.defaultMode"]').selectOption('load');
    await page.keyboard.press('F2');
    await page.evaluate(() => { hudTest.reload(); hudTest.step(0.5); });
    const loading = await page.evaluate(() => hudTest.view());
    assert.equal(loading.reloadMode, 'load');
    assert.equal(loading.magazineAmmo, 4);
    assert.equal((await status()).rows[0].view.magazineAmmo, 4);
    await page.screenshot({ path: shot('reloading') });
    await page.evaluate(() => hudTest.step(2));

    // C 空手：只留一行拳击，没有弹药数字与子弹。
    await press('c', 0.3);
    const unarmed = await status();
    assert.equal(unarmed.mode, 'melee');
    assert.equal(unarmed.rows.length, 1);
    assert.equal(unarmed.rows[0].active, true);
    assert.equal(unarmed.rows[0].view.kind, 'empty');
    assert.equal(unarmed.rows[0].ammoBox, null);
    assert.equal(unarmed.rows[0].bullets.length, 0);
    assert.equal(await page.evaluate(() => hudTest.activeSlot()), 'melee');
    assert.equal((await page.evaluate(() => hudTest.view())).kind, 'empty');
    await page.screenshot({ path: shot('unarmed') });

    // Q/E 不再切枪。
    await press('q');
    await press('e');
    assert.equal(await page.evaluate(() => hudTest.activeSlot()), 'melee', 'Q/E 不得切枪');

    // Tab 回到手枪，再 Tab 切到冲锋枪；切枪第一帧就要用新顺序且从对面出发。
    await press('Tab', 0.3);
    assert.equal((await status()).rows[0].slot, 'secondary');
    await page.keyboard.down('Tab');
    await page.evaluate(() => hudTest.step(1 / 60));
    await page.keyboard.up('Tab');
    const firstFrame = await page.evaluate(() => hudTest.listStatus());
    assert.equal(firstFrame.rows[0].slot, 'secondary', '第一帧物理上方仍是被换下的枪');
    assert.ok(firstFrame.swapProgress > 0 && firstFrame.swapProgress < 1,
      `切枪首帧就应开始动画，实际 ${firstFrame.swapProgress}`);
    const movingPrimary = firstFrame.rows.find(row => row.slot === 'primary');
    assert.ok(Math.abs(movingPrimary.rect.y - list.bottomRow.y) < 3,
      `新选中行应从下方出发（一帧内只前进一小步），实际 ${movingPrimary.rect.y}`);

    // 动画中间帧截图。
    await page.evaluate(() => hudTest.step(0.09));
    const mid = await status();
    assert.ok(mid.swapProgress > 0 && mid.swapProgress < 1, `中间帧应在动画中，实际 ${mid.swapProgress}`);
    const midPrimary = mid.rows.find(row => row.slot === 'primary');
    assert.ok(midPrimary.rect.y > list.area.y && midPrimary.rect.y < list.bottomRow.y,
      `主武器行应向顶部移动，实际 ${midPrimary.rect.y}`);
    await page.screenshot({ path: shot('swap-mid') });

    // 快速反向切枪：位置必须连续，不能瞬移。
    const beforeReverse = mid.rows.find(row => row.slot === 'primary').rect.y;
    await press('Tab', 0);
    const reversed = await page.evaluate(() => hudTest.listStatus());
    const afterReverse = reversed.rows.find(row => row.slot === 'primary').rect.y;
    assert.ok(Math.abs(afterReverse - beforeReverse) < 1e-6,
      `反向切枪位置必须连续: ${beforeReverse} -> ${afterReverse}`);

    // 跑完动画，回到手枪在上方的稳定态。
    await page.evaluate(() => hudTest.step(0.3));
    await press('Tab');
    await page.evaluate(() => hudTest.step(0.3));
    let settled = await status();
    assert.equal(settled.swapProgress, 1);
    assert.deepEqual(settled.rows.map(row => row.slot), ['primary', 'secondary']);
    assert.equal(settled.rows[0].active, true);
    assert.equal(settled.rows[0].view.magazineAmmo, 30);
    assert.equal(settled.rows[1].view.magazineAmmo, 6);
    assert.equal(await page.evaluate(() => hudTest.activeSlot()), 'primary');
    // 冲锋枪笔刷明显比手枪长（左侧起点更靠左）。
    assert.ok(settled.rows[0].brushRect.x < settled.rows[1].brushRect.x,
      '冲锋枪笔刷应比手枪笔刷更长');
    await page.screenshot({ path: shot('smg-active') });

    // 两张枪的右锚点一致。
    assert.ok(Math.abs(
      (settled.rows[0].gunRect.x + settled.rows[0].gunRect.width)
      - (settled.rows[1].gunRect.x + settled.rows[1].gunRect.width),
    ) < 1e-6, '冲锋枪与手枪右端对齐');

    // G 手电：关灯变成冷灰，再开回来。
    await press('g');
    const lampOff = await sample(chip.x + 12, chip.y + 13);
    assert.ok(nearColor(lampOff, LAMP_OFF), `关灯后灯色应转冷灰，实际 ${lampOff}`);
    await press('g');
    assert.ok(nearColor(await sample(chip.x + 12, chip.y + 13), LAMP_ON), 'G 应能重新开灯');

    // 调试面板开关不影响 HUD。
    await page.keyboard.press('F2');
    await page.getByRole('dialog', { name: '调试面板' }).waitFor({ state: 'visible' });
    await page.keyboard.press('F2');

    // 音频资源回归：HUD 改动不得影响武器音效加载。
    for (const sound of [
      '/audio/weapons/Fire/05_Pistol_Type5_Fire.wav',
      '/audio/weapons/Fire/01_Pistol_Type1_Fire.wav',
      '/audio/weapons/Reload/Type_5/Pistol_Reload_Type_5_Full.wav',
      '/audio/weapons/Reload/Type_1/Pistol_Reload_Type_1_Full.wav',
    ]) {
      const ok = await page.evaluate(url => fetch(url).then(response => response.status), sound);
      assert.equal(ok, 200, `${sound} should be served`);
    }

    assert.deepEqual(errors, [], 'no page errors');
    await context.close();
    scenarios += 1;
  }

  // 小窗口与极端尺寸：布局连续缩放，不越界、不出现负尺寸。
  {
    const { context, page, errors } = await openGame({ dpr: 1, width: 640, height: 360 });
    await page.waitForFunction(() => hudTest.assets().settled, null, { timeout: 15000 });
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [1100, 800], [800, 600], [640, 360], [320, 200]]) {
      await page.setViewportSize({ width, height });
      // 等游戏把画布与相机调整到新尺寸，避免读到上一帧的绘制结果。
      await page.waitForFunction(
        ([w, h]) => {
          const size = hudTest.size();
          return Math.abs(size.width - w) < 1 && Math.abs(size.height - h) < 1;
        },
        [width, height],
        { timeout: 5000 },
      );
      await page.evaluate(() => hudTest.step(0.3));
      const layout = await page.evaluate(() => hudTest.listLayout());
      assert.ok(layout.area.width > 0 && layout.area.height > 0, `${width}x${height} 面积必须为正`);
      assert.ok(layout.area.x >= 0 && layout.area.y >= 0, `${width}x${height} 不能越出左上角`);
      assert.ok(layout.area.x + layout.area.width <= width + 0.6, `${width}x${height} 不能越出右边界`);
      assert.ok(layout.area.y + layout.area.height <= height + 0.6, `${width}x${height} 不能越出下边界`);
      assert.ok(layout.topRow.height > 0 && layout.bottomRow.height > 0);
      const rows = await page.evaluate(() => hudTest.listStatus().rows);
      for (const row of rows) {
        assert.ok(row.brushRect.width > 0, `${width}x${height} 笔刷宽度必须为正`);
        assert.ok(row.gunRect.width > 0 && row.gunRect.height > 0, `${width}x${height} 枪械尺寸必须为正`);
        assert.ok(row.gunRect.x >= layout.area.x - 0.6, `${width}x${height} 枪械不得越出左侧`);
        assert.ok(row.gunRect.x + row.gunRect.width <= width, `${width}x${height} 枪械不得越出右侧`);
        if (row.ammoBox) assert.ok(row.ammoBox.x + row.ammoBox.width <= width + 0.6,
          `${width}x${height} 弹药列不得越出右侧`);
      }
      // 手电胶囊不越界、不压 HUD。
      const chipRect = await page.evaluate(() => hudTest.flashlightRect());
      assert.ok(chipRect.x >= 0 && chipRect.x + chipRect.width <= width + 0.6, `${width}x${height} 手电胶囊越界`);
      assert.ok(chipRect.y + chipRect.height <= layout.area.y + 0.6, `${width}x${height} 手电压住 HUD`);
    }
    // 换回 640×360 再截图：必须等游戏把画布调整到新尺寸后再绘制，
    // 否则会截到 resize 后被清空、还没重绘的空白画面。
    await page.setViewportSize({ width: 640, height: 360 });
    await page.waitForFunction(
      () => {
        const size = hudTest.size();
        return Math.abs(size.width - 640) < 1 && Math.abs(size.height - 360) < 1;
      },
      null,
      { timeout: 5000 },
    );
    await page.evaluate(() => hudTest.step(0.3));
    await page.screenshot({ path: `${output}/weapon-hud-small-viewport.png` });
    assert.deepEqual(errors, [], 'small viewport page errors');
    await context.close();
    scenarios += 1;
  }

  // 素材故障：可选装饰图 404 时，布局与矢量回退都仍然可用。
  {
    const { context, page, errors } = await openGame({ dpr: 1, width: 1100, height: 800, failImages: true });
    await page.waitForFunction(() => hudTest.assets().settled, null, { timeout: 15000 });
    const assets = await page.evaluate(() => hudTest.assets());
    assert.equal(assets.statuses.pistolGlock, 'failed');
    assert.equal(assets.statuses.smgTactical, 'failed');
    assert.equal(assets.statuses.ammoPistol, 'failed');
    await page.evaluate(() => hudTest.step(0.3));
    const fallback = await page.evaluate(() => hudTest.listStatus());
    assert.equal(fallback.mode, 'firearms');
    assert.equal(fallback.rows.length, 2);
    for (const row of fallback.rows) {
      assert.ok(row.gunRect.width > 0 && row.gunRect.height > 0, '回退时枪械区域仍然有效');
      // 矢量剪影仍然画出可见的枪形。
      const ink = await page.evaluate(rect => hudTest.rowStats(rect), row.gunRect);
      assert.ok(ink.bright > 40, `回退剪影应仍然可见，实际 ${ink.bright}`);
    }
    // 布局不依赖图片加载结果：与正常加载时的矩形完全一致。
    const normalLayout = await page.evaluate(() => hudTest.listLayout());
    assert.ok(Math.abs(normalLayout.area.width - 396) < 1.5);
    await page.screenshot({ path: `${output}/weapon-hud-assets-fallback.png` });
    assert.deepEqual(errors, [], 'fallback page errors');
    await context.close();
    scenarios += 1;
  }

  // 加载前后连续性：进入场景时先矢量回退，图片 ready 后自动换成 PNG，布局不跳。
  {
    const { context, page, errors } = await openGame({ dpr: 1, width: 1100, height: 800 });
    await page.evaluate(() => hudTest.step(0.3));
    const beforeReady = await page.evaluate(() => ({
      assets: hudTest.assets(),
      rows: hudTest.listStatus().rows.map(row => ({ slot: row.slot, gun: row.gunRect, brush: row.brushRect })),
    }));
    await page.waitForFunction(() => hudTest.assets().settled, null, { timeout: 15000 });
    await page.evaluate(() => hudTest.step(0.3));
    const afterReady = await page.evaluate(() => ({
      assets: hudTest.assets(),
      rows: hudTest.listStatus().rows.map(row => ({ slot: row.slot, gun: row.gunRect, brush: row.brushRect })),
    }));
    assert.equal(afterReady.assets.settled, true);
    if (!beforeReady.assets.settled) {
      assert.notEqual(beforeReady.assets.statuses.pistolGlock, 'failed');
    }
    assert.deepEqual(afterReady.rows, beforeReady.rows, '素材 ready 不应改变 HUD 布局矩形');
    assert.deepEqual(errors, [], 'ready transition page errors');
    await context.close();
    scenarios += 1;
  }
} finally {
  await browser.close();
}

console.log(`weapon HUD V2 browser checks passed for ${scenarios} scenarios`);
