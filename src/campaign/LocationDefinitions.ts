import { TileMap } from '../map/TileMap';
import { TileTypeId } from '../map/TileType';
import { ZOMBIE_CONFIG } from '../enemies/ZombieConfig';
import type { LocationId, LocationState, Pose } from './CampaignState';

export const CAMPAIGN_DEFINITION_VERSION = 'prototype-campaign-v1';
export const LOCATION_DEFINITIONS: Record<LocationId, {
  name: string; width: number; height: number; entrance: Pose; destination: LocationId;
  facilityLights?: readonly { x: number; y: number; radius: number; intensity: number; color: string; sourceRadius: number }[];
}> = {
  outpost: { name: '营地', width: 24, height: 20, entrance: { position: { x: 325.5, y: 475.5 }, facing: 0 }, destination: 'residential',
    facilityLights: [{ x: 350, y: 400, radius: 230, intensity: .85, color: '#FFD59B', sourceRadius: 10 },
      { x: 750, y: 450, radius: 230, intensity: .85, color: '#FFD59B', sourceRadius: 10 }] },
  residential: { name: '废弃住宅区', width: 36, height: 24, entrance: { position: { x: 125.5, y: 475.5 }, facing: 0 }, destination: 'outpost' },
};

/** P1 验证地图：少量显式内容，不启用尚无持久契约的小鸡、火把、交易站。 */
export function createLocationMap(id: LocationId, seed: number): TileMap {
  const d = LOCATION_DEFINITIONS[id], map = new TileMap(d.width, d.height, { seed, generateWater: false });
  for (let row = 0; row < d.height; row++) for (let col = 0; col < d.width; col++) {
    map.tiles[row][col] = row === 0 || col === 0 || row === d.height - 1 || col === d.width - 1 ? TileTypeId.WALL : TileTypeId.DEFAULT;
    map.tileHp[row][col] = 0;
  }
  if (id === 'residential') {
    for (const [x, y] of [[9, 3], [22, 14]]) {
      for (let row = y; row <= y + 5; row++) for (let col = x; col <= x + 6; col++) {
        if ((row === y || row === y + 5 || col === x || col === x + 6) && !(row === y + 5 && col === x + 3))
          map.tiles[row][col] = TileTypeId.WALL;
      }
    }
  }
  const minerals = id === 'outpost' ? [[16, 10], [17, 10]] : [[14, 12], [15, 12], [25, 9], [26, 9]];
  for (const [col, row] of minerals) { map.tiles[row][col] = TileTypeId.MINERAL; map.tileHp[row][col] = 100; }
  map.invalidateNavigation();
  return map;
}

export function initializeLocation(state: LocationState, day: number): LocationState {
  if (state.definitionVersion !== CAMPAIGN_DEFINITION_VERSION) throw new Error('地点内容版本不匹配');
  if (state.initialized) return state;
  const result: LocationState = { ...state, initialized: true, lastVisitedDay: day, spawns: {}, containers: {},
    groundItems: [], terrainChanges: [], exploration: null, structures: [] };
  if (state.locationId === 'residential') {
    for (const [name, kind, x, y] of [
      ['street-west', 'shambler', 825, 525], ['street-east', 'shambler', 1425, 575], ['yard', 'runner', 975, 975],
    ] as const) {
      const spawnId = state.locationId + '/' + name, size = ZOMBIE_CONFIG[kind].size;
      result.spawns[spawnId] = { spawnId, generation: 0, lastRefreshDay: day,
        occupant: { kind: 'enemy', value: { instanceId: spawnId + '/g0', kind, hp: ZOMBIE_CONFIG[kind].maxHealth,
          pose: { position: { x: x - size / 2, y: y - size / 2 }, facing: Math.PI } } } };
    }
    for (const [name, itemId, x, y] of [
      ['clinic-vaccine', 'vaccine', 350, 475], ['street-grenade', 'grenade', 625, 525], ['yard-smoke', 'smokeGrenade', 950, 875],
    ] as const) {
      const spawnId = state.locationId + '/' + name;
      result.spawns[spawnId] = { spawnId, generation: 0, lastRefreshDay: day,
        occupant: { kind: 'loot', value: { instanceId: spawnId + '/g0', position: { x, y },
          item: { kind: 'consumable', itemId, quantity: 1 } } } };
    }
  }
  return result;
}
