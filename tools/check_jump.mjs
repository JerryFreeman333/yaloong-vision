import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Box3,Group,Object3D,Vector3} from 'three';
import R from '@dimforge/rapier3d-compat';
import {bench} from '../src/bench.js';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+file,import.meta.url)));
const assembly=read('assembly.json'),calibration=read('kinematics.json'),frame=new Group();
addBatteryBody(assembly,frame);addFasteners(assembly,frame,read('fasteners.json'));
const mech=createMechanics(assembly,calibration),dynamics=await createDynamics(assembly,calibration,mech);
const feet=assembly.nodes.filter(row=>row.name.includes('077 足端')).map(row=>({
  id:row.id,pad:calibration.legs[mech.legFor(row.id)].soleSupportPoints.map(v=>new Vector3(...v))
}));
const ground=assembly.nodes[0].min[1],goal=poseAngles(),dt=1/120;
const surface=new R.Cuboid(bench.width/2,.035,bench.length/2);
const surfacePosition={x:0,y:-.035,z:bench.centerZ},identity={x:0,y:0,z:0,w:1};
const bounds=assembly.nodes.filter(n=>n.geometry&&!feet.some(f=>n.id===f.id)).map(n=>({
  id:n.id,host:n.hostId||n.id,box:new Box3(new Vector3(...n.min),new Vector3(...n.max)),name:n.name
}));
const aabb=new Box3();
function checkTable(){
  for(const part of bounds){
    if(aabb.copy(part.box).applyMatrix4(mech.matrixFor(part.host)).min.y>ground+2)continue;
    const hit=dynamics.allColliders.get(part.id).contactShape(surface,surfacePosition,identity,0);
    assert(!hit||hit.distance>=-.0005,'workbench penetration '+part.name+' '+hit?.distance);
  }
}

