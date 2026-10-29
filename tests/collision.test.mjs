import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { compileShape, transformCollider, DEFAULT_SHAPE, circleCollider, rectangleCollider, collide, areaInside } = load('physics/Collider');
const { TileMap } = load('map/TileMap');
const { Player } = load('objects/Player');
const { Entities } = load('objects/Entities');
const { Bullet } = load('objects/Bullet');
const { PickupItem, PickupType } = load('objects/PickupItem');
const { Vector2 } = load('math/Vector2');
const { parsePlayerConfig } = load('objects/PlayerConfig');
const empty = { isKeyDown: () => false };
const input = (...keys) => ({ isKeyDown: k => keys.includes(k) });
const near = (a, b, tolerance = 0.001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);
const mapOf = (w = 16, h = 12) => { const m = new TileMap(w, h, { generateWater: false }); m.tiles.forEach(row => row.fill('default')); return m; };
const body = (shape = DEFAULT_SHAPE, x = 200, y = 200, size = 49, rotation = 0) => transformCollider(compileShape(shape), { x, y, size, rotation });
const legal = (m, p) => assert.ok(m.queryShape(p.getCollider ? p.getCollider() : p).every(c => c.depth <= 0.01), 'body penetrates solid terrain');
const wall = m => m.tiles.forEach(row => row[1] = 'wall');
const L = { type: 'polygon', vertices: [[0,0], [1,0], [1,0.3], [0.3,0.3], [0.3,1], [0,1]] };
class ShapeEntity extends Entities {
  direction(i,keys){const d=new Vector2(Number(i.isKeyDown(keys[0]))-Number(i.isKeyDown(keys[1])),Number(i.isKeyDown(keys[2]))-Number(i.isKeyDown(keys[3])));return d.length()?d.normalize():d;}
  getMoveDirection(i){return this.direction(i,['d','a','s','w']);}
  getLookDirection(i){return this.direction(i,['ArrowRight','ArrowLeft','ArrowDown','ArrowUp']);}
  getBodyRotation(){return this.currentRotation-Math.PI/2;}
}
const squareActor=(x,y)=>new ShapeEntity(x,y);

test('shape pairs use actual circles, rotated polygons, containment and strict tangency', () => {
  assert.equal(collide(circleCollider(0,0,1), circleCollider(2,0,1)).length, 0);
  near(collide(circleCollider(0,0,1), circleCollider(1.5,0,1))[0].depth, 0.5);
  assert.equal(collide(circleCollider(-0.8,-0.8,1), rectangleCollider(0,0,1,1)).length, 0, 'empty square corner must not hit a circle');
  assert.ok(collide(circleCollider(0.5,0.5,0.1), rectangleCollider(0,0,1,1)).length);
  const square = body(DEFAULT_SHAPE, 0, 0, 2, Math.PI / 4);
  assert.ok(collide(square, circleCollider(1.35,0,0.1)).length);
  assert.equal(collide(square, circleCollider(1.3,1.3,0.1)).length, 0);
  assert.ok(collide(body(DEFAULT_SHAPE,0,0,4,0.2), body(DEFAULT_SHAPE,0,0,1,-0.3)).length);
});

test('concave contours preserve their notch and triangulation area', () => {
  const shape = body(L, 0,0,100);
  assert.ok(shape.pieces.length > 1);
  near(shape.area, 5100);
  assert.equal(collide(shape, circleCollider(70,70,10)).length, 0);
  assert.equal(collide(shape, rectangleCollider(60,60,10,10)).length, 0);
  assert.ok(collide(shape, circleCollider(20,70,10)).length);
  near(areaInside(shape, { x:30, y:30, width:70, height:70 }), 0);
  near(areaInside(shape, { x:0,y:0,width:100,height:100 }),5100);
});

