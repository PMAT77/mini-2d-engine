/** 循环音效从当前音量淡到目标音量的时长（秒），避免起停时的爆音。 */
export const LOOP_FADE_SECONDS = 0.12;

/** 一次性音效被主动掐断时默认的淡出时长（秒）：80 毫秒既听不出延迟，又不会爆音。 */
export const VOICE_STOP_FADE_SECONDS = 0.08;

/** 一次播放的句柄：让音量能持续跟随声源距离，而不是在触发那一刻定死。 */
export interface SoundHandle {
  /** 改写这一声的音量；声部被下一次触发复用后调用无效。 */
  setVolume(volume: number): void;
  /** 这一声是否还在响；播放结束、被复用或被 stop 之后为 false。 */
  isPlaying(): boolean;
  /**
   * 立刻停掉这一声。默认 80 毫秒淡出后暂停，避免在半截音节上硬切出爆音；
   * 传 0 表示完全硬停。调用后句柄立即失效，声部可以马上被下一次触发复用。
   */
  stop(fadeSeconds?: number): void;
}

/** 一次性音效的可选播放方式。 */
export interface PlayOptions {
  /** 同时可叠放的声部数；1 表示后一声打断前一声。默认 2。 */
  count?: number;
  /** 从采样内部的随机位置起播：录音本身包含多次脚步时，每次取不同的一截。 */
  randomStart?: boolean;
  /**
   * 从采样内的固定秒数起播：用来跳过录音开头的静音，或让长采样跟着游戏状态推进；
   * 超过时长会被夹到采样末尾之前。
   */
  startAt?: number;
}

interface LoopVoice {
  clip: HTMLAudioElement;
  /** 当前音量，每帧向 target 逼近。 */
  volume: number;
  /** 目标音量；0 表示淡出后暂停。 */
  target: number;
  /** 当前过渡的音量变化速度（每秒），按起止音量差与固定淡入淡出时长换算。 */
  fade: number;
  rate: number;
  playing: boolean;
}

/**
 * 音效播放器：一次性音效走轮换声部，循环音效走单个持久元素。
 *
 * 一次性音效维护一小撮轮换的 Audio 元素：短间隔重复触发时前一声自然收尾、不会被打断，
 * 同时元素数量有上限，不会为每颗子弹新建一个音频节点。
 * 循环音效（涉水行走这类持续采样）整段 loop 播放，音量按帧平滑过渡，
 * 不会因为每帧重新触发而被截成碎片。
 * Node 单元测试环境没有 Audio，所有播放静默跳过。
 */
export class SoundPlayer {
  /** 一次性音效：url -> 轮换的元素池、每个声部的复用代数与下一个待用下标 */
  private readonly voices = new Map<string, { clips: HTMLAudioElement[]; generations: number[]; next: number }>();
  /** 循环音效：url -> 单个元素与当前/目标音量 */
  private readonly loops = new Map<string, LoopVoice>();
  /** 正在淡出的声部：元素 -> 淡出起点音量与剩余时间（按元素而非句柄记录，声部复用即取消） */
  private readonly stops = new Map<HTMLAudioElement, { from: number; duration: number; remaining: number }>();

  /**
   * 播放一次音效。
   * @param url 音频地址
   * @param volume 0–1 音量
   * @param rate 播放速率，用于给重复的脚步声做轻微随机化
   * @param options 声部数量与是否从随机位置起播
   * @returns 这一次播放的句柄；没有 Audio 的环境返回 null
   */
  play(url: string, volume: number, rate = 1, options: PlayOptions = {}): SoundHandle | null {
    if (typeof Audio === "undefined") return null;
    const count = Math.max(1, Math.floor(options.count ?? 2));
    let voice = this.voices.get(url);
    if (!voice || voice.clips.length !== count) {
      voice = {
        clips: Array.from({ length: count }, () => {
          const clip = new Audio(url);
          clip.preload = "auto";
          return clip;
        }),
        generations: Array.from({ length: count }, () => 0),
        next: 0,
      };
      this.voices.set(url, voice);
    }
    const pool = voice;
    const index = pool.next++ % pool.clips.length;
    const generation = ++pool.generations[index];
    const clip = pool.clips[index];
    // 这一声重新开始时，元素上可能还挂着上一声的淡出，必须先取消，否则会被继续压低。
    this.stops.delete(clip);
    clip.volume = clamp01(volume);
    clip.playbackRate = clampRate(rate);
    clip.currentTime = options.randomStart ? randomStartOffset(clip) : startOffset(clip, options.startAt);
    void clip.play().catch(() => { /* 上一次播放被打断或尚未加载完 */ });
    return {
      setVolume: (value: number) => {
        // 声部被下一次触发顶掉后，旧句柄不该再把音量写到别人的播放上。
        if (pool.generations[index] === generation) clip.volume = clamp01(value);
      },
      isPlaying: () => pool.generations[index] === generation && !clip.ended,
      stop: (fadeSeconds = VOICE_STOP_FADE_SECONDS) => {
        if (pool.generations[index] !== generation) return;
        // 先让句柄失效，停的这一声不会再被音量的逐帧更新影响。
        pool.generations[index] += 1;
        const fade = Number.isFinite(fadeSeconds) ? Math.max(0, fadeSeconds) : 0;
        if (fade === 0) {
          this.stops.delete(clip);
          clip.volume = 0;
          clip.pause();
          clip.currentTime = 0;
          return;
        }
        this.stops.set(clip, { from: clip.volume, duration: fade, remaining: fade });
      },
    };
  }

