// Exercise the same floating-base drive, workpiece contacts and support plane as the viewer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Group,Vector3} from 'three';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+file,import.meta.url)));
const assembly=read('assembly.json'),calibration=read('kinematics.json'),frame=new Group();
addBatteryBody(assembly,frame);addFasteners(assembly,frame,read('fasteners.json'));
const mechanism=createMechanics(assembly,calibration);
const dynamics=await createDynamics(assembly,calibration,mechanism);
const feet=assembly.nodes.filter(row=>row.name.includes('077 足端')).map(row=>{
  const code=mechanism.legFor(row.id),sole=calibration.legs[code].soleSupportPoints.map(p=>new Vector3(...p));
  const low=Math.min(...sole.map(p=>p.y));
  const patch=sole.filter(p=>p.y<low+1);
  const center=patch.reduce((s,p)=>s.add(p),new Vector3()).divideScalar(patch.length);
  return {id:row.id,code,sole,center,peak:0,anchor:null};
});
const ground=assembly.nodes[0].min[1],dt=1/60,goal=poseAngles();
let state;
for(let i=0;i<120;i++)state=dynamics.step(dt,goal);
const initial=state.centerOfMass.slice(),up=new Vector3(0,1,0);
const displacements=[],tilts=[],heights=[],supported=[];
const heading=new Vector3(0,0,1).transformDirection(state.bodyMatrix).setY(0).normalize();
const lateral=new Vector3(heading.z,0,-heading.x);
const datum=new Vector3(...assembly.nodes[0].center);
const startChassis=datum.clone().applyMatrix4(state.bodyMatrix);
const startupX=[0],cruiseX=[],cruiseSpeed=[],margins=[],traction=[];
let lastChassis=startChassis.clone();
const soleClearance=(foot,matrix)=>Math.min(...foot.sole.map(p=>p.clone().applyMatrix4(matrix).y))-ground;
for(let tick=0;tick<1200;tick++){
  state=dynamics.step(dt,goal,{gait:true});
  assert(!state.walkBlock,state.walkBlock?.message);
  const balance=state.walkBalance;
  assert(balance && balance.supportCount>=3,'every walking sample needs a solved support polygon');
  assert(balance.marginMm>0 && balance.frictionRatio<=1,'contact stability and available friction');
  const loaded=state.contacts.filter(contact=>contact.normalN>0 && contact.source==='table');
  const netNormal=loaded.reduce((sum,c)=>sum+c.normalN,0);
  const centerOfPressure=[0,2].map(axis=>loaded.reduce((sum,c)=>sum+c.point[axis]*c.normalN,0)/netNormal);
  assert(Math.hypot(centerOfPressure[0]-balance.cop[0],centerOfPressure[1]-balance.cop[2])<.001,'pressure point must agree with measured normal loads');
  const normalDemand=state.massKg*(9.81+balance.acceleration[1]);
  assert(Math.abs(netNormal-normalDemand)<.15,'vertical ground reaction must support mass and acceleration');
  const chassis=datum.clone().applyMatrix4(state.bodyMatrix);
  const crossTrack=chassis.clone().sub(startChassis).dot(lateral);
  if(tick<360)startupX.push(crossTrack);
  else{
    cruiseX.push(crossTrack);
    cruiseSpeed.push(chassis.clone().sub(lastChassis).dot(heading)/dt);
  }
  lastChassis=chassis;
  margins.push(balance.marginMm);traction.push(balance.frictionRatio);
  tilts.push(up.clone().transformDirection(state.bodyMatrix).angleTo(up)*180/Math.PI);
  heights.push(state.centerOfMass[1]);
  let supporting=0;
  for(const foot of feet){
    const m=mechanism.matrixFor(foot.id);
    const pad=foot.center.clone().applyMatrix4(m);
    foot.peak=Math.max(foot.peak,soleClearance(foot,m));
    const loaded=state.contacts.some(c=>c.id===foot.id&&c.source==='table'&&c.normalN>.8);
    if(loaded){
      supporting++;
      foot.anchor??=pad;
      displacements.push(Math.hypot(pad.x-foot.anchor.x,pad.z-foot.anchor.z));
    } else foot.anchor=null;
  }
  supported.push(supporting);
}
const forward=(state.centerOfMass[2]-initial[2])*1000;
const bob=(Math.max(...heights)-Math.min(...heights))*1000;
const p95=values=>values.sort((a,b)=>a-b)[Math.floor(.95*values.length)];
assert(displacements.length>0,'the measured contact set must include loaded feet');
const slip=p95(displacements),tilt=Math.max(...tilts);
const fourFeet=feet.every(foot=>foot.peak>10);
console.log('20 seconds forward mm',forward.toFixed(1),'max chassis tilt deg',tilt.toFixed(2),
  'height variation mm',bob.toFixed(1),'stance pad displacement p95 mm',slip.toFixed(1),
  'peak clearance mm',Object.fromEntries(feet.map(f=>[f.code,+f.peak.toFixed(1)])));
