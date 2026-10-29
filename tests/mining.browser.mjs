import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = process.env.SCREENSHOT_DIR || '.review';
mkdirSync(output, { recursive: true });
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/');
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
      window.miningGame = (await import(entry.src)).game;
    });
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => miningGame.sceneManager.getCurrentScene()?.loaded);
    await page.keyboard.up('Enter');
    await page.evaluate(() => {
      const game = miningGame, scene = game.sceneManager.getCurrentScene();
      const update = scene.update.bind(scene), oldMap = scene.map;
      window.miningCallbacks = { onTileDestroyed: oldMap.onTileDestroyed, onTileDamaged: oldMap.onTileDamaged };
      scene.update = () => {};
      scene.map = new oldMap.constructor(100, 100, { generateWater: false });
      scene.map.onTileDestroyed = oldMap.onTileDestroyed;
      scene.map.onTileDamaged = oldMap.onTileDamaged;
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.pickupItems = [];
      scene.goldPickups = []; scene.goldDroppedByTile.clear(); scene.particleSystem.clear();
      scene.player.x = scene.player.y = 200;
      scene.map.tiles[4][6] = 'mineral'; scene.map.tileHp[4][6] = 100;
      window.stagedMining = {
        scene, hits: [], safe: true, lastHp: 100,
        tick(input = game.input) {
          update(1 / 60, input);
          this.safe &&= scene.goldPickups.every(piece => scene.map.isShapeWalkable(piece.getCollider()));
          const hp = scene.map.tileHp[4][6];
          if (hp !== this.lastHp) { this.hits.push(scene.goldPickups.length); this.lastHp = hp; }
        },
        advance(seconds, input = game.input) { for (let i = 0; i < Math.ceil(seconds * 60); i++) this.tick(input); this.render(); },
        untilHits(count) { for (let i = 0; i < 300 && this.hits.length < count; i++) this.tick(); this.render(); return [...this.hits]; },
        render() { scene.camera.x = 37.25; scene.camera.y = 19.75; scene.draw(game.renderer.ctx); }
      };
    });
    const mouseTarget = await page.evaluate(() => {
      stagedMining.scene.player.applyConfig({ shooting: { spreadHorizontal: 0, spreadVertical: 0, maxSpreadHorizontal: 0, maxSpreadVertical: 0 } });
      stagedMining.render(); const s = stagedMining.scene, v = s.displayedView, r = s.getCanvasViewport();
      return { x: r.left + (325 - v.x) * r.width / v.width, y: r.top + (225 - v.y) * r.height / v.height };
    });
    await page.mouse.move(mouseTarget.x, mouseTarget.y); await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => stagedMining.untilHits(3)), [2, 2, 4]);
    await page.mouse.up();
    await page.evaluate(() => stagedMining.advance(0.12));
    await page.screenshot({ path: `${output}/mining-partial-dpr${dpr}.png` });
    await page.mouse.move(mouseTarget.x, mouseTarget.y); await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => stagedMining.untilHits(10)), [2, 2, 4, 4, 6, 6, 8, 8, 10, 20]);
    await page.mouse.up();
    await page.evaluate(() => stagedMining.advance(0.7));
    assert.equal(await page.evaluate(() => stagedMining.safe), true);
    await page.screenshot({ path: `${output}/mining-destroyed-dpr${dpr}.png` });
    await page.keyboard.down('d');
    await page.evaluate(() => stagedMining.advance(0.3));
    await page.keyboard.up('d');
    const gold = await page.evaluate(() => {
      const t = stagedMining, p = t.scene.player;
      for (let frame = 0; frame < 900 && t.scene.goldPickups.length; frame++) {
        const target = t.scene.goldPickups[0];
        const dx = target.x + 4 - p.x - p.getSize() / 2, dy = target.y + 4 - p.y - p.getSize() / 2;
        const keys = [];
        if (Math.abs(dx) > 4) keys.push(dx > 0 ? 'd' : 'a');
        if (Math.abs(dy) > 4) keys.push(dy > 0 ? 's' : 'w');
        t.tick({ isKeyDown: key => keys.includes(key) });
      }
      t.advance(0.3, { isKeyDown: () => false });
      return { collected: p.getGold(), remaining: t.scene.goldPickups.length, safe: t.safe };
    });
    assert.deepEqual(gold, { collected: 20, remaining: 0, safe: true });
    await page.screenshot({ path: `${output}/mining-collected-dpr${dpr}.png` });
    console.log(JSON.stringify({ dpr, stagedMining: gold }));
    await page.evaluate(() => {
      const game = miningGame, scene = game.sceneManager.getCurrentScene();
      scene.map = new scene.map.constructor(100, 100, { generateWater: false });
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tiles[4][6] = scene.map.tiles[5][6] = 'mineral';
      scene.map.tileHp[4][6] = scene.map.tileHp[5][6] = 100;
      scene.map.tiles[4][7] = 'wall';
      scene.goldPickups = []; scene.particleSystem.clear(); scene.deltaSinceLastFrame = 0;
      scene.player.x = scene.player.y = 200;
      scene.playerLight.setPosition(new (scene.player.getVelocity().constructor)(224.5, 224.5));
      scene.camera.x = 37.25; scene.camera.y = 19.75;
      const ctx = scene.worldContext;
      const read = (col = 6, row = 4) => ctx.getImageData(Math.round(col * 50 - scene.camera.x), Math.round(row * 50 - scene.camera.y), 50, 50).data;
      const mask=document.createElement('canvas');mask.width=mask.height=50;
      const maskCtx=mask.getContext('2d',{willReadFrequently:true});maskCtx.beginPath();
      const mx=scene.camera.x+Math.round(300-scene.camera.x),my=scene.camera.y+Math.round(200-scene.camera.y);
      for(const {vertices} of scene.map.getBlockingPolygons(300,200,50,50)){
        vertices.forEach((p,i)=>i?maskCtx.lineTo(p.x-mx,p.y-my):maskCtx.moveTo(p.x-mx,p.y-my));maskCtx.closePath();
      }
      maskCtx.fill();const maskPixels=maskCtx.getImageData(0,0,50,50).data;
      // Curved boundaries can change raster coverage when Chromium batches clipped damage.
      // Measure complete interior pixels; contour/mask agreement is checked separately.
      const interior=Array.from({length:2500},(_,p)=>{
        const x=p%50,y=Math.floor(p/50);if(x<2||y<2||x>47||y>47)return false;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(maskPixels[((y+dy)*50+x+dx)*4+3]!==255)return false;
        return true;
      });
      const changed = (a, b) => {
        const pixels = [];
        for (let i = 0; i < a.length; i += 4) if (interior[i/4] && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) pixels.push(i / 4);
        return pixels;
      };
      const render = () => scene.draw(miningGame.renderer.ctx);
      // Settle Chromium's readback fallback before comparing antialiased contour pixels.
      for(let i=0;i<6;i++){render();read();}
      render();
      const baseline = read(), wall = read(7, 4), neighbor = read(6, 5);
      scene.map.tileHighlight[4][6] = scene.map.highlightDuration; render();
      for(let i=0;i<6;i++){render();read();}
      const flashBaseline = read();
      scene.map.tileHighlight[4][6] = 0; render();
      window.oreDamageTest = {
        scene, previous: baseline, positions: [],
        hit(amount) {
          scene.map.damageTile(6, 4, amount); render();
          const flashPixels=changed(flashBaseline,read()).length;
          scene.map.tileHighlight[4][6] = 0; render();
          const actual = read(), positions = changed(baseline, actual);
          const stable = this.positions.every(pixel => {
            const i = pixel * 4;
            return actual[i] === this.previous[i] && actual[i + 1] === this.previous[i + 1] && actual[i + 2] === this.previous[i + 2];
          });
          const cells = new Map();
          for (const pixel of positions) {
            const x = pixel % 50, y = Math.floor(pixel / 50);
            const key = `${Math.floor((x - 1) / 8)},${Math.floor((y - 1) / 8)}`;
            cells.set(key, (cells.get(key) || 0) + 1);
          }
          this.previous = actual; this.positions = positions;
          render();
          return { pixels: positions.length, cells: cells.size, boundedCells: [...cells.values()].every(count => count > 0 && count <= 64),
            stable, redrawStable: changed(actual, read()).length === 0, flashPixels,
            wallChanged: changed(wall, read(7, 4)).length, neighborChanged: changed(neighbor, read(6, 5)).length };
        },
        cameras() {
          const hp = scene.map.tileHp[4][6], results = [];
          for (const [x, y] of [[0, 0], [37.25, 19.75], [-0.5, -0.5]]) {
            scene.camera.x = x; scene.camera.y = y;
            scene.map.tileHp[4][6] = 100; render(); const clean = read();
            scene.map.tileHp[4][6] = hp; render();
            results.push(JSON.stringify(changed(clean, read())) === JSON.stringify(this.positions));
          }
          scene.camera.x = 37.25; scene.camera.y = 19.75; render();
          return results;
        }
      };
    });
    for (const [amount, count, stage] of [[10, 3, 'light'], [40, 12, 'half'], [40, 22, 'low'], [9, 24, 'maximum']]) {
      const damage = await page.evaluate(amount => oreDamageTest.hit(amount), amount);
      assert.equal(damage.cells,count);assert.ok(damage.boundedCells&&damage.pixels>0&&damage.pixels<=count*64);
      assert.equal(damage.flashPixels,damage.pixels,'highlighting preserves the same clipped damage marks');
      assert.ok(damage.stable&&damage.redrawStable);assert.equal(damage.wallChanged,0);assert.equal(damage.neighborChanged,0);
      await page.screenshot({ path: `${output}/mining-damage-${stage}-dpr${dpr}.png` });
      console.log(JSON.stringify({ dpr, damageStage: stage, ...damage }));
    }
    assert.deepEqual(await page.evaluate(() => oreDamageTest.cameras()), [true, true, true]);
    for (const side of ['left', 'right']) {
      const result = await page.evaluate(async side => {
        const { GoldPickup } = await import('/src/objects/GoldPickup.ts');
        const game = miningGame, scene = game.sceneManager.getCurrentScene();
        scene.update = () => {};
        const { onTileDestroyed, onTileDamaged } = scene.map;
        scene.map = new scene.map.constructor(100, 100, { generateWater: false });
        scene.map.onTileDestroyed = onTileDestroyed;
        scene.map.onTileDamaged = onTileDamaged;
        scene.map.tiles.forEach(row => row.fill('default'));
        scene.map.tileHighlight.forEach(row => row.fill(0));
        scene.pickupItems = []; scene.particleSystem.clear();
        scene.player.x = side === 'left' ? 200 : 570; scene.player.y = 279.5;
        const Vector2 = scene.player.getVelocity().constructor;
        scene.playerLight.setPosition(new Vector2(scene.player.x + scene.player.getSize() / 2, 304));
        scene.camera.x = 37.25; scene.camera.y = 19.75;
        const ctx = scene.worldContext;
        const sample = (x, y) => {
          const rgb = ctx.getImageData(Math.round(x - scene.camera.x) - 2, Math.round(y - scene.camera.y) - 2, 5, 5).data;
          const luminance = [];
          for (let i = 0; i < rgb.length; i += 4) luminance.push(0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]);
          // A floating sparkle can cross one pixel of the shadow; compare the ground patch.
          return luminance.sort((a, b) => a - b)[12];
        };
        scene.goldPickups = []; scene.draw(miningGame.renderer.ctx);
        const shadowX = side === 'left' ? 412 : 396;
        const baseline = sample(shadowX, 304);
        const piece = new GoldPickup(400, 300, 400, 300);
        piece.glowPhase = 0.4; piece.update(1);
        scene.goldPickups = [piece]; scene.draw(miningGame.renderer.ctx);
        const shadow = sample(shadowX, 304);
        const litSide = sample(side === 'left' ? 396 : 412, 304);
        // Test the final scene, including multiply lighting and the additive loot aura.
        // A gray isolated canvas used to pass while the aura erased the real shadow.
        const nearEnd = sample(side === 'left' ? 415 : 393, 304);
        const beyond = sample(side === 'left' ? 424 : 384, 304);
        const neighborX = side === 'left' ? 414 : 386;
        const neighbor = new GoldPickup(neighborX, 300, neighborX, 300);
        neighbor.glowPhase = 0.4; neighbor.update(1);
        scene.goldPickups.push(neighbor); scene.draw(miningGame.renderer.ctx);
        const crowdedShadow = sample(shadowX, 304);
        return { baseline, shadow, litSide, nearEnd, beyond, crowdedShadow };
      }, side);
      await page.screenshot({ path: `${output}/mining-shadow-${side}-dpr${dpr}.png` });
      console.log(JSON.stringify({ dpr, side, ...result }));
      assert.ok(result.shadow < result.baseline * 0.65, `loot shadow must stay visible after the glow: ${JSON.stringify(result)}`);
      assert.ok(result.crowdedShadow < result.baseline * 0.65, 'neighboring loot glow must not erase the shadow');
      assert.ok(result.litSide > result.shadow + 8, 'shadow must face away from the light');
      assert.ok(result.beyond > result.nearEnd, 'shadow must end close to the gold');
      const topChanges = await page.evaluate(async side => {
        const { GoldPickup } = await import('/src/objects/GoldPickup.ts');
        const scene = miningGame.sceneManager.getCurrentScene(), ctx = scene.worldContext;
        const col = side === 'left' ? 9 : 7;
        const x = side === 'left' ? 440 : 402;
        const piece = new GoldPickup(x, 320, x, 320);
        piece.glowPhase = 0.4; piece.update(1);
        scene.goldPickups = [piece];
        scene.player.y = 299.5;
        scene.playerLight.setPosition(new (scene.player.getVelocity().constructor)(scene.player.x + scene.player.getSize() / 2, 324));
        const changed = {};
        for (const type of ['wall', 'mineral']) {
          scene.map.tiles[6][col] = type;
          const shadow = piece.drawShadow;
          piece.drawShadow = () => {}; scene.draw(miningGame.renderer.ctx);
          const before = ctx.getImageData(Math.round(col * 50 - scene.camera.x), Math.round(300 - scene.camera.y), 50, 50).data;
          piece.drawShadow = shadow; scene.draw(miningGame.renderer.ctx);
          const after = ctx.getImageData(Math.round(col * 50 - scene.camera.x), Math.round(300 - scene.camera.y), 50, 50).data;
          const mx=scene.camera.x+Math.round(col*50-scene.camera.x),my=scene.camera.y+Math.round(300-scene.camera.y);
          changed[type] = after.reduce((count, value, i) => {
            const x=mx+Math.floor(i/4)%50+.5,y=my+Math.floor(i/200)+.5;
            const interior=[[-1,-1],[1,-1],[-1,1],[1,1]].every(([dx,dy])=>scene.map.blocksLightAt(x+dx,y+dy));
            return count+(interior&&Math.abs(value-before[i])>1?1:0);
          }, 0);
        }
        return changed;
      }, side);
      assert.deepEqual(topChanges, { wall: 0, mineral: 0 }, 'loot shadows and their soft edges must leave terrain tops unchanged');
      await page.screenshot({ path: `${output}/mining-shadow-terrain-${side}-dpr${dpr}.png` });
      console.log(JSON.stringify({ dpr, side, terrainTopChangedPixels: topChanges }));
    }
    // Use the real scene at fractional camera offsets for all five special ores.
    await page.evaluate(async () => {
      const { SPECIAL_MINERAL_TYPES, TILE_TYPES } = await import('/src/map/TileType.ts');
      const scene = miningGame.sceneManager.getCurrentScene();
      Object.assign(scene.map, miningCallbacks);
      scene.map.tiles.forEach(row => row.fill('default'));
      scene.map.tileHp.forEach(row => row.fill(0));
      scene.map.tileHighlight.forEach(row => row.fill(0));
      scene.map.mineralDamage.clear(); scene.goldPickups = []; scene.pickupItems = [];
      scene.particleSystem.clear(); scene.modifierManager.clearAllModifiers();
      scene.player.heal(100); scene.player.takeDamage(80);
      scene.player.x = 475.5; scene.player.y = 100.5;
      scene.playerLight.setPosition(new (scene.player.getVelocity().constructor)(500, 125));
      scene.camera.x = 37.25; scene.camera.y = 19.75;
      const ores = SPECIAL_MINERAL_TYPES.map((type, i) => ({ type, col: 6 + i * 2, row: 5 }));
      for (const { type, col, row } of ores) { scene.map.tiles[row][col] = type; scene.map.tileHp[row][col] = 100; }
      window.specialMining = {
        scene, ores,
        render() { scene.deltaSinceLastFrame = 0; scene.draw(miningGame.renderer.ctx); },
        hit(amount) { for (const { col, row } of ores) scene.map.damageTile(col, row, amount); this.render(); },
        snapshot() {
          // Sample the shared terrain renderer without lighting to measure highlight and damage colors exactly.
          const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 500;
          const ctx = canvas.getContext('2d'); scene.map.draw(ctx, 37.25, 19.75, 1000, 500, 0);
          return ores.map(({ type, col, row }) => {
            const x = Math.round(col * 50 - 37.25), y = Math.round(row * 50 - 19.75);
            const pixels = ctx.getImageData(x, y, 50, 50).data;
            return { type, color: [...ctx.getImageData(x, y+25, 1, 1).data],
              pixels: Array.from(pixels), marks: scene.map.mineralDamage.get(row * 100 + col)?.length ?? 0,
              expectedColor: TILE_TYPES[type].color };
          });
        }
      };
      specialMining.render();
    });
    const intact = await page.evaluate(() => specialMining.snapshot());
    await page.screenshot({ path: `${output}/special-mining-intact-dpr${dpr}.png` });
    await page.evaluate(() => specialMining.hit(10));
    const flash = await page.evaluate(() => specialMining.snapshot());
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(flash[i].color, [255, 255, 255, 255], `${flash[i].type} flashes on hit`);
      assert.equal(flash[i].marks, 24);
    }
    assert.deepEqual(await page.evaluate(() => [specialMining.scene.pickupItems.length, specialMining.scene.goldPickups.length]), [0, 0]);
    await page.screenshot({ path: `${output}/special-mining-flash-dpr${dpr}.png` });
    await page.evaluate(() => {
      specialMining.hit(40);
      specialMining.scene.map.tileHighlight.forEach(row => row.fill(0)); specialMining.render();
    });
    const damaged = await page.evaluate(() => specialMining.snapshot());
    for (let i = 0; i < 5; i++) {
      const expected = intact[i].expectedColor.match(/[a-f0-9]{2}/gi).map(hex => parseInt(hex, 16));
      assert.deepEqual(intact[i].color, [...expected, 255]);
      assert.deepEqual(damaged[i].color, intact[i].color, 'the ore keeps its own hue after flashing');
      const changed = damaged[i].pixels.reduce((count, value, k) => count + (value !== intact[i].pixels[k] ? 1 : 0), 0);
      assert.ok(changed > 500, `${damaged[i].type} shows accumulated damage`);
    }
    await page.screenshot({ path: `${output}/special-mining-damaged-dpr${dpr}.png` });
    await page.evaluate(() => specialMining.hit(50));
    assert.deepEqual(await page.evaluate(() => {
      const { scene, ores } = specialMining;
      return { pickups: scene.pickupItems.map(p => p.getType()), gold: scene.goldPickups.length,
        clear: ores.every(({ col, row }) => scene.map.tiles[row][col] === 'default' && !scene.map.blocksLightAt(col * 50 + 25, row * 50 + 25)),
        safe: scene.pickupItems.every(p => scene.map.isShapeWalkable(p.getCollider())) };
    }), { pickups: [0, 1, 2, 3, 4], gold: 0, clear: true, safe: true });
    await page.screenshot({ path: `${output}/special-mining-drops-dpr${dpr}.png` });
    const collected = await page.evaluate(() => {
      const { scene } = specialMining;
      for (const pickup of [...scene.pickupItems]) {
        scene.player.x = pickup.x + 20 - 24.5; scene.player.y = pickup.y + 20 - 24.5;
        scene.checkPickupCollisions();
      }
      return [scene.pickupItems.length, scene.player.getHealth(), scene.modifierManager.getModifierCount()];
    });
    assert.deepEqual(collected, [0, 70, 4]);
    console.log(JSON.stringify({ dpr, specialMining: { types: 5, partialLoot: 0, drops: 5, health: collected[1], boosts: collected[2] } }));
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
