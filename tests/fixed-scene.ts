import { GameScene } from '../src/scenes/GameScene';
import { TileMap } from '../src/map/TileMap';
import type { Game } from '../src/core/Game';

/** The existing isolated renderer/UI tests declare their empty scene at construction.
 * Zombie integration tests use zombie-fixture.html with the default 4 enemies + 2 vaccines.
 */
export async function createFixedScene(game: Game, width: number, height: number, x = 400, y = 400, chickenCount = 0): Promise<GameScene> {
  const map = new TileMap(width, height, { seed: 817, generateWater: false });
  map.tiles.forEach(row => row.fill('default')); map.tileHp.forEach(row => row.fill(0)); map.invalidateNavigation();
  const scene = new GameScene({ map, seed: 817, playerSpawn: { x, y }, chickenCount, encounters: { shambler: 0, runner: 0, vaccines: 0 } });
  await scene.load(); game.sceneManager.changeScene(scene, 0);
  // onEnter's resource/canvas setup completes at the next microtask turn, without an rAF loop.
  await new Promise(resolve => setTimeout(resolve, 0));
  return scene;
}
