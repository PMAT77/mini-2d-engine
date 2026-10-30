import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

/**
 * 视野模式的入口回归。
 *
 * 开发服务器与生产预览的行为不同：
 * - 开发：只有显式 `?vision=legacy` 才回退旧迷雾；其余一律 three-layer。
 * - 生产：任何 URL 参数都不能把游戏切回 legacy，也不能启用 `visionDebug`。
 *
 * 生产预览用 `EXPECT_ENV=production` 运行，并配合 `vite preview`：
 * `TEST_BASE_URL=http://127.0.0.1:5174 EXPECT_ENV=production node tests/vision-mode.browser.mjs`
 */
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const production = process.env.EXPECT_ENV === 'production';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});

const results = [];
try {
  const cases = production
    ? [
        { url: '/', mode: 'three-layer', debugLayer: null, label: 'production root' },
        { url: '/?vision=legacy', mode: 'three-layer', debugLayer: null, label: 'production ignores vision=legacy' },
        { url: '/?visionDebug=world', mode: 'three-layer', debugLayer: null, label: 'production ignores visionDebug=world' },
        { url: '/?visionDebug=outline', mode: 'three-layer', debugLayer: null, label: 'production ignores visionDebug=outline' },
      ]
    : [
        { url: '/', mode: 'three-layer', debugLayer: null, label: 'dev root defaults to three-layer' },
        { url: '/?vision=three-layer', mode: 'three-layer', debugLayer: null, label: 'dev explicit three-layer' },
        { url: '/?vision=legacy', mode: 'legacy', debugLayer: null, label: 'dev explicit legacy' },
        { url: '/?vision=whatever', mode: 'three-layer', debugLayer: null, label: 'dev unknown value falls back to three-layer' },
        { url: '/?visionDebug=world', mode: 'three-layer', debugLayer: 'world', label: 'dev debug layer allowed' },
      ];

  for (const entry of cases) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(`${base}${entry.url}`);
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]');
    await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

    const state = await page.evaluate(() => {
      const scene = window.__miniGame.sceneManager.getCurrentScene();
      const headings = Array.from(document.querySelectorAll('#player-debug-panel h3')).map(node => node.textContent);
      return {
        mode: scene.visionMode,
        debugLayer: scene.visionDebugLayer ?? null,
        loaded: scene.loaded === true,
        hasRenderer: Boolean(scene.perceptionRenderer),
        headings,
      };
    });

    assert.deepEqual(errors, [], `${entry.label}: page errors ${errors.join(' | ')}`);
    assert.equal(state.loaded, true, `${entry.label}: scene must finish loading`);
    assert.equal(state.mode, entry.mode, `${entry.label}: expected ${entry.mode}, got ${state.mode}`);
    assert.equal(state.debugLayer, entry.debugLayer, `${entry.label}: expected debug layer ${entry.debugLayer}, got ${state.debugLayer}`);
    if (state.mode === 'three-layer') {
      assert.equal(state.hasRenderer, true, `${entry.label}: three-layer scene must own a PerceptionRenderer`);
      assert.ok(!state.headings.includes('战争迷雾'), `${entry.label}: three-layer panel must hide the legacy fog section`);
      assert.ok(state.headings.includes('三层视野遮蔽'), `${entry.label}: three-layer panel must expose visibility controls`);
    } else {
      assert.ok(state.headings.includes('战争迷雾'), `${entry.label}: legacy panel keeps the fog section`);
    }

    if (entry.url === '/') {
      // 默认模式准星分级：三层视野下，未辨识的鸡不提供红准星；辨识后才允许压枪反馈。
      const gating = await page.evaluate(() => {
        const scene = window.__miniGame.sceneManager.getCurrentScene();
        const point = { clientX: 420, clientY: 300 };
        const world = scene.screenToWorld(point.clientX, point.clientY);
        const chicken = scene.chickens.find(item => item.isAlive());
        if (!world || !chicken) return { ok: false, reason: `world=${Boolean(world)} chicken=${Boolean(chicken)}` };
        chicken.x = world.x - chicken.getSize() / 2;
        chicken.y = world.y - chicken.getSize() / 2;
        chicken.velocity.set(0, 0);
        scene.chickens = [chicken];
        const identify = scene.perception.canIdentify;
        scene.perception.canIdentify = () => false;
        const dark = scene.isCrosshairOnTarget(point);
        scene.perception.canIdentify = () => true;
        const lit = scene.isCrosshairOnTarget(point);
        scene.perception.canIdentify = identify;
        return { ok: true, dark, lit };
      });
      assert.equal(gating.ok, true, `crosshair gating setup failed: ${gating.reason ?? ''}`);
      assert.equal(gating.dark, false, 'three-layer crosshair must not lock onto an unidentified chicken');
      assert.equal(gating.lit, true, 'three-layer crosshair must lock on once the chicken is identified');
      console.log('crosshair gating: dark=false identified=true');
    }
    results.push({ ...entry, ...state, errors: errors.length });
    await context.close();
    console.log(`${entry.label}: mode=${state.mode} debugLayer=${state.debugLayer} fog=${state.headings.includes('战争迷雾')}`);
  }
} finally {
  await browser.close();
}

console.log(`vision mode checks passed (${production ? 'production preview' : 'dev server'}, ${results.length} cases)`);
