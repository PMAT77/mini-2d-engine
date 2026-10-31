import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { Chicken } = load('objects/Chicken');
const { TileMap } = load('map/TileMap');
const { seededRandom } = load('map/WaterTerrain');

globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };

const dryMap = (width = 40, height = 30) => {
  const map = new TileMap(width, height, { generateWater: false });
  map.tiles.forEach(row => row.fill('default'));
  return map;
};

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

/** 无 Audio 的 Node 环境里 SoundPlayer 返回 null，用假播放器验证声部与增益。 */
function stubVoices(scene) {
  const handles = [];
  scene.sfx = {
    play() {
      const handle = {
        volume: 0,
        playing: true,
        stops: 0,
        setVolume(value) { this.volume = value; },
        isPlaying() { return this.playing; },
        stop() { this.playing = false; this.stops++; },
      };
      handles.push(handle);
      return handle;
    },
  };
  return handles;
}

const clucks = scene => scene.noiseSystem.getEvents().filter(event => event.kind === 'cluck');

test('受惊惊叫比普通咕咕更响，但仍是同一种世界噪声事件', () => {
  const scene = createScene();
  const calm = new Chicken(320, 300, seededRandom(11));
  const scared = new Chicken(330, 300, seededRandom(12));
  scene.chickens = [calm, scared];

  scene.playChickenCluck(calm, calm.x, calm.y);
  scene.playChickenCluck(scared, scared.x, scared.y, true);

  const events = clucks(scene);
  assert.equal(events.length, 2);
  assert.equal(events[0].loudness, 0.45);
  assert.equal(events[1].loudness, 0.55);
  assert.equal(events[1].kind, 'cluck');
});

test('同时发声的鸡叫受声部预算限制，但世界事件一条不少', () => {
  const scene = createScene();
  stubVoices(scene);
  const chickens = [340, 350, 360, 370].map((x, i) => new Chicken(x, 300, seededRandom(20 + i)));
  scene.chickens = chickens;

  for (const chicken of chickens) scene.playChickenCluck(chicken, chicken.x, chicken.y);

  assert.equal(clucks(scene).length, 4, '六只鸡同时受惊时世界仍记录每一声');
  assert.equal(scene.activeClucks.length, 3, '播放声部只保留最响的几声');
});

test('音量跟随活鸡实时位置，走远后平滑收掉并释放声部', () => {
  const scene = createScene();
  stubVoices(scene);
  const chicken = new Chicken(360, 300, seededRandom(31));
  scene.chickens = [chicken];

  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  assert.equal(scene.activeClucks.length, 1);
  scene.updateCluckVolumes(1 / 60);
  const playing = scene.activeClucks[0].handle;
  const initial = playing.volume;
  assert.ok(initial > 0, '近距离应当有可听音量');

  // 鸡边叫边跑远：声音要跟着鸡走，而不是停在发声瞬间的坐标。
  chicken.x = 900;
  chicken.y = 300;
  for (let i = 0; i < 12; i++) scene.updateCluckVolumes(1 / 60);
  assert.ok(playing.volume < initial, '鸡跑远后音量必须下降');

  for (let i = 0; i < 120 && scene.activeClucks.length > 0; i++) {
    scene.updateCluckVolumes(1 / 60);
  }
  assert.equal(scene.activeClucks.length, 0, '完全听不见后要释放声部');
  assert.ok(playing.stops > 0);
});
