import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { CONFIG_CONTROLS, DEBUG_SECTIONS, DEBUG_TABS, PLAYER_DEBUG_EXCLUSIONS } = load('ui/debugSchema');
const { PLAYER_CONFIG_GROUPS, parsePlayerConfig } = load('objects/PlayerConfig');
const { DEFAULT_GRAPHICS_CONFIG, parseGraphicsConfig } = load('core/GraphicsConfig');
const { DEFAULT_AUDIO_CONFIG, parseAudioConfig } = load('core/AudioConfig');
const { Player } = load('objects/Player');

const tabs = new Set(DEBUG_TABS.map(entry => entry.id));
const sections = new Map(DEBUG_SECTIONS.map(entry => [entry.id, entry]));
const exclusions = new Set(PLAYER_DEBUG_EXCLUSIONS.map(entry => entry.path));
const snapshot = new Player(0, 0).getConfigSnapshot();

/** 递归收集纯数据叶子，返回 `group.key...` 形式的路径。 */
function leaves(value, prefix = '') {
  const paths = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object') paths.push(...leaves(entry, path));
    else paths.push(path);
  }
  return paths;
}

function readPath(source, path) {
  return path.split('.').reduce((value, key) => value[key], source);
}

const playerDefaults = {
  ...snapshot,
  collider: { radius: snapshot.collider.radius },
};

function controlPaths(control) {
  if (control.domain === 'player') {
    const groups = control.group === 'activeFirearm' ? ['shooting', 'primaryShooting'] : [control.group];
    return groups.map(group => `${group}.${control.key}`);
  }
  if (control.domain === 'graphics') return [`${control.group}.${control.key}`];
  return [control.group ? `${control.group}.${control.key}` : control.key];
}

function defaultPaths() {
  const player = Object.entries(PLAYER_CONFIG_GROUPS)
    .flatMap(([group, keys]) => keys.map(key => `${group}.${key}`))
    .concat('collider.radius')
    .filter(path => !exclusions.has(path));
  return {
    player,
    graphics: leaves(DEFAULT_GRAPHICS_CONFIG),
    audio: leaves(DEFAULT_AUDIO_CONFIG),
  };
}

function panelPaths() {
  const result = { player: [], graphics: [], audio: [] };
  for (const control of CONFIG_CONTROLS) result[control.domain].push(...controlPaths(control));
  return result;
}

test('every configurable leaf and every debug control match one-to-one', () => {
  const expected = defaultPaths();
  const actual = panelPaths();
  for (const domain of ['player', 'graphics', 'audio']) {
    const unique = new Set(actual[domain]);
    assert.equal(unique.size, actual[domain].length, `${domain} 调试控件重复: ${actual[domain].filter((path, index) => actual[domain].indexOf(path) !== index)}`);
    assert.deepEqual([...unique].sort(), [...new Set(expected[domain])].sort(), `${domain} 配置项与调试控件不一致`);
  }
});

test('exclusions stay parsed but hidden and documented', () => {
  const player = defaultPaths().player;
  for (const entry of PLAYER_DEBUG_EXCLUSIONS) {
    assert.ok(entry.reason && entry.reason.trim().length > 0, `${entry.path} 缺少排除理由`);
    assert.ok(!player.includes(entry.path), `${entry.path} 既被排除又在期望集合中`);
    const [group, ...rest] = entry.path.split('.');
    const keys = PLAYER_CONFIG_GROUPS[group];
    assert.ok(keys && keys.includes(rest.join('.')), `${entry.path} 已不在解析器白名单里，请删除排除项`);
    const value = readPath(playerDefaults, entry.path);
    const key = rest.join('.');
    if (value !== undefined) {
      assert.equal(typeof value, 'number', `${entry.path} 默认值不是数值`);
      assert.doesNotThrow(() => parsePlayerConfig({ [group]: { [key]: value } }), `${entry.path} 的默认值必须仍被解析器接受`);
    } else {
      assert.doesNotThrow(() => parsePlayerConfig({ [group]: { [key]: 0.2 } }), `${entry.path} 仍是解析器接受的兼容字段`);
    }
  }
});

