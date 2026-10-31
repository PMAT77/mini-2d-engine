import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap } = load('map/TileMap');
const { WATER_TYPES } = load('map/WaterTerrain');
const { TILE_TYPES } = load('map/TileType');
const { circleCollider, rectangleCollider, compileShape, transformCollider, areaInsidePolygons, circlePolygonArea, unionArea } = load('physics/Collider');
const { castCollider } = load('physics/Motion');
const { Player } = load('objects/Player');
const { Bullet } = load('objects/Bullet');
const { Vector2 } = load('math/Vector2');
const { GameScene } = load('scenes/GameScene');
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const input = (...keys) => ({ isKeyDown: key => keys.includes(key) });
const empty = () => { const m = new TileMap(24, 16, { generateWater: false }); m.tiles.forEach(row => row.fill('default')); return m; };
const generated = () => { const m = new TileMap(100, 100, { seed: 8351 }); m.tiles.forEach(row => row.fill('default')); return m; };
const polygonBody = vertices => transformCollider(compileShape({ type: 'polygon', vertices }), { x: 0, y: 0, size: 1, rotation: 0 });

test('wading indicator follows cached terrain slowdown while idle, sprinting and buffed, with exact fade times', () => {
  const m=empty(),p=new Player(200,200);
  m.tiles.forEach(row=>row.fill('shallow_water'));
  m.getTerrainCoverage=()=>{throw Error('wading state requested coverage details');};
  p.update(.04,input(),m);near(p.terrainSpeedFactor,.75);near(p.wadingAlpha,.5);assert.equal(p.wadingMap,m);
  p.update(.04,input(),m);near(p.wadingAlpha,1);
  p.addModifier('maxSpeed',1,0,true);p.update(.2,input('d','Shift'),m);
  assert.ok(p.getVelocity().length()>200);near(p.terrainSpeedFactor,.75);near(p.wadingAlpha,1);
  m.tiles.forEach(row=>row.fill('default'));
  p.update(0,input(),m);near(p.terrainSpeedFactor,1);assert.equal(p.wadingMap,undefined);near(p.wadingAlpha,1);
  p.update(.06,input(),m);near(p.wadingAlpha,.5);p.update(.06,input(),m);near(p.wadingAlpha,0);
  m.tiles.forEach(row=>row.fill('deep_water'));p.update(.08,input(),m);near(p.terrainSpeedFactor,.25);near(p.wadingAlpha,1);
  p.update(.12,input());near(p.terrainSpeedFactor,1);assert.equal(p.wadingMap,undefined);near(p.wadingAlpha,0);
});

test('wading overlay remains on the screen left independently of facing, aim and camera offsets', () => {
  const p=new Player(200.5,210.75),layout=p.getOverlayLayout(37.25,19.5);
  for(const angle of [0,Math.PI/4,Math.PI,Math.PI*1.5]){
    p.currentRotation=angle;p.aimAngle=angle;
    assert.deepEqual(p.getOverlayLayout(37.25,19.5),layout);
  }
  assert.ok(layout.debuffX<200.5-37.25-10);near(layout.debuffY,210.75-19.5+24.5);
  assert.ok(Math.hypot(layout.debuffX-layout.reloadX,layout.debuffY-layout.reloadY)>22);
});

test('debuff color is constant within each depth and blends water depths without diluting them with land', () => {
  const m=empty(),p=new Player(375.5,200);
  for(const [type,expected] of [['shallow_water',[98,186,255]],['water',[177,143,178]],['deep_water',[255,100,100]]]){
    m.tiles.forEach(row=>row.fill(type));p.update(0,input(),m);
    assert.deepEqual(p.wadingColor.match(/\d+/g).map(Number),expected);
  }
  m.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<8?'shallow_water':'water'));
  p.update(0,input(),m);near(p.terrainSpeedFactor,.625);near(p.terrainWaterCoverage.fraction,1);near(p.terrainWaterCoverage.depth,.5);
  p.wadingColor.match(/\d+/g).map(Number).forEach((value,i)=>near(value,[138,165,217][i],1.1));
  m.tiles.forEach(row=>row.forEach((_,col)=>row[col]=col<8?'default':'deep_water'));
  p.update(0,input(),m);near(p.terrainSpeedFactor,.625);near(p.terrainWaterCoverage.fraction,.5);near(p.terrainWaterCoverage.depth,2);
  assert.deepEqual(p.wadingColor.match(/\d+/g).map(Number),[255,100,100]);
  m.tiles.forEach(row=>row.fill('default'));p.update(0,input(),m);near(p.terrainWaterCoverage.fraction,0);near(p.terrainWaterCoverage.depth,0);
  assert.deepEqual(p.wadingColor.match(/\d+/g).map(Number),[255,100,100],'retain the last water color while fading out');
});

