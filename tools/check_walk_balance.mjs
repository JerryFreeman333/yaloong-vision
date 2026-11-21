// Challenge the actual BPX controller with a biased COM observation and a mid-stride veto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Group,Quaternion,Vector3} from 'three';
import {createWalk} from '../src/walk.js';
import {createDynamics} from '../src/dynamics.js';
import {trackWalkBalance,distributePatchPressure} from '../src/walk-balance.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
import {addFasteners} from '../src/fasteners.js';
import {addBatteryBody} from '../src/battery.js';

const read=name=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+name,import.meta.url)));
const assembly=read('assembly.json'),kinematics=read('kinematics.json'),frame=new Group();
addBatteryBody(assembly,frame);addFasteners(assembly,frame,read('fasteners.json'));
const mechanism=createMechanics(assembly,kinematics);
const solver=await createDynamics(assembly,kinematics,mechanism),goals=poseAngles();
const dt=1/60,root=assembly.nodes[0],origin=new Vector3(root.center[0],root.min[1],root.center[2]);
const pivot=new Vector3(root.center[0],164.63,983.5);
const feet=assembly.nodes.filter(n=>n.name.includes('077 足端'));
// Each rectangle is 20 mm wide. A COP at x = -5 mm is outside the
// centre triangle but inside these soles. At -15 mm the model must refuse.
const patchFixture=[[0,0],[.2,0],[0,.2]].map(([x,z])=>({point:[x,0,z],
  patch:[[-.01,-.006],[.01,-.006],[.01,.006],[-.01,.006]].map(([dx,dz])=>[x+dx,0,z+dz])}));
