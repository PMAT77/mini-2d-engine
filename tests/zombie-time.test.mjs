import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require=createRequire(import.meta.url),load=p=>require(join(process.env.TEST_BUILD_DIR,p+'.js'));
const {TileMap}=load('map/TileMap'),{VisionSensor}=load('ai/VisionSensor'),{Zombie}=load('enemies/Zombie');
const {ZombieBehavior}=load('enemies/ZombieBehavior'),{MeleeAttackController}=load('enemies/MeleeAttackController');
const {ZOMBIE_CONFIG}=load('enemies/ZombieConfig'),{seededRandom}=load('map/WaterTerrain');
const idle={isKeyDown:()=>false},impact=damage=>({damage,point:{x:125,y:125},direction:{x:1,y:0},impulse:0,impactSpeed:1,initialSpeed:1,traveledDistance:0,source:'bullet'});

test('both types preserve confirmation, stun, attack impact, death and search times at 30/60/144 FPS',()=>{
  const map=new TileMap(12,12,{seed:1,generateWater:false});map.tiles.forEach(r=>r.fill('default'));map.invalidateNavigation();
  for(const kind of ['shambler','runner'])for(const fps of [30,60,144]){
    const config=ZOMBIE_CONFIG[kind],dt=1/fps,within=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<=dt+1e-8,`${kind} ${fps} ${label}: ${actual} / ${expected}`);
    const sensor=new VisionSensor(config.senses);let confirmed=0;
    for(let i=1;i<fps;i++)if(sensor.sense(dt,map,{x:125,y:125,facing:0},{x:250,y:125}).visible){confirmed=i*dt;break;}
    within(confirmed,config.senses.confirmSeconds,'confirmation');

    const z=new Zombie('timed',100,100,config);z.receiveHit(impact(1));let stun=0;
    for(let i=0;i<fps&&z.isStunned();i++){z.update(dt,idle,map);stun+=dt;}
    within(stun,config.knockback.hitStunSeconds,'stun');

    const attack=new MeleeAttackController('a',config);attack.start(0,0);let hits=0,hitTime=0;
    for(let i=1;i<=Math.ceil((config.windup+config.recovery+.1)*fps);i++)if(attack.advance(i*dt)){hits++;hitTime=i*dt;}
    assert.equal(hits,1);within(hitTime,config.windup,'impact');

    z.receiveHit(impact(1000));const event=z.consumeDeathFinished();
    assert.ok(event);assert.equal(z.getLifeState(),'removed');assert.equal(event.elapsedSeconds,0);assert.equal(z.consumeDeathFinished(),null);

    const behavior=new ZombieBehavior(config,seededRandom(1)),point={x:400,y:400};
    behavior.update(0,point,point,null);behavior.update(0,point,null,null);assert.equal(behavior.getState(),'search');
    let search=0;
    for(let i=0;i<fps*8&&behavior.getState()==='search';i++){behavior.update(dt,point,null,null);search+=dt;}
    within(search,config.searchDuration,'search');assert.equal(behavior.getState(),'wander');
  }
});
