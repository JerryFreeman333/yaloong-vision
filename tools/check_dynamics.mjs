import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Group,Vector3} from 'three';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
import {createProcedures} from '../src/procedures.js';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+file,import.meta.url)));
const a=read('assembly.json'),k=read('kinematics.json'),man=read('procedures.json'),frame=new Group();
addBatteryBody(a,frame);addFasteners(a,frame,read('fasteners.json'));
const proc=createProcedures(a,man),mech=createMechanics(a,k),d=await createDynamics(a,k,mech);
const foot=a.nodes.filter(n=>n.geometry && n.name.includes('077 足端'));
const feet=()=>foot.map(n=>new Vector3(...n.center).applyMatrix4(mech.matrixFor(n.id)));
function run(seconds,pose='stand',options={},fps=60){let s;for(let i=0;i<Math.round(seconds*fps);i++)s=d.step(1/fps,poseAngles(pose),options);return s;}
function staticReaction(state){assert(state.centerOfMass.every(Number.isFinite));assert(state.contacts.every(c=>c.normalN>=0));
  assert(Math.abs(state.weightN-state.totalSupportN)<state.weightN*.05+1e-4, JSON.stringify([state.weightN,state.totalSupportN,state.contacts]));}
let state=run(18);staticReaction(state);
const reference=feet();state=run(12);staticReaction(state);
const maxDrift=Math.max(...feet().map((p,i)=>reference[i].distanceTo(p)));assert(maxDrift<2);
console.log('30 s stance · support',state.totalSupportN.toFixed(2),'N · foot drift over final 12 s',maxDrift.toFixed(3),'mm');
const fullMass=state.massKg,standingCOM=state.centerOfMass[1];
const benchY=a.nodes[0].min[1];
function soleClearance(){
  return Math.min(...foot.flatMap(n=>k.legs[mech.legFor(n.id)].soleSupportPoints.map(
    p=>new Vector3(...p).applyMatrix4(mech.matrixFor(n.id)).y-benchY)));
}
const floorHeight=soleClearance();
assert(floorHeight<2 && !state.standSettled);
state=run(2,'stand',{serviceStand:true});
const lowHeight=soleClearance();
assert(state.standSettled&&lowHeight<52);
state=run(3,'stand',{serviceStand:true,serviceLift:.072});
const highHeight=soleClearance();
assert(state.standSettled&&highHeight>55);
assert(state.contacts.filter(c=>c.source==='fixture').reduce((s,c)=>s+c.normalN,0)>state.weightN*.9);
state=run(1,'stand',{serviceStand:true,serviceLift:.072,detachedIds:foot.map(n=>n.id)});
staticReaction(state);
assert(state.standPads.length===4 && state.contacts.every(c=>c.source==='fixture'));
state=run(.1);
assert(state.standPads.length===4 && soleClearance()>50,'fixture dropped away before unloading');
state=run(3);
assert(state.standPads.length===0 && soleClearance()<2);
console.log('Foot service clearance · floor, normal stand, extended stand',...[floorHeight,lowHeight,highHeight].map(v=>v.toFixed(1)),'mm');

for(let cycle=0;cycle<10;cycle++){
  state=run(2,'crouch');
  assert(state.centerOfMass[1]<standingCOM-.035,'folded posture lowers the centre of mass');
  assert(state.contacts.filter(h=>h.source==='table'&&h.normalN>.5).length>=3,'stable bearing surfaces on the bench');
  staticReaction(state);
  state=run(2,'liftRF');assert(!state.contacts.some(h=>h.name==='右前足'&&h.normalN>.5));
  state=run(2,'liftRF',{batteryOut:1});assert(fullMass-state.massKg>1);staticReaction(state);
  state=run(2,'liftRF',{batteryOut:0});assert(Math.abs(state.massKg-fullMass)<.001);
  d.reset();state=run(2);staticReaction(state);
}
const leg=a.nodes.find(n=>n.name.includes('左前腿组件'));
state=run(1,'stand',{serviceStand:true});assert(state.contacts.some(h=>h.source==='fixture'&&h.normalN>1));
state=run(2,'stand',{serviceStand:true,detachedIds:[leg.id]});staticReaction(state);
assert(state.massKg<fullMass-1 && state.standPads.length===4);
console.log('10 crouch/lift/battery cycles · 3-leg frame on service fixture · restored mass',fullMass.toFixed(3),'kg');

for(const id of ['frame','legs','mount','battery','frame','battery']){
  d.reset();
  const guide=proc.start(id),missing=new Set(guide.visual.stagedIds);
  const members=new Set(guide.chapter.steps.flatMap(x=>x.roots.flatMap(proc.leaves)));
  for(const n of a.nodes.filter(n=>n.geometry)){
    if((id==='frame'&&!members.has(n.id))||(id==='legs'&&mech.legFor(n.id)!==guide.step.leg)||
       (id==='mount'&&proc.batteryMotion(n.id).pack))missing.add(n.id);
  }
  state=run(1,'stand',{detachedIds:[...missing],serviceStand:id!=='battery',indexedFixture:id!=='battery'});
  staticReaction(state);
  if(id==='legs')assert(state.contacts.length>=3);
}
const other=await createDynamics(a,k,createMechanics(a,k));
for(let i=0;i<30*2;i++)other.step(1/30,poseAngles());
const third=await createDynamics(a,k,createMechanics(a,k));
for(let i=0;i<120*2;i++)third.step(1/120,poseAngles());
assert(new Vector3(...other.state().centerOfMass).distanceTo(new Vector3(...third.state().centerOfMass))<1e-5);
d.reset();run(1);
const phases=new Set();
for(let i=0;i<420;i++){
  state=d.step(1/60,poseAngles(),{gait:true});
  assert(state.centerOfMass[1]>.17 && state.centerOfMass.every(Number.isFinite));
  phases.add(state.contacts.filter(x=>x.name.endsWith('足')).map(x=>x.name).sort().join(','));
}
assert(phases.size>=4,JSON.stringify({phases:[...phases],angle:state.angles.LF,time:state.gaitTime}));
d.dispose();other.dispose();third.dispose();
console.log('chapter transitions, step partition 30/120 Hz and physical gait contact phases passed');
