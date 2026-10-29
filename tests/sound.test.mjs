import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { SoundPlayer, LOOP_FADE_SECONDS, VOICE_STOP_FADE_SECONDS } = load('core/SoundPlayer');

/** 记录每个被创建的元素，用来检查声部轮换、循环标志和音量曲线。 */
class FakeAudio {
  constructor(url) {
    this.src = url;
    this.preload = '';
    this.volume = 1;
    this.playbackRate = 1;
    this.currentTime = 0;
    this.duration = NaN;
    this.loop = false;
    this.paused = true;
    this.ended = false;
    this.plays = 0;
    FakeAudio.instances.push(this);
  }
  play() {
    this.plays++;
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
FakeAudio.instances = [];

/** 用例内临时提供浏览器环境的 Audio，结束后恢复原状。 */
const withAudio = run => {
  const previous = globalThis.Audio;
  FakeAudio.instances = [];
  globalThis.Audio = FakeAudio;
  try {
    run();
  } finally {
    if (previous === undefined) delete globalThis.Audio;
    else globalThis.Audio = previous;
  }
};

test('一次性音效轮换声部，短间隔重复触发不打断前一声', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.play('/gun.wav', 0.6);
  sfx.play('/gun.wav', 0.6);
  assert.equal(FakeAudio.instances.length, 2, '默认两个声部');
  sfx.play('/gun.wav', 0.6);
  // 第三发回到第一个声部，此时它早已播完，可以安全重放。
  assert.equal(FakeAudio.instances[0].plays, 2);
  assert.equal(FakeAudio.instances[1].plays, 1);
}));

test('一次性音效把音量和速率夹在合法范围内', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.play('/gun.wav', 3, 99);
  const clip = FakeAudio.instances[0];
  assert.equal(clip.volume, 1);
  assert.equal(clip.playbackRate, 4);
  sfx.play('/gun.wav', -1, 0.01, { count: 1 });
  const single = FakeAudio.instances[2];
  assert.equal(single.volume, 0);
  assert.equal(single.playbackRate, 0.25);
}));

test('随机起播从采样内部的随机位置开始，默认仍从头播', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.play('/step.wav', 0.4, 1, { randomStart: true });
  const [first, second] = FakeAudio.instances;
  assert.equal(first.currentTime, 0, '时长还没读到时从头播');
  first.duration = 10;
  second.duration = 10;
  const previousRandom = Math.random;
  Math.random = () => 0.5;
  try {
    sfx.play('/step.wav', 0.4, 1, { randomStart: true });
  } finally {
    Math.random = previousRandom;
  }
  assert.equal(second.currentTime, 5, '0.5 × 10 秒');
  first.currentTime = 7;
  sfx.play('/step.wav', 0.4, 1);
  assert.equal(first.currentTime, 0, '不开随机时回到开头');
}));

test('一次性音效的句柄能持续改音量，声部被复用后旧句柄失效', () => withAudio(() => {
  const sfx = new SoundPlayer();
  const handle = sfx.play('/cluck.wav', 0.4, 1, { count: 1 });
  const [clip] = FakeAudio.instances;
  assert.equal(handle.isPlaying(), true, '刚开始播');
  handle.setVolume(0.1);
  assert.equal(clip.volume, 0.1, '播放中按距离改写音量');
  handle.setVolume(2);
  assert.equal(clip.volume, 1, '音量依旧夹在 0–1');

  clip.ended = true;
  assert.equal(handle.isPlaying(), false, '播放结束后句柄不再有效');

  const next = sfx.play('/cluck.wav', 0.3, 1, { count: 1 });
  handle.setVolume(0.9);
  assert.equal(clip.volume, 0.3, '旧句柄不能改被新触发复用的声部');
  next.setVolume(0.5);
  assert.equal(clip.volume, 0.5, '新句柄正常生效');
}));

test('循环音效整段 loop 播放，音量淡入且不会重复起播', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.loop('/water.wav', 0.4, 1.6);
  const clip = FakeAudio.instances.at(-1);
  assert.equal(clip.loop, true, '必须是整段循环，而不是一次性的脚步声');
  assert.equal(clip.volume, 0, '从静音开始淡入');
  assert.equal(clip.plays, 1);
  assert.equal(clip.paused, false);
  assert.equal(clip.playbackRate, 1.6);

  // 每帧重复设置同一个目标，只调整目标音量，不会把采样拨回开头。
  sfx.loop('/water.wav', 0.4, 1.6);
  sfx.loop('/water.wav', 0.4, 1.6);
  assert.equal(clip.plays, 1);
  assert.equal(FakeAudio.instances.length, 1);

  sfx.update(LOOP_FADE_SECONDS / 2);
  assert.ok(clip.volume > 0 && clip.volume < 0.4, `半程应处于淡入中，实际 ${clip.volume}`);
  sfx.update(LOOP_FADE_SECONDS);
  assert.equal(clip.volume, 0.4);
}));

