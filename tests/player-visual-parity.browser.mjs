import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 玩家视觉浏览器验收（rig-only）。
 *
 * 检查：非翻滚帧能稳定出图、快照与渲染状态一致；翻滚六相位输出关键帧截图；
 * 中段伪高度/遮挡/阴影存在；枪口 socket 与手持武器 socket 有限且可用。
 *
 * 运行前提：开发服务器已启动（默认 http://127.0.0.1:5173），并提供 playwright：
 *   TEST_BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_MODULE=<path> node tests/player-visual-parity.browser.mjs
 */
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = process.env.SCREENSHOT_DIR || '.review';
const rollOutput = join(output, 'anim2d-roll');
mkdirSync(rollOutput, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});

try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
  await page.goto(`${base}/?vision=legacy`);
  await page.keyboard.down('Enter');
  await page.waitForSelector('[data-player-debug]');
  await page.keyboard.up('Enter');
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  const report = await page.evaluate(async () => {
    const bridge = await import('/src/objects/animation/PlayerVisualAdapter.ts');
    const game = (await import('/src/main.ts')).game;
    const p = game.sceneManager.getCurrentScene().player;

    const reset = () => {
      p.currentRotation = Math.PI;
      p.armLift = 0;
      p.armAngle = -Math.PI;
      p.armDistance = Number.POSITIVE_INFINITY;
      p.shotPoseTime = 0;
      p.weaponSwapTime = 0;
      p.runSwayWeight = 0;
      p.runSwayPhase = 0;
      p.idleTime = 0;
      p.rollTimeLeft = 0;
      p.rollDirection.set(1, 0);
      p.health = 100;
      bridge.resetPlayerVisualState(p);
    };

    const size = 220;
    const makeCanvas = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      return canvas;
    };
    const paintedPixels = (data) => {
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
      return painted;
    };
    const diffPixels = (a, b) => {
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) diff++;
      }
      return diff;
    };

    const cases = [];
    const renderCase = (label, setup) => {
      reset();
      setup?.();
      const snapshot = bridge.createPlayerRenderSnapshot(p);
      const canvas = makeCanvas();
      const ctx = canvas.getContext('2d');
      bridge.renderPlayerSnapshot(ctx, snapshot, size / 2, size / 2);
      cases.push({ label, painted: paintedPixels(ctx.getImageData(0, 0, size, size).data) });
      return snapshot;
    };

    const rest = renderCase('rest');
    renderCase('idle breathing', () => { p.idleTime = 0.83; });
    renderCase('aiming', () => { p.armLift = 1; p.armAngle = 0.4; p.armDistance = 120; p.shotPoseTime = 0.05; });
    renderCase('running sway', () => { p.runSwayWeight = 0.9; p.runSwayPhase = 2.1; });
    renderCase('weapon swap', () => { p.switchWeapon('primary'); p.weaponSwapTime = 0.11; });
    renderCase('melee', () => { p.toggleMelee(); });
    const snapshotMatches = (() => {
      reset();
      const state = p.getRenderState();
      const snapshot = bridge.createPlayerRenderSnapshot(p);
      return snapshot.facing === state.angle && snapshot.progress === state.progress
        && snapshot.scale === state.scale && snapshot.rolling === state.rolling
        && snapshot.altitudePx === 0 && snapshot.depthTuck === false;
    })();

    const socketsFinite = Number.isFinite(rest.sockets.mainGrip.x) && Number.isFinite(rest.sockets.mainGrip.y)
      && Number.isFinite(rest.sockets.visualMuzzle.x) && Number.isFinite(rest.sockets.visualMuzzle.y);

    const rollCases = [];
    const pngs = [];
    for (const [label, progress] of [
      ['p00', 0], ['p12', .12], ['p30', .30], ['p50', .50], ['p70', .70], ['p92', .92],
    ]) {
      reset();
      const facing = .6;
      p.currentRotation = facing + Math.PI;
      p.rollDirection.set(Math.cos(facing), Math.sin(facing));
      p.rollTimeLeft = p.roll.duration * (1 - progress);
      p.armLift = .6; p.armAngle = .2; p.armDistance = 90;
      p.runSwayWeight = .4; p.runSwayPhase = 1.7;

      const snapshot = bridge.createPlayerRenderSnapshot(p);
      const rigCanvas = makeCanvas();
      const drawCanvas = makeCanvas();
      bridge.renderPlayerSnapshot(rigCanvas.getContext('2d'), snapshot, size / 2, size / 2);
      // Player.draw 会在缓冲外补一层地面阴影；偏移让它落在同一中心。
      const offsetX = p.x + p.getSize() / 2 - size / 2;
      const offsetY = p.y + p.getSize() / 2 - size / 2;
      p.draw(drawCanvas.getContext('2d'), offsetX, offsetY);
      const rigData = rigCanvas.getContext('2d').getImageData(0, 0, size, size).data;
      const drawData = drawCanvas.getContext('2d').getImageData(0, 0, size, size).data;
      rollCases.push({
        label,
        shadowDiff: diffPixels(drawData, rigData),
        altitudePx: snapshot.altitudePx,
        depthTuck: snapshot.depthTuck,
        painted: paintedPixels(drawData),
      });
      pngs.push({ label, png: drawCanvas.toDataURL('image/png') });
    }

    return {
      cases,
      snapshotMatches,
      socketsFinite,
      rollCases,
      pngs,
    };
  });

  assert.deepEqual(errors, [], 'page must not throw');
  assert.equal(report.snapshotMatches, true, 'non-rolling snapshot must mirror PlayerRenderState');
  assert.equal(report.socketsFinite, true, 'mainGrip and visualMuzzle sockets must be finite');
  for (const entry of report.cases) {
    assert.ok(entry.painted > 500, `${entry.label}: rig body should be drawn`);
  }

  assert.equal(report.rollCases.length, 6, 'six key roll phases are captured');
  for (const roll of report.rollCases) {
    assert.ok(roll.painted > 500, `${roll.label}: rig body should be drawn`);
    assert.ok(Number.isFinite(roll.altitudePx), `${roll.label}: altitude must be finite`);
    if (roll.label === 'p50') {
      assert.ok(roll.altitudePx > 0, 'mid-roll must be airborne');
      assert.equal(roll.depthTuck, true, 'mid-roll must tuck the head behind the torso');
      assert.ok(roll.shadowDiff > 20, 'Player.draw must add the airborne shadow outside the buffer');
    }
    if (roll.label === 'p00') {
      assert.equal(roll.altitudePx, 0, 'grounded start must have no shadow');
      assert.equal(roll.depthTuck, false);
    }
  }
  const airborne = report.rollCases.map(entry => entry.altitudePx);
  assert.ok(Math.max(...airborne) > 10, 'roll should lift the character visibly');

  for (const entry of report.pngs) {
    writeFileSync(join(rollOutput, `roll-${entry.label}.png`), Buffer.from(entry.png.split(',')[1], 'base64'));
  }
  console.log('non-rolling cases:', report.cases.map(entry => entry.label).join(', '));
  console.log('roll phases:', report.rollCases.map(entry => `${entry.label} alt=${entry.altitudePx.toFixed(2)}`).join(', '));
  console.log('saved roll screenshots to', rollOutput);
} finally {
  await browser.close();
}
