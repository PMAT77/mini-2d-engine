import { Game } from "./core/Game";
import { MenuScene } from "./scenes/MenuScene";

const canvas = document.querySelector("canvas")!;
export const game = new Game(canvas);
game.sceneManager.changeScene(new MenuScene(), 0);
game.start();
