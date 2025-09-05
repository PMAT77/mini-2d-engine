/**
 * 配置映射类型定义 - 将配置名称映射到配置路径
 */
export type ConfigMap = Record<string, string>; // 名称 -> 路径

/**
 * 配置加载器类
 * 负责加载、缓存和管理游戏中的配置文件
 */
export class ConfigLoader {
  /**
   * 配置缓存 - 存储已加载的配置文件
   * @private
   */
  private static configCache: Record<string, any> = {};

  /**
   * 加载状态Promise缓存 - 用于处理重复加载请求
   * @private
   */
  private static loadingPromises: Record<string, Promise<any> | undefined> = {};

  /**
   * 存储需要加载的配置映射
   * @private
   */
  private configs: ConfigMap = {};

  /**
   * 实例配置缓存
   * @private
   */
  private instanceConfigCache: Record<string, any> = {};

  /**
   * 构造函数
   * @param configs 需要加载的配置映射表
   */
  constructor(configs: ConfigMap = {}) {
    this.configs = configs;
  }

  /**
   * 加载所有配置
   * @param onProgress 加载进度回调函数，接收已加载数量和总数量两个参数
   * @returns Promise<void> 加载完成时解析的Promise
   */
  async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const entries = Object.entries(this.configs);
    const total = entries.length;
    let loaded = 0;

    const updateProgress = () => {
      loaded++;
      onProgress?.(loaded, total);
    };

    const promises = entries.map(([key, url]) =>
      ConfigLoader.loadConfig(url).then(config => {
        this.instanceConfigCache[key] = config;
        updateProgress();
        return config;
      }).catch(error => {
        console.error(`配置加载失败: ${url}`, error);
        updateProgress();
        return null;
      })
    );

    await Promise.all(promises);
    console.log(`配置加载完成: 共 ${total} 个配置`);
  }

  /**
   * 获取已加载的配置
   * @param key 配置的名称
   * @returns any | undefined 加载的配置数据，如果不存在则返回undefined
   */
  getConfig(key: string): any | undefined {
    const config = this.instanceConfigCache[key];
    if (!config) {
      console.warn(`未找到配置: ${key}`);
    }
    return config;
  }

  /**
   * 添加配置到加载列表
   * @param key 配置名称
   * @param url 配置文件路径
   */
  addConfig(key: string, url: string): void {
    this.configs[key] = url;
  }

  /**
   * 移除配置从加载列表
   * @param key 配置名称
   */
  removeConfig(key: string): void {
    delete this.configs[key];
    delete this.instanceConfigCache[key];
  }

  /**
   * 异步加载JSON配置文件（静态方法）
   * @param url 配置文件的URL路径
   * @param forceReload 是否强制重新加载，默认为false
   * @returns Promise<any> 配置数据的Promise
   */
  public static async loadConfig(url: string, forceReload: boolean = false): Promise<any> {
    // 检查是否已加载且不需要强制重新加载
    if (this.configCache[url] && !forceReload) {
      return Promise.resolve(this.configCache[url]);
    }

    // 检查是否已有加载请求正在进行
    if (this.loadingPromises[url] !== undefined) {
      return this.loadingPromises[url];
    }

    // 创建新的加载Promise
    this.loadingPromises[url] = new Promise<any>(async (resolve, reject) => {
      try {
        // 发送请求获取配置文件
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`无法加载配置文件: ${url}, 状态码: ${response.status}`);
        }

        // 解析JSON数据
        const config = await response.json();

        // 缓存配置数据
        this.configCache[url] = config;
        resolve(config);
      } catch (error) {
        console.error(`配置文件加载失败: ${url}`, error);
        reject(error);
      } finally {
        // 移除加载状态Promise
        delete this.loadingPromises[url];
      }
    });

    return this.loadingPromises[url];
  }

  /**
   * 批量加载多个配置文件（静态方法）
   * @param urls 配置文件的URL路径数组
   * @param onProgress 加载进度回调函数
   * @returns Promise<any[]> 包含所有配置数据的Promise数组
   */
  public static async loadConfigs(urls: string[], onProgress?: (loaded: number, total: number) => void): Promise<any[]> {
    const total = urls.length;
    let loaded = 0;

    const updateProgress = () => {
      loaded++;
      onProgress?.(loaded, total);
    };

    const promises = urls.map(url =>
      this.loadConfig(url).then(config => {
        updateProgress();
        return config;
      }).catch(error => {
        updateProgress();
        return null;
      })
    );

    return Promise.all(promises);
  }

  /**
   * 获取已加载的配置文件（静态方法）
   * @param url 配置文件的URL路径
   * @returns any | null 配置数据，如果未加载则返回null
   */
  public static getConfig(url: string): any | null {
    return this.configCache[url] || null;
  }

  /**
   * 检查配置文件是否已加载（静态方法）
   * @param url 配置文件的URL路径
   * @returns boolean 是否已加载
   */
  public static hasConfig(url: string): boolean {
    return url in this.configCache;
  }

  /**
   * 清除指定配置文件的缓存（静态方法）
   * @param url 配置文件的URL路径，如果为空则清除所有缓存
   */
  public static clearCache(url?: string): void {
    if (url) {
      delete this.configCache[url];
      console.log(`配置缓存已清除: ${url}`);
    } else {
      this.configCache = {};
      console.log('所有配置缓存已清除');
    }
  }

  /**
   * 获取缓存的配置文件数量（静态方法）
   * @returns number 缓存的配置文件数量
   */
  public static getCacheSize(): number {
    return Object.keys(this.configCache).length;
  }

  /**
   * 获取一个默认的空配置对象（静态方法）
   * @returns 空配置对象
   */
  public static getEmptyConfig(): Record<string, any> {
    return {};
  }
}