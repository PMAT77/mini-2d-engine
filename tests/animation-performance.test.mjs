import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const { Player } = load('objects/Player');
const { createPlayerRenderSnapshot, renderPlayerSnapshot } = load('objects/animation/PlayerVisualAdapter');
const { buildCharacterCommands } = load('animation2d/render/CharacterCanvasRenderer');

function createNoopContext() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return {
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
    rect: noop, fillRect: noop, closePath: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    fill: noop, stroke: noop, clearRect: noop, drawImage: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
}

function makePlayer() {
  const player = new Player(200, 200);
  player.currentRotation = Math.PI - 0.4;
  player.armLift = 1;
  player.armAngle = 0.4;
  player.armDistance = 120;
  player.runSwayWeight = 0.9;
  player.runSwayPhase = 2.1;
  player.idleTime = 0.83;
  player.rollDirection.set(Math.cos(0.7), Math.sin(0.7));
  return player;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(fn, iterations) {
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  return Number(process.hrtime.bigint() - started) / 1e6 / iterations;
}

test('rig renderer stays within the frame budget', () => {
  const player = makePlayer();
  const context = createNoopContext();
  const snapshot = createPlayerRenderSnapshot(player);
  const rigBuild = () => buildCharacterCommands(snapshot, 100, 100);
  const rigFull = () => renderPlayerSnapshot(context, createPlayerRenderSnapshot(player), 100, 100);

  // 预热 JIT，避免把编译时间算进预算。
  for (let i = 0; i < 2000; i++) { rigBuild(); rigFull(); }

  const samples = [];
  for (let round = 0; round < 5; round++) samples.push(measure(rigFull, 600));
  const rigMs = median(samples);
  const commands = rigBuild().length;

  console.log(`rig perf: ${rigMs.toFixed(4)} ms/frame, ${commands} commands`);

  assert.ok(commands > 80 && commands < 260, `unexpected command count: ${commands}`);
  // 绝对预算保持宽松：Node 微基准噪声大，这里防的是数量级退化（每帧建 Canvas/重复解析/深拷贝爆炸）。
  assert.ok(rigMs < 2, `rig renderer must stay under 2 ms/frame, got ${rigMs.toFixed(4)}`);
});

test('building a snapshot is read-only and stable across repeated calls', () => {
  const player = makePlayer();
  player.rollTimeLeft = player.roll.duration * 0.37;
  const before = player.getRenderState();
  const beforeWeapon = player.getWeaponView();
  const first = createPlayerRenderSnapshot(player);
  const second = createPlayerRenderSnapshot(player);
  const after = player.getRenderState();
  const afterWeapon = player.getWeaponView();

  assert.deepEqual(first, second);
  assert.equal(after.angle, before.angle);
  assert.equal(after.progress, before.progress);
  assert.equal(after.scale, before.scale);
  assert.equal(after.stowedAlpha, before.stowedAlpha);
  assert.equal(after.rolling, before.rolling);
  assert.deepEqual(afterWeapon, beforeWeapon);
  assert.equal(first.locals.locals.head.x, second.locals.locals.head.x);
});
