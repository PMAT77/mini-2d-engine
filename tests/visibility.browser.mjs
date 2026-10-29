import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173', output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const dpr of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: 'export {};' }));
    await page.goto(base);
    await page.evaluate(async () => { window.visionGame = (await import('/src/main.ts')).game; });
    await page.keyboard.down('Enter');
    await page.waitForSelector('[data-player-debug]'); await page.keyboard.up('Enter');
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await page.waitForTimeout(60);
    assert.ok(!requests.some(url => url.includes('avatar.png')), 'the procedural model does not load an avatar');
    await page.screenshot({ path: `${output}/cylinder-gameplay-dpr${dpr}.png` });
    await page.evaluate(async () => {
      const { Torch } = await import('/src/objects/Torch.ts');
      const { GoldPickup } = await import('/src/objects/GoldPickup.ts');
      const game = visionGame, scene = game.sceneManager.getCurrentScene(), p = scene.player;
      scene.map = new scene.map.constructor(40, 30, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.pickupItems = []; scene.goldPickups = []; scene.torches = []; scene.particleSystem.clear();
      scene.lightingSystem.clearAllLights(); scene.lightingSystem.addLightSource(scene.playerLight);
      p.x = 300.5; p.y = 425.5; p.currentRotation = Math.PI; p.velocity.set(0, 0);
      p.applyConfig({ animation: { breathingAmplitude: 0 }, shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      p.setOnShootCallback(() => {}); p.bullets = []; p.fireCooldown = 0;
      const lightPosition = p.getVelocity(); lightPosition.set(325, 450); scene.playerLight.setPosition(lightPosition);
      scene.camera.reset(); scene.camera.x = .375; scene.camera.y = .625;
      game.input.clear(); scene.deltaSinceLastFrame = 0;
      const t = window.visionTest = {
        game, scene, p, Torch, GoldPickup,
        render() { scene.draw(game.renderer.ctx); },
        tick(delta) { p.update(delta, game.input, scene.map, scene.getPointerAim(game.input)); this.render(); },
        client(x, y) { const v = scene.displayedView, r = scene.getCanvasViewport(); return { x: r.left + (x - v.x) * r.width / v.width, y: r.top + (y - v.y) * r.height / v.height }; },
        pixel(x, y, canvas = scene.visibilitySystem.canvas) { const v = scene.displayedView; return [...canvas.getContext('2d').getImageData(Math.floor(x - v.x), Math.floor(y - v.y), 1, 1).data]; },
      };
      t.render();
    });
    const daily = await page.evaluate(() => {
      const t = visionTest, v = t.p.getVisionState();
      const polar = degrees => t.pixel(v.x + Math.cos(degrees * Math.PI / 180) * 200, v.y + Math.sin(degrees * Math.PI / 180) * 200)[0];
      return { v, front: t.pixel(525, 450)[0], rear: t.pixel(125, 450)[0], far: t.pixel(750, 450)[0],
        inner: polar(56), feather: polar(58.5), outside: polar(61), edge: t.pixel(713, 450)[0] };
    });
    assert.equal(daily.front, 255); assert.equal(daily.rear, 8); assert.equal(daily.far, 8);
    assert.equal(daily.inner, 255); assert.ok(daily.feather > 40 && daily.feather < 220); assert.equal(daily.outside, 8);
    assert.ok(daily.edge > 60 && daily.edge < 200);
    await page.screenshot({ path: `${output}/cylinder-daily-dpr${dpr}.png` });
    const far = await page.evaluate(() => visionTest.client(1125, 450));
    await page.mouse.move(far.x, far.y); await page.mouse.down({ button: 'right' });
    const raised = await page.evaluate(() => {
      const t = visionTest; t.tick(.05); const half = t.p.armLift; t.tick(.95);
      return { half, lift: t.p.armLift, v: t.p.getVisionState(), distant: t.pixel(1000, 450)[0], side: t.pixel(525, 600)[0],
        baseRadius: t.scene.playerLight.getRadius(), effectiveRadius: t.scene.playerLight.getEffectiveRadius() };
    });
    assert.equal(raised.half, .5); assert.equal(raised.lift, 1);
    assert.ok(Math.abs(raised.v.range - 800) < .01); assert.ok(Math.abs(raised.v.angle * 180 / Math.PI - 45) < .01);
    assert.equal(raised.distant, 255); assert.equal(raised.side, 8);
    assert.equal(raised.baseRadius, 400); assert.ok(Math.abs(raised.effectiveRadius - 800) < .01);
    await page.screenshot({ path: `${output}/cylinder-focused-dpr${dpr}.png` });
    await page.mouse.down();
    const shot = await page.evaluate(() => {
      const t = visionTest; t.tick(0); const b = t.p.getBullets()[0];
      return { hand: t.p.getMuzzlePosition(), bullet: { x: b.getPosition().x + 5, y: b.getPosition().y + 5 }, arms: t.p.armLift };
    });
    assert.deepEqual(shot.hand, shot.bullet); assert.equal(shot.arms, 1);
    await page.mouse.up(); await page.mouse.up({ button: 'right' });
    await page.evaluate(() => { visionTest.tick(1); visionTest.p.bullets = []; visionTest.render(); });
    const released = await page.evaluate(() => ({ v: visionTest.p.getVisionState(), arms: visionTest.p.armLift }));
    assert.equal(released.v.range, 400); assert.equal(released.arms, 0);

    // A low light and post-lighting loot effects must not reveal occluded space or distant wall tops.
    const occlusion = await page.evaluate(() => {
      const t = visionTest, { scene: s, p } = t;
      s.map.tiles[8][10] = s.map.tiles[9][10] = 'mineral'; s.map.tileHp[8][10] = s.map.tileHp[9][10] = 100;
      s.map.tiles[8][13] = s.map.tiles[9][13] = 'wall';
      const torch = new t.Torch(610, 450); s.torches = [torch]; s.lightingSystem.addLightSource(torch.light);
      s.goldPickups = [new t.GoldPickup(610, 470, 610, 470), new t.GoldPickup(150, 450, 150, 450)];
      s.goldPickups.forEach(g => g.update(1));
      s.particleSystem.addParticle({ x: 610, y: 430, size: 8, color: '#ffffff', speed: 0, angle: 0, lifetime: 2 });
      t.render();
      const hidden = [[610, 446], [613, 472], [153, 452], [610, 430]];
      const final = hidden.map(([x,y]) => t.pixel(x,y,s.worldCanvas));
      const original = s.visibilitySystem.apply; s.visibilitySystem.apply = () => {}; t.render();
      const raw = hidden.map(([x,y]) => t.pixel(x,y,s.worldCanvas));
      const self = t.pixel(p.x + 24.5, p.y + 24.5, s.worldCanvas);
      s.visibilitySystem.apply = original; t.render();
      const result = { final, raw, self, maskedSelf: t.pixel(p.x + 24.5,p.y + 24.5,s.worldCanvas),
        behind: t.pixel(600,450)[0], front: t.pixel(480,450)[0], distantWall: t.pixel(675,450)[0] };
      s.map.damageTile(10,8,100); s.map.damageTile(10,9,100); t.render();
      result.revealed = t.pixel(600,450)[0];
      p.currentRotation = 0; t.render(); result.turnedAway = t.pixel(600,450)[0];
      p.currentRotation = Math.PI; t.render();
      return result;
    });
    assert.equal(occlusion.behind, 8); assert.equal(occlusion.front, 255); assert.equal(occlusion.distantWall, 8);
    assert.equal(occlusion.revealed, 255); assert.equal(occlusion.turnedAway, 8);
    assert.deepEqual(occlusion.self, occlusion.maskedSelf);
    for (let i = 0; i < occlusion.final.length; i++) for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(occlusion.final[i][c] - occlusion.raw[i][c] * 8 / 255) <= 1, 'all world effects share the final visibility mask');
    await page.screenshot({ path: `${output}/cylinder-occlusion-dpr${dpr}.png` });

    const alignment = [];
    for (const shake of [false, true]) {
      alignment.push(await page.evaluate(shake => {
        const t = visionTest, c = t.scene.camera;
        c.x = 37.25; c.y = 19.75; if (shake) { c.shake(5, 1, .5, 20, 'linear'); c.follow(325,450,.01); }
        t.render(); const v = t.p.getVisionState(), client = t.client(v.x,v.y), world = t.scene.screenToWorld(client.x,client.y);
        return { dx: world.x-v.x, dy: world.y-v.y, self: t.pixel(v.x,v.y)[0], front: t.pixel(v.x+100,v.y)[0], rear: t.pixel(v.x-100,v.y)[0] };
      }, shake));
    }
    for (const a of alignment) { assert.ok(Math.abs(a.dx)<1e-7 && Math.abs(a.dy)<1e-7); assert.equal(a.self,255); assert.equal(a.front,255); assert.equal(a.rear,8); }
    await page.setViewportSize({ width: 1000, height: 720 });
    const resized = await page.evaluate(() => {
      const t = visionTest; t.scene.handleResize(); t.render();
      return { world: [t.scene.worldCanvas.width,t.scene.worldCanvas.height], mask: [t.scene.visibilitySystem.canvas.width,t.scene.visibilitySystem.canvas.height] };
    });
    assert.deepEqual(resized.mask,resized.world); assert.deepEqual(errors,[]);
    results.push({ dpr,daily,raised,shot,occlusion,alignment,resized });
    await context.close();
  }
  writeFileSync(`${output}/visibility-pixels.json`,JSON.stringify(results,null,2)+'\n');
  console.log('Visibility passed: actual mouse poses, hand emission, focus, wall occlusion/destruction, hidden lights/loot/particles, player exemption, DPR/zoom/shake and resize.');
} finally { await browser.close(); }