  /**
   * 设置循环音效的目标音量。每帧用同一 url 调用即可跟随游戏状态：
   * volume > 0 时淡入并持续整段循环，volume 为 0 时淡出后暂停。
   * @param url 音频地址
   * @param volume 目标音量 0–1
   * @param rate 播放速率；跟移动速度成正比时，循环采样里的脚步节拍才不会和实际步伐脱节
   */
  loop(url: string, volume: number, rate = 1): void {
    if (typeof Audio === "undefined") return;
    let voice = this.loops.get(url);
    if (!voice) {
      const clip = new Audio(url);
      clip.preload = "auto";
      // 整段采样循环播放：音效文件本身就是一段可无缝衔接的行走录音。
      clip.loop = true;
      voice = { clip, volume: 0, target: 0, fade: 0, rate: 1, playing: false };
      this.loops.set(url, voice);
    }

    const nextTarget = clamp01(volume);
    if (nextTarget !== voice.target) {
      // 目标变了才重算过渡速度：不管目标音量多小，淡入淡出都固定用 LOOP_FADE_SECONDS。
      voice.fade = Math.abs(nextTarget - voice.volume) / LOOP_FADE_SECONDS;
      voice.target = nextTarget;
    }
    const nextRate = clampRate(rate);
    // 只在明显变化时改写速率，避免每帧刷新造成音高抖动。
    if (Math.abs(nextRate - voice.rate) > 0.005) {
      voice.rate = nextRate;
      voice.clip.playbackRate = nextRate;
    }

    if (voice.target > 0 && !voice.playing) {
      voice.playing = true;
      voice.volume = 0;
      voice.clip.volume = 0;
      voice.clip.currentTime = 0;
      void voice.clip.play().catch(() => { voice.playing = false; });
    }
  }

  /** 按帧推进循环音效的淡入淡出；降到 0 后暂停元素，不留下半截尾音。 */
  update(delta: number): void {
    if (!(delta > 0)) return;
    for (const voice of this.loops.values()) {
      const step = voice.fade * delta;
      if (voice.volume < voice.target) voice.volume = Math.min(voice.target, voice.volume + step);
      else if (voice.volume > voice.target) voice.volume = Math.max(voice.target, voice.volume - step);
      voice.clip.volume = voice.volume;
      if (voice.playing && voice.target === 0 && voice.volume === 0) {
        voice.playing = false;
        voice.clip.pause();
        voice.clip.currentTime = 0;
      }
    }
    // 被 stop 掐断的一次性音效：按剩余时间线性降到 0，再暂停元素。
    for (const [clip, stop] of this.stops) {
      stop.remaining = Math.max(0, stop.remaining - delta);
      if (stop.remaining === 0) {
        this.stops.delete(clip);
        clip.volume = 0;
        clip.pause();
        clip.currentTime = 0;
      } else {
        clip.volume = clamp01(stop.from * (stop.remaining / stop.duration));
      }
    }
  }

  /** 立即停掉所有循环音效，离开场景时用。 */
  stopLoops(): void {
    for (const voice of this.loops.values()) {
      voice.target = 0;
      voice.volume = 0;
      voice.clip.volume = 0;
      voice.playing = false;
      voice.clip.pause();
      voice.clip.currentTime = 0;
    }
  }
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const clampRate = (value: number): number => (Number.isFinite(value) ? Math.max(0.25, Math.min(4, value)) : 1);
/** 起播点：读完采样时长才随机；元数据没到或流式音频（Infinity）时从头播。 */
const randomStartOffset = (clip: HTMLAudioElement): number =>
  Number.isFinite(clip.duration) && clip.duration > 0 ? Math.random() * clip.duration : 0;

/** 指定起播秒数；时长未知时不冒险跳播，夹在采样内部避免落到末尾静音。 */
const startOffset = (clip: HTMLAudioElement, seconds: number | undefined): number => {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return 0;
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) return 0;
  return Math.min(seconds as number, Math.max(0, clip.duration - 0.01));
};
