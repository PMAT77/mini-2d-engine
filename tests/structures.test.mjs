import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap } = load('map/TileMap');
const { StructureSystem, structureCollider } = load('structures/StructureSystem');
const { WOOD_WALL } = load('structures/StructureDefinition');
const { circleCollider } = load('physics/Collider');
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
const { GameScene } = load('scenes/GameScene');
const { CampaignSession } = load('campaign/CampaignSession');
const { parseCampaignState } = load('campaign/CampaignState');
const { SaveRepository, ACTIVE_CAMPAIGN_KEY, campaignSaveKey } = load('campaign/SaveRepository');
const { emptyLocationResume } = load('campaign/LocationResumeState');
const { createLocationMap, initializeLocation, LOCATION_DEFINITIONS, CAMPAIGN_DEFINITION_VERSION: VERSION } = load('campaign/LocationDefinitions');
globalThis.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1, location: { search: '' }, addEventListener() {}, removeEventListener() {} };
function floor(width = 20, height = 12) {
  const map = new TileMap(width, height, { seed: 42, generateWater: false });
  map.tiles.forEach(row => row.fill('default')); map.tileHp.forEach(row => row.fill(0)); map.invalidateNavigation(); return map;
}
const context = (x = 150, y = 200, ex = 75, ey = 200) => { const player = circleCollider(x, y, 24.5); return { player, actors: [player], entrance: { x: ex, y: ey } }; };
async function scene(saved, player) {
  const location = saved ?? initializeLocation({ locationId: 'outpost', definitionVersion: VERSION, seed: 42, initialized: false, lastVisitedDay: null,
    spawns: {}, containers: {}, groundItems: [], terrainChanges: [], exploration: null, structures: [] }, 1);
  const result = new GameScene({ map: createLocationMap('outpost', 42), seed: 42, playerSpawn: LOCATION_DEFINITIONS.outpost.entrance.position,
    campaignData: { location, player, pose: LOCATION_DEFINITIONS.outpost.entrance, nextInstanceSequence: 0 } });
  result.configLoader = { async load() {}, getConfig() { return {}; } }; await result.load(); return result;
}

test('wood walls retain identity, damage/repair/destroy state, observation and geometry through runtime restore', () => {
  const map = floor(); let changes = 0;
  const system = new StructureSystem(map, [], () => changes++); system.build('wall-1', 5, 4, 0, context());
  const revision = map.getNavigationRevision(); assert.equal(system.snapshot()[0].hp, WOOD_WALL.maxHp);
  const bullet = new Bullet(new Vector2(200, 225), new Vector2(1000, 0), 25); bullet.update(.2, map); bullet.update(.2, map);
  assert.equal(system.snapshot()[0].hp, 95); assert.equal(map.getNavigationRevision(), revision);
  system.observe(() => false); assert.equal(system.snapshot()[0].observedHp, 120, 'hidden damage does not update memory');
  system.observe(() => true); assert.equal(system.snapshot()[0].observedHp, 95);
  const secondMap = floor(), restored = new StructureSystem(secondMap, system.snapshot(), () => {});
  assert.deepEqual(restored.snapshot(), system.snapshot()); assert.equal(secondMap.blocksLightAt(275, 225), true);
  restored.repair('wall-1'); assert.equal(restored.snapshot()[0].hp, 120);
  restored.damage('wall-1', 120); assert.equal(restored.snapshot()[0].status, 'destroyed'); assert.equal(secondMap.blocksLightAt(275, 225), false);
  assert.throws(() => restored.repair('wall-1'), /残骸/);
  restored.dismantle('wall-1'); assert.deepEqual(restored.snapshot(), []);
  restored.build('wall-2', 5, 4, 1, context()); assert.equal(structureCollider(restored.snapshot()[0], 50).bounds.width, 16);
  restored.dispose(); assert.equal(secondMap.blocksLightAt(275, 225), false); assert.ok(changes >= 3);
});

test('placement rejects actors, terrain, entrance, duplicate cells and a sealed return route without mutating topology', () => {
  const map = floor(), system = new StructureSystem(map, [], () => {}), before = map.getNavigationRevision();
  assert.throws(() => system.build('actor', 2, 4, 0, context()), /角色/);
  assert.throws(() => system.build('edge', -1, 0, 0, context()), /网格/);
  assert.throws(() => system.build('entrance', 1, 3, 0, context(175, 200)), /出入口/);
  assert.equal(map.getNavigationRevision(), before); assert.deepEqual(system.snapshot(), []);
  const corridor = floor(); corridor.tiles.forEach((row, index) => { if (index !== 5) row.fill('wall'); }); corridor.invalidateNavigation();
  const closed = new StructureSystem(corridor, [], () => {}), version = corridor.getNavigationRevision();
  assert.throws(() => closed.build('trap', 4, 5, 1, context(325, 275, 125, 275)), /封住/);
  assert.equal(corridor.getNavigationRevision(), version); assert.deepEqual(closed.snapshot(), []);
  system.build('valid', 5, 4, 0, context()); const count = system.snapshot().length;
  assert.throws(() => system.build('same-cell', 5, 4, 1, context()), /已有/); assert.equal(system.snapshot().length, count);
});

