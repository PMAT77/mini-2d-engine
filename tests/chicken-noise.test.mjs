import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { GameScene } = load('scenes/GameScene');
const { Chicken } = load('objects/Chicken');
const { TileMap } = load('map/TileMap');
const { NoiseSystem } = load('core/NoiseSystem');
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

const clucks = scene => scene.noiseSystem.getEvents().filter(event => event.kind === 'cluck');

test('两只鸡在同一个冷却窗口内先后受惊，都能向世界发出一条叫声事件', () => {
  const scene = createScene();
  const first = new Chicken(320, 300, seededRandom(1));
  const second = new Chicken(340, 300, seededRandom(2));
  scene.chickens = [first, second];

  scene.playChickenCluck(first, first.x, first.y);
  scene.playChickenCluck(second, second.x, second.y);

  const events = clucks(scene);
  assert.equal(events.length, 2, '一只鸡的叫声不应吞掉另一只鸡的叫声');
  assert.notEqual(events[0].sourceId, events[1].sourceId, '每只鸡要有可区分的发声者 id');
  assert.equal(events[0].sourceId, 'chicken-1');
  assert.equal(events[1].sourceId, 'chicken-2');
});

test('同一只鸡的冷却独立计时，冷却前后的 sourceId 保持不变', () => {
  const scene = createScene();
  const chicken = new Chicken(320, 300, seededRandom(3));
  scene.chickens = [chicken];

  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  assert.equal(clucks(scene).length, 1);
  assert.equal(clucks(scene)[0].sourceId, 'chicken-1');

  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  assert.equal(clucks(scene).length, 1, '冷却时间内不重复发声');

  scene.updateChickenCluckCooldowns(0.5);
  scene.playChickenCluck(chicken, chicken.x, chicken.y);
  assert.equal(clucks(scene).length, 1, '冷却尚未走完');

  scene.updateChickenCluckCooldowns(0.41);
  assert.equal(scene.chickenCluckCooldowns.size, 0, '冷却归零后条目被清理');
  scene.playChickenCluck(chicken, chicken.x, chicken.y);

  const events = clucks(scene);
  assert.equal(events.length, 2);
  assert.equal(events[1].sourceId, 'chicken-1', '同一只鸡的 id 必须稳定');
});

test('远到听不见的鸡仍然发布世界事件，只是不占用音频声部', () => {
  const scene = createScene();
  const chicken = new Chicken(3000, 3000, seededRandom(4));
  scene.chickens = [chicken];

  scene.playChickenCluck(chicken, chicken.x, chicken.y);

  assert.equal(clucks(scene).length, 1, '世界事件不能因为玩家听不见而消失');
  assert.equal(scene.activeClucks.length, 0, '超出可听范围时不占用播放声部');
});

test('鸡叫事件的传播半径跟随音频配置，而不是 NoiseSystem 的 240 默认值', () => {
  const bare = new NoiseSystem();
  bare.emit('cluck', 0, 0);
  assert.equal(bare.getEvents()[0].radius, 240, '默认 profile 仍是 240');

  const scene = createScene();
  const chicken = new Chicken(320, 300, seededRandom(5));
  scene.chickens = [chicken];
  scene.playChickenCluck(chicken, chicken.x, chicken.y);

  assert.equal(scene.audio.chicken.range, 450);
  assert.equal(clucks(scene)[0].radius, scene.audio.chicken.range, '调用点要覆盖成音频可听范围');
});

test('叫声事件带原始响度，供听觉感知与涟漪共用', () => {
  const scene = createScene();
  const chicken = new Chicken(320, 300, seededRandom(6));
  scene.chickens = [chicken];
  scene.playChickenCluck(chicken, chicken.x, chicken.y);

  assert.equal(clucks(scene)[0].loudness, 0.45);
});
