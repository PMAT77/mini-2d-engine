import { Game } from "./core/Game";
import { MenuScene } from "./scenes/MenuScene";

declare global {
  interface Window {
    /** 入口模块可能被以不同 URL（开发服务器的 `?t=` 版本串）执行多次，用它保证全局只有一个游戏实例。 */
    __miniGame?: Game;
  }
}

const canvas = document.querySelector("canvas")!;

/**
 * 复用已经启动的实例。
 *
 * Vite 开发服务器会给入口脚本加上 `?t=` 查询串，测试脚本里 `import('/src/main.ts')`
 * 因此会再执行一次本模块。若直接 `new Game()`，同一页面里会出现两个游戏循环、
 * 两套场景和两套准星图层：帧率减半，`document.querySelector` 还可能取到旧图层。
 * 生产构建只有一个 URL，行为与原来一致。
 */
export const game = window.__miniGame ?? new Game(canvas);

if (!window.__miniGame) {
  window.__miniGame = game;
  game.sceneManager.changeScene(new MenuScene(), 0);
  game.start();
}