test('compound area is a union, including overlapping circles and polygons', () => {
  const duplicate = body({ type:'compound', parts:[{type:'circle',radius:0.5}, {type:'circle',radius:0.5}] },0,0,100);
  near(duplicate.area, Math.PI * 2500, 0.01);
  near(areaInside(duplicate,{x:0,y:-50,width:50,height:100}), duplicate.area/2,0.01);
  const mixed = body({type:'compound',parts:[DEFAULT_SHAPE,{type:'circle',radius:0.5}]},0,0,100);
  near(mixed.area,10000,0.01);
  near(areaInside(mixed,{x:0,y:-50,width:50,height:100}),5000,0.01);
  const overlap = body({type:'compound',parts:[{type:'circle',radius:1,center:[-0.5,0]},{type:'circle',radius:1,center:[0.5,0]}]},0,0,1);
  near(overlap.area, 2*Math.PI-(2*Math.acos(0.5)-Math.sqrt(3)/2),0.0001);
});

test('invalid shape configurations are rejected before any player field changes', () => {
  const invalid = [null, {type:'circle',radius:0}, {type:'circle',radius:Infinity}, {type:'circle',radius:1,center:[NaN,0]}, {type:'polygon',vertices:[[0,0],[1,1],[0,1],[1,0]]}, {type:'polygon',vertices:[[0,0],[1,0],[2,0]]}, {type:'polygon',vertices:[[0,0],[1,0],[1,0],[0,1]]}, {type:'compound',parts:[]}, {type:'compound',parts:[{type:'compound',parts:[DEFAULT_SHAPE]}]}, {type:'circle',radius:1,typo:0}];
  const p = new Player(100,100);
  for (const collider of invalid) {
    assert.throws(() => parsePlayerConfig({base:{maxSpeed:700},collider}));
    assert.throws(() => p.applyConfig({base:{maxSpeed:700},collider}));
    assert.equal(p.getMaxSpeed(),200);
    assert.equal(p.getCollider().compiled.shape.type,'circle');
  }
  const source = {type:'polygon',vertices:[[0,0],[1,0],[1,1],[0,1]]};
  const custom=squareActor(100,100);custom.setCollider(source); source.vertices[0][0] = 99;
  near(custom.getCollider().compiled.shape.vertices[0][0],0);
  assert.throws(()=>p.setCollider(DEFAULT_SHAPE));
  assert.throws(()=>p.applyConfig({base:{maxSpeed:700},collider:L}));
  assert.throws(()=>p.setCollider({type:'circle',radius:0.5,center:[0.1,0]}));
  near(p.getMaxSpeed(),200);
  p.applyConfig({collider:{type:'circle',radius:0.4}});
  assert.equal(p.getCollider().parts[0].type,'circle');
});

test('stationary square rotates away from a wall by its true corner extension', () => {
  const m = mapOf(); wall(m);
  const p = squareActor(100,200); p.currentRotation=0;
  p.updateRotation(0.0625,new Vector2(-Math.SQRT1_2,-Math.SQRT1_2),m);
  near(p.currentRotation,Math.PI/4,0.001);
  near(p.x,100+(49*Math.SQRT2-49)/2,0.03);
  near(p.y,200,0.03); legal(m,p);
});

test('90 degree turn checks its intermediate 45 degree silhouette', () => {
  const m=mapOf(); wall(m); const p=squareActor(100,200); p.currentRotation=0;
  p.updateRotation(0.125,new Vector2(0,-1),m);
  near(p.currentRotation,Math.PI/2,0.001);
  near(p.x,110.1482,0.04); legal(m,p);
});

test('narrow corridor stops rotation locally instead of teleporting through a wall', () => {
  const m=mapOf(); wall(m); m.tiles.forEach(row => row[3]='wall');
  const p=squareActor(100.5,200); p.currentRotation=0;
  p.updateRotation(0.125,new Vector2(0,-1),m);
  assert.ok(p.currentRotation > 0 && p.currentRotation < 0.04);
  assert.ok(p.x >= 100-0.01 && p.x <= 101.01); legal(m,p);
});

