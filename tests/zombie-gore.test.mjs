import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require=createRequire(import.meta.url),load=p=>require(join(process.env.TEST_BUILD_DIR,p+'.js'));
const {TileMap}=load('map/TileMap'),{Zombie}=load('enemies/Zombie'),{ZOMBIE_CONFIG}=load('enemies/ZombieConfig');
const {ZombieGoreSystem}=load('enemies/ZombieGoreSystem'),{seededRandom}=load('map/WaterTerrain'),{circleCollider}=load('physics/Collider');
const ground=()=>{const m=new TileMap(30,20,{seed:1,generateWater:false});m.tiles.forEach(r=>r.fill('default'));m.invalidateNavigation();return m;};
const death=(id='z',x=225,y=225,kind='shambler')=>{const z=new Zombie(id,x-ZOMBIE_CONFIG[kind].size/2,y-ZOMBIE_CONFIG[kind].size/2,ZOMBIE_CONFIG[kind]);z.receiveHit({damage:1000,point:{x,y},direction:{x:1,y:0},impulse:200,impactSpeed:100,initialSpeed:100,traveledDistance:1,source:'bullet'});return z.consumeDeathFinished();};

test('a death bursts into six recognizable parts once, keeps its fatal flash, and settles permanently',()=>{
  const gore=new ZombieGoreSystem(ground(),seededRandom(3)),event=death();gore.burst(event);gore.burst(event);
  assert.equal(gore.getStats().flying,6);assert.equal(gore.snapshot().flying.filter(p=>p.kind==='head').length,1);
  assert.equal(gore.snapshot().flying.filter(p=>p.kind==='arm').length,2);
  assert.ok(gore.snapshot().flying.every(p=>p.age===0));
  gore.update(.7);assert.equal(gore.getStats().flying,0);assert.equal(gore.getStats().settled,6);
  const before=gore.snapshot();gore.update(1800);assert.deepEqual(gore.snapshot(),before);assert.equal(gore.getStats().physicsSteps,0);
  gore.clear();assert.equal(gore.getStats().settled,0);assert.equal(gore.getStats().drops,0);
});

test('30/60/144 FPS keep flight endpoint, rotation and landing time within one simulation step',()=>{
  let baseline;
  for(const fps of [30,60,144]){
    const gore=new ZombieGoreSystem(ground(),seededRandom(8));gore.burst(death());
    let time=0;while(gore.getStats().flying){gore.update(1/fps);time+=1/fps;assert.ok(time<.7+1/fps);}
    const parts=gore.snapshot().settled;
    assert.equal(parts.length,6);assert.ok(time>=.35&&time<=.7);
    if(baseline)for(let i=0;i<6;i++)for(const key of ['x','y','angle'])assert.ok(Math.abs(parts[i][key]-baseline[i][key])<1e-6,`${fps} ${key}`);
    else baseline=parts;
  }
});

test('fragments respect walls and map borders, water remains are submerged, and hidden fragments draw nothing',()=>{
  for(const at of [[375,225],[25,25]]){
    const map=ground();for(let row=0;row<20;row++)map.tiles[row][8]='wall';map.invalidateNavigation();
    const gore=new ZombieGoreSystem(map,seededRandom(9));gore.burst(death('wall',...at));
    for(let i=0;i<45;i++){
      gore.update(1/60);for(const p of [...gore.snapshot().flying,...gore.snapshot().settled]){
        assert.ok(map.isShapeWalkable(circleCollider(p.x,p.y,p.radius)));assert.ok(p.x>=p.radius&&p.y>=p.radius);
        assert.ok(p.x<=map.width*map.tileSize-p.radius&&p.y<=map.height*map.tileSize-p.radius);
      }
    }
    let draws=0;const ctx={canvas:{width:800,height:600},save(){},restore(){},fillRect(){draws++;}};
    gore.draw(ctx,0,0,()=>false);assert.equal(draws,0);
  }
  const map=ground();map.tiles.forEach(r=>r.fill('water'));map.invalidateNavigation();
  const gore=new ZombieGoreSystem(map,seededRandom(9));gore.burst(death());gore.update(.7);
  assert.ok(gore.snapshot().settled.every(p=>p.wet));
});

test('100 simultaneous deaths retain all 600 fragments while limiting active flight to 256',()=>{
  const gore=new ZombieGoreSystem(ground(),seededRandom(2));
  for(let i=0;i<100;i++)gore.burst(death(`z${i}`));
  assert.equal(gore.getStats().flying,256);assert.equal(gore.getStats().settled,344);
  gore.update(.7);assert.equal(gore.getStats().settled,600);assert.equal(gore.getStats().flying,0);
  gore.update(1800);assert.equal(gore.getStats().physicsSteps,0);assert.equal(gore.getStats().settled,600);
});
