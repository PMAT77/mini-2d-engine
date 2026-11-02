import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
  await page.evaluate(async () => {
    const { game } = await import('/src/main.ts'); window.requestAnimationFrame = () => 0;
    await new Promise(resolve => setTimeout(resolve, 50));
    const { createFixedScene } = await import('/tests/fixed-scene.ts');
    window.wheelGame = game; window.wheelScene = await createFixedScene(game, 40, 30, 600, 600);
    window.wheelTick = (dt = 0) => { wheelScene.update(dt, game.input); wheelScene.draw(game.renderer.ctx); };
    wheelTick();
  });
  const slot = () => page.evaluate(() => wheelScene.player.getActiveWeaponSlot());
  const scroll = async delta => {
    const { width, height } = page.viewportSize();
    await page.mouse.move(width * .75, height * .5); await page.mouse.wheel(0, delta);
    await page.waitForFunction(() => wheelGame.input.wheelDirection !== 0, undefined, { polling: 10 });
    await page.evaluate(() => wheelTick());
  };
  await scroll(100); assert.equal(await slot(), 'primary');
  await page.evaluate(() => { for (let i = 0; i < 10; i++) wheelTick(); });
  assert.equal(await slot(), 'primary', 'wheel is not replayed');
  await scroll(-100); assert.equal(await slot(), 'secondary');
  await page.keyboard.down('KeyC'); await page.evaluate(() => wheelTick()); await page.keyboard.up('KeyC');
  assert.equal(await slot(), 'melee');
  await scroll(100); assert.equal(await slot(), 'secondary', 'empty hands restore last gun');
  await page.keyboard.down('Tab'); await scroll(100); await page.keyboard.up('Tab');
  assert.equal(await slot(), 'primary', 'Tab and wheel combine into one switch');
  await page.evaluate(() => { for (let i = 0; i < 5; i++) wheelGame.renderer.ctx.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })); wheelTick(); });
  assert.equal(await slot(), 'secondary', 'scroll burst switches once per world frame');
  const ctrlPrevented = await page.evaluate(() => {
    const event = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true });
    wheelGame.renderer.ctx.canvas.dispatchEvent(event); wheelTick(); return event.defaultPrevented;
  });
  assert.equal(ctrlPrevented, false); assert.equal(await slot(), 'secondary');
  await page.evaluate(() => {
    const input = wheelGame.input;
    input.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    input.canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })); wheelTick();
  });
  assert.equal(await slot(), 'secondary', 'leaving canvas discards queued scroll');

  await page.evaluate(() => { wheelScene.survival.inventory.addVaccines(); wheelScene.survival.infection.infect(); wheelScene.quickSlotBindings[1] = 'vaccine'; });
  await page.keyboard.down('Digit2'); await page.evaluate(() => wheelTick()); await page.keyboard.up('Digit2');
  await page.evaluate(() => wheelTick(.5));
  assert.ok(await page.evaluate(() => wheelScene.quickItemUse !== undefined));
  await scroll(100);
  assert.equal(await page.evaluate(() => wheelScene.quickItemUse === undefined), true, 'switch cancels consumable progress');
  assert.equal(await page.evaluate(() => wheelScene.survival.inventory.getVaccines()), 1);

  await page.setViewportSize({ width: 640, height: 360 });
  await page.keyboard.press('KeyB');
  const before = await slot();
  await page.locator('.backpack-list').hover(); await page.mouse.wheel(0, 200); await page.waitForTimeout(100);
  assert.ok(await page.locator('.backpack-list').evaluate(node => node.scrollTop > 0), 'backpack still scrolls normally');
  await page.evaluate(() => wheelTick()); assert.equal(await slot(), before);
  await page.keyboard.press('KeyB'); await page.evaluate(() => wheelTick());
  assert.equal(await slot(), before, 'closing backpack cannot replay scroll');
  await page.keyboard.press('F2');
  await page.evaluate(() => { wheelGame.renderer.ctx.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })); wheelTick(); });
  assert.equal(await slot(), before, 'debug modal rejects even a directly dispatched canvas wheel');
  await page.keyboard.press('F2'); await page.evaluate(() => wheelTick()); assert.equal(await slot(), before);
  await page.evaluate(() => { wheelScene.player.dropWeapon('secondary'); });
  await scroll(-100); assert.equal(await slot(), 'primary', 'dropped firearm is not restored');
  assert.deepEqual(errors, []);
  console.log('Wheel switch: both directions, one-shot frame ownership, Tab combination, empty hands, dropped weapons, consumable cancellation and modal scrolling passed.');
} finally { await browser.close(); }