test('analytic circle intersections match integration at tangencies, corners, concavities and water transitions', () => {
  const shapes = [rectangleCollider(200,200,50,50), polygonBody([[200,200],[250,200],[250,210],[210,210],[210,250],[200,250]])];
  for (const region of shapes) for (const [x,y,r] of [[175,225,25],[225,175,25],[225,225,25],[200,200,25],[195,205,24.5],[215,215,35],[225,225,0.01]]) {
    const circle=circleCollider(x,y,r);
    near(circlePolygonArea(circle.parts[0],region.parts[0].vertices),areaInsidePolygons(circle,region.parts,region.bounds),Math.max(1e-6,circle.area*1e-6));
  }
  const m=generated(),lake=m.water.lakes[0],y=lake.center.y*50;
  for(let x=lake.bounds.x*50;x<(lake.bounds.x+lake.bounds.width)*50;x+=11){
    const body=circleCollider(x,y,24.5);let reference=1;
    const b=body.bounds;
    for(let row=Math.floor(b.y/50);row<=Math.floor((b.y+b.height)/50);row++)for(let col=Math.floor(b.x/50);col<=Math.floor((b.x+b.width)/50);col++){
      const cell=m.water.getCell(col,row,50);if(!cell)continue;
      const rect={x:col*50,y:row*50,width:50,height:50};
      if(cell.type)reference+=(TILE_TYPES[cell.type].speedFactor-1)*unionArea(body.parts,rect)/body.area;
      else for(const polygons of cell.cumulative)reference-=0.25*areaInsidePolygons(body,polygons,rect)/body.area;
    }
    near(m.getShapeSpeedFactor(body),Math.max(0,reference),0.001);
  }
});

test('movement reuses the previous endpoint factor and speed queries do not construct coverage details', () => {
  const m=generated(),lake=m.water.lakes[0],p=new Player(lake.center.x*50-230-24.5,lake.center.y*50-24.5);
  m.getTerrainCoverage=()=>{throw Error('movement requested debug coverage');};
  let queries=0,steps=0;const factor=m.getShapeSpeedFactor.bind(m),move=m.resolveMotion.bind(m);
  m.getShapeSpeedFactor=(...args)=>{queries++;return factor(...args)};
  m.resolveMotion=(...args)=>{steps++;return move(...args)};
  p.update(1/60,input('d'),m);
  assert.ok(steps>1);assert.equal(queries,steps+1);
});

test('four water factors, mixed-depth footprints, buffs and sprint preserve the speed contract', () => {
  const m = empty();
  for (const [i, type] of WATER_TYPES.entries()) {
    m.tiles.forEach(row => row.fill(type));
    near(m.getSpeedFactor(225, 225), [0.75, 0.5, 0.25, 0][i]);
    near(m.getShapeSpeedFactor(circleCollider(225, 225, 20)), [0.75, 0.5, 0.25, 0][i]);
    assert.equal(m.isShapeWalkable(circleCollider(225, 225, 20)), i !== 3);
  }
  for (const [left, right, expected] of [['default','shallow_water',0.875], ['shallow_water','water',0.625], ['water','deep_water',0.375]]) {
    m.tiles.forEach(row => row.forEach((_, col) => row[col] = col < 8 ? left : right));
    near(m.getShapeSpeedFactor(circleCollider(400, 225, 20)), expected);
  }
  m.tiles.forEach(row => row.fill('deep_water'));
  const p = new Player(200, 200); p.addModifier('maxSpeed', 0.5, 0, true);
  for (let i = 0; i < 30; i++) p.update(1 / 60, input('d', 'Shift'), m);
  near(p.getVelocity().length(), 160 * 0.25 * 1.5 * 1.6);
});

