/**
 * 资源映射类型定义 - 将资源名称映射到资源路径
 */
export type AssetMap = Record<string, string>; // 名称 -> 路径

/**
 * 资源加载器类
 * 负责加载和管理游戏中的图片和音频资源
 */
export class AssetLoader {
  /**
   * 存储已加载的图片资源
   * @private
   */
  private images: Record<string, HTMLImageElement> = {};

  /**
   * 存储已加载的音频资源
   * @private
   */
  private audios: Record<string, HTMLAudioElement> = {};

  /**
   * 构造函数
   * @param assets 需要加载的资源映射表
   */
  constructor(private assets: AssetMap) { }

  /**
   * 加载所有资源
   * @param onProgress 加载进度回调函数，接收已加载数量和总数量两个参数
   * @returns Promise<void> 加载完成时解析的Promise
   */
  async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const entries = Object.entries(this.assets);
    const total = entries.length;
    let loaded = 0;

    const promises = entries.map(async ([key, url]) => {
      const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
      if (!ext) {
        throw new Error(`无法识别资源扩展名: ${url}`);
      }

      if (this.isImageExtension(ext)) {
        return this.loadImage(key, url, () => {
          loaded++;
          onProgress?.(loaded, total);
        });
      } else if (this.isAudioExtension(ext)) {
        return this.loadAudio(key, url, () => {
          loaded++;
          onProgress?.(loaded, total);
        });
      } else {
        throw new Error(`不支持的资源类型: ${url}`);
      }
    });

    return Promise.all(promises).then(() => {
      console.log(`资源加载完成: 共 ${total} 个资源`);
    });
  }

  /**
   * 获取已加载的图片资源
   * @param key 图片资源的名称
   * @returns HTMLImageElement | undefined 加载的图片元素，如果不存在则返回undefined
   */
  getImage(key: string): HTMLImageElement | undefined {
    const image = this.images[key];
    if (!image) {
      console.warn(`未找到图片资源: ${key}`);
    }
    return image;
  }

  /**
   * 获取已加载的音频资源
   * @param key 音频资源的名称
   * @returns HTMLAudioElement | undefined 加载的音频元素，如果不存在则返回undefined
   */
  getAudio(key: string): HTMLAudioElement | undefined {
    const audio = this.audios[key];
    if (!audio) {
      console.warn(`未找到音频资源: ${key}`);
    }
    return audio;
  }

  /**
   * 检查扩展名是否为支持的图片格式
   * @private
   * @param ext 文件扩展名
   * @returns boolean 是否为图片扩展名
   */
  private isImageExtension(ext: string): boolean {
    return ['png', 'jpg', 'jpeg', 'gif'].includes(ext);
  }

  /**
   * 检查扩展名是否为支持的音频格式
   * @private
   * @param ext 文件扩展名
   * @returns boolean 是否为音频扩展名
   */
  private isAudioExtension(ext: string): boolean {
    return ['mp3', 'wav', 'ogg'].includes(ext);
  }

  /**
   * 加载单个图片资源
   * @private
   * @param key 资源名称
   * @param url 资源URL
   * @param onLoad 加载完成回调
   * @returns Promise<void> 加载完成时解析的Promise
   */
  private loadImage(key: string, url: string, onLoad: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.images[key] = img;
        onLoad();
        resolve();
      };
      img.onerror = () => {
        reject(new Error(`图片加载失败: ${url}`));
      };
      img.src = url;
    });
  }

  /**
   * 加载单个音频资源
   * @private
   * @param key 资源名称
   * @param url 资源URL
   * @param onLoad 加载完成回调
   * @returns Promise<void> 加载完成时解析的Promise
   */
  private loadAudio(key: string, url: string, onLoad: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      audio.onloadeddata = () => {
        this.audios[key] = audio;
        onLoad();
        resolve();
      };
      audio.onerror = () => {
        reject(new Error(`音频加载失败: ${url}`));
      };
      audio.src = url;
    });
  }
}