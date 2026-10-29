import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url), load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));
const { TileMap } = load('map/TileMap');
const { LightingSystem, projectShadow } = load('core/LightingSystem');
const { circleCollider, rectangleCollider, compileShape, transformCollider, areaInsidePolygons } = load('physics/Collider');
const empty = () => { const m = new TileMap(8, 8, {generateWater:false});m.tiles.forEach(r=>r.fill('default'));return m; };
const area = polygon => Math.abs(polygon.vertices.reduce((n,a,i)=>{const b=polygon.vertices[(i+1)%polygon.vertices.length];return n+a.x*b.y-a.y*b.x},0))/2;

test('all sixteen vertex layouts round convex/concave corners and keep diagonals separate', () => {
  const samples = [[149,149],[151,149],[149,151],[151,151]], cells=[[2,2],[3,2],[2,3],[3,3]];
  for(let mask=0;mask<16;mask++){
    const m=empty();cells.forEach(([x,y],i)=>{if(mask&(1<<i))m.tiles[y][x]='wall'});
    const count=cells.filter((_,i)=>mask&(1<<i)).length;
    for(let i=0;i<4;i++){
      const own=!!(mask&(1<<i)), diagonal=!!(mask&(1<<(3-i)));
      const expected=count===3?true:own&&!(count===1||(count===2&&diagonal));
      assert.equal(m.blocksLightAt(...samples[i]),expected,`mask ${mask}, quadrant ${i}`);
      assert.equal(m.isShapeWalkable(circleCollider(...samples[i],.01)),!expected);
    }
    const polygons=m.getBlockingPolygons(0,0,400,400);
    assert.ok(polygons.every(p=>area(p)>0));
    assert.equal(m.getShadowEdges(150,150,400).some(e=>!Object.values(e).every(Number.isFinite)),false);
  }
});
test('isolated corners, joined materials and concave fillets share point and projectile geometry', () => {
  const m=empty();m.tiles[2][2]='mineral';m.tileHp[2][2]=100;
  const roundedArea=m.getBlockingPolygons(100,100,50,50).reduce((n,p)=>n+area(p),0);
  assert.ok(Math.abs(roundedArea-(2500-4*(225-4*225*Math.sin(Math.PI/16))))<1e-6,'50px tiles have a 15px radius');
  assert.equal(m.blocksLightAt(101,101),false);assert.equal(m.getSpeedFactor(101,101),1);
  assert.equal(m.isShapeWalkable(rectangleCollider(100.1,100.1,1,1)),true);
  assert.equal(m.castShape(circleCollider(90,101,.2),{x:15,y:0},'projectile'),null);
  assert.equal(m.castShape(circleCollider(90,125,1),{x:1000,y:0},'projectile').obstacle.col,2);
  m.tiles[2][3]='wall';m.tiles[3][2]='damage_mineral';m.tileHp[3][2]=100;
  assert.equal(m.blocksLightAt(151,151),true);
  const overlap=m.castShape(circleCollider(151,151,.05),{x:0,y:0},'projectile');
  assert.equal(overlap.fraction,0);assert.deepEqual([overlap.obstacle.col,overlap.obstacle.row],[3,2]);
  const bisector=m.castShape(circleCollider(160,160,.01),{x:-20,y:-20},'projectile');
  assert.deepEqual([bisector.obstacle.col,bisector.obstacle.row],[3,2]);
  const upper=m.castShape(circleCollider(156,160,.01),{x:0,y:-15},'projectile');
  const lower=m.castShape(circleCollider(160,156,.01),{x:-15,y:0},'projectile');
  assert.deepEqual([upper.obstacle.col,upper.obstacle.row],[3,2]);
  assert.deepEqual([lower.obstacle.col,lower.obstacle.row],[2,3]);
  const before=m.getShadowEdges(150,150,400);m.breakTile(2,3);
  assert.equal(m.blocksLightAt(151,151),false);assert.notDeepEqual(m.getShadowEdges(150,150,400),before);
  m.tileSize=62.5;assert.equal(m.blocksLightAt(126,126),false);assert.equal(m.blocksLightAt(150,150),true);
});
test('rounded coverage, holes, size changes and direct array edits preserve exact ownership', () => {
  const m=empty();m.tiles[2][2]='wall';m.tiles[2][3]='mineral';m.tiles[3][2]='damage_mineral';m.tiles[3][3]='water';
  const solid=circleCollider(151,151,.1),wet=circleCollider(175,175,.1),cut=circleCollider(101,101,.1);
  for(const [body,factor] of [[solid,0],[wet,.5],[cut,1]]){
    const coverage=m.getTerrainCoverage(body);assert.ok(Math.abs(coverage.reduce((n,c)=>n+c.fraction,0)-1)<1e-6);
    assert.ok(Math.abs(m.getShapeSpeedFactor(body)-factor)<1e-6);
  }
  const body=circleCollider(156,156,8),coverage=m.getTerrainCoverage(body);
  assert.ok(Math.abs(coverage.reduce((n,c)=>n+c.fraction,0)-1)<1e-5);
  const expected=coverage.reduce((n,c)=>n+({wall:0,mineral:0,damage_mineral:0,water:.5,default:1}[c.type])*c.fraction,0);
  assert.ok(Math.abs(m.getShapeSpeedFactor(body)-expected)<1e-6);
  const polygons=m.getBlockingPolygons(150,150,50,50);
  const compound=transformCollider(compileShape({type:'compound',parts:[{type:'circle',radius:8},{type:'circle',radius:8}]}),{x:156,y:156,size:1,rotation:0});
  const dry=areaInsidePolygons(compound,[{type:'polygon',vertices:[{x:150,y:150},{x:200,y:150},{x:200,y:200},{x:150,y:200}],edges:[true,true,true,true]}],{x:150,y:150,width:50,height:50},polygons);
  assert.ok(dry>0&&dry<compound.area);
  m.tiles[3][2]='default';assert.equal(m.blocksLightAt(151,151),false);
  m.tiles[3][2]='wall';assert.equal(m.blocksLightAt(151,151),true);
  m.tileSize=37.5;assert.equal(m.blocksLightAt(113.25,113.25),true);
});
test('circles slide across mixed-material joins and rounded corners without internal contacts', () => {
  const m=empty();for(let y=1;y<7;y++)m.tiles[y][3]=y%2?'wall':'mineral';
  const result=m.resolveMotion(circleCollider(125.5,100,24.5),{x:0,y:180});
  assert.ok(Math.abs(result.collider.pose.y-280)<.02);assert.equal(result.exhausted,false);
  const single=empty();single.tiles[3][3]='wall';
  for(const fps of [30,60,144]){
    let body=circleCollider(125.5,130,24.5);
    for(let i=0;i<fps;i++)body=single.resolveMotion(body,{x:60/fps,y:80/fps}).collider;
    assert.ok(single.queryShape(body).every(c=>c.depth<=.01));
  }
});
test('polygon and compound actors retain tangent movement on rounded terrain', () => {
  const m=empty();m.tiles[3][3]='wall';
  const square={type:'polygon',vertices:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]};
  for(const shape of [square,{type:'compound',parts:[square,{type:'circle',radius:.4}]}]){
    let body=transformCollider(compileShape(shape),{x:120,y:120,size:30,rotation:0});
    for(let i=0;i<60;i++){
      const next=m.resolveMotion(body,{x:1.5,y:1});body=next.collider;
      assert.ok(m.queryShape(body).every(c=>c.depth<=.01));assert.equal(next.exhausted,false);
    }
    assert.ok(body.pose.x>160,'retain motion along the top of the rounded block');
  }
});
test('shadow strips remove internal radial edges without changing the projected area', () => {
  const m=empty();m.tiles[3][3]='wall';const edges=m.getShadowEdges(175,175,400),paths=[];
  const ctx={beginPath(){},moveTo(x,y){paths.push([{x,y}])},lineTo(x,y){paths.at(-1).push({x,y})},closePath(){},fill(){}};
  new LightingSystem().shadowPath(ctx,edges,-1000,-600,20,20);
  const quads=edges.map(e=>projectShadow(e,-1000,-600,20,20)).filter(Boolean);
  const expected=quads.reduce((n,p)=>n+area({vertices:Array.from({length:4},(_,i)=>({x:p[i*2],y:p[i*2+1]}))}),0);
  assert.ok(paths.length<quads.length/2,'rounded arc quads are merged before Canvas fills them');
  assert.ok(Math.abs(paths.reduce((n,vertices)=>n+area({vertices}),0)-expected)<1e-6);
});
