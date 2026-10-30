// 诊断脚本：抓取鸡从完整辨识退回剪影的逐帧画面，用于修改前后对照。
// 用法：TEST_BASE_URL=http://127.0.0.1:5173 SHOT_TAG=after node tests/perception-crossfade-shots.mjs
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", ".review");
mkdirSync(output, { recursive: true });

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const tag = process.env.SHOT_TAG || "after";
const dpr = Number(process.env.SHOT_DPR || "1");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/@vite/client", (route) => route.fulfill({ contentType: "application/javascript", body: "export {};" }));
await page.goto(`${base}/?vision=three-layer`);
await page.evaluate(async () => { window.visionGame = (await import("/src/main.ts")).game; });
await page.keyboard.down("Enter");
await page.waitForSelector("[data-player-debug]");
await page.keyboard.up("Enter");
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

const setup = await page.evaluate(async () => {
  const { TileMap } = await import("/src/map/TileMap.ts");
  const { Chicken } = await import("/src/objects/Chicken.ts");
  const { PerceptionSystem } = await import("/src/vision/PerceptionSystem.ts");
  const { PerceptionRenderer } = await import("/src/vision/PerceptionRenderer.ts");

  const game = window.visionGame;
  const scene = game.sceneManager.getCurrentScene();
  scene.map = new TileMap(40, 30, { generateWater: false });
  scene.map.tiles.forEach((row) => row.fill("default"));
  scene.map.tileHp.forEach((row) => row.fill(0));
  scene.map.water = undefined;
  scene.torches.forEach((torch) => scene.lightingSystem.removeLightSource(torch.light));
  scene.torches = [];
  scene.goldPickups = [];
  scene.meatPickups = [];
  scene.pickupItems = [];
  scene.chickens = [];
  scene.particleSystem.clear();

  const size = scene.map.tileSize;
  const px = 20.5 * size;
  const py = 15.5 * size;
  scene.player.x = px - 24.5;
  scene.player.y = py - 24.5;
  scene.player.currentRotation = Math.PI / 2;
  scene.playerLight.getPosition().set(px, py);
  scene.flashlight.getPosition().set(px, py);
  scene.flashlight.setDirection(0);
  scene.flashlight.setActive(false);
  scene.camera.x = px - scene.camera.width / 2;
  scene.camera.y = py - scene.camera.height / 2;

  scene.perception = new PerceptionSystem({ map: scene.map, terrain: scene.map, rules: scene.visionRules });
  scene.perceptionObserver = {
    id: "player", x: px, y: py, facing: Math.PI / 2,
    nearSenseRadius: scene.visionRules.nearSenseRadius,
    maxObservationRange: scene.visionRules.maxObservationRange,
  };
  scene.perceptionRenderer = new PerceptionRenderer(scene.map, scene.map, scene.visionRules, scene.graphics.visibility);
  scene.perceptionRenderer.resize(scene.worldCanvas.width, scene.worldCanvas.height, scene.graphics.visibility);

  const bird = new Chicken(0, 0, () => 0.5);
  bird.x = px + 80 - bird.size / 2;
  bird.y = py - 20 - bird.size / 2;
  scene.chickens = [bird];

  window.shotTest = {
    scene,
    bird,
    step() {
      scene.updatePerception(1 / 30);
      scene.draw(game.renderer.ctx);
    },
    view() {
      const view = scene.getPerceptionView(bird);
      return { level: view.level, alpha: view.alpha, silhouette: view.silhouette ?? null };
    },
    light(on) { scene.flashlight.setActive(on); },
  };

  window.shotTest.step();
  const view = scene.displayedView;
  const cx = bird.x + bird.size / 2 - view.x;
  const cy = bird.y + bird.size / 2 - view.y;
  return { crop: { x: Math.round(cx - 70), y: Math.round(cy - 70), size: 140 }, px, py };
});

const { crop } = setup;
const shot = async (name) => {
  const dataUrl = await page.evaluate(({ x, y, size }) => {
    const scene = window.shotTest.scene;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d").drawImage(scene.worldCanvas, x, y, size, size, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  }, crop);
  writeFileSync(join(output, `crossfade-${tag}-${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
};

const states = [];
await page.evaluate(() => { const t = window.shotTest; t.light(true); for (let i = 0; i < 40; i += 1) t.step(); });
states.push({ phase: "identified", ...(await page.evaluate(() => window.shotTest.view())) });
await shot("00-identified");

const fade = await page.evaluate(() => {
  const t = window.shotTest;
  t.light(false);
  return t.view();
});
states.push({ phase: "fade-0", ...fade });
for (let i = 1; i <= 12; i += 1) {
  const state = await page.evaluate(() => { const t = window.shotTest; t.step(); return t.view(); });
  states.push({ phase: `fade-${i}`, ...state });
  await shot(`${String(i).padStart(2, "0")}-fade`);
}

await page.screenshot({ path: join(output, `crossfade-${tag}-scene.png`) });
writeFileSync(join(output, `crossfade-${tag}.json`), JSON.stringify({ tag, base, dpr, crop, states }, null, 2) + "\n");
assert.deepEqual(errors, []);
await browser.close();
console.log(`Cross-fade shots [${tag}] written for ${states.length} states.`);