test('controls carry valid ids, ranges, steps and select options', () => {
  const seen = new Set();
  for (const control of CONFIG_CONTROLS) {
    const ids = controlPaths(control).map(path => `${control.domain}:${path}`);
    for (const id of ids) {
      assert.ok(!seen.has(id), `调试控件重复: ${id}`);
      seen.add(id);
    }
    const section = sections.get(control.section);
    assert.ok(section, `未知分区: ${control.section}`);
    assert.equal(control.tab, section.tab, `${control.section} 的 tab 与控件不一致`);
    assert.ok(tabs.has(control.tab), `未知 tab: ${control.tab}`);
    assert.ok(control.label && control.label.trim(), `控件 ${control.group}.${control.key} 缺少标签`);

    for (const path of controlPaths(control)) {
      const source = control.domain === 'player' ? playerDefaults
        : control.domain === 'graphics' ? DEFAULT_GRAPHICS_CONFIG : DEFAULT_AUDIO_CONFIG;
      const value = readPath(source, path);
      assert.ok(value !== undefined, `找不到 ${control.domain}.${path} 的默认值`);

      if (control.kind === 'number') {
        assert.equal(typeof value, 'number', `${control.domain}.${path} 默认值不是数值`);
        assert.ok(typeof control.min === 'number', `${control.domain}.${path} 缺少最小值`);
        assert.ok(typeof control.step === 'number' && control.step > 0, `${control.domain}.${path} 步长必须大于 0`);
        assert.ok(value >= control.min, `${control.domain}.${path} 默认值 ${value} 小于最小值 ${control.min}`);
        assert.ok(typeof control.max === 'number' && control.max > control.min,
          `${control.domain}.${path} 缺少有效最大值（滑条需要）`);
        assert.ok(value <= control.max, `${control.domain}.${path} 默认值 ${value} 大于最大值 ${control.max}`);
      } else if (control.kind === 'color') {
        assert.match(value, /^#[0-9A-F]{6}$/, `${control.domain}.${path} 默认颜色不合法`);
      } else {
        assert.ok(Array.isArray(control.options) && control.options.length > 0, `${control.domain}.${path} 缺少选项`);
        const values = control.options.map(option => option.value);
        assert.equal(new Set(values).size, values.length, `${control.domain}.${path} 选项重复`);
        assert.ok(values.includes(value), `${control.domain}.${path} 默认值 ${value} 不在选项里`);
      }
    }
  }
});

test('parser accepts every player control default and rejects out-of-range values', () => {
  for (const control of CONFIG_CONTROLS.filter(entry => entry.domain === 'player')) {
    for (const path of controlPaths(control)) {
      const [group, key] = path.split('.');
      const value = readPath(playerDefaults, path);
      const patch = group === 'collider'
        ? { collider: { type: 'circle', radius: value, center: [0, 0] } }
        : { [group]: { [key]: value } };
      assert.doesNotThrow(() => parsePlayerConfig(patch), `${path} 默认值应被接受`);
    }
  }
  assert.throws(() => parsePlayerConfig({ base: { maxHealth: 0 } }));
  assert.throws(() => parsePlayerConfig({ shooting: { damage: -1 } }));
  assert.throws(() => parsePlayerConfig({ collider: { type: 'circle', radius: 0, center: [0, 0] } }));
  assert.throws(() => parsePlayerConfig({ base: { rotationStrategy: 'spin' } }));
});

test('config files load and graphics/audio parsers merge defaults', () => {
  for (const file of ['playerConfig', 'graphicsConfig', 'audioConfig']) {
    const url = new URL(`../public/configs/${file}.json`, import.meta.url);
    const value = JSON.parse(readFileSync(url, 'utf8'));
    if (file === 'playerConfig') assert.doesNotThrow(() => parsePlayerConfig(value));
    if (file === 'graphicsConfig') assert.deepEqual(parseGraphicsConfig(value), DEFAULT_GRAPHICS_CONFIG);
    if (file === 'audioConfig') assert.deepEqual(parseAudioConfig(value), DEFAULT_AUDIO_CONFIG);
  }
  assert.deepEqual(parseGraphicsConfig({}), DEFAULT_GRAPHICS_CONFIG);
  assert.deepEqual(parseAudioConfig({}), DEFAULT_AUDIO_CONFIG);
  assert.equal(parseGraphicsConfig({ flashlight: { angle: 90 } }).flashlight.angle, 90);
  assert.equal(parseAudioConfig({ master: 0 }).master, 0);
  assert.throws(() => parseGraphicsConfig({ camera: { zoom: 0.1 } }));
  assert.throws(() => parseGraphicsConfig({ ambient: { color: 'red' } }));
  assert.throws(() => parseGraphicsConfig({ flashlight: { angle: 0 } }));
  assert.throws(() => parseAudioConfig({ master: 2 }));
  assert.throws(() => parseAudioConfig({ chicken: { range: -1 } }));
  assert.throws(() => parseAudioConfig({ camera: {} }));
});