const span=values=>Math.max(...values)-Math.min(...values);
const lateralSpan=span(cruiseX),startupSpan=span(startupX);
console.log('start through first 6 seconds, chassis lateral peak-to-peak mm',startupSpan.toFixed(3));
console.log('steady cruise chassis lateral peak-to-peak mm',lateralSpan.toFixed(2),
  'forward velocity range mm/s',Math.min(...cruiseSpeed).toFixed(2),Math.max(...cruiseSpeed).toFixed(2),
  'minimum pressure margin mm',Math.min(...margins).toFixed(2),'max traction utilization',Math.max(...traction).toFixed(3));
assert(forward>500,'20 s continuous forward walk');
assert(startupSpan<8,'chassis sways sideways while forming the walking stance');
assert(lateralSpan<5,'side-to-side rocking during straight cruise');
assert(Math.max(...cruiseX.map(Math.abs))<8,'cruise remains centred on the original heading');
assert(slip<2,'loaded feet must stay planted while the chassis advances');
assert(Math.min(...cruiseSpeed)>-1,'backward lurch during steady forward travel');
assert(tilt<7 && bob<23,'chassis attitude during forward walk');
assert(fourFeet,'each foot must actually lift');
assert(supported.filter(n=>n>=3).length>supported.length*.75,'at least three supporting feet for most of the crawl');
for(let i=0;i<210;i++)state=dynamics.step(dt,goal,{gait:false});
assert(!state.gaitActive,'stop controller relinquishes motors after landing');
assert(state.contacts.filter(c=>feet.some(f=>f.id===c.id)&&c.normalN>1).length===4,'all four feet support the stopped machine');

const paused=state.centerOfMass.slice();
const blockedAngles=structuredClone(state.angles),blockedPose=state.bodyMatrix.toArray();
state=dynamics.step(dt,goal,{gait:true,checkWalk:()=>({ok:false,fraction:0,message:'fixture',blockerId:'workpiece'})});
assert.equal(state.walkBlock.blockerId,'workpiece');
assert.deepEqual(state.angles,blockedAngles);
assert.deepEqual(state.bodyMatrix.toArray(),blockedPose);
let swung=false;
for(let i=0;i<90;i++){
  state=dynamics.step(dt,goal,{gait:true});
  assert(!state.walkBlock,state.walkBlock?.message);
  if(feet.some(foot=>soleClearance(foot,mechanism.matrixFor(foot.id))>15)){swung=true;break;}
}
assert(swung,'resume must raise a foot after the four-foot stop');
assert((state.centerOfMass[2]-paused[2])>-.03,'resume must start from its stopped position');
let settling=false,settled=false;
for(let i=0;i<180;i++){
  state=dynamics.step(dt,goal,{gait:false});
  assert(!state.walkBlock,state.walkBlock?.message);
  if(state.gaitActive)settling=true;
  else{
    settled=state.contacts.filter(c=>feet.some(f=>f.id===c.id)&&c.normalN>1).length===4;
    break;
  }
}
assert(settling&&settled,'stopping in the middle of a swing must finish landing on four feet');
console.log('obstructed step, resume at the stopped location and four-foot mid-swing stop passed');
dynamics.dispose();
