// Exercise a complete four-beat return on the actual long bench at mixed frame rates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Group,Vector3} from 'three';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
import {addFasteners} from '../src/fasteners.js';
import {addBatteryBody} from '../src/battery.js';

const data=name=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+name,import.meta.url)));
const assembly=data('assembly.json'),calibration=data('kinematics.json'),frame=new Group();
addBatteryBody(assembly,frame);addFasteners(assembly,frame,data('fasteners.json'));
const mech=createMechanics(assembly,calibration),solver=await createDynamics(assembly,calibration,mech);
const neutral=poseAngles(),chassis=new Vector3(...assembly.nodes[0].center);
const feet=assembly.nodes.filter(n=>n.name.includes('077 足端'));
const pads=()=>feet.map(n=>new Vector3(...n.center).applyMatrix4(mech.matrixFor(n.id)));
const trace=[];
let state,ticks=0;
const tick=(gait,dt=1/30,extra={})=>{
  state=solver.step(dt,neutral,{gait,...extra});
  assert(!state.walkBlock,state.walkBlock?.message);
  if(ticks++%4===0 && process.env.BPX_RETURN_TRACE){trace.push({angles:structuredClone(state.angles),bodyMatrix:state.bodyMatrix.toArray()});}
};
const center=()=>chassis.clone().applyMatrix4(state.bodyMatrix);
const planar=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
for(let i=0;i<75;i++)tick(false);
const home=center(),footprints=pads();
function stop(){
  for(let t=0; t<90 && state.gaitActive;t++)tick(false);
  assert(!state.gaitActive && state.contacts.filter(c=>c.normalN>1).length===4);
}
function checkHome(){
  assert(state.atWalkOrigin && !state.gaitActive,'automatic four-foot stop');
  assert(planar(center(),home)<3,'chassis returned to original support point');
  assert(pads().every((p,i)=>planar(p,footprints[i])<2),'each sole returned to original footprint');
  assert.equal(state.contacts.filter(c=>c.normalN>1).length,4);
}
let steppedLegs=new Set(),maxDelta=0;
function back(limit){
  for(let t=0;t<limit && !state.atWalkOrigin;t++){
    const prev=center(),dt=t%9===0?.05:1/30;
    tick('return',dt);
    maxDelta=Math.max(maxDelta,planar(center(),prev));
    assert(state.contacts.length>=3,'each reverse stride has three supports');
    for(const f of feet)if(!state.contacts.some(c=>c.id===f.id))steppedLegs.add(f.id);
  }
}
try{
  for(const advance of [95,.8,4.4]){
    for(let i=0;i<Math.round(advance*30);i++)tick(true);
    stop();
    const reached=center().z-home.z;
    assert(reached>advance*28,'forward distance');
    const before=center();
    state=solver.step(.03,neutral,{gait:'return',checkWalk:()=>({ok:false,fraction:0,message:'obstacle'})});
    assert.equal(state.walkBlock.message,'obstacle');assert.equal(planar(center(),before),0);
    if(advance>5){
      back(136);stop();
      assert(center().z<before.z-75,'reverse gain before mid-return stop');
      assert(!state.atWalkOrigin,'manual stop short of origin');
    }
    back(Math.ceil(advance*35)+350);checkHome();
    for(let i=0;i<90;i++)tick(false);
    checkHome();
    console.log('outbound mm',reached.toFixed(1),'return endpoint error mm',planar(center(),home).toFixed(2));
  }
  // Follow two straight legs, turn again at the far end and backtrack.
  const march=seconds=>{for(let i=0;i<seconds*30;i++)tick(true);stop();};
  const turn=side=>{
    tick(false,1/30,{turn:side});assert(state.turnActive,state.turnBlock?.message);
    for(let i=0;i<450&&state.turnActive;i++)tick(false);
    assert(!state.turnActive&&!state.turnBlock,state.turnBlock?.message);
  };
  march(8);
  turn('left');
  const corner=center();
  const h=new Vector3(0,0,1).transformDirection(state.bodyMatrix);
  march(10);
  const moved=center().sub(corner);
  assert(moved.dot(h)>300,'forward movement along the new heading');
  assert(Math.abs(moved.x*h.z-moved.z*h.x)<8,'lateral walking error after a turn');
  turn('right');
  let bends=0,wasTurning=false,closest=Infinity;
  for(let i=0;i<2500&&!state.atWalkOrigin;i++){
    tick('return');
    assert(!state.turnBlock,state.turnBlock?.message);
    if(state.returnTurning&&!wasTurning)bends++;
    wasTurning=state.returnTurning;
    closest=Math.min(closest,planar(center(),corner));
  }
  checkHome();
  assert(bends>=2 && closest<5,'reverse route should turn at its junction');
  console.log('corner return: realigned',bends,'times; closest corner mm',closest.toFixed(2),
    'home error mm',planar(center(),home).toFixed(2));
  assert.equal(steppedLegs.size,4);
  assert(maxDelta<25,'per-frame chassis continuity');
  console.log('All four legs backed up. Maximum per-frame displacement mm',maxDelta.toFixed(2));
  if(process.env.BPX_RETURN_TRACE)fs.writeFileSync(process.env.BPX_RETURN_TRACE,JSON.stringify(trace));
}finally{solver.dispose();}