test('automatic facing cannot prevent walking backward out of a narrow corridor', () => {
  const m=mapOf();wall(m);m.tiles.forEach(row=>row[3]='wall');
  const p=new Player(100.5,200);p.currentRotation=0;
  for(let i=0;i<24;i++){p.update(1/60,input('s'),m);legal(m,p);}
  const outward=p.y;
  assert.ok(outward>260,`outward movement stopped at ${outward}, angle ${p.currentRotation}`);
  for(let i=0;i<24;i++){p.update(1/60,input('w'),m);legal(m,p);}
  assert.ok(p.y<outward-60,`return movement stopped at ${p.y}, angle ${p.currentRotation}`);
});

test('player body stays circular when turning, changing sprites, or overlapping decorative corners', () => {
  const m=mapOf();m.tiles[4][4]='wall';
  const p=new Player(155.5,155.5),before=p.getCollider();
  assert.equal(before.compiled.shape.type,'circle');near(before.parts[0].radius,24.5);
  assert.ok(m.isCollidingRect(p.x,p.y,49,49),'the cosmetic square overlaps the wall corner');
  assert.ok(m.isShapeWalkable(before),'the circular body remains outside the wall');
  p.setSprite({width:600,height:1800});p.currentRotation=Math.PI/4;
  assert.deepEqual(p.getCollider().bounds,before.bounds);near(p.getCollider().area,before.area);
  legal(m,p);
  const corridor=mapOf();wall(corridor);corridor.tiles.forEach(row=>row[3]='wall');
  const q=new Player(100.5,200);q.currentRotation=0;q.velocity.set(0,-1);q.updateRotation(0.125,new Vector2(1,0),corridor);
  near(q.currentRotation,Math.PI/2);near(q.x,100.5);near(q.y,200);legal(corridor,q);
});

test('resting contact tolerance does not turn tile seams into movement barriers', () => {
  const m=mapOf();wall(m);m.tiles.forEach(row=>row[3]='wall');
  const p=squareActor(100.5,200);p.currentRotation=0;
  p.updateRotation(0.125,new Vector2(0,-1),m);
  p.velocity.set(0,200);p.updatePosition(0.8,m);
  near(p.y,360,0.02);legal(m,p);
  const c=circleCollider(124.4995,225,24.5);
  assert.equal(m.castShape(c,{x:0,y:150}),null,'tangential circle motion is valid within contact tolerance');
});

test('breathing grows only the artwork and never changes wall contact, slowdown or the body', () => {
  const m=mapOf();m.tiles.forEach(row=>row.fill('water'));wall(m);
  const p=new Player(100,200);p.applyConfig({animation:{breathingAmplitude:30}});
  const original=p.getCollider(),factor=m.getShapeSpeedFactor(original),scales=[];
  const ctx={save(){},restore(){},translate(){},rotate(){},scale(x){scales.push(x)},fillRect(){},clearRect(){},drawImage(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},closePath(){},arc(){},fill(){},stroke(){},createLinearGradient(){return {addColorStop(){}}},createRadialGradient(){return {addColorStop(){}}}};
  p.wadingCanvas={width:0,height:0,getContext:()=>ctx};
  for(let i=0;i<240;i++){
    p.update(1/60,empty,m);p.draw(ctx);
    assert.deepEqual(p.getCollider().bounds,original.bounds);
    near(p.getCollider().parts[0].radius,24.5);near(m.getShapeSpeedFactor(p.getCollider()),factor);legal(m,p);
  }
  assert.ok(Math.max(...scales)>1.29&&Math.min(...scales)<0.71);
  p.update(0.4,input('s'),m);const outward=p.y;assert.ok(outward>230);
  p.update(0.4,input('w'),m);assert.ok(p.y<outward-30);legal(m,p);
});

test('diagonal movement glances along a tile corner instead of losing all movement', () => {
  const m=mapOf();m.tiles[4][4]='wall';
  const p=new Player(180,151);p.currentRotation=0;
  for(let i=0;i<45;i++){p.update(1/60,input('d','s'),m);legal(m,p);}
  assert.ok(p.x>280,`corner stopped horizontal movement at ${p.x},${p.y}`);
  assert.ok(p.y>200,`corner stopped vertical movement at ${p.x},${p.y}`);
});

test('simultaneous wall contacts push both axes and tile seams do not block sliding', () => {
  const m=mapOf(); wall(m); m.tiles[3].fill('wall');
  const p=squareActor(100,215); p.currentRotation=0;
  p.updateRotation(0.0625,new Vector2(-Math.SQRT1_2,-Math.SQRT1_2),m);
  near(p.x,110.1482,0.04); near(p.y,215,0.04); legal(m,p);
  const slide=squareActor(100,220); slide.currentRotation=0;
  slide.velocity.set(-100,200); slide.updatePosition(0.8,m);
  near(slide.x,100,0.02); near(slide.y,380,0.1); legal(m,slide);
});

test('rotated map bounds and fractional rectangle overlaps use full geometry', () => {
  const m=mapOf(4,8), p=squareActor(-10,-10); p.currentRotation=Math.PI/4;
  p.update(0,empty,m); legal(m,p);
  near(p.getCollider().bounds.x,0); near(p.getCollider().bounds.y,0);
  m.tiles[2][2]='wall'; assert.equal(m.isCollidingRect(51.1,100,49,49),true);
  assert.equal(m.isCollidingRect(51,100,49,49),false);
});

test('concave and compound motion retains empty space and ignores decomposition edges', () => {
  const m=mapOf();m.tiles[5][5]='wall';
  const l=body(L,200,200,100);
  assert.ok(m.isShapeWalkable(l));
  const moved=m.resolveMotion(l,{x:0,y:40});
  near(moved.collider.pose.y,220,0.02);legal(m,moved.collider);
  const compound=body({type:'compound',parts:[{type:'circle',radius:0.5},{type:'circle',radius:0.5}]},200,200,49);
  const along=m.resolveMotion(compound,{x:90,y:0});
  near(along.collider.pose.x,290,0.02);legal(m,along.collider);
  const rectangular=m.resolveMotion(rectangleCollider(200,200,20,40),{x:100,y:0});
  near(rectangular.collider.pose.x,310,0.02);near(rectangular.collider.bounds.width,20);near(rectangular.collider.bounds.height,40);
});

test('coverage-weighted slowdown is symmetric on every entry edge, including circles', () => {
  const m=mapOf(); m.tiles[4][4]='water';
  for(const [x,y,expected] of [[175,225,1],[200,225,0.75],[225,225,0.5],[250,225,0.75],[275,225,1],[225,200,0.75],[225,250,0.75]]) {
    near(m.getShapeSpeedFactor(body(DEFAULT_SHAPE,x,y,50)),expected);
    near(m.getShapeSpeedFactor(circleCollider(x,y,25)),expected);
  }
  const p=new Player(175.5,200.5);
  near(m.getShapeSpeedFactor(p.getCollider()),1-0.5*24.5/49);
});

test('rotating, concave and overlapping compound footprints produce correct terrain coverage', () => {
  const m=mapOf(); m.tiles.forEach(row => {for(let c=4;c<m.width;c++) row[c]='water';});
  const shape = {type:'polygon',vertices:[[-0.8,-0.2],[0.8,-0.2],[0.8,0.2],[-0.8,0.2]]};
  const horizontal=m.getShapeSpeedFactor(body(shape,190,225,50,0));
  const vertical=m.getShapeSpeedFactor(body(shape,190,225,50,Math.PI/2));
  near(horizontal,0.8125); near(vertical,1);
  const duplicate={type:'compound',parts:[DEFAULT_SHAPE,DEFAULT_SHAPE]};
  near(m.getShapeSpeedFactor(body(duplicate,200,225,50)),0.75);
  const corner=mapOf(); corner.tiles[4][4]='water';
  near(corner.getShapeSpeedFactor(body(L,185,185,50)),1);
});

