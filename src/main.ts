/**
 * 游戏主入口文件
 * 负责初始化游戏环境、创建场景并启动游戏循环
 */

// 导入核心游戏类
import { Game } from "./core/Game";
// 导入场景类
import { LoadingScene } from "./scenes/LoadingScene";
import { MenuScene } from "./scenes/MenuScene";

/**
 * 获取HTML中的canvas元素，用于游戏渲染
 * 使用非空断言操作符(!)确保canvas存在
 */
const canvas = document.querySelector("canvas")!;

/**
 * 创建游戏实例
 * 作为全局导出变量，便于在其他模块中访问游戏实例
 */
export const game = new Game(canvas);

/**
 * 创建游戏主菜单场景
 */
const menuScene = new MenuScene();

/**
 * 创建资源加载场景
 * @param resources 要加载的资源映射，键为资源ID，值为资源URL
 * @param targetScene 加载完成后要切换到的目标场景
 */
const loadingScene = new LoadingScene(
  {
  },
  menuScene // 加载完成后切换到主菜单场景
);

/**
 * 切换到加载场景
 * @param scene 目标场景实例
 * @param transitionTime 场景过渡时间（秒），0表示无过渡
 */
game.sceneManager.changeScene(loadingScene, 0);

/**
 * 启动游戏主循环
 * 开始游戏的更新和渲染流程
 */
game.start();