test('seeded lakes occupy about ten percent, stay separated and have closed nested contours', () => {
  for (const seed of [0, 1, 42, 8351, 99999]) {
    const a = new TileMap(100, 100, { seed }), b = new TileMap(100, 100, { seed });
    assert.deepEqual(a.tiles, b.tiles); assert.deepEqual(a.water.lakes, b.water.lakes);
    assert.ok(a.water.lakes.length >= 4 && a.water.lakes.length <= 6);
    let area = 0;
    for (const lake of a.water.lakes) {
      const bounds = lake.bounds;
      assert.ok(bounds.x >= 1 && bounds.y >= 1 && bounds.x + bounds.width < 100 && bounds.y + bounds.height < 100);
      const edges = Array.from({ length: 4 }, () => new Map());
      const edge = (depth, p, q) => {
        const key = v => `${v.x.toFixed(6)},${v.y.toFixed(6)}`;
        const forward = `${key(p)}:${key(q)}`, reverse = `${key(q)}:${key(p)}`;
        if (edges[depth].has(reverse)) edges[depth].delete(reverse); else edges[depth].set(forward, [p, q]);
      };
      for (const key of lake.cells) {
        const col = key % 100, row = Math.floor(key / 100), cell = a.water.getCell(col, row, 50);
        assert.equal(a.tiles[row][col], 'default'); assert.equal(a.tileHp[row][col], 0);
        const rect = rectangleCollider(col * 50, row * 50, 50, 50);
        const areas = cell.type ? WATER_TYPES.map((t,i) => i <= WATER_TYPES.indexOf(cell.type) ? 2500 : 0) :
          cell.cumulative.map(polys => areaInsidePolygons(rect, polys, rect.bounds));
        area += areas[0];
        for (let i = 1; i < 4; i++) assert.ok(areas[i] <= areas[i-1] + 1e-5);
        for (let i = 0; i < 4; i++) {
          const polygons = cell.type ? (WATER_TYPES.indexOf(cell.type) >= i ? rect.parts : []) : cell.cumulative[i];
          for (const polygon of polygons) polygon.vertices.forEach((p,j) => edge(i,p,polygon.vertices[(j+1)%polygon.vertices.length]));
        }
      }
      for (const contour of edges) {
        const degrees = new Map();
        assert.ok(contour.size > 12);
        for (const [p,q] of contour.values()) for (const v of [p,q]) {
          const key = `${v.x.toFixed(6)},${v.y.toFixed(6)}`;
          degrees.set(key,(degrees.get(key)||0)+1);
        }
        assert.ok([...degrees.values()].every(degree => degree === 2), 'every contour vertex has exactly two boundary edges');
      }
    }
    assert.ok(area / (5000 * 5000) > 0.075 && area / (5000 * 5000) < 0.125, `${seed}: ${area / 25000000}`);
  }
  assert.equal(new TileMap(4, 8, { seed: 1 }).water.lakes.length, 0);
  assert.equal(new TileMap(12, 12, { seed: 1 }).water.lakes.length, 1);
  assert.equal(new TileMap(100, 100, { generateWater: false }).water, undefined);
});

test('polygon intersections preserve concave holes and overlapping compound unions', () => {
  const region = polygonBody([[200, 200], [250, 200], [200, 250]]);
  near(areaInsidePolygons(rectangleCollider(200,200,50,50), region.parts, region.bounds), 1250);
  const duplicated = transformCollider(compileShape({ type: 'compound', parts: [{type:'circle',radius:20},{type:'circle',radius:20}] }), { x:200,y:200,size:1,rotation:0 });
  near(areaInsidePolygons(duplicated, region.parts, region.bounds), Math.PI * 100, 0.001);
  const concave = polygonBody([[200,200],[250,200],[250,210],[210,210],[210,250],[200,250]]);
  near(areaInsidePolygons(concave, region.parts, region.bounds), 800, 0.001);
});

test('curved water coverage agrees with point queries and stays normalized across every band', () => {
  const m = generated(), lake = m.water.lakes[0], cy = lake.center.y * 50;
  let mixed = 0;
  for (let x = (lake.bounds.x - 1) * 50; x < (lake.bounds.x + lake.bounds.width + 1) * 50; x += 17) {
    const body = circleCollider(x, cy, 24.5), coverage = m.getTerrainCoverage(body);
    near(coverage.reduce((n,c) => n+c.fraction,0), 1, 1e-5);
    if (new Set(coverage.map(c=>c.type)).size > 1) mixed++;
    const tiny = circleCollider(x, cy, 0.01);
    near(m.getShapeSpeedFactor(tiny), m.getSpeedFactor(x, cy), 0.002);
  }
  assert.ok(mixed >= 8);
  m.tileSize = 37.5;
  near(m.getSpeedFactor(lake.center.x*37.5, lake.center.y*37.5),0);
  assert.equal(m.isShapeWalkable(circleCollider(lake.center.x*37.5,lake.center.y*37.5,10)),false);
});