for(const x of [-.005,-.015]){
  const center=new Vector3(x,.25,.075);
  const demand=trackWalkBalance(center,9.80665,.81).demand(center,dt,patchFixture);
  const loads=distributePatchPressure(patchFixture,demand,100);
  if(x<-.01){assert(demand.edge.distance<0 && !loads);continue;}
  assert(demand.edge.distance>.001);
  const resultant=new Vector3();
  for(const [i,hit] of loads.entries()){
    assert(hit.normalN>0 && Math.abs(hit.point[0]-patchFixture[i].point[0])<=.010001 &&
      Math.abs(hit.point[2]-patchFixture[i].point[2])<=.006001);
    resultant.addScaledVector(new Vector3(...hit.point),hit.normalN);
  }
  assert(Math.abs(loads.reduce((sum,h)=>sum+h.normalN,0)-100)<1e-8);
  assert(resultant.divideScalar(100).distanceTo(demand.cop)<1e-8);
}
function checkActualPatches(state){
  assert.equal(new Set(state.contacts.map(h=>h.id)).size,state.contacts.length);
  for(const hit of state.contacts){
    const code=mechanism.legFor(hit.id),matrix=mechanism.matrixFor(hit.id);
    const vertices=kinematics.legs[code].soleSupportPoints.map(p=>
      new Vector3(...p).applyMatrix4(matrix).sub(origin).multiplyScalar(.001));
    const lowest=Math.min(...vertices.map(v=>v.y));
    assert(lowest<.00045 && lowest>-.00045 && hit.patch.length>0);
    for(const [x,,z] of hit.patch)assert(vertices.some(v=>Math.hypot(v.x-x,v.z-z)<1e-8 &&
      v.y<=Math.min(lowest+.00065,.00065)+1e-8),'pressure site must be a posed CAD vertex at the table');
    // A separating axis for a planar convex polygon is perpendicular to
    // one of its edges. Testing all pairs also covers collinear treads.
    for(const a of hit.patch)for(const b of hit.patch){
      const nx=a[2]-b[2],nz=b[0]-a[0],projection=p=>p[0]*nx+p[2]*nz;
      const ci=projection(hit.point),samples=hit.patch.map(projection);
      assert(ci>=Math.min(...samples)-1e-10 && ci<=Math.max(...samples)+1e-10,'actual pressure escaped the tread');
    }
  }
}
try{
  let state;
  for(let i=0;i<120;i++)state=solver.step(dt,goals);
  const position=pivot.clone().applyMatrix4(state.bodyMatrix).sub(origin).multiplyScalar(.001);
  const rotation=new Quaternion().setFromRotationMatrix(state.bodyMatrix);
  const comOffset=new Vector3(...state.centerOfMass).sub(position);
  const measure=(code,p)=>new Vector3(...p).applyMatrix4(mechanism.matrixFor(feet.find(foot=>mechanism.legFor(foot.id)===code).id)).sub(origin).multiplyScalar(.001);
  const controllers=[-.012,.012].map(offset=>({walk:createWalk(kinematics,pivot,{position,rotation,comOffset},measure),offset}));
  let bestRecovery=0;
  for(let i=0;i<480;i++){
    for(const {walk,offset} of controllers){
      const center=walk.bodyPosition().add(comOffset);center.x+=offset;
      assert(walk.update(dt,true,{center}),'same feet can still carry the load');
    }
    state=solver.step(dt,goals,{gait:true});
    assert(!state.walkBlock,state.walkBlock?.message);
    if(state.contacts.length!==3)continue;
    // The longest side of the supporting triangle joins diagonal legs.
    const sites=state.contacts.map(hit=>new Vector3(...hit.point));
    const pairs=[[0,1],[1,2],[2,0]];
    const [a,b]=pairs.reduce((best,pair)=>sites[pair[0]].distanceToSquared(sites[pair[1]])>
      sites[best[0]].distanceToSquared(sites[best[1]]) ? pair : best);
    const edge=sites[b].clone().sub(sites[a]);
    const normal=new Vector3(-edge.z,0,edge.x).normalize();
    const delta=controllers[1].walk.bodyPosition().sub(controllers[0].walk.bodyPosition());
    const projectedDisturbance=.024*normal.x;
    const residual=projectedDisturbance+normal.dot(delta);
    bestRecovery=Math.max(bestRecovery,Math.abs(projectedDisturbance)-Math.abs(residual));
  }
  assert(bestRecovery>.005,'feedback must reduce the disturbance across the supporting diagonal');
  console.log('Measured COM feedback corrected the projected diagonal loading error by',
    (bestRecovery*1000).toFixed(1),'mm during a three-foot swing.');

  for(let i=0;i<300;i++){
    state=solver.step(dt,goals,{gait:true});
    assert(!state.walkBlock,state.walkBlock?.message);
    checkActualPatches(state);
    if(state.contacts.length===3 && feet.some(foot=>{
      const code=mechanism.legFor(foot.id),transform=mechanism.matrixFor(foot.id);
      return Math.min(...kinematics.legs[code].soleSupportPoints.map(p=>new Vector3(...p).applyMatrix4(transform).y))-origin.y>10;
    }))break;
  }
  assert.equal(state.contacts.length,3);
  const before=state.bodyMatrix.toArray(),angles=structuredClone(state.angles);
  state=solver.step(dt,goals,{gait:true,checkWalk:()=>({ok:false,blockerId:'obstruction'})});
  assert.equal(state.walkBlock?.blockerId,'obstruction');
  assert.deepEqual(state.bodyMatrix.toArray(),before);
  assert.deepEqual(state.angles,angles);
  let landing=false;
  for(let i=0;i<80&&state.gaitActive;i++){
    landing=true;
    state=solver.step(dt,goals,{gait:false});
    assert(state.contacts.length>=3);
    assert.deepEqual(state.bodyMatrix.toArray(),before);
  }
  assert(landing&&!state.gaitActive);
  assert.equal(state.contacts.filter(h=>h.normalN>.1).length,4);
  for(let i=0;i<180;i++){
    state=solver.step(dt,goals,{gait:true});
    assert(!state.walkBlock,state.walkBlock?.message);
  }
  console.log('Reaction points are inside the measured CAD tread patches and reproduce the requested COP.');
  console.log('Rejected a mid-swing path, planted the free foot with the other three loaded, then resumed walking.');
}finally{solver.dispose();}
