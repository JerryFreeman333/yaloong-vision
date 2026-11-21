import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {BoxGeometry, Object3D, Mesh, Matrix4, Group, Vector3, Quaternion} from 'three';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';
import {createCollisionGuard,readCollisionAsset} from '../src/collisions.js';
import {createProcedures} from '../src/procedures.js';
import {fittingRoute} from '../src/movement.js';
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
function addBox(id,dimensions,origin) {
  const mesh=new Mesh(new BoxGeometry(...dimensions));
  mesh.name=id;mesh.position.fromArray(origin);mesh.updateMatrix();frame.add(mesh);
  nodes.push({id,name:id,part:id,center:origin});
}
addBox('薄型试块',[.8,24,24],[500,300,500]);
addBox('平移试件',[3,3,3],[484,300,500]);
addBox('旋转挡块',[4,5,4],[535.355,350,535.355]);
addBox('铰链试件',[40,3,3],[550,350,500]);
const entries=frame.children.map(mesh=>({mesh,id:mesh.name,base:mesh.matrix.clone()}));
const byId=new Map(entries.map(e=>[e.id,e]));
const unpack=gunzipSync(fs.readFileSync(new URL('collision-v1.bin.gz',dir)));
const parts=readCollisionAsset(unpack.buffer.slice(unpack.byteOffset,unpack.byteOffset+unpack.byteLength));
const guard=await createCollisionGuard(assembly,entries,parts);
const path=(id,v,d=1)=>({ids:[id],at:(t,k,m)=>m.makeTranslation(v.x*t*d,v.y*t*d,v.z*t*d).multiply(byId.get(k).base)});
const thin=guard.sweep({...path('平移试件',new Vector3(32,0,0)),obstacleIds:['薄型试块']});
assert(!thin.ok&&thin.fraction>.3&&thin.fraction<.5);console.log('thin obstacle at',thin.fraction);
const arc=guard.sweep({ids:['铰链试件'],at:(t,id,m)=>m.makeTranslation(500,350,500).multiply(new Matrix4().makeRotationY(-t*Math.PI/2)).multiply(new Matrix4().makeTranslation(50,0,0)),obstacleIds:['旋转挡块']});
assert(!arc.ok && arc.fraction>.1 && arc.fraction<.9);console.log('intermediate arc at',arc.fraction);
const screw=json('fasteners.json').items.find(i=>i.role==='legClamp');
const screwPath=path(screw.id,new Vector3(...screw.axis),45);screwPath.kind='screw';
let result=guard.sweep(screwPath);
console.log('aligned clamp screw',result);
const near=guard.mate({id:screw.id,targetId:screw.hostId,lateralMm:.01,tiltDeg:0});
const wrong=guard.mate({id:screw.id,targetId:'wrong hole'});
const tilted=guard.mate({id:screw.id,tiltDeg:8});
assert(near.ok&&!wrong.ok&&!tilted.ok);
assert.deepEqual(guard.approach(screw.id).toArray(), screw.axis);
const floor=guard.sweep({...path('平移试件',new Vector3(0,-202,0)),floorY:150,obstacleIds:[]});assert(!floor.ok&&floor.blockerId==='workbench');
const mechanics=createMechanics(assembly,json('kinematics.json'));
const battery=nodes.find(n=>n.name.startsWith('C2-8-0-024'));
assert.deepEqual(guard.approach(battery.id).toArray(), [-1,0,0]);
const packIds=entries.filter(e=>e.id.startsWith(battery.id+'_')).map(e=>e.id);
const housing=nodes.find(n=>n.name.startsWith('C2-2-0-079'));
assert(guard.mate({id:battery.id,tiltDeg:.5}).ok);
assert(!guard.mate({id:battery.id,tiltDeg:8}).ok);
const manual=json('procedures.json').batteryMotion;
const origin=new Vector3(...manual.origin),pivot=new Matrix4().makeTranslation(...origin);
const angle=new Matrix4().makeRotationAxis(new Vector3(...manual.axis),manual.openDegrees*Math.PI/180);
const reverse=new Matrix4().makeTranslation(...origin.clone().negate());
const handle=nodes.find(n=>n.name.startsWith('C2-2-0-086'));
mechanics.update(poseAngles('liftRF'));
for(const e of entries)e.mesh.matrix.multiplyMatrices(mechanics.matrixFor(e.id),e.base);
for(const id of packIds.filter(i=>i.startsWith(handle.id+'_'))){
  byId.get(id).mesh.matrix.multiplyMatrices(mechanics.matrixFor(id),pivot).multiply(angle).multiply(reverse).multiply(byId.get(id).base);
}
const snap=new Map(entries.map(e=>[e.id,e.mesh.matrix.clone()]));
const handleIds=packIds.filter(id=>id===handle.id||id.startsWith(handle.id+'_'));
function handlePose(id,out,fraction,displacement){
 const hinge=new Matrix4().makeRotationAxis(new Vector3(...manual.axis),manual.openDegrees*Math.PI/180*fraction);
 return out.copy(mechanics.matrixFor(id)).multiply(new Matrix4().makeTranslation(displacement,0,0)).multiply(pivot).multiply(hinge).multiply(reverse).multiply(byId.get(id).base);
}
for(const [distance,open] of [[-451,true],[0,false]]){
 for(const id of packIds){
   byId.get(id).mesh.matrix.copy(mechanics.matrixFor(id)).multiply(new Matrix4().makeTranslation(distance,0,0)).multiply(byId.get(id).base);
 }
 const checked=guard.sweep({ids:handleIds,kind:'handle',segments:16,at:(t,id,out)=>handlePose(id,out,open?t:1-t,distance)});
 assert(checked.ok,JSON.stringify(checked));
}
for(const e of entries)e.mesh.matrix.copy(snap.get(e.id));

