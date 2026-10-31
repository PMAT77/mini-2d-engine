import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createRecordingContext } from './render-recorder.mjs';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const {
  SoundRippleSystem, SOUND_RIPPLE_MIN_LIFE, SOUND_RIPPLE_MAX_LIFE, SOUND_RIPPLE_MAX_COUNT,
} = load('objects/SoundRippleSystem');
const { GameScene } = load('scenes/GameScene');
const { Chicken } = load('objects/Chicken');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');

const dryMap = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

const cue = (eventId, strength = 0.5, distance = 120, occluded = false) => ({
  x: 100, y: 100, strength, distance, occluded, eventId,
});

test('提示位置带确定性小偏移：近处 0–8 像素，远处或隔墙 12–30 像素', () => {
  const nearCue = SoundRippleSystem.resolveCue(200, 200, 40, false, 7);
  assert.ok(Math.hypot(nearCue.x - 200, nearCue.y - 200) <= 8);

  const farCue = SoundRippleSystem.resolveCue(200, 200, 500, true, 7);
  const farOffset = Math.hypot(farCue.x - 200, farCue.y - 200);
  assert.ok(farOffset >= 12 && farOffset <= 30, `隔墙偏移 ${farOffset}`);

  const again = SoundRippleSystem.resolveCue(200, 200, 500, true, 7);
  assert.deepEqual(again, farCue, '同一事件每次生成的位置必须一致，不能逐帧抖动');
});

test('同一个世界事件只生成一条提示，寿命在 0.7–0.9 秒之间', () => {
  const system = new SoundRippleSystem();
  assert.equal(system.spawn(cue(10)), true);
  assert.equal(system.spawn(cue(10)), false, '同一事件不能重复生成');
  assert.equal(system.getActiveCount(), 1);

  const [ripple] = system.getRipples();
  assert.ok(ripple.life >= SOUND_RIPPLE_MIN_LIFE && ripple.life <= SOUND_RIPPLE_MAX_LIFE);
  assert.equal(ripple.segments, 3, '较响的声音画三段弧');

  system.update(ripple.life + 0.01);
  assert.equal(system.getActiveCount(), 0, '寿命结束后自动移除');
});

test('同时存在的提示数量有上限，清空后可以重新使用事件 id', () => {
  const system = new SoundRippleSystem();
  for (let id = 1; id <= SOUND_RIPPLE_MAX_COUNT + 6; id++) system.spawn(cue(id));
  assert.equal(system.getActiveCount(), SOUND_RIPPLE_MAX_COUNT);

  system.clear();
  assert.equal(system.getActiveCount(), 0);
  assert.equal(system.spawn(cue(1)), true, '清空会一并丢弃去重表');
});

test('涟漪用断续圆弧绘制，并在相机外整条剔除', () => {
  const system = new SoundRippleSystem();
  system.spawn(cue(30, 0.6, 100));
  system.update(0.2);

  const { ctx, ops } = createRecordingContext();
  system.draw(ctx, 0, 0, 800, 600);
  const arcs = ops.filter(op => op.op === 'arc');
  assert.equal(arcs.length, 3, '一条涟漪三段弧');
  for (const arc of arcs) {
    const span = arc.args[4] - arc.args[3];
    assert.ok(span < (Math.PI * 2) / 3, '每段弧都不能连成整圆');
  }

  const { ctx: offscreenCtx, ops: offscreenOps } = createRecordingContext();
  system.draw(offscreenCtx, -2000, -2000, 800, 600);
  assert.equal(offscreenOps.filter(op => op.op === 'arc').length, 0);
});

function createScene() {
  const scene = new GameScene({ seed: 7, generateWater: false });
  scene.loaded = true;
  scene.map = dryMap();
  scene.perception = undefined;
  scene.player.x = 300;
  scene.player.y = 300;
  scene.chickens = [];
  return scene;
}

test('玩家听见鸡叫才生成涟漪，同一声不会反复生成', () => {
  const scene = createScene();
  const chicken = new Chicken(420, 300, seededRandom(41));
  scene.chickens = [chicken];

  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  scene.updateSoundRipples(1 / 60);
  assert.equal(scene.soundRippleSystem.getActiveCount(), 1);

  scene.updateSoundRipples(1 / 60);
  assert.equal(scene.soundRippleSystem.getActiveCount(), 1, '同一事件只提示一次');
});

test('玩家自己的枪声不画涟漪，关闭主音量也不影响世界听觉', () => {
  const scene = createScene();
  const px = scene.player.x + scene.player.getSize() / 2;
  const py = scene.player.y + scene.player.getSize() / 2;
  scene.noiseSystem.emit('gunshot', px + 80, py, { sourceId: 'player' });
  scene.updateSoundRipples(1 / 60);
  assert.equal(scene.soundRippleSystem.getActiveCount(), 0, '自己的声音不需要位置提示');

  const chicken = new Chicken(420, 300, seededRandom(42));
  scene.chickens = [chicken];
  scene.audio.master = 0;
  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  scene.updateSoundRipples(1 / 60);
  assert.equal(scene.soundRippleSystem.getActiveCount(), 1, '静音是播放设置，不改变世界听觉');
});

test('已完整识别的鸡不再画声音提示', () => {
  const scene = createScene();
  const chicken = new Chicken(420, 300, seededRandom(43));
  scene.chickens = [chicken];
  scene.perception = {};
  scene.getEntityVisibility = () => 'identified';

  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  scene.updateSoundRipples(1 / 60);
  assert.equal(scene.soundRippleSystem.getActiveCount(), 0);
});

test('只看到剪影的鸡仍保留声音提示', () => {
  const scene = createScene();
  const chicken = new Chicken(420, 300, seededRandom(44));
  scene.chickens = [chicken];
  scene.perception = {};
  scene.getEntityVisibility = () => 'silhouette';

  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  scene.updateSoundRipples(1 / 60);
  assert.equal(scene.soundRippleSystem.getActiveCount(), 1);
});
