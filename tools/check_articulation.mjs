import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Object3D, Matrix4, Group, Vector3} from 'three';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';
import {createCollisionGuard,readCollisionAsset} from '../src/collisions.js';
import {createArticulationGuard} from '../src/articulation.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';

const dir=new URL('../public/assets/',import.meta.url);
const json=file=>JSON.parse(fs.readFileSync(new URL(file,dir)));
const assembly=json('assembly.json'),cad=fs.readFileSync(new URL('bpx.glb',dir));
const gltf=JSON.parse(cad.subarray(20,20+cad.readUInt32LE(12)));
const frame=new Group();
for(const n of gltf.nodes.filter(n=>n.mesh!==undefined)){
  const obj=new Object3D();obj.name=n.name;obj.matrix.fromArray(n.matrix);
  obj.matrix.decompose(obj.position,obj.quaternion,obj.scale);frame.add(obj);
}
addBatteryBody(assembly,frame);addFasteners(assembly,frame,json('fasteners.json'));
const nodes=assembly.nodes;
const entries=frame.children.map(mesh=>({mesh,id:mesh.name,host:nodes.find(n=>n.id===mesh.name)?.hostId||mesh.name,base:mesh.matrix.clone()}));
const byId=new Map(entries.map(e=>[e.id,e]));
const unpack=gunzipSync(fs.readFileSync(new URL('collision-v1.bin.gz',dir)));
const parts=readCollisionAsset(unpack.buffer.slice(unpack.byteOffset,unpack.byteOffset+unpack.byteLength));
const guard=await createCollisionGuard(assembly,entries,parts);


const calibration=json('kinematics.json'),probe=createMechanics(assembly,calibration);
const monitor=createArticulationGuard(assembly,calibration,entries,guard);
const zero=poseAngles(),rest=new Matrix4();
function poseParts(angles,body=rest){
  probe.update(angles,{bodyMatrix:body});
  for(const e of entries)e.mesh.matrix.multiplyMatrices(probe.matrixFor(e.host),e.base);
}
const crouch=poseAngles('crouch'),lift=poseAngles('liftRF');
for(const [from,to] of [[zero,crouch],[crouch,lift],[lift,crouch],[crouch,zero]]){
  poseParts(from);
  const verdict=monitor.check(from,to);
  assert(verdict.ok,JSON.stringify(verdict));
}
poseParts(zero);
for(const code of ['LF','RF','LR','RR']){
  const target=poseAngles();target[code].knee=80;
  const hit=monitor.check(zero,target);
  assert(!hit.ok && hit.fraction>.5 && hit.fraction<.7,JSON.stringify(hit));
  const blockers=[hit.partId,hit.blockerId].map(id=>nodes.find(n=>n.id===id));
  assert(blockers.every(n=>probe.legFor(n.id)===code));
  assert(blockers.some(n=>n.name.endsWith(' 小腿')));
  console.log(code,blockers.map(n=>n.name).join(' / '),'at',+(hit.fraction*80).toFixed(2),'degrees');
}
// Small repeated commands cannot accumulate penetration past the limit.
const limit=poseAngles();limit.LF.knee=47;
for(let angle=47.1;angle<=50;angle+=.1){
  poseParts(limit);
  const next=structuredClone(limit);next.LF.knee=angle;
  if(!monitor.check(limit,next).ok)break;
  limit.LF.knee=angle;
}
assert(limit.LF.knee<49.35,'repeated microsteps crossed the confirmed 49.36 degree CAD interference');
// This finer command used to step through the surface a few microns at
// a time once already approaching the contact skin.
limit.LF.knee=48.7;
for(let n=0;n<60;n++){
  poseParts(limit);
  const next=structuredClone(limit);next.LF.knee+=.0001;
  if(!monitor.check(limit,next).ok)break;
  limit.LF.knee=next.LF.knee;
}
assert(limit.LF.knee<48.705,'submillidegree increments crossed the contact skin');
poseParts(zero);
// Place a separately held frame screw in the path of a moving foot between
// endpoints. Its original frame/leg classification must no longer matter.
const screw=byId.get(json('fasteners.json').items[0].id);
const foot=nodes.find(n=>probe.legFor(n.id)==='LF' && n.name.includes('077 足端'));
const mid=poseAngles();mid.LF.hip=14;probe.update(mid,{bodyMatrix:rest});
const pathCenter=new Vector3(...foot.center).applyMatrix4(probe.matrixFor(foot.id));
screw.mesh.matrix.makeTranslation(...pathCenter.toArray());
const goal=poseAngles();goal.LF.hip=28;
const held=monitor.check(zero,goal,{freeLeaf:new Map([[screw.id,screw.id]])});
assert(!held.ok && [held.partId,held.blockerId].includes(screw.id),JSON.stringify(held));
console.log('Held screw obstructed a commanded leg at',held.fraction.toFixed(3));
// A loose screw in front of the pad must block pure chassis translation
// even though the legs stay at exactly the same joint coordinates.
poseParts(zero);
screw.mesh.matrix.makeTranslation(foot.center[0],foot.center[1],foot.center[2]+57);
const travel=new Matrix4().makeTranslation(0,0,114);
const crash=monitor.check(zero,zero,{bodyMatrix:rest,endBodyMatrix:travel,freeLeaf:new Map([[screw.id,screw.id]])});
assert(!crash.ok && [crash.partId,crash.blockerId].includes(screw.id) && crash.fraction>.1 && crash.fraction<.9,JSON.stringify(crash));
console.log('Chassis translation with fixed joint angles blocked at',crash.fraction.toFixed(3));
// Include actual positions from the floating-base solver for a complete walk.
// Run with --walk when generating the slower whole-mechanism regression.
async function sampleSolvedWalk(){
  const {createDynamics}=await import('../src/dynamics.js');
  const dynamics=await createDynamics(assembly,calibration,probe);
  let last;
  for(let i=0;i<120;i++)last=dynamics.step(1/60,zero);
  const snapshots=[{angles:structuredClone(last.angles),body:last.bodyMatrix.clone()}];
  for(let tick=1;tick<=480;tick++){
    const state=dynamics.step(1/60,zero,{gait:true});
    if(tick%15===0)snapshots.push({angles:structuredClone(state.angles),body:state.bodyMatrix.clone()});
  }
  dynamics.dispose();
  return snapshots;
}
const trace=process.argv.find(arg=>arg.startsWith('--trace='));
if(trace || process.argv.includes('--walk')){
  const snapshots=trace?JSON.parse(fs.readFileSync(trace.slice(8),'utf8')).map(s=>({
    angles:s.angles,body:new Matrix4().fromArray(s.bodyMatrix)
  })):await sampleSolvedWalk();
  for(let i=1;i<snapshots.length;i++){
    const {angles,body}=snapshots[i-1];
    poseParts(angles,body);
    const hit=monitor.check(angles,snapshots[i].angles,{bodyMatrix:body,endBodyMatrix:snapshots[i].body});
    assert(hit.ok,'step '+i+': '+JSON.stringify(hit));
  }
  console.log('CAD clear on',snapshots.length-1,'measured walk intervals');
}
guard.dispose();