let checkWalk,guard;
if(process.argv.includes('--cad')){
  const {gunzipSync}=await import('node:zlib');
  const {createCollisionGuard,readCollisionAsset}=await import('../src/collisions.js');
  const {createArticulationGuard}=await import('../src/articulation.js');
  const packed=gunzipSync(fs.readFileSync(new URL('../public/assets/collision-v1.bin.gz',import.meta.url)));
  const parts=readCollisionAsset(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength));
  const entries=[...dynamics.solids.parts].map(([id,part])=>({
    id,host:part.n.hostId||id,base:part.matrix,mesh:frame.getObjectByName(id)||new Object3D()
  }));
  guard=await createCollisionGuard(assembly,entries,parts);
  const monitor=createArticulationGuard(assembly,calibration,entries,guard);
  checkWalk=(from,to,endBodyMatrix)=>{
    for(const e of entries)e.mesh.matrix.multiplyMatrices(mech.matrixFor(e.host),e.base);
    return monitor.check(from,to,{bodyMatrix:dynamics.state().bodyMatrix,endBodyMatrix});
  };
}
const tick=(options={})=>dynamics.step(dt,goal,options);
let state;
for(let i=0;i<240;i++)state=tick();
const before=state.bodyMatrix.clone();
const blocked=tick({jump:true,checkWalk:()=>({ok:false,message:'测试障碍'})});
assert.equal(blocked.jumpBlock.message,'测试障碍');
assert(before.equals(blocked.bodyMatrix));
function jump(mode=true){
  const currentHeading=()=>Math.atan2(state.bodyMatrix.elements[8],state.bodyMatrix.elements[10]);
  const heading=currentHeading(),airHeadings=[];
  const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const start=dynamics.state().centerOfMass;
  const phases=new Set(),flight=[],loads=[];
  let sawCouple=false;
  let peak=0,min=Infinity;
  for(let i=0;i<400;i++){
    state=tick({jump:i===0?mode:false,checkWalk});
    assert(!state.jumpBlock,JSON.stringify({i,phase:state.jumpPhase,hit:state.jumpBlock,angles:state.angles}));
    if(!state.jumpActive)break;
    phases.add(state.jumpPhase);checkTable();
    const floorHeights=feet.map(f=>Math.min(...f.pad.map(p=>p.clone().applyMatrix4(mech.matrixFor(f.id)).y-ground)));
    const h=Math.min(...floorHeights);
    peak=Math.max(peak,h);min=Math.min(min,h);
    if(state.jumpPhase==='flight'){
      airHeadings.push(currentHeading());flight.push(state.centerOfMass);assert.equal(state.totalSupportN,0);
    }else{
      assert.equal(state.contacts.filter(c=>c.normalN>0).length,4);
      loads.push(state.totalSupportN/state.weightN);
      if(state.contacts.some(c=>c.tangentN)){
        const net=new Vector3();
        for(const c of state.contacts){
          const [fx,fz]=c.tangentN;
          net.x+=fx;net.z+=fz;
          assert(Math.hypot(fx,fz)<=.81*c.normalN,JSON.stringify([c,i,state.jumpPhase]));
          if(Math.hypot(fx,fz)>.2)sawCouple=true;
        }
        assert(net.length()<1e-4,'yaw couple is balanced horizontally');
      }
    }
  }
  assert.deepEqual([...phases],['crouch','push','flight','land','settle']);
  assert(!state.jumpActive&&state.contacts.length===4);
  assert(Math.hypot(state.centerOfMass[0]-start[0],state.centerOfMass[2]-start[2])<.006);
  if(typeof mode==='string'){
    const dir=mode==='left'?1:-1;
    assert(sawCouple,'takeoff uses measured ground traction');
    assert(Math.abs(delta(currentHeading(),heading)-dir*Math.PI/4)<.001,'signed landing heading');
    assert(delta(airHeadings.at(-1),airHeadings[0])*dir>Math.PI/5,'airborne angular travel');
  }
  assert(peak>(typeof mode==='string'?85:25) && min>-.6,'foot height '+min+' to '+peak);
  const accelerations=flight.slice(1,-1).map((p,i)=>(flight[i][1]+flight[i+2][1]-2*p[1])/dt**2);
  assert(accelerations.every(a=>Math.abs(a+9.80665)<.07));
  const drift=Math.max(...flight.map(p=>Math.hypot(p[0]-flight[0][0],p[2]-flight[0][2])));
  assert(drift<.0001,'airborne COM drift');
  assert(Math.max(...loads)>1.5);
  console.log('minimum clearance',min.toFixed(2),'mm, peak',peak.toFixed(1),'mm, flight samples',flight.length,'peak support/weight',Math.max(...loads).toFixed(2));
}
jump();jump('left');jump('right');jump();
for(let i=0;i<540;i++)state=tick({gait:true});
for(let i=0;i<240;i++)state=tick();
jump();
jump('right');jump('left');
for(let i=0;i<2000;i++){
  state=tick({gait:'return'});
  if(state.atWalkOrigin)break;
}
assert(state.atWalkOrigin);
jump();
// A 30° pivot changes the initial heading and the footprint of the next jump.
for(let i=0;i<1400;i++){
  state=tick({turn:i===0?'left':false,checkWalk});
  assert(!state.turnBlock,state.turnBlock?.message);
  if(!state.turnActive)break;
}
jump('left');jump('right');

// Install the complete robot near a deck edge and next to the tray. Start from
// a fresh solver so all manifolds settle at the translated test placement.
for(const lateral of [.65,-.36]){
  dynamics.reset();
  dynamics.world.forEachRigidBody(rb=>{
    const p=rb.translation();
    rb.setTranslation({x:p.x+lateral,y:p.y,z:p.z},true);
  });
  for(let i=0;i<240;i++)state=tick();
  assert.equal(state.contacts.filter(c=>c.source==='table'&&c.normalN>.5).length,4);
  const before=state.bodyMatrix.clone();
  state=tick({jump:'left',checkWalk});
  assert.equal(state.jumpBlock?.blockerId,'workbench',JSON.stringify([lateral,state.centerOfMass,state.jumpBlock]));
  assert(before.equals(state.bodyMatrix)&&!state.jumpActive);
}
console.log('Ground turn followed by two high jumps passed; unsafe edge and tray jumps blocked before takeoff.');
guard?.dispose();dynamics.dispose();
