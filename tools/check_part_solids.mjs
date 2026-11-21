// Use the registered Rapier shapes. Each CAD occurrence must contain the same
// material points as its visual inspection overlay, including mirrored parts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import {Group,Matrix4,Vector3} from 'three';
import {addFasteners} from '../src/fasteners.js';
import {addBatteryBody} from '../src/battery.js';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
const data=name=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+name,import.meta.url)));
const a=data('assembly.json'),k=data('kinematics.json'),frame=new Group();
addBatteryBody(a,frame);addFasteners(a,frame,data('fasteners.json'));
const mech=createMechanics(a,k),d=await createDynamics(a,k,mech);
const origin=new Vector3(a.nodes[0].center[0],a.nodes[0].min[1],a.nodes[0].center[2]);
assert.equal(d.allColliders.size,412);
const probes=[];
for(const [id,c] of d.allColliders){
  assert(c.isEnabled()&&!c.isSensor());
  const record=d.solids.parts.get(id),pieces=d.solids.pieces(id),first=pieces[0];
  const local=new Vector3(...first.center);
  if(first.type==='hull'){
    const mean=new Vector3();for(let i=0;i<first.points.length;i+=3)mean.add(new Vector3().fromArray(first.points,i));
    local.add(mean.multiplyScalar(3/first.points.length));
  }
  if(first.type==='box'){
    local.add(new Vector3(first.half[0]*.21,first.half[1]*.19,first.half[2]*.13));
  }
  const inside=local.applyMatrix4(record.matrix).sub(origin).multiplyScalar(.001);
  assert(c.containsPoint(inside),'unoccupied registered volume '+id);
  assert(!c.containsPoint(inside.clone().addScalar(2)),'unbounded collider '+id);
  // Sweep a physical probe from outside onto the first occupied surface.
  const originOutside=inside.clone().add(new Vector3(1,.13,.07));
  const ray=new R.Ray(originOutside,inside.clone().sub(originOutside).normalize());
  const hit=c.castRayAndGetNormal(ray,2,true);
  assert(hit,'external ray failed '+id);
  const probe=c.castShape({x:0,y:0,z:0},new R.Ball(.001),ray.pointAt(Math.max(0,hit.timeOfImpact-.012)),{x:0,y:0,z:0,w:1},ray.dir,0,2,true);
  assert(probe && probe.time_of_impact>=0 && probe.time_of_impact<.025,'external obstruction passed '+id);
  probes.push(inside);
}
const rail=a.nodes.find(n=>n.name.includes('单面封槽方管-320长'));
const railCollider=d.allColliders.get(rail.id);
const bore=new Vector3(...rail.center).sub(origin).multiplyScalar(.001);
assert(!railCollider.containsPoint(bore),'centre through-bore filled');
console.log(probes.length+' non-sensor mounted workpieces verified with Rapier contact queries; long extrusion bore remains open.');
const id='bpx1_1_23_15';
const rest=d.solids.parts.get(id).matrix.clone();
const relative=rest.clone();relative.elements[12]+=205;relative.elements[13]-=14;
const held=d.world.createCollider(d.solids.descriptor(id,relative));
const p=d.solids.pieces(id)[0];
const sample=new Vector3(...p.center).applyMatrix4(relative).multiplyScalar(.001);
assert(held.containsPoint(sample),'tray release coordinates');
d.world.removeCollider(held,true);
// Exercise both sides of the actual mounted contact filter. The commanded knee
// is limited earlier; introduce a known CAD interference to test solver response
// even if an external force or an inconsistent imported pose bypasses that limit.
let productionHooks;
const step=d.world.step.bind(d.world);
d.world.step=(queue,hooks)=>{productionHooks=hooks;step(queue,hooks);};
d.step(1/240,poseAngles());
d.world.step=step;
for(const code of Object.keys(k.legs)){
  const leg=a.nodes.filter(n=>n.geometry && mech.legFor(n.id)===code);
  const shank=leg.find(n=>n.name.endsWith(' 小腿'));
  const plates=[leg.find(n=>n.name.includes('大腿外侧')),leg.find(n=>n.name.endsWith(' 小腿连杆'))];
  const angles=poseAngles();angles[code].knee=58;mech.update(angles,{bodyMatrix:new Matrix4()});
  for(const plate of plates){
    const installed=d.allColliders.get(shank.id),opposite=d.allColliders.get(plate.id);
    assert.equal(productionHooks.filterContactPair(installed.handle,opposite.handle),R.SolverFlags.COMPUTE_IMPULSE,
      code+' shank surface silenced by a pin-seat exception');
    const test=new R.World({x:0,y:0,z:0});
    test.lengthUnit=.04;test.timestep=1/240;
    const descriptor=n=>d.solids.descriptor(n.id,mech.matrixFor(n.id).clone().multiply(d.solids.parts.get(n.id).matrix));
    const body=test.createRigidBody(R.RigidBodyDesc.dynamic());
    const sh=test.createCollider(descriptor(shank).setMass(1),body);
    const face=test.createCollider(descriptor(plate));
    test.step();
    let depth=0;
    test.contactPair(sh,face,m=>{
      for(let j=0;j<m.numContacts();j++)depth=Math.min(depth,m.contactDist(j));
    });
    assert(depth<-.0001 && new Vector3().copy(body.translation()).length()>1e-6,
      code+' shank did not physically separate from '+plate.name);
    test.free();
  }
}
console.log('All four shanks physically repelled the outer thigh plate and four-bar link at a forced fold.');
d.dispose();

// Drop dissimilar workpieces on a single physical tray and verify that they
// travel, establish a support contact and finish with occupied material above it.
const world=new R.World({x:0,y:-9.80665,z:0});
world.lengthUnit=.04;world.timestep=1/120;
const table=world.createCollider(R.ColliderDesc.cuboid(3,.08,3).setTranslation(0,-.08,0));
const selected=['bpx1_1_23_15',rail.id,'bpx1_1_23_20','bpx1_1_13_bolt1',a.nodes.find(r=>r.part==='manual-battery-cassette').id];
const testBodies=[];
for(const [i,id] of selected.entries()){
  const rec=d.solids.parts.get(id),matrix=rec.matrix.clone();
  const node=a.nodes.find(r=>r.id===id);
  matrix.elements[12]+=i*450-node.center[0];
  matrix.elements[13]+=65-node.min[1];
  matrix.elements[14]-=node.center[2];
  const rb=world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true));
  const col=world.createCollider(d.solids.descriptor(id,matrix).setMass(.1).setFriction(.8),rb);
  testBodies.push({rb,col,id});
}
for(let i=0;i<210;i++)world.step();
for(const {rb,col,id} of testBodies){
  let support=false;
  world.contactPair(table,col,m=>{for(let i=0;i<m.numContacts();i++)if(m.contactDist(i)<.001)support=true;});
  assert(support,id+' never settled on the tray');
  assert(rb.translation().y<-.035 && rb.translation().y>-.14,id+' invalid drop translation');
}
world.free();console.log('Detached leg, pad, extrusion, screw and battery made physical tray contacts.');