test('circular sweeps use polygon geometry rather than an obstacle bounding box', () => {
  const triangle = polygonBody([[200,200],[300,300],[200,300]]);
  const world = { getCollisionObstacles: () => [{ collider: triangle, col:-1,row:-1 }] };
  assert.equal(castCollider(world,circleCollider(250,180,5),{x:0,y:40}),null);
  const hit = castCollider(world,circleCollider(250,180,5),{x:0,y:100});
  assert.ok(hit && hit.fraction > 0.6 && hit.fraction < 0.65);
});

test('ultra-deep water constrains long frames, sprint, coasting and sliding at the visible contour', () => {
  const m = generated(), lake = m.water.lakes[0], center = { x:lake.center.x*50,y:lake.center.y*50 };
  const states=[];
  for (const fps of [30,60,144]) {
    const p = new Player(center.x-230-24.5,center.y-24.5);
    assert.ok(m.isShapeWalkable(p.getCollider()));
    for (let i=0;i<fps*3;i++) { p.update(1/fps,input('d','Shift'),m); assert.ok(m.isShapeWalkable(p.getCollider()) || m.queryShape(p.getCollider()).every(c=>c.depth<=0.01)); }
    const before=p.x;
    p.update(0.5,input('d','Shift'),m); p.update(0.5,input(),m);
    // A curved bank can turn forward input into sliding; it must never allow entry.
    assert.ok(m.queryShape(p.getCollider()).every(c=>c.depth<=0.01));
    assert.ok(m.getTerrainCoverage(p.getCollider()).filter(c=>c.type==='ultra_deep_water').reduce((n,c)=>n+c.fraction,0)<0.001);
    assert.ok(p.x<center.x-24.5);
    const startY=p.y;
    for(let i=0;i<fps;i++)p.update(1/fps,input('d','s'),m);
    assert.ok(p.y>startY+25,'retain tangential movement');
    assert.ok(m.queryShape(p.getCollider()).every(c=>c.depth<=0.01));
    states.push(before);
  }
  assert.ok(Math.max(...states)-Math.min(...states)<1);
  for(let i=0;i<30;i++) { const p=m.getRandomWalkablePosition(49,{type:'circle',radius:0.5}); assert.ok(m.isShapeWalkable(circleCollider(p.x+24.5,p.y+24.5,24.5))); }
});

test('all water transmits light and bullets still hit ore beyond the ultra-deep center', () => {
  const m = generated(), lake = m.water.lakes[0], x=lake.center.x*50,y=lake.center.y*50;
  const start=circleCollider(x-200,y,5), move={x:400,y:0};
  assert.ok(m.castShape(start,move)); assert.equal(m.castShape(start,move,'projectile'),null);
  assert.equal(m.blocksLightAt(x,y),false);
  assert.equal(m.getShadowEdges(x,y,500).length,0); assert.equal(m.getBlockingRects(x-500,y-500,1000,1000).length,0);
  const col=Math.floor((x+250)/50), row=Math.floor(y/50); m.tiles[row][col]='mineral';m.tileHp[row][col]=100;
  const bullet=new Bullet(new Vector2(x-200-5,y-5),new Vector2(2000,0),100);
  bullet.update(0.5,m);assert.ok(bullet.getIsDestroyed()); assert.equal(m.tileHp[row][col],0);
  for(const type of WATER_TYPES) { const plain=empty();plain.tiles[4][4]=type;assert.equal(plain.blocksLightAt(225,225),false); assert.equal(plain.castShape(circleCollider(175,225,5),{x:100,y:0},'projectile'),null); }
});

test('gold scatter paths cannot enter curved ultra-deep water', () => {
  globalThis.window = { innerWidth:1200,innerHeight:800,devicePixelRatio:1 };
  const scene = new GameScene({ seed:8351 }), m=scene.map, lake=m.water.lakes[0],y=lake.center.y*50;
  m.tiles.forEach(row=>row.fill('default'));
  let x=lake.center.x*50-250;
  while(m.isShapeWalkable(rectangleCollider(x+1,y,8,8)))x++;
  const col=Math.floor((x-20)/50),row=Math.floor(y/50);
  m.tiles[row][col]='mineral';m.tileHp[row][col]=100;m.damageTile(col,row,10);
  assert.equal(scene.goldPickups.length,1);
  for(let i=0;i<40;i++)for(const gold of scene.goldPickups){gold.update(1/60);assert.ok(m.isShapeWalkable(gold.getCollider()));}
  m.breakTile(col,row);
  assert.equal(scene.goldPickups.length,10);
  for(let i=0;i<40;i++)for(const gold of scene.goldPickups){gold.update(1/60);assert.ok(m.queryShape(gold.getCollider()).every(c=>c.depth<=0.01));}
});
