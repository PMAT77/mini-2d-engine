import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });

const LAMP_ON = [255, 206, 107];
const LAMP_OFF = [91, 116, 128];
const nearColor = (pixel, expected, tolerance = 14) => expected.every((value, index) => Math.abs(pixel[index] - value) <= tolerance);
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
      // Vite 可能给入口 URL 加时间戳：用页面正在跑的模块，避免第二个游戏实例。
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.hudGame = (await import(entry.src)).game;
      const ui = new URL('./ui/', entry.src);
      window.hudModules = {
        list: await import(new URL('WeaponListHud.ts', ui).href),
        flashlight: await import(new URL('FlashlightHud.ts', ui).href),
      };
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => {
      const scene = window.hudGame.sceneManager.getCurrentScene();
      return scene?.constructor.name === 'GameScene' && scene.loaded;
    });
    await page.keyboard.up('Enter');

    // 固定地图、停掉 rAF、手动步进，保证采样的是真实渲染管线而不是模拟值。
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
      const game = window.hudGame, scene = game.sceneManager.getCurrentScene();
      scene.map = new scene.map.constructor(60, 40, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.pickupItems = [];
      scene.player.x = 200;
      scene.player.y = 250;
      window.hudTest = {
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
          const data = game.renderer.ctx.getImageData(
            Math.floor(x * d), Math.floor(y * d), Math.ceil(width * d), Math.ceil(height * d),
          ).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if ((data[i] + data[i + 1] + data[i + 2]) / 3 > threshold) count += 1;
          }
          return count;
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
      };
    });

    const list = await page.evaluate(() => hudTest.listLayout());
    const chip = await page.evaluate(() => hudTest.flashlightRect());
    const sample = (x, y) => page.evaluate(([x, y]) => hudTest.pixel(x, y), [x, y]);
    const bright = (x, y, width, height, threshold = 140) =>
      page.evaluate(([x, y, width, height, threshold]) => hudTest.brightPixels(x, y, width, height, threshold),
        [x, y, width, height, threshold]);

    await page.evaluate(() => hudTest.step());

    const countRegion = row => [row.x + row.width - 110, row.y, 100, row.height];

    // 手枪：右上列表只有主副两行，当前手持的副武器排在上方。
    let view = await page.evaluate(() => hudTest.view());
    assert.equal(view.magazineAmmo, 6);
    assert.equal(view.kind, 'firearm');
    let status = await page.evaluate(() => hudTest.listStatus());
    assert.equal(status.mode, 'firearms');
    assert.deepEqual(status.rows.map(row => row.slot), ['secondary', 'primary']);
    assert.equal(status.rows[0].active, true);
    assert.equal(status.rows[0].rect.y, list.area.y);
    assert.equal(status.rows[1].active, false);
    assert.equal(status.rows[1].rect.y, list.bottomRow.y);
    const activeEdge = await sample(status.rows[0].rect.x + 2, status.rows[0].rect.y + status.rows[0].rect.height / 2);
    const inactiveEdge = await sample(status.rows[1].rect.x + 2, status.rows[1].rect.y + status.rows[1].rect.height / 2);
    assert.ok(brightness(activeEdge) > 200, `active row should carry a white accent, got ${activeEdge}`);
    assert.ok(brightness(inactiveEdge) < 150, `inactive row should be quieter, got ${inactiveEdge}`);
    assert.ok(await bright(...countRegion(status.rows[0].rect), 100) > 20,
      'active row shows its ammo count and cartridge icon');
    assert.ok(await bright(...countRegion(status.rows[1].rect), 100) < 120,
      'inactive row content is dimmer but still present');
    await page.screenshot({ path: `${output}/weapon-list-pistol-dpr${dpr}.png` });

    // 手电胶囊贴在列表上方；G 关灯后为冷灰。
    assert.equal(chip.y, list.area.y - 34);
    assert.equal(chip.x, list.area.x + list.area.width - 96);
    const press = async key => {
      await page.keyboard.down(key);
      await page.evaluate(() => hudTest.step());
      await page.keyboard.up(key);
      await page.evaluate(() => hudTest.step());
    };
    const lampOn = await sample(chip.x + 12, chip.y + 13);
    assert.ok(nearColor(lampOn, LAMP_ON), `flashlight lamp should be amber while on, got ${lampOn}`);
    await press('g');
    const lampOff = await sample(chip.x + 12, chip.y + 13);
    assert.ok(nearColor(lampOff, LAMP_OFF), `flashlight lamp should be muted while off, got ${lampOff}`);

    // C 空手：列表收成单行拳头，不显示数字和子弹图标。
    await press('c');
    await page.evaluate(() => hudTest.step(0.3));
    const unarmed = await page.evaluate(() => hudTest.listStatus());
    assert.equal(unarmed.mode, 'melee');
    assert.equal(unarmed.rows.length, 1);
    assert.equal(unarmed.rows[0].active, true);
    assert.equal(unarmed.rows[0].view.kind, 'empty');
    assert.equal((await page.evaluate(() => hudTest.activeSlot())), 'melee');
    assert.equal((await page.evaluate(() => hudTest.view())).kind, 'empty');
    const unarmedRow = unarmed.rows[0].rect;
    assert.ok(await bright(...countRegion(unarmedRow), 100) < 20,
      'melee row has no ammo count or cartridge icons');
    await page.screenshot({ path: `${output}/weapon-list-unarmed-dpr${dpr}.png` });

    // Tab 回到手枪，再按 Tab 切到冲锋枪；切枪时两行纵向交换。
    // Q/E 不再切枪：先确认这两个键不会改变当前枪械。
    await press('q');
    await press('e');
    assert.equal((await page.evaluate(() => hudTest.activeSlot())), 'melee',
      'Q and E must not switch firearms any more');
    await press('Tab');
    await page.evaluate(() => hudTest.step(0.3));
    assert.equal((await page.evaluate(() => hudTest.listStatus())).rows[0].slot, 'secondary');
    await press('Tab');
    const mid = await page.evaluate(() => hudTest.listStatus());
    assert.ok(mid.swapProgress > 0 && mid.swapProgress < 1, `expected a running swap, got ${mid.swapProgress}`);
    const midPrimary = mid.rows.find(row => row.slot === 'primary');
    assert.ok(midPrimary.rect.y > list.area.y && midPrimary.rect.y < list.bottomRow.y,
      `primary row should be travelling upward, got ${midPrimary.rect.y}`);
    await page.evaluate(() => hudTest.step(0.3));

    const smg = await page.evaluate(() => hudTest.listStatus());
    assert.equal(smg.swapProgress, 1);
    assert.deepEqual(smg.rows.map(row => row.slot), ['primary', 'secondary']);
    assert.equal(smg.rows[0].active, true);
    assert.equal(smg.rows[0].rect.y, list.area.y);
    assert.equal(smg.rows[1].active, false);
    assert.equal((await page.evaluate(() => hudTest.activeSlot())), 'primary');
    assert.equal((await page.evaluate(() => hudTest.view())).magazineAmmo, 30);
    assert.equal(smg.rows[1].view.magazineAmmo, 6);
    assert.ok(await bright(...countRegion(smg.rows[0].rect), 100) > 20,
      'SMG row shows its count and cartridge icon');
    await page.screenshot({ path: `${output}/weapon-list-smg-dpr${dpr}.png` });

    // Tab 回到手枪：列表再次把手枪放到第一行，弹匣数字随槽位独立保留。
    await press('Tab');
    await page.evaluate(() => hudTest.step(0.3));
    const back = await page.evaluate(() => hudTest.listStatus());
    assert.deepEqual(back.rows.map(row => row.slot), ['secondary', 'primary']);
    assert.equal(back.rows[0].active, true);
    assert.equal(back.rows[0].view.magazineAmmo, 6);
    assert.equal(back.rows[1].view.magazineAmmo, 30);
    await press('g');
    assert.ok(nearColor(await sample(chip.x + 12, chip.y + 13), LAMP_ON), 'G should turn the flashlight back on');

    // F2 调试面板开关不移动 HUD。
    await page.keyboard.press('F2');
    const panel = page.getByRole('dialog', { name: '调试面板' });
    await panel.waitFor({ state: 'visible' });
    assert.ok(await panel.boundingBox(), 'debug dialog should render');
    await page.keyboard.press('F2');

    // R 默认行为可切到「装填」：只补缺的 3 发，保留弹匣里的 3 发；列表数字同步。
    await page.evaluate(() => { hudTest.setAmmo(3, true); hudTest.step(); });
    await page.keyboard.press('F2');
    await page.locator('[data-debug-field="reload.defaultMode"]').selectOption('load');
    await page.keyboard.press('F2');
    await page.evaluate(() => { hudTest.reload(); hudTest.step(0.5); });
    const loading = await page.evaluate(() => hudTest.view());
    assert.equal(loading.reloadMode, 'load');
    assert.equal(loading.magazineAmmo, 4);
    assert.equal((await page.evaluate(() => hudTest.listStatus())).rows[0].view.magazineAmmo, 4);
    await page.screenshot({ path: `${output}/weapon-list-load-dpr${dpr}.png` });
    await page.evaluate(() => hudTest.step(2));
    assert.equal((await page.evaluate(() => hudTest.view())).magazineAmmo, 6);

    for (const sound of [
      '/audio/weapons/Fire/05_Pistol_Type5_Fire.wav',
      '/audio/weapons/Fire/01_Pistol_Type1_Fire.wav',
      '/audio/weapons/Reload/Type_5/Pistol_Reload_Type_5_Full.wav',
      '/audio/weapons/Reload/Type_1/Pistol_Reload_Type_1_Full.wav',
    ]) {
      const status = await page.evaluate(url => fetch(url).then(response => response.status), sound);
      assert.equal(status, 200, `${sound} should be served`);
    }

    assert.deepEqual(errors, [], 'no page errors');
    await context.close();
    scenarios += 1;
  }
} finally {
  await browser.close();
}

console.log(`weapon list + flashlight HUD browser checks passed for ${scenarios} DPR scenarios`);