const bat=guard.sweep({ids:packIds,kind:'battery',at:(t,id,out)=>out.makeTranslation(-220*t,0,0).multiply(snap.get(id))});
console.log('battery aligned full scene',bat);
const ins=guard.sweep({ids:packIds,kind:'battery',at:(t,id,out)=>out.makeTranslation(-451*(1-t),0,0).multiply(snap.get(id))});console.log('reverse',ins);
const diag=guard.sweep({ids:packIds,kind:'battery',obstacleIds:[housing.id],at:(t,id,out)=>out.makeTranslation(-220*(1-t),t*13,0).multiply(snap.get(id))});
console.log('battery raised 13mm',diag);assert(!diag.ok);


assert(result.ok,'calibrated clamp screw');
assert(bat.ok && ins.ok,'calibrated battery slide in both directions');
const proc=createProcedures(assembly,json('procedures.json'));
const owners=new Map(nodes.map(n=>[n.id,n]));
const active=entries.filter(e=>e.id.startsWith('bpx'));
for(const e of entries){e.mesh.matrix.copy(e.base);e.mesh.visible=false;}
const routeFile=new URL('approaches.json',dir);
const routes=fs.existsSync(routeFile)?JSON.parse(fs.readFileSync(routeFile)):{};
const find=process.env.BUILD_APPROACH==='1';const failures=[];
let operations=0, movements=0;
for(const chapter of proc.chapters) {
 let st=proc.start(chapter.id);
 const frameMembers=new Set(chapter.steps.flatMap(s=>s.roots.flatMap(proc.leaves)));
 while(!st.complete){
  const step=st.step,id=process.env.REVERSE_SELECTION?st.targetRootIds.at(-1):st.targetRootIds[0];
  const preview=proc.preview('next',{selectedId:id,confirmed:true}).state;
  const staged=new Set(st.visual.stagedIds),nextStaged=new Set(preview.visual.stagedIds);
  const changed=[...staged].filter(i=>!nextStaged.has(i));
  for(const e of active){
    const tag=mechanics.legFor(e.id);
    const outside=(chapter.id==='frame'&&!frameMembers.has(e.id))||(chapter.id==='legs'&&tag!==step.leg)||(chapter.id==='mount'&&packIds.includes(e.id));
    e.mesh.visible=!outside&&!staged.has(e.id);
  }
  if(changed.length && id){
   const key=chapter.id+'/'+id, row=owners.get(id);
   const defaultV=row.fastener?new Vector3(...row.removalAxis).multiplyScalar(Number(row.spec.split('×')[1])+13):mechanics.removalOffset(id,1);
   const choices=[row.fastener ? defaultV.toArray() : (routes[key]||defaultV.toArray())];
   if(find && !row.fastener){
    const local=byId.get(id)||byId.get(changed[0]);
    const axis=new Vector3();
    for (const len of [75,35,18]){
     for(let i=0;i<3;i++)for(const sign of [1,-1]){
       axis.set(...[0,1,2].map(k=>k===i?sign:0));
       choices.push(axis.clone().multiplyScalar(len).toArray());
       if(local)choices.push(axis.clone().transformDirection(local.base).multiplyScalar(len).toArray());
     }
     for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1]){
       if(Math.abs(x)+Math.abs(y)+Math.abs(z)>1)choices.push([x,y,z].map(k=>k*len/Math.hypot(x,y,z)));
     }
    }
   }
   if(find && !row.fastener && (!routes[key]||Math.hypot(...routes[key])<=8.01)){
    const ph=Math.PI*(3-Math.sqrt(5));
    for(const len of [45,22])for(let k=0;k<384;k++){
     const y=1-2*(k+.5)/384,rr=Math.sqrt(1-y*y);
     choices.push([len*rr*Math.cos(ph*k),len*y,len*rr*Math.sin(ph*k)]);
    }
   }
   if(find && !row.fastener && (!routes[key]||Math.hypot(...routes[key])<=8.01))for(const len of [8,4,2,1.5,1])for(let k=0;k<192;k++){
     const y=1-2*(k+.5)/192,rr=Math.sqrt(1-y*y),ph=2.399963229728653*k;
     choices.push([len*rr*Math.cos(ph),len*y,len*rr*Math.sin(ph)]);
   }
   let verdict;
   for(const v of choices){
     const destination=new Map(changed.map(k=>[k,byId.get(k).base]));
     const stagedPose=new Map(changed.map(k=>[k,new Matrix4().makeTranslation(...v).multiply(byId.get(k).base)]));
     const params={ids:changed,kind:row.fastener?'screw':'part',floorY:assembly.nodes[0].min[1]};
     const fastener=row.fastener?row:null;
     verdict=guard.sweep({...params,at:fittingRoute(stagedPose,destination,fastener,Math.hypot(...v),true)});
     if(verdict.ok){
       verdict=guard.sweep({...params,at:fittingRoute(destination,stagedPose,fastener,Math.hypot(...v),false)});
       if(verdict.ok){routes[key]=v;movements++;break;}
     }
   }
   if(!verdict.ok)failures.push([key,step.role,row.name,verdict.partId,verdict.blockerId,owners.get(verdict.blockerId)?.name,verdict.fraction]);
  }
  const result=proc.advance({selectedId:id,confirmed:true});assert(result.ok);st=result.state;operations++;
 }
}
assert.equal(operations,176);
assert.equal(failures.length,0,JSON.stringify(failures));
assert.equal(movements,159);
if(find)fs.writeFileSync(routeFile,JSON.stringify(routes,null,2)+'\n');
console.log('Manual transitions',operations,'approved mounted trajectories',movements,'blocked',failures.length);
console.log(JSON.stringify(failures));
for(const e of active){e.mesh.matrix.copy(e.base);e.mesh.visible=true;}
const feet=nodes.filter(n=>n.name.startsWith('C2-2-2-077 '));
const underLift=assembly.nodes[0].min[1]-63;
for(const foot of feet){
 const pins=nodes.filter(n=>n.parent===foot.parent&&/C2-2-0-09[23] /.test(n.name));
 assert.equal(pins.length,2);
 assert.deepEqual(new Set(proc.removalInfo(foot.id).blockerIds), new Set(pins.map(p=>p.id)));
 function serviceSweep(id,restore=false,floorY=underLift){
   const mesh=byId.get(id),d=routes['service/'+id];
   const at=(t,k,out)=>out.makeTranslation(...d.map(v=>v*(restore?1-t:t))).multiply(mesh.base);
   const checked=guard.sweep({ids:[id],kind:'part',floorY,at});
   if(checked.ok)at(1,id,mesh.mesh.matrix);
   return checked;
 }
 // Removing one of two opposing retainers still leaves the foot trapped.
 for(const [i,pin] of pins.entries()){
   assert(serviceSweep(pin.id).ok);
   assert(proc.detach(pin.id,{confirmed:true}).ok);
   if(i===0)assert.equal(proc.removalInfo(foot.id).canRemove,false);
 }
 assert.equal(serviceSweep(foot.id,false,assembly.nodes[0].min[1]).blockerId,'workbench');
 assert(serviceSweep(foot.id).ok);assert(proc.detach(foot.id,{confirmed:true}).ok);
 assert.equal(proc.removalInfo(pins[0].id).canRestore,false);
 assert(serviceSweep(foot.id,true).ok);assert(proc.restore(foot.id).ok);
 for(const pin of [...pins].reverse()){
   assert(serviceSweep(pin.id,true).ok);assert(proc.restore(pin.id).ok);
 }
}
console.log('All four foot pads and eight retainers removed and reinstalled; insufficient lifting clearance blocks release.');
guard.dispose();
