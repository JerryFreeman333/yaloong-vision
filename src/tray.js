// Loose parts share the same tray so a second part can land on the first.
import {bench,partsTray} from './bench.js';
import RAPIER from '@dimforge/rapier3d-compat';
import inertials from './inertials.json' with {type:'json'};
import {Box3, Matrix4, Quaternion, Vector3} from 'three';

export function createTray(frame,solids) {
  const world=new RAPIER.World({x:0,y:-9.81,z:0});
  world.timestep=1/120;world.lengthUnit=.12;
  const bodies=new Map(), slots=new Map();
  function plate(x,y,z,dx,dy,dz) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(dx/2,dy/2,dz/2).setTranslation(x,y,z).setFriction(.72));
  }
  plate(0,-bench.thickness/2,bench.centerZ,bench.width,bench.thickness,bench.length);
  plate(partsTray.x,.0035,partsTray.z,partsTray.width,.007,partsTray.length);
  for(const dx of [-.139,.139])plate(partsTray.x+dx,.014,partsTray.z,.002,.016,partsTray.length);
  for(const dz of [-.339,.339])plate(partsTray.x,.014,partsTray.z+dz,partsTray.width,.016,.002);
  let accumulated=0;
  const toWorld=p=>p.multiplyScalar(.001).add(frame.position);
  const toCAD=p=>p.sub(frame.position).multiplyScalar(1000);
  function centerOf(entities){
    const box=new Box3();
    for(const {mesh} of entities){
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
    }
    return {center:box.getCenter(new Vector3()),size:box.getSize(new Vector3())};
  }
  function slot(id,entities) {
    const {size}=centerOf(entities);
    const width=size.x*.001,depth=size.z*.001;
    if(width>.26 || depth>.65)return null;
    const radiusX=Math.max(.011,width/2+.004),radiusZ=Math.max(.011,depth/2+.004);
    for(let z=partsTray.z-.325+radiusZ;z+radiusZ<=partsTray.z+.337;z+=.025){
      for(let x=partsTray.x-.132+radiusX;x+radiusX<=partsTray.x+.136;x+=.025){
        if([...slots.values()].some(s=>Math.abs(s.x-x)<s.rx+radiusX && Math.abs(s.z-z)<s.rz+radiusZ))continue;
        return {x,z,rx:radiusX,rz:radiusZ,target:toCAD(new Vector3(x,.007+size.y*.0005+.027,z))};
      }
    }
    return null;
  }
  function release(id,entities,spot){
    const {center}=centerOf(entities);
    const p=toWorld(center.clone());
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setCcdEnabled(true).setAngularDamping(.16));
    const local=[];
    for(const {id:leafId,mesh,fastener} of entities){
      const base=mesh.matrix.clone();
      base.elements[12]-=center.x;base.elements[13]-=center.y;base.elements[14]-=center.z;
      local.push([mesh,base]);
      const desc=solids.descriptor(leafId,base);
      const cadMass=inertials.parts[leafId]?.m;
      if(cadMass)desc.setMass(cadMass);
      else if(leafId.endsWith('_manual_cassette'))desc.setMass(1.12);
      else desc.setDensity(fastener?7850:2300);
      world.createCollider(desc.setFriction(.65).setRestitution(.04),body);
    }
    if(!body.numColliders()){world.removeRigidBody(body);return false;}
    bodies.set(id,{body,local});slots.set(id,spot);return true;
  }
  function hold(id,held){
    const data=bodies.get(id);
    if(data)data.body.setEnabled(!held);
  }
  function pick(id){
    const data=bodies.get(id);if(!data)return;
    world.removeRigidBody(data.body);bodies.delete(id);slots.delete(id);
  }
  const quat=new Quaternion(), scale=new Vector3(1,1,1), p=new Vector3(), delta=new Matrix4();
  function tick(dt) {
    if(!bodies.size)return false;
    accumulated+=Math.min(.1,dt);
    while(accumulated>=world.timestep){world.step();accumulated-=world.timestep;}
    let active=false;
    for(const {body,local} of bodies.values()){
      if(!body.isEnabled())continue;
      active ||= !body.isSleeping();
      const v=body.translation(),q=body.rotation();toCAD(p.set(v.x,v.y,v.z));
      delta.compose(p,quat.set(q.x,q.y,q.z,q.w),scale);
      for(const [mesh,rest] of local){mesh.matrix.multiplyMatrices(delta,rest);mesh.matrixWorldNeedsUpdate=true;}
    }
    return active;
  }
  return {slot,release,hold,pick,tick,centerOf,has:id=>bodies.has(id),free:()=>world.free()};
}
