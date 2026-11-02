import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
mkdirSync('.review', { recursive: true });

try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const { game } = await import('/src/main.ts'); window.requestAnimationFrame = () => 0;
      await new Promise(resolve => setTimeout(resolve, 50));
      const { createFixedScene } = await import('/tests/fixed-scene.ts');
      window.invGame = game; window.invScene = await createFixedScene(game, 60, 40, 600, 600);
      invScene.survival.inventory.addVaccines(3); invScene.survival.infection.infect();
      window.invTick = (dt = 0) => { invScene.update(dt, game.input); invScene.draw(game.renderer.ctx); };
      invTick();
    });
    const row = id => page.locator(`[data-item-id="${id}"]`);
    const openMenu = async id => { await row(id).click({ button: 'right' }); };
    const bind = async (id, slot) => { await openMenu(id); await page.locator(`[data-bind-slot="${slot}"]`).click(); };
    await page.keyboard.press('Tab');
    const style = await page.evaluate(() => {
      const panel = getComputedStyle(document.querySelector('.backpack-panel'));
      const root = getComputedStyle(document.querySelector('[data-backpack]'));
      const canvas = document.querySelector('.backpack-header-brush'), ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rows = [...document.querySelectorAll('.backpack-row')].map(node => node.getBoundingClientRect());
      return { panelBg: panel.backgroundColor, panelImage: panel.backgroundImage, shadow: panel.boxShadow,
        rootBg: root.backgroundColor, canvasBg: getComputedStyle(canvas).backgroundColor,
        gap: rows[1].top - rows[0].bottom,
        transparent: data.some((v, i) => i % 4 === 3 && v === 0), painted: data.some((v, i) => i % 4 === 3 && v > 30) };
    });
    assert.equal(style.panelBg, 'rgba(0, 0, 0, 0)'); assert.equal(style.panelImage, 'none'); assert.equal(style.shadow, 'none');
    assert.equal(style.rootBg, 'rgba(0, 0, 0, 0)'); assert.equal(style.canvasBg, 'rgba(0, 0, 0, 0)');
    assert.ok(style.gap >= 8 && style.transparent && style.painted, 'spaced rows and a genuine alpha brush');
    assert.match(await page.locator('.backpack-properties').innerText(), /攻击力[\s\S]*16\.0[\s\S]*射速[\s\S]*800/);
    await bind('primary', 0);
    assert.equal(await page.evaluate(() => invScene.quickSlotBindings[0]), 'primary');
    await page.keyboard.press('Tab'); await page.keyboard.press('Digit1'); await page.evaluate(() => invTick());
    // A complete press/release between world ticks is not a held gameplay input: use a real down edge.
    await page.keyboard.down('Digit1'); await page.evaluate(() => invTick()); await page.keyboard.up('Digit1');
    assert.equal(await page.evaluate(() => invScene.player.getActiveWeaponSlot()), 'primary');
    await page.evaluate(() => { invScene.player.shootAt({ x: 1400, y: 600 }, 10, invScene.map); });
    const ammo = await page.evaluate(() => invScene.player.getWeaponView().magazineAmmo);
    await page.keyboard.press('Tab'); await openMenu('primary');
    await page.evaluate(() => invTick());
    await page.screenshot({ path: `.review/inventory-context-dpr${dpr}.png` });
    await page.locator('[data-action="drop"]').click();
    assert.equal(await row('primary').count(), 0);
    assert.equal(await page.evaluate(() => invScene.quickSlotBindings[0]), 'primary', 'drop retains binding');
    assert.equal(await page.evaluate(() => invScene.weaponPickups.length), 1, 'weapon exists on ground');
    assert.equal(await page.evaluate(() => invScene.player.getActiveWeaponSlot()), 'secondary');
    assert.match(await page.locator('.backpack-load').innerText(), /1\.2 \/ 30/);
    await page.keyboard.press('Tab');
    await page.keyboard.down('KeyE');
    await page.evaluate(() => { for (let i = 0; i < 40; i++) invTick(1 / 60); });
    await page.keyboard.up('KeyE');
    assert.equal(await page.evaluate(() => invScene.player.hasWeapon('primary')), true, 'normal E interaction recovers weapon');
    assert.equal(await page.evaluate(() => invScene.weaponPickups.length), 0);
    assert.equal(await page.evaluate(() => invScene.player.getWeaponViewForSlot('primary').magazineAmmo), ammo, 'recovery does not refill ammo');

    await page.keyboard.press('Tab');
    const drag = async (id, dx, dy, cancel = false) => {
      const rect = await row(id).boundingBox();
      await page.mouse.move(rect.x + 60, rect.y + rect.height / 2); await page.mouse.down();
      await page.mouse.move(rect.x + dx, rect.y + dy, { steps: 8 });
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
    };
    await drag('primary', 200, 35);
    assert.equal(await row('primary').count(), 1, 'releasing inside inventory cancels drop');
    await drag('primary', 750, 35, true);
    assert.equal(await page.evaluate(() => invScene.isWorldPaused() && !invScene.backpackPanel.isOpen()), true, 'Escape cancels drag, closes backpack and pauses');
    await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('.backpack-drag-ghost').count(), 0);
    await drag('primary', 750, 35);
    assert.equal(await row('primary').count(), 0, 'releasing outside drops exactly once');
    assert.equal(await page.evaluate(() => invScene.weaponPickups.length), 1);
    await page.keyboard.press('KeyQ'); await openMenu('melee');
    assert.equal(await page.locator('[data-action="drop"]').isDisabled(), true, 'empty hands cannot be dropped');
    await page.locator('.backpack-header').click(); await page.keyboard.press('KeyQ'); await page.keyboard.press('KeyQ');
    await openMenu('vaccine'); await page.locator('[data-action="drop"]').click();
    assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), 2, 'drop one vaccine from stack');
    assert.equal(await page.evaluate(() => invScene.vaccinePickups.length), 1);
    await bind('vaccine', 1);
    assert.equal(await page.evaluate(() => invScene.quickSlotBindings[1]), 'vaccine');
    await page.keyboard.press('Tab');

    // Consuming uses a one-second simulation action, never an immediate keydown decrement.
    await page.keyboard.down('Digit2'); await page.evaluate(() => invTick());
    await page.evaluate(() => { for (let i = 0; i < 30; i++) invTick(1 / 60); });
    assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), 2);
    assert.ok(await page.evaluate(() => invScene.quickItemUse.elapsed > .49 && invScene.quickItemUse.elapsed < .51));
    await page.screenshot({ path: `.review/inventory-use-progress-dpr${dpr}.png` });
    await page.evaluate(() => { for (let i = 0; i < 31; i++) invTick(1 / 60); });
    assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), 1);
    assert.equal(await page.evaluate(() => invScene.survival.infection.isInfected()), false);
    assert.equal(await page.evaluate(() => invScene.quickItemUse === undefined), true);
    await page.evaluate(() => { invScene.survival.infection.infect(); for (let i = 0; i < 90; i++) invTick(1 / 60); });
    assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), 1, 'held key cannot consume repeatedly');
    await page.keyboard.up('Digit2'); await page.evaluate(() => invTick());
    for (const reason of ['blur', 'backpack', 'reload', 'roll', 'shoot']) {
      await page.keyboard.down('Digit2'); await page.evaluate(() => invTick());
      await page.keyboard.up('Digit2'); await page.evaluate(() => { for (let i = 0; i < 20; i++) invTick(1 / 60); });
      if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (reason === 'backpack') { await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); }
      if (reason === 'reload') await page.keyboard.down('KeyR');
      if (reason === 'roll') await page.keyboard.down('Space');
      if (reason === 'shoot') { await page.mouse.move(1200, 500); await page.mouse.down({ button: 'right' }); await page.mouse.down(); }
      await page.evaluate(() => invTick(1 / 60));
      assert.equal(await page.evaluate(() => invScene.quickItemUse === undefined), true, `${reason} cancels use`);
      assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), 1);
      if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.keyboard.up('KeyR'); await page.keyboard.up('Space'); await page.mouse.up(); await page.mouse.up({ button: 'right' });
      await page.evaluate(() => { invScene.player.cancelReload(); for (let i = 0; i < 80; i++) invTick(1 / 60); });
    }
    // The action reaches completion at the same simulated time across frame rates.
    for (const fps of [30, 60, 144]) {
      await page.evaluate(() => { invScene.survival.inventory.addVaccines(); invScene.survival.infection.infect(); invTick(); });
      const count = await page.evaluate(() => invScene.survival.inventory.getVaccines());
      await page.keyboard.down('Digit2'); await page.evaluate(() => invTick()); await page.keyboard.up('Digit2');
      await page.evaluate(fps => { for (let i = 0; i < fps - 1; i++) invTick(1 / fps); }, fps);
      assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), count);
      await page.evaluate(fps => invTick(1 / fps), fps);
      assert.equal(await page.evaluate(() => invScene.survival.inventory.getVaccines()), count - 1);
    }
    await page.keyboard.press('Tab');
    const count = await page.evaluate(() => invScene.survival.inventory.getVaccines());
    for (let i = 0; i < count; i++) { await openMenu('vaccine'); await page.locator('[data-action="drop"]').click(); }
    assert.equal(await page.evaluate(() => invScene.quickSlotBindings[1]), 'vaccine', 'last consumable removal retains binding');
    assert.match(await page.locator('.backpack-empty').innerText(), /暂无消耗物/);
    await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE');
    await page.evaluate(async () => {
      invTick();
      await Promise.all([...document.querySelectorAll('.backpack-panel image')].map(async node => {
        const image = new Image(); image.src = node.getAttribute('href'); await image.decode();
      }));
    });
    await page.screenshot({ path: `.review/inventory-v2-dpr${dpr}.png` });
    assert.deepEqual(errors, [], 'no runtime errors');
    await context.close();
  }
  console.log('Inventory V2: brush/gaps/properties, context menu, safe drag/drop/recovery, quick binding, neutral slots and timed/cancellable consumption at 30/60/144 FPS passed.');
} finally { await browser.close(); }