test('terrain speed caps combine with buffs, update within the frame and respect a zero factor', () => {
  const m=mapOf(); m.tiles.forEach(row=>row.fill('water'));
  const p=new Player(200,200); p.addModifier('maxSpeed',0.5,0,true);
  p.velocity.set(600,0); p.update(0.1,input('d'),m);
  near(p.getVelocity().length(),150); legal(m,p);
  const terrain=mapOf(); terrain.terrainMap.get('water').walkable=true;
  const { TILE_TYPES }=load('map/TileType'); const previous=TILE_TYPES.water.speedFactor;
  try { TILE_TYPES.water.speedFactor=0; terrain.tiles.forEach(row=>row.fill('water')); const q=new Player(200,200); q.update(0.1,input('d'),terrain); near(q.x,200); near(q.getVelocity().length(),0); }
  finally { TILE_TYPES.water.speedFactor=previous; }
});

test('circle bullets hit the first swept tile, even across multiple tiles in a long frame', () => {
  const m=mapOf(); m.tiles[4][4]='mineral'; m.tileHp[4][4]=100; m.tiles[4][6]='mineral'; m.tileHp[4][6]=100;
  const b=new Bullet(new Vector2(100,225),new Vector2(10000,0),100);
  b.update(0.05,m);
  assert.ok(b.getIsDestroyed()); near(b.getPosition().x,190,0.001);
  assert.equal(m.tiles[4][4],'default'); assert.equal(m.tileHp[4][6],100);
  assert.equal(m.isWalkableArea(200,200,49),true);
});

test('circle casts respect rounded corners, tangency, initial overlap and world boundaries', () => {
  const m=mapOf(); m.tiles[4][4]='wall';
  assert.equal(m.castShape(circleCollider(180,194.9,5),{x:80,y:0}),null,'a circle above the tile must miss');
  const hit=m.castShape(circleCollider(180,196,5),{x:80,y:0}); assert.ok(hit); near(hit.fraction,(35-Math.sqrt(39))/80,.3/80);
  assert.equal(m.castShape(circleCollider(180,195,5),{x:80,y:0}),null,'a tangential path does not enter the solid');
  assert.equal(m.castShape(circleCollider(225,225,5),{x:0,y:0}).fraction,0);
  const exit=new Bullet(new Vector2(795,225),new Vector2(1000,0)); exit.update(0.1,m); assert.ok(exit.getIsDestroyed());
});

test('pickup queries use rotated and concave shapes, not their bounding squares', () => {
  const pickup=new PickupItem(60,60,PickupType.HEALTH);
  assert.equal(pickup.isCollidingWithShape(body(L,0,0,100)),false);
  const p=squareActor(200,200); p.currentRotation=Math.PI/4;
  const nearTip=new PickupItem(254,204,PickupType.HEALTH);
  assert.equal(nearTip.isCollidingWithRect(p.x,p.y,49,49),false);
  assert.ok(nearTip.isCollidingWithShape(p.getCollider()));
});

test('frame rates and one long frame preserve legal turning and terrain movement', () => {
  const states=[];
  for(const fps of [30,60,144]) {
    const m=mapOf(40,20); wall(m); m.tiles.forEach(row=>{for(let c=8;c<20;c++)row[c]='water';});
    const p=new Player(100,200); p.currentRotation=0;
    for(let i=0;i<fps;i++) { p.update(1/fps,input('d'),m); legal(m,p); }
    states.push(p.x);
    const turn=squareActor(100,300); turn.currentRotation=0;
    for(let i=0;i<fps/4;i++) { turn.update(1/fps,input('ArrowUp'),m); legal(m,turn); }
    near(turn.x,110.1482,0.05);
  }
  assert.ok(Math.max(...states)-Math.min(...states)<1,states.join(','));
  const m=mapOf(); wall(m); const p=squareActor(100,200); p.currentRotation=0;
  p.update(0.5,input('ArrowUp'),m); legal(m,p); near(p.x,110.1482,0.05);
});