test('blast damage is collected before mutation and respects shielding; melee uses the same structure damage owner', () => {
  const map = floor(), system = new StructureSystem(map, [], () => {});
  system.build('front', 5, 4, 1, context()); system.build('back', 6, 4, 1, context(200, 200));
  const hits = system.collectBlast(235, 225); assert.deepEqual(hits.map(hit => hit.id), ['front']);
  for (const hit of hits) system.damage(hit.id, hit.damage);
  assert.equal(system.snapshot().find(s => s.instanceId === 'front').hp, 0);
  assert.equal(system.snapshot().find(s => s.instanceId === 'back').hp, 120);
  const melee = system.meleeHit({ x: 280, y: 225 }, 0, 64, Math.PI / 4);
  assert.equal(melee.id, 'back'); system.damage(melee.id, 8); assert.equal(system.snapshot().find(s => s.instanceId === 'back').hp, 112);
});

test('schema 1 migrates purely to schema 2; structures validate and migration preserves the old backup', async () => {
  const current = await scene(), session = CampaignSession.create({ campaignId: 'migration', worldSeed: (42 ^ 0x6f757470) >>> 0, definitionVersion: VERSION,
    player: current.captureCampaignPlayer(), outpostSpawn: current.captureCampaignPose() });
  session.commitCurrentLocation(0, current.captureCampaignCheckpoint(1));
  const state = session.getSnapshot(), legacy = structuredClone(state); legacy.schemaVersion = 1;
  for (const location of Object.values(legacy.locations)) delete location.structures;
  const bytes = JSON.stringify(legacy), migrated = parseCampaignState(legacy);
  assert.deepEqual(migrated, state); assert.equal(JSON.stringify(legacy), bytes);
  const store = new Map(), storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  storage.setItem(ACTIVE_CAMPAIGN_KEY, JSON.stringify({ formatVersion: 1, campaignId: 'migration' }));
  const key = campaignSaveKey('migration', 0), raw = JSON.stringify({ formatVersion: 1, campaignId: 'migration', saveSequence: 1, payload: legacy, runtime: emptyLocationResume() }); storage.setItem(key, raw);
  const repo = new SaveRepository(storage, VERSION), read = repo.read(); assert.deepEqual(read.candidates[0].state, state); assert.equal(storage.getItem(key), raw);
  repo.save(state, emptyLocationResume()); assert.equal(storage.getItem(key), raw); assert.equal(repo.read().candidates[0].state.schemaVersion, 2);
  const valid = { instanceId: 'building', definitionId: 'wood-wall', level: 1, col: 9, row: 10, rotation: 0, hp: 80, status: 'standing', observedHp: 120 };
  for (const change of [s => s.hp = 121, s => s.col = -1, s => s.rotation = 3, s => s.status = 'destroyed', s => s.level = 2,
    s => s.observedHp = NaN, s => s.instanceId = state.player.weapons.primary.instanceId]) {
    const bad = structuredClone(state), structure = structuredClone(valid); change(structure); bad.locations.outpost.structures.push(structure);
    assert.throws(() => parseCampaignState(bad));
  }
  const bad = structuredClone(state); delete bad.locations.outpost.structures; assert.throws(() => parseCampaignState(bad));
});

test('campaign checkpoint restores damaged walls; invalid geometry never silently moves a saved player', async () => {
  const source = await scene(), system = source.getStructures();
  system.build('saved-wall', 9, 10, 0, { ...context(350, 500, 350, 500) }); system.damage('saved-wall', 37);
  const checkpoint = source.captureCampaignCheckpoint(1), restored = await scene(checkpoint.location, checkpoint.player);
  assert.deepEqual(restored.getStructures().snapshot(), checkpoint.location.structures); assert.equal(restored.map.blocksLightAt(475, 525), true);
  const bad = structuredClone(checkpoint.location); bad.structures[0].col = 7; bad.structures[0].row = 9; bad.structures[0].rotation = 1;
  await assert.rejects(scene(bad, checkpoint.player), /玩家位置不可通行|重叠/);
  source.disposePrepared(); assert.equal(restored.map.blocksLightAt(475, 525), true, 'old scene cleanup cannot remove restored geometry');
});

test('actual GameScene punch settlement damages the first wall and does not hit through it', async () => {
  const current = await scene(), system = current.getStructures();
  system.build('punched', 9, 10, 1, context(350, 500, 350, 500));
  current.player.x = 417.5; current.player.y = 500.5; current.player.currentRotation = Math.PI;
  current.player.consumePunchImpacts = () => [{ sequence: 1, moveId: 'jab' }];
  current.settlePlayerPunches();
  assert.equal(system.snapshot()[0].hp, 112); assert.equal(current.consumeStructureChanges(), true);
});

test('adjacent wood walls omit shared shadow seams and expose the end again after destruction', () => {
  const map = floor(), system = new StructureSystem(map, [], () => {});
  system.build('left', 5, 4, 0, context(200, 200)); system.build('right', 6, 4, 0, context(200, 200));
  const edges = map.getShadowEdges(100, 225, 700);
  assert.equal(edges.length, 6); assert.equal(edges.some(edge => edge.ax === 300 && edge.bx === 300), false);
  system.damage('left', 120);
  assert.equal(map.getShadowEdges(100, 225, 700).length, 4);
  assert.equal(map.getShadowEdges(100, 225, 700).some(edge => edge.ax === 300 && edge.bx === 300), true);
});
