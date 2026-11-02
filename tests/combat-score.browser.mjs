import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.SCREENSHOT_DIR || '.review/combat-score'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const url = `${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/tests/zombie-fixture.html?count=0`;
let cases = 0;
try {
  for (const dpr of [1, 1.25, 2]) for (const [width, height] of [[360, 640], [640, 360], [1280, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => window.fixture?.scene.killIndicator.sprites.gold);
    const result = await page.evaluate(async () => {
      const f = window.fixture, scene = f.scene; scene.chickens = [];
      const { Bullet } = await import('/src/objects/Bullet.ts'), { Vector2 } = await import('/src/math/Vector2.ts');
      const { getKillIndicatorLayout } = await import('/src/ui/KillIndicator.ts');
      const fire = (kind, head) => {
        const z = f.addEnemy(kind, 900, 750, 0), c = z.getCenter(), direction = head ? -1 : 1;
        const bullet = new Bullet(new Vector2(c.x - direction * 140, c.y), new Vector2(direction * 10000, 0), 100);
        bullet.setEntityHitTest((...args) => scene.findChickenHit(...args)); bullet.update(.03, f.map);
      };
      fire('shambler', true); fire('shambler', false); fire('runner', true);
      scene.killIndicator.update(.12);
      let reserved = [];
      const draw = scene.killIndicator.draw.bind(scene.killIndicator);
      scene.killIndicator.draw = (...args) => { reserved = args[4]; draw(...args); };
      scene.draw(f.game.renderer.ctx); scene.killIndicator.draw = draw;
      const surface = document.createElement('canvas'); surface.width = surface.height = 128;
      const ctx = surface.getContext('2d'), color = quality => {
        ctx.clearRect(0, 0, 128, 128); ctx.drawImage(scene.killIndicator.sprites[quality], 0, 0);
        const pixels = ctx.getImageData(0, 0, 128, 128).data, rgb = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[i + channel] * pixels[i + 3] / 255;
        return rgb;
      };
      const before = JSON.stringify(scene.getCombatScoreState()), age = scene.killIndicator.age;
      draw(ctx, 128, 128, scene.getCombatScoreState()); draw(ctx, 128, 128, scene.getCombatScoreState());
      return { score: scene.getCombatScoreState(), feedback: scene.killIndicator.feedback,
        layout: getKillIndicatorLayout(innerWidth, innerHeight, reserved), reserved,
        colors: { gold: color('gold'), silver: color('silver') },
        stable: before === JSON.stringify(scene.getCombatScoreState()) && age === scene.killIndicator.age };
    });
    assert.equal(result.score.score, 775); assert.equal(result.score.chainCount, 3); assert.equal(result.score.goldKills, 2);
    assert.equal(result.feedback.quality, 'gold'); assert.equal(result.feedback.points, 450); assert.ok(result.stable);
    assert.ok(result.colors.gold[0] > result.colors.gold[2] * 1.5, 'gold skull has a warm gold material');
    assert.ok(result.colors.silver[2] > result.colors.silver[0], 'silver skull has a distinct cool material');
    const r = result.layout;
    assert.ok(r.x >= 12 && r.y >= 12 && r.x + r.width <= width - 12 && r.y + r.height <= height - 12);
    for (const area of result.reserved) assert.ok(!(r.x < area.x + area.width && r.x + r.width > area.x && r.y < area.y + area.height && r.y + r.height > area.y), `badge must not overlap bottom HUD at ${width}x${height}: ${JSON.stringify({ r, area })}`);
    await page.screenshot({ path: `${output}/gold-3-chain-${width}x${height}-dpr-${dpr}.png` });
    const silver = await page.evaluate(async () => {
      const f = window.fixture, { Bullet } = await import('/src/objects/Bullet.ts'), { Vector2 } = await import('/src/math/Vector2.ts');
      const z = f.addEnemy('runner', 900, 750, 0), c = z.getCenter();
      const bullet = new Bullet(new Vector2(c.x - 140, c.y), new Vector2(10000, 0), 100);
      bullet.setEntityHitTest((...args) => f.scene.findChickenHit(...args)); bullet.update(.03, f.map);
      f.scene.killIndicator.update(.12); f.scene.draw(f.game.renderer.ctx);
      return { feedback: f.scene.killIndicator.feedback, score: f.scene.getCombatScoreState() };
    });
    assert.equal(silver.feedback.quality, 'silver', 'latest body kill replaces the gold badge even during a high chain');
    assert.equal(silver.feedback.points, 263); assert.equal(silver.score.goldKills, 2);
    if (dpr === 1) await page.screenshot({ path: `${output}/silver-4-chain-${width}x${height}.png` });
    const lingering = await page.evaluate(() => {
      const f = window.fixture, ctx = f.game.renderer.ctx, text = [], fillText = ctx.fillText;
      f.scene.killIndicator.update(.9); f.scene.combatScore.update(.9);
      ctx.fillText = function (value, ...args) { text.push(value); return fillText.call(this, value, ...args); };
      f.scene.draw(ctx); ctx.fillText = fillText;
      return text;
    });
    assert.ok(lingering.includes('4 连杀 · ×1.75'), 'chain remains after badge expires');
    assert.ok(!lingering.includes('白银击杀') && !lingering.includes('+263'), 'expired badge and points disappear');
    const frozen = await page.evaluate(() => {
      const f = window.fixture; f.scene.paused = true;
      return JSON.stringify({ score: f.scene.getCombatScoreState(), age: f.scene.killIndicator.age });
    });
    await page.evaluate(() => window.fixture.tick(180, 1 / 30));
    assert.equal(await page.evaluate(() => JSON.stringify({ score: window.fixture.scene.getCombatScoreState(), age: window.fixture.scene.killIndicator.age })), frozen);
    await page.evaluate(() => { const f = window.fixture; f.scene.paused = false; f.tick(1, 4.001); });
    assert.equal(await page.evaluate(() => window.fixture.scene.getCombatScoreState().chainCount), 0);
    await page.evaluate(() => { const f = window.fixture; f.scene.getPlayer().applyDamage({ kind: 'script', amount: 1000 }); f.tick(1, 0); });
    const dead = await page.evaluate(() => window.fixture.scene.getCombatScoreState());
    assert.equal(dead.score, 1038); assert.equal(dead.bestChain, 4);
    if (dpr === 1) await page.screenshot({ path: `${output}/death-score-${width}x${height}.png` });
    await page.evaluate(() => { const f = window.fixture; f.scene.paused = true; f.scene.getPlayer().resetLifeState(); f.tick(1, 0); });
    assert.equal(await page.evaluate(() => window.fixture.scene.getCombatScoreState().score), 0);
    assert.deepEqual(errors, []); cases++; await context.close();
  }
  for (const fps of [30, 60, 144]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url); await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(async fps => {
      const f = window.fixture, p = f.scene.getPlayer(); f.scene.chickens = [];
      const { ZombieRenderer } = await import('/src/enemies/ZombieRenderer.ts');
      p.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      const c = p.getCollider().pose, z = f.addEnemy('runner', c.x + 170, c.y, Math.PI);
      const head = ZombieRenderer.parts(z.getPose()).at(-1);
      p.shootAt(head, 30, f.map);
      for (let i = 0; i < fps && z.isAlive(); i++) f.tick(1, 1 / fps);
      return { life: z.getLifeState(), score: f.scene.getCombatScoreState() };
    }, fps);
    assert.equal(result.life, 'removed'); assert.equal(result.score.score, 300); assert.equal(result.score.goldKills, 1);
    cases++; await page.close();
  }
  console.log(`combat score browser: ${cases} cases passed; screenshots in ${output}`);
} finally { await browser.close(); }