test('目标音量归零后淡出并暂停，再次涉水重新淡入', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.loop('/water.wav', 0.4);
  sfx.update(LOOP_FADE_SECONDS);
  const clip = FakeAudio.instances.at(-1);
  assert.equal(clip.volume, 0.4);

  sfx.loop('/water.wav', 0);
  sfx.update(LOOP_FADE_SECONDS / 2);
  assert.ok(clip.volume > 0 && clip.volume < 0.4, '淡出需要经过中间值');
  assert.equal(clip.paused, false, '淡出过程中仍在播放');
  sfx.update(LOOP_FADE_SECONDS);
  assert.equal(clip.volume, 0);
  assert.equal(clip.paused, true, '归零后暂停元素');

  sfx.loop('/water.wav', 0.4);
  assert.equal(clip.paused, false);
  assert.equal(clip.currentTime, 0, '重新开始时从头播整段循环');
  assert.equal(clip.plays, 2);
}));

test('播放速率变化平缓，且很快落到新速度', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.loop('/water.wav', 0.4, 1);
  const clip = FakeAudio.instances.at(-1);
  sfx.loop('/water.wav', 0.4, 1.001);
  assert.equal(clip.playbackRate, 1, '微小抖动不改写速率');
  sfx.loop('/water.wav', 0.4, 1.6);
  assert.equal(clip.playbackRate, 1.6);
  sfx.loop('/water.wav', 0.4, 0.1);
  assert.equal(clip.playbackRate, 0.25, '速率下限保护');
}));

test('stopLoops 立即静音并暂停，离开场景不会残留声音', () => withAudio(() => {
  const sfx = new SoundPlayer();
  sfx.loop('/water.wav', 0.4);
  sfx.update(LOOP_FADE_SECONDS);
  const clip = FakeAudio.instances.at(-1);
  sfx.stopLoops();
  assert.equal(clip.volume, 0);
  assert.equal(clip.paused, true);
  sfx.update(LOOP_FADE_SECONDS);
  assert.equal(clip.paused, true);
}));

test('句柄 stop 会先淡出再暂停，停下的这一声立刻失效', () => withAudio(() => {
  const sfx = new SoundPlayer();
  const handle = sfx.play('/cluck.wav', 0.6, 1, { count: 1 });
  const [clip] = FakeAudio.instances;
  handle.stop();
  assert.equal(handle.isPlaying(), false, 'stop 之后句柄立即失效，逐帧音量更新不会再动它');
  assert.equal(clip.paused, false, '先淡出 80 毫秒，不该在半截音节上硬切出爆音');

  handle.setVolume(0.9);
  assert.equal(clip.volume, 0.6, '失效的句柄不能把音量推回去');

  sfx.update(VOICE_STOP_FADE_SECONDS / 2);
  assert.ok(clip.volume > 0 && clip.volume < 0.6, `淡出半程应低于原音量，实际 ${clip.volume}`);
  assert.equal(clip.paused, false);
  sfx.update(VOICE_STOP_FADE_SECONDS);
  assert.equal(clip.volume, 0);
  assert.equal(clip.paused, true, '淡完暂停元素');
  assert.equal(clip.currentTime, 0, '元素复位，下次触发从头播');
}));

test('stop 传 0 直接暂停；声部被重新触发时取消未完成的淡出', () => withAudio(() => {
  const sfx = new SoundPlayer();
  const hard = sfx.play('/cluck.wav', 0.5, 1, { count: 1 });
  const [cluck] = FakeAudio.instances;
  hard.stop(0);
  assert.equal(cluck.paused, true);
  assert.equal(cluck.volume, 0);

  const soft = sfx.play('/step.wav', 0.4, 1, { count: 1 });
  const step = FakeAudio.instances[1];
  soft.stop();
  sfx.update(VOICE_STOP_FADE_SECONDS / 2);
  assert.ok(step.volume > 0 && step.volume < 0.4);

  // 淡出还没走完就复用这个声部：新的一声必须恢复满音量，不能继承淡出中的低音量。
  sfx.play('/step.wav', 0.4, 1, { count: 1 });
  assert.equal(step.volume, 0.4, '重新触发取消旧淡出');
  sfx.update(1);
  assert.equal(step.volume, 0.4, '旧淡出不会在之后继续压低音量');
  assert.equal(step.paused, false);
}));

test('没有 Audio 的 Node 环境里所有播放静默跳过', () => {
  const previous = globalThis.Audio;
  delete globalThis.Audio;
  try {
    const sfx = new SoundPlayer();
    assert.doesNotThrow(() => {
      sfx.play('/a.wav', 1);
      sfx.loop('/b.wav', 1, 1.2);
      sfx.update(0.016);
      sfx.stopLoops();
    });
  } finally {
    if (previous !== undefined) globalThis.Audio = previous;
  }
});
