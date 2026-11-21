import {createTurn} from './turn.js';
import {createJump} from './jump.js';
import {createWalk} from './walk.js';
import {trackWalkBalance,distributePatchPressure} from './walk-balance.js';
import {createFootLegs,solveSole} from './foot-ik.js';
import {bench, onBench} from './bench.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {Box3, MathUtils, Matrix4, Quaternion, Vector3} from 'three';
import inertials from './inertials.json' with {type:'json'};
import {createOccupiedBounds,occupiedPairTest} from './solid-bounds.js';
import {createPartSolids} from './part-solids.js';
import {poseAngles} from './mechanics.js';

const LEG_CODES=['LF','RF','LR','RR'];
const JOINTS=['sway','hip','knee'];
const batteryServicePose=poseAngles('liftRF');
const STEP=1/240;
const GRAVITY=9.80665;
const ONE=new Vector3(1,1,1),ZERO=new Vector3();
const IDENTITY={x:0,y:0,z:0,w:1};
// Every moving link can contact the table, fixtures and other links. Rapier
// automatically omits same-rigid-body pairs. Seated interfaces are filtered
// by individual part IDs, not by the leg the parts were manufactured for.
const GROUND=0x00020001,ROBOT=0x00010003;
const DEG=Math.PI/180;
const {clamp}=MathUtils;
// These are teaching-model ratings until calibrated to a motor test sheet.
const DRIVES={
  sway:{maxTorque:24,stiffness:210,damping:4,rate:82},
  hip:{maxTorque:36,stiffness:320,damping:6,rate:77},
  knee:{maxTorque:36,stiffness:320,damping:6,rate:110},
};
let initPromise;
export async function initPhysics(){
  if(!initPromise)initPromise=RAPIER.init();
  await initPromise;
  return RAPIER;
}

const v3=a=>new Vector3().fromArray(a);
function inertiaOfBox(dx,dy,dz) {
  return [(dy*dy+dz*dz)/12,0,0,(dx*dx+dz*dz)/12,0,(dx*dx+dy*dy)/12];
}

function addedInertial(n) {
  const dims=n.max.map((v,i)=>(v-n.min[i])*.001);
  if(n.fastener){
    const [diameter,length]=n.spec.slice(1).split('×').map(Number);
    const volume=Math.PI*(diameter/2)**2*length*.84+Math.PI*(diameter*.81)**2*diameter*.86;
    return {m:volume*7.85e-6,c:n.center,i:inertiaOfBox(...dims)};
  }
  if(n.part==='manual-battery-cassette')return {m:1.12,c:n.center,i:inertiaOfBox(...dims)};
  throw Error('缺少惯性数据 '+n.id);
}

// Jacobi diagonalisation expresses each assembled link's full inertia tensor in
// its principal frame for Rapier, including parallel-axis and off-diagonal terms.
function principalInertia(t){
  const a=[[t[0],t[1],t[2]],[t[1],t[3],t[4]],[t[2],t[4],t[5]]];
  const r=[[1,0,0],[0,1,0],[0,0,1]];
  for(let sweep=0;sweep<8;sweep++){
    for(const [i,j] of [[0,1],[0,2],[1,2]]){
      if(Math.abs(a[i][j])<1e-13)continue;
      const angle=.5*Math.atan2(2*a[i][j],a[j][j]-a[i][i]);
      const c=Math.cos(angle), s=Math.sin(angle);
      for(let k=0;k<3;k++){
        const ai=a[k][i],aj=a[k][j];
        a[k][i]=c*ai-s*aj;a[k][j]=s*ai+c*aj;
        const ri=r[k][i],rj=r[k][j];
        r[k][i]=c*ri-s*rj;r[k][j]=s*ri+c*rj;
      }
      for(let k=0;k<3;k++){
        const ai=a[i][k],aj=a[j][k];
        a[i][k]=c*ai-s*aj;a[j][k]=s*ai+c*aj;
      }
    }
  }
  const rotation=new Matrix4().set(...r[0],0,...r[1],0,...r[2],0,0,0,0,1);
  return {value:new Vector3(...[0,1,2].map(i=>Math.max(1e-9,a[i][i]))),frame:new Quaternion().setFromRotationMatrix(rotation)};
}

export async function createDynamics(assembly,calibration,mech,solids) {
  const R=await initPhysics();
  solids??=createPartSolids(assembly);
  const events=new R.EventQueue(true);
  const world=new R.World({x:0,y:-GRAVITY,z:0});
  world.timestep=STEP;world.lengthUnit=.04;
  world.numSolverIterations=12;
  const root=assembly.nodes[0];
  const origin=new Vector3(root.center[0],root.min[1],root.center[2]);
  const cadWorld=a=>v3(a).sub(origin).multiplyScalar(.001);
  const nodes=new Map(assembly.nodes.map(n=>[n.id,n]));
  const bodies=new Map(), motors=[], contacts=new Map(), supports=new Map(), plateColliders=[];
  const cushionRows=assembly.nodes.filter(n=>/C2底部缓冲垫/.test(n.name));
  const floor=world.createCollider(R.ColliderDesc.cuboid(bench.width/2,bench.thickness/2,bench.length/2).setTranslation(0,-bench.thickness/2,bench.centerZ)
    .setFriction(.81).setCollisionGroups(GROUND).setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS));
  supports.set(floor.handle,'table');
  const frameGravityCenter=[root.center[0],164.63,983.5];
  function body(id,cadPivot){
    const at=cadWorld(cadPivot);
    const rb=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(at.x,at.y,at.z)
      .setCanSleep(false).setLinearDamping(.25).setAngularDamping(.65));
    const part={id,pivot:v3(cadPivot),at,rb,items:[],mass:0,enabled:true,colliders:[]};
    bodies.set(id,part);
    return part;
  }
  const base=body('body',frameGravityCenter);
  const restBodies=new Map();
  restBodies.set(base.id,{position:cadWorld(frameGravityCenter),rotation:IDENTITY});
  const local=(part,point)=>v3(point).sub(part.pivot).multiplyScalar(.001);
  const packColliders=[],allColliders=new Map();
  function coll(part,desc,id,label){
    const col=world.createCollider(desc.setMassProperties(0,ZERO,ZERO,IDENTITY).setFriction(1.02).setRestitution(0).setCollisionGroups(ROBOT).setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS),part.rb);
    part.colliders.push({col,id});
    contacts.set(col.handle,{id,label});allColliders.set(id,col);
    return col;
  }
  function joint(parent,child,code,name,pivot,dir,sign){
    const data=R.JointData.revolute(local(parent,pivot),local(child,pivot),dir);
    const hinge=world.createImpulseJoint(data,parent.rb,child.rb,true);
    hinge.setContactsEnabled(true);
    const operatingLimits=[...calibration.limits[name==='sway'?'roll':name]];
    if(name==='knee')operatingLimits[1]=Math.min(operatingLimits[1],code[0]==='L'?48:46.5);
    const limits=operatingLimits.map(x=>x*DEG*sign);
    hinge.setLimits(Math.min(...limits),Math.max(...limits));
    hinge.configureMotorModel(R.MotorModel.ForceBased);
    hinge.setMotorMaxForce(DRIVES[name].maxTorque);
    motors.push({code,name,parent,child,dir,sign,hinge,operatingLimits,reference:0});
  }
  for(const code of LEG_CODES){
    const def=calibration.legs[code];
    const crank=body(code+'.crank',def.hip),link=body(code+'.link',def.crankPin);
    restBodies.set(crank.id,{position:cadWorld(def.hip),rotation:IDENTITY});
    restBodies.set(link.id,{position:cadWorld(def.crankPin),rotation:IDENTITY});
    const roll=body(code+'.roll',def.roll), thigh=body(code+'.thigh',def.hip), shin=body(code+'.shin',def.kneePin);
    restBodies.set(roll.id,{position:cadWorld(def.roll),rotation:IDENTITY});
    restBodies.set(thigh.id,{position:cadWorld(def.hip),rotation:IDENTITY});
    restBodies.set(shin.id,{position:cadWorld(def.kneePin),rotation:IDENTITY});
    joint(base,roll,code,'sway',def.roll,{x:0,y:0,z:1},code[0]==='L'?1:-1);
    joint(roll,thigh,code,'hip',def.hip,{x:1,y:0,z:0},1);
    joint(thigh,shin,code,'knee',def.kneePin,{x:1,y:0,z:0},-1);
    for(const [parent,child,pin] of [[roll,crank,def.hip],[crank,link,def.crankPin],[link,shin,def.linkPin]]){
      const hinge=world.createImpulseJoint(R.JointData.revolute(local(parent,pin),local(child,pin),{x:1,y:0,z:0}),parent.rb,child.rb,true);
      hinge.setContactsEnabled(true);
    }
  }
  const battery=assembly.nodes.find(n=>n.name.startsWith('C2-8-0-024 '));
  const byPhysicalId=new Map();
  for(const n of assembly.nodes.filter(n=>n.geometry)){
    const p=nodes.get(n.hostId)||n;
    const code=mech.legFor(p.id),group=mech.groupFor(p.id);
    const key=!code||group==='fixed'?'body':code+'.'+group;
    const part=bodies.get(key);
    const data=inertials.parts[n.id]||addedInertial(n);
    const leaf=solids.parts.get(n.id);
    const mount=new Matrix4().makeTranslation(-part.pivot.x,-part.pivot.y,-part.pivot.z);
    const start=mount.clone().multiply(leaf.matrix);
    const label=n.name.includes('077 足端')?calibration.legs[code].name+'足':
      n.name.includes('C2底部缓冲垫')?'机腹缓冲垫':n.name.includes('方管-320长')?'机身长梁':n.name;
    const col=coll(part,solids.descriptor(n.id,start),n.id,label);
    if(n.name.includes('077 足端'))part.soleId=n.id;

    const ancestors=[];
    for(let parent=n;parent;parent=nodes.get(parent.parent))ancestors.push(parent.id);
    const item={id:n.id,ancestors,pack:ancestors.includes(battery.id),m:data.m,c:local(part,data.c),i:data.i};
    part.items.push(item);byPhysicalId.set(n.id,item);
    if(item.pack)packColliders.push({col,id:n.id,mount,base:leaf.matrix,handle:ancestors.some(id=>nodes.get(id)?.name.includes('086 C2电池把手'))});
  }
  const mountPose=new Matrix4(),manipPose=new Matrix4();
  const mb=solids.batteryMotion,hp=v3(mb.origin),rotation=new Matrix4(),axis=v3(mb.axis);
  let lastSlide=NaN,lastHandle=NaN;
  function moveCollider(c,matrix){
    const {position,rotation}=solids.pose(c.id,matrix);
    c.col.setTranslationWrtParent(position);
    c.col.setRotationWrtParent(rotation);
  }
  function updatePack(travel,fraction){
    if(travel===lastSlide&&fraction===lastHandle)return;
    lastSlide=travel;lastHandle=fraction;
    rotation.makeRotationAxis(axis,mb.openDegrees*DEG*fraction);
    rotation.setPosition(hp.clone().sub(hp.clone().applyMatrix4(rotation)));
    for(const c of packColliders){
      manipPose.makeTranslation(-travel,0,0);
      if(c.handle)manipPose.multiply(rotation);
      moveCollider(c,mountPose.copy(c.mount).multiply(manipPose).multiply(c.base));
    }
  }
  function updateMass(part,absent,pull){
    const included=[];
    let mass=0;const center=new Vector3();
    // A hand supports progressively more of the battery load during extraction.
    // Slider displacement still changes its lever arm until the cassette clears.
    for(const item of part.items){
      if(item.ancestors.some(id=>absent.has(id)))continue;
      const fraction=item.pack?clamp((1-pull)/.6,0,1):1;
      const m=item.m*fraction;
      if(m<1e-9)continue;
      const c=item.c.clone();
      if(item.pack)c.x-=.220*pull;
      included.push({m,c,i:item.i});center.addScaledVector(c,m);mass+=m;
    }
    part.mass=mass;
    if(mass>0)center.divideScalar(mass);
    const t=[0,0,0,0,0,0];
    for(const item of included){
      const {x,y,z}=item.c.clone().sub(center);
      const shift=[y*y+z*z,-x*y,-x*z,x*x+z*z,-y*z,x*x+y*y];
      for(let i=0;i<6;i++)t[i]+=item.m*(item.i[i]+shift[i]);
    }
    const prop=principalInertia(t);
    part.rb.setAdditionalMassProperties(Math.max(.0001,mass),center,prop.value,prop.frame,true);
    part.rb.recomputeMassPropertiesFromColliders();
    if(part===base && mass<.0001)part.rb.setEnabled(false);
    else if(part===base && !part.rb.isEnabled()){
      const r=restBodies.get(part.id);part.rb.setEnabled(true);part.rb.setTranslation(r.position,true);part.rb.setRotation(r.rotation,true);
    }
    for(const {col,id} of part.colliders){
      const attached=!(byPhysicalId.get(id)?.ancestors||[id]).some(key=>absent.has(key));
      col.setEnabled(attached);
    }
  }

  const plateWidth=.028,plateLength=.026;
  let standActive=false,standPads=[],standY=0,standTarget=0,standMountY=0;
  function mountStand(){
    const rotation=new Quaternion().copy(base.rb.rotation()), pos=new Vector3().copy(base.rb.translation());
    // Contact the unmodified rail undersides between the two rubber buffers.
    const locations=[];
    for(const x of [-130.209,9.791])for(const z of [942,1026]){
      const p=local(base,[x,88.203,z]).applyQuaternion(rotation).add(pos);
      locations.push(p);
    }
    standMountY=Math.min(...locations.map(p=>p.y));
    standY=Math.max(.006,standMountY-.007);
    standTarget=standY;
    for(const p of locations){
      const rb=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,standY-.006,p.z));
      const col=world.createCollider(R.ColliderDesc.cuboid(plateWidth,.006,plateLength).setCollisionGroups(GROUND).setFriction(.98).setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS),rb);
      plateColliders.push({rb,col,p});supports.set(col.handle,'fixture');
    }
    standActive=true;
  }
  function dismantleStand(){
    for(const {rb,col} of plateColliders){supports.delete(col.handle);world.removeRigidBody(rb);}
    plateColliders.length=0;standPads=[];standActive=false;
  }
  function advanceStand(){
    if(!standActive)return;
    standY+=clamp(standTarget-standY,-.045*STEP,.045*STEP);
    standPads=plateColliders.map(({rb,p})=>{
      rb.setNextKinematicTranslation({x:p.x,y:standY-.006,z:p.z});
      return [p.x,standY,p.z];
    });
  }

  const angles=poseAngles(), bodyMatrix=new Matrix4(), qa=new Quaternion(),qb=new Quaternion(),vec=new Vector3();
  const cadToWorldOrigin=origin.clone().multiplyScalar(.001);
  const baseInverse=new Matrix4().makeTranslation(-base.pivot.x,-base.pivot.y,-base.pivot.z);
  let rotorTime=0,accumulator=0,maskKey='',previousPull=-1,absent=new Set(),massKg=0,awake=true;
  let forces=[],lastCommand='',unchangedTime=0,resting=false;
  function readConfiguration() {
    const bp=base.rb.translation();
    vec.set(bp.x,bp.y,bp.z).add(cadToWorldOrigin).multiplyScalar(1000);
    bodyMatrix.compose(vec,qa.copy(base.rb.rotation()),ONE).multiply(baseInverse);
    for(const m of motors){
      if(!m.child.rb.isEnabled())continue;
      qa.copy(m.parent.rb.rotation()).invert();
      qb.copy(m.child.rb.rotation()).premultiply(qa);
      const tangent=qb.x*m.dir.x+qb.y*m.dir.y+qb.z*m.dir.z;
      let rad=2*Math.atan2(tangent,qb.w);
      if(rad>Math.PI)rad-=2*Math.PI;
      if(rad<-Math.PI)rad+=2*Math.PI;
      angles[m.code][m.name]=rad/DEG*m.sign;
    }
    mech.update(angles,{bodyMatrix});
  }
  function readContactForces() {
    const groups=new Map(),eventLoads=new Map(),unresolved=new Map();
    events.drainContactForceEvents(e=>{
      let support=e.collider1(),leaf=e.collider2();
      if(!supports.has(support)){[support,leaf]=[leaf,support];}
      if(supports.has(support))eventLoads.set(support+'/'+leaf,Math.abs(e.totalForce().y));
    });
    for(const [groundHandle,source] of supports){
      const ground=world.getCollider(groundHandle);
      world.contactPairsWith(ground,other=>{
        const tag=contacts.get(other.handle);
        if(!tag)return;
        const eventN=eventLoads.get(groundHandle+'/'+other.handle);
        let firstPoint=null;
        world.contactPair(ground,other,(m,flipped)=>{
          if(!firstPoint&&m.numSolverContacts()&&Math.abs(m.normal().y)>.55){
            for(let i=0;i<m.numSolverContacts();i++)if(m.solverContactDist(i)<.00025){
              firstPoint=m.solverContactPoint(i);break;
            }
          }
          if(!firstPoint&&Math.abs(m.normal().y)>.55){
            for(let i=0;i<m.numContacts();i++)if(m.contactDist(i)<.00025){
              const p=flipped?m.localContactPoint2(i):m.localContactPoint1(i);
              if(p){firstPoint=new Vector3().copy(p).applyQuaternion(new Quaternion().copy(ground.rotation())).add(ground.translation());break;}
            }
          }
          let impulse=0;
          for(let i=0;i<m.numContacts();i++)impulse+=m.contactImpulse(i);
          const reaction=impulse/STEP*Math.abs(m.normal().y);
          if(reaction<1e-4)return;
          // Front and rear support pads can both carry the same rail.
          // Keep their distinct moment arms in the equilibrium calculation.
          const key=source+'/'+groundHandle+'/'+tag.id;
          let hit=groups.get(key);
          if(!hit){
            const loc=m.solverContactPoint(0)||other.translation();
            hit={id:tag.id,name:tag.label,source,supportKey:key,point:[loc.x,loc.y,loc.z],normalN:0};
            groups.set(key,hit);
          }
          hit.normalN+=reaction;
        });
        // Voxel manifolds do not expose individual contact impulses on every
        // backend. Their solver contact-force event is the net support load.
        if(firstPoint&&!eventN){
          const key=source+'/'+groundHandle+'/'+tag.id;
          if(!groups.has(key))unresolved.set(key,{id:tag.id,name:tag.label,source,supportKey:key,
            point:[firstPoint.x,firstPoint.y,firstPoint.z],normalN:0});
        }
        if(eventN>1e-4){
          const key=source+'/'+groundHandle+'/'+tag.id;
          const hit=groups.get(key);
          if(hit)hit.normalN=eventN;
          else if(firstPoint)groups.set(key,{id:tag.id,name:tag.label,source,supportKey:key,
            point:[firstPoint.x,firstPoint.y,firstPoint.z],normalN:eventN});
        }
      });
    }
    forces=[...groups.values()];
    // When a voxel patch carries load, Rapier can return a contact manifold
    // with no exposed impulses. Recover compressive reactions from the measured
    // footprint and mass only if the chassis is in quasi-static equilibrium.
    if(unresolved.size && vec.copy(base.rb.linvel()).length()<.08 && vec.copy(base.rb.angvel()).length()<.45){
      const measured=forces;
      const remaining=massKg*GRAVITY-measured.reduce((n,c)=>n+c.normalN,0);
      if(remaining>1){
        forces=measured.concat([...unresolved.values()].map(c=>({...c,normalN:remaining/unresolved.size})));
        if(!equilibrium())forces=measured;
      }
    }
  }
  function configure(options) {
    const ids=options.detachedIds||[];
    const key=Array.from(ids).sort().join('|');
    const pull=clamp(options.batteryOut||0,0,1);
    if(key!==maskKey || Math.abs(pull-previousPull)>.001 || (pull!==previousPull && [0,1].includes(pull))){
      absent=new Set(ids);maskKey=key;previousPull=pull;
      for(const part of bodies.values())updateMass(part,absent,pull);
      massKg=[...bodies.values()].reduce((sum,part)=>sum+part.mass,0);
      for(const code of LEG_CODES){
        const roll=bodies.get(code+'.roll'),thigh=bodies.get(code+'.thigh'),shin=bodies.get(code+'.shin');
        let chainConnected=true;
        for(const part of [roll,thigh,shin]){
          chainConnected=chainConnected && part.mass>.0001;
          if(part.rb.isEnabled()!==chainConnected){
            if(chainConnected){
              const pos=local(base,part.pivot.toArray()).applyQuaternion(qa.copy(base.rb.rotation())).add(base.rb.translation());
              part.rb.setTranslation(pos,true);part.rb.setRotation(base.rb.rotation(),true);
              part.rb.setLinvel(base.rb.linvel(),true);part.rb.setAngvel(base.rb.angvel(),true);
            }
            part.rb.setEnabled(chainConnected);
          }
        }
        for(const name of ['crank','link']){
          const part=bodies.get(code+'.'+name);
          const present=chainConnected && part.mass>.0001;
          if(part.rb.isEnabled()!==present){
            if(present){
              const p=local(base,part.pivot.toArray()).applyQuaternion(qa.copy(base.rb.rotation())).add(base.rb.translation());
              part.rb.setTranslation(p,true);part.rb.setRotation(base.rb.rotation(),true);
              part.rb.setLinvel(base.rb.linvel(),true);part.rb.setAngvel(base.rb.angvel(),true);
            }
            part.rb.setEnabled(present);
          }
        }
      }
    }
    updatePack(options.batteryTravelMm??pull*220,options.handleFraction||0);
    if(options.serviceStand && !standActive)mountStand();
    if(standActive){
      if(options.serviceStand)standTarget=Math.max(standTarget,standMountY+(options.serviceLift??.012));
      else {
        // Lower the rails until the feet carry the machine before releasing the pads.
        standTarget=Math.max(.006,standMountY-.009);
        if(standY<=standTarget+1e-6)dismantleStand();
      }
    }

  }
  // Resting contact is a separate mode of Coulomb friction. Accept a static
  // equilibrium only if non-negative normal forces balance the weight and
  // both pitch/roll moments at the *measured* contact positions. Contact
  // weights come from the dynamic solver and resolve indeterminate load sharing.
  // A pure yaw couple has zero net horizontal force. Allocate traction to
  // the measured contact patches in proportion to their compressive loads.
  function applyYawTraction(solved,center,yawAcceleration){
    let inertia=0,weight=0;
    const centroid=new Vector3(),axes=new Quaternion(),principalAxes=new Quaternion(),vertical=new Vector3();
    for(const part of bodies.values())if(part.rb.isEnabled()){
      const principal=part.rb.principalInertia(),p=part.rb.worldCom();
      axes.copy(part.rb.rotation()).multiply(principalAxes.copy(part.rb.principalInertiaLocalFrame()));
      vertical.set(0,1,0).applyQuaternion(axes.invert());
      inertia+=vertical.x**2*principal.x+vertical.y**2*principal.y+vertical.z**2*principal.z+
        part.mass*((p.x-center.x)**2+(p.z-center.z)**2);
    }
    for(const hit of solved){
      centroid.x+=hit.normalN*hit.point[0];centroid.z+=hit.normalN*hit.point[2];weight+=hit.normalN;
    }
    centroid.divideScalar(weight);
    const polar=solved.reduce((sum,h)=>sum+h.normalN*((h.point[0]-centroid.x)**2+(h.point[2]-centroid.z)**2),0);
    if(polar<1e-8)return false;
    const scale=inertia*yawAcceleration/polar;
    if(!Number.isFinite(scale))return false;
    for(const h of solved){
      const fx=h.normalN*scale*(h.point[2]-centroid.z),fz=-h.normalN*scale*(h.point[0]-centroid.x);
      if(Math.hypot(fx,fz)>.81*h.normalN)return false;
      h.tangentN=[fx,fz];
    }
    return true;
  }
  function pointReactions(pressure,effectiveGravity){
    let active=forces.filter(hit=>hit.normalN>.005);
    while(active.length>=3){
      const gram=[[0,0,0],[0,0,0],[0,0,0]];
      const selected=active.map(hit=>{
        const col=[1,hit.point[0]-pressure.x,hit.point[2]-pressure.z];
        const w=Math.max(hit.normalN,.01);
        for(let i=0;i<3;i++)for(let j=0;j<3;j++)gram[i][j]+=w*col[i]*col[j];
        return {hit,w,col};
      });
      const rhs=[massKg*effectiveGravity,0,0];
      for(let i=0;i<3;i++){
        if(Math.abs(gram[i][i])<1e-9)return false;
        const scale=gram[i][i];
        for(let j=i;j<3;j++)gram[i][j]/=scale;
        rhs[i]/=scale;
        for(let k=0;k<3;k++)if(k!==i){
          const factor=gram[k][i];
          for(let j=i;j<3;j++)gram[k][j]-=factor*gram[i][j];
          rhs[k]-=factor*rhs[i];
        }
      }
      const solved=selected.map(({hit,w,col})=>({...hit,normalN:w*col.reduce((sum,c,i)=>sum+c*rhs[i],0)}));
      const tensile=solved.findIndex(hit=>hit.normalN<-.0001);
      if(tensile>=0){active=active.filter((x,i)=>i!==tensile);continue;}
      return solved;
    }
    return null;
  }
  function equilibrium(effectiveGravity=GRAVITY,yawAcceleration=0,walkDemand=null) {
    if(forces.length<3)return false;
    const center=new Vector3();
    for(const part of bodies.values())if(part.rb.isEnabled())center.addScaledVector(part.rb.worldCom(),part.mass);
    center.divideScalar(massKg);
    const pressure=walkDemand?.cop??center;
    const solved=walkDemand?distributePatchPressure(forces,walkDemand,massKg*effectiveGravity):
      pointReactions(pressure,effectiveGravity);
    if(!solved || solved.some(hit=>!Number.isFinite(hit.normalN)))return false;
    if(walkDemand){
      if(!(walkDemand.frictionRatio<=1) || !(effectiveGravity>0))return false;
      for(const h of solved){
        const k=h.normalN/effectiveGravity;
        h.tangentN=[k*walkDemand.acceleration.x,k*walkDemand.acceleration.z];
      }
    }
    if(yawAcceleration&&!applyYawTraction(solved,center,yawAcceleration))return false;
    // Verify every static joint moment against the drive limit, including
    // gravity of the subtree and upstream load transmitted by its foot.
    for(const m of motors){
      if(!m.child.rb.isEnabled())continue;
      const pivot=new Vector3().copy(m.child.rb.translation());
      const direction=new Vector3().copy(m.dir).applyQuaternion(qa.copy(m.parent.rb.rotation()));
      const reaction=new Vector3();
      const subtree=JOINTS.slice(JOINTS.indexOf(m.name)).map(j=>bodies.get(m.code+'.'+({sway:'roll',hip:'thigh',knee:'shin'}[j])));
      for(const link of subtree){
        vec.copy(link.rb.worldCom()).sub(pivot);
        reaction.x+=link.mass*effectiveGravity*vec.z;
        reaction.z-=link.mass*effectiveGravity*vec.x;
        if(walkDemand){
          const {x:ax,z:az}=walkDemand.acceleration;
          reaction.x-=link.mass*vec.y*az;
          reaction.y+=link.mass*(vec.x*az-vec.z*ax);
          reaction.z+=link.mass*vec.y*ax;
        }
      }
      for(const hit of solved){
        const host=bodies.get(m.code+'.'+(hit.name.endsWith('足')||hit.name.endsWith('小腿')?'shin':'thigh'));
        if(!subtree.includes(host)||mech.legFor(hit.id)!==m.code)continue;
        vec.fromArray(hit.point).sub(pivot);
        reaction.x-=hit.normalN*vec.z;reaction.z+=hit.normalN*vec.x;
        if(hit.tangentN){
          const [fx,fz]=hit.tangentN;
          reaction.x+=vec.y*fz;reaction.y+=vec.z*fx-vec.x*fz;reaction.z-=vec.y*fx;
        }
      }
      if(Math.abs(reaction.dot(direction))>DRIVES[m.name].maxTorque)return false;
    }
    forces=solved.filter(hit=>hit.normalN>.005);
    return true;
  }
  // Each station marks the beginning of a straight leg of the route. On the
  // return, traverse these legs in reverse order and turn at their junctions.
  const stations=[];
  let walk=null,walkBlock=null,referenceFeet=null,atWalkOrigin=true,returnTurning=false;
  let balanceTracker=null,walkBalance=null,landing=null,walkRemainder=0;
  const headingVector=new Vector3();
  function walkCenter(){
    // Keep the differentiated measurement in double precision even when the
    // live Rapier backend stores its metre-scale world transforms as f32.
    const center=new Vector3();
    for(const part of bodies.values())if(part.rb.isEnabled() && part.mass>0){
      const mount=part===base?bodyMatrix:mech.matrixFor(part.items[0].id);
      kinPosition.copy(part.rb.localCom()).multiplyScalar(1000).add(part.pivot).applyMatrix4(mount).sub(origin);
      center.addScaledVector(kinPosition,part.mass*.001);
    }
    return center.divideScalar(massKg);
  }
  function bodyHeading(){
    headingVector.set(0,0,1).applyQuaternion(base.rb.rotation());
    return Math.atan2(headingVector.x,headingVector.z);
  }
  function headingTo(station){
    const delta=station.heading-bodyHeading();
    return Math.atan2(Math.sin(delta),Math.cos(delta));
  }
  function turnAtStation(dt,options,delta=0){
    const beginning=!returnTurning;
    returnTurning=true;
    const result=advanceTurn(dt,{...options,gait:false,
      turn:beginning?(delta>0?'left':'right'):undefined,turnRadians:clamp(delta,-Math.PI/6,Math.PI/6)});
    returnTurning=Boolean(result.turnActive);
    if(result.turnBlock)walkBlock=result.turnBlock;
    return state();
  }
  const treadByLeg=new Map(LEG_CODES.map(code=>[code,calibration.legs[code].soleSupportPoints.map(v3)]));
  const kinPosition=new Vector3(),kinRotation=new Quaternion(),kinBody=new Matrix4();
  function syncDrivenBodies(){
    for(const part of bodies.values()){
      const mount=part===base?bodyMatrix:mech.matrixFor(part.items[0].id);
      kinPosition.copy(part.pivot).applyMatrix4(mount).sub(origin).multiplyScalar(.001);
      kinRotation.setFromRotationMatrix(mount);
      part.rb.setTranslation(kinPosition,true);part.rb.setRotation(kinRotation,true);
      part.rb.setLinvel(ZERO,true);part.rb.setAngvel(ZERO,true);
    }
    world.propagateModifiedBodyPositionsToColliders();
  }
  function measureTreadContacts(finitePatch=false){
    forces=[];
    for(const code of LEG_CODES){
      const part=bodies.get(code+'.shin'),matrix=mech.matrixFor(part.soleId);
      if(!part.rb.isEnabled()||!allColliders.get(part.soleId).isEnabled())continue;
      let height=Infinity;
      const patch=new Vector3(),vertices=[];let count=0;
      for(const vertex of treadByLeg.get(code))height=Math.min(height,kinPosition.copy(vertex).applyMatrix4(matrix).y);
      if(height>origin.y+.45 || height<origin.y-.45)continue;
      const top=finitePatch?Math.min(height+.65,origin.y+.65):height+.65;
      for(const vertex of treadByLeg.get(code)){
        kinPosition.copy(vertex).applyMatrix4(matrix);
        if(kinPosition.y>=top)continue;
        kinPosition.sub(origin).multiplyScalar(.001);
        if(finitePatch){
          if(!onBench(kinPosition.x,kinPosition.z))continue;
          vertices.push([kinPosition.x,0,kinPosition.z]);
        }
        patch.add(kinPosition);count++;
      }
      if(!count)continue;
      patch.divideScalar(count);
      if(!onBench(patch.x,patch.z))continue;
      patch.y=0;
      const hit={id:part.soleId,name:calibration.legs[code].name+'足',source:'table',point:patch.toArray(),normalN:massKg*GRAVITY/4};
      if(finitePatch)hit.patch=vertices;
      forces.push(hit);
    }
  }
  let turn=null,turnBlock=null;
  function applyTurnSample(sample,checkWalk){
    const location=sample.position.clone().add(cadToWorldOrigin).multiplyScalar(1000);
    kinBody.compose(location,sample.rotation,ONE).multiply(baseInverse);
    const hit=checkWalk?.(angles,sample.angles,kinBody);
    if(hit&&!hit.ok)return hit;
    bodyMatrix.copy(kinBody);
    for(const code of LEG_CODES)Object.assign(angles[code],sample.angles[code]);
    mech.update(angles,{bodyMatrix});syncDrivenBodies();measureTreadContacts();
    for(const leg of sample.legs){
      const foot=bodies.get(leg.code+'.shin');
      const actual=kinPosition.fromArray(leg.pad).applyMatrix4(mech.matrixFor(foot.soleId)).sub(origin).multiplyScalar(.001);
      if(Math.hypot(actual.x-leg.site.x,actual.z-leg.site.z)>.001){
        return {message:'落足位置超出关节可达范围，转向已停止。'};
      }
    }
    return workpieceTableContact()||(!equilibrium(GRAVITY,sample.yawAcceleration)?{message:'支撑足或关节力矩不足，转向已停止。'}:null);
  }
  function advanceTurn(dt,options){
    const previous=bodyMatrix.clone(),prior=structuredClone(angles),previousForces=forces;
    function restore(){
      bodyMatrix.copy(previous);
      for(const code of LEG_CODES)Object.assign(angles[code],prior[code]);
      mech.update(angles,{bodyMatrix});syncDrivenBodies();forces=previousForces;
    }
    function blocked(hit){turn=null;turnBlock=hit;return state();}
    if(!turn){
      const loaded=new Set(forces.filter(c=>c.normalN>.5&&c.source==='table').map(c=>c.id));
      if(walk||jump||standActive||options.serviceStand||absent.size||options.batteryOut||options.handleFraction||
        !LEG_CODES.every(code=>loaded.has(bodies.get(code+'.shin').soleId))){
        return blocked({message:'请先收步，待四足站稳后转向。'});
      }
      const position=new Vector3().copy(base.rb.translation()),rotation=new Quaternion().copy(base.rb.rotation());
      const comOffset=new Vector3(...state().centerOfMass).sub(position);
      const radians=options.turnRadians??(options.turn==='left'?1:-1)*30*DEG;
      const body={position,rotation,comOffset};
      const measureSole=(code,point)=>{
        const foot=bodies.get(code+'.shin');
        return local(foot,point).applyQuaternion(qb.copy(foot.rb.rotation())).add(foot.rb.translation());
      };
      // The feasible support triangle depends on which foot was last planted
      // before braking. Check alternate starting feet and load transfers with
      // the same mass, IK and contact model before moving the displayed robot.
      let failure;
      for(const margin of [.022,.029,.016,.036]){
        for(let first=0;first<4;first++){
          const make=()=>createTurn(calibration,base.pivot,body,measureSole,radians,first,margin);
          const candidate=make();
          if(!candidate)return blocked({message:'转向后的落足位置接近台边或托盘，请先倒退。'});
          let sample;
          do{
            sample=candidate.sample(.04);
            failure=applyTurnSample(sample);
          }while(!failure&&!sample.done);
          restore();
          if(!failure){turn=make();break;}
        }
        if(turn)break;
      }
      if(!turn)return blocked(failure);
    }
    const sample=turn.sample(dt);
    const invalid=applyTurnSample(sample,options.checkWalk);
    if(invalid){restore();return blocked(invalid);}
    for(const m of motors)m.reference=angles[m.code][m.name];
    awake=!sample.done;resting=sample.done;accumulator=0;
    if(sample.done)turn=null;
    return state();
  }
  // On a mid-swing veto, keep the three planted joints and the last approved
  // chassis pose, then try a vertical placement at the free foot’s current XZ.
  // If that descent itself is obstructed, hold the last feasible supported pose.
  function makeWalkLanding(){
    const loaded=new Set(forces.filter(h=>h.source==='table' && h.normalN>.005).map(h=>h.id));
    if(loaded.size!==3)return null;
    const leg=createFootLegs(calibration,base.pivot).find(l=>!loaded.has(bodies.get(l.code+'.shin').soleId));
    if(!leg)return null;
    const sole=bodies.get(leg.code+'.shin'),matrix=mech.matrixFor(sole.soleId);
    const site=v3(leg.pad).applyMatrix4(matrix).sub(origin).multiplyScalar(.001);
    const bottom=Math.min(...treadByLeg.get(leg.code).map(p=>kinPosition.copy(p).applyMatrix4(matrix).y));
    const height=(bottom-origin.y)*.001;
    if(height<=0)return null;
    const position=new Vector3().copy(base.rb.translation());
    const inverse=new Quaternion().copy(base.rb.rotation()).invert();
    const up=new Vector3(0,1,0).applyQuaternion(inverse);
    let elapsed=0;
    return {code:leg.code,balance:trackWalkBalance(walkCenter(),GRAVITY,.81),sample(dt){
      elapsed=Math.min(.42,elapsed+dt);
      const t=elapsed/.42,blend=t*t*t*(10+t*(-15+6*t));
      const target=new Vector3(site.x,height*(1-blend),site.z).sub(position).applyQuaternion(inverse);
      return {angles:solveSole(leg,target,calibration.limits,up),done:t>=1};
    }};
  }
  function landAfterVeto(dt,options){
    const code=landing.code,old={...angles[code]},priorForces=forces;
    const sample=landing.sample(dt);
    const collision=options.checkWalk?.(angles,{...angles,[code]:sample.angles},bodyMatrix);
    let approved=false;
    if(!collision||collision.ok){
      Object.assign(angles[code],sample.angles);
      mech.update(angles,{bodyMatrix});syncDrivenBodies();measureTreadContacts(true);
      const demand=landing.balance.demand(walkCenter(),dt,forces);
      approved=!workpieceTableContact()&&demand.edge.distance>=.001&&equilibrium(demand.normal,0,demand);
      if(approved)landing.balance.commit(demand);
    }
    if(!approved){
      Object.assign(angles[code],old);
      mech.update(angles,{bodyMatrix});syncDrivenBodies();forces=priorForces;
    }
    for(const m of motors)m.reference=angles[m.code][m.name];
    if(!approved||sample.done)landing=null;
    awake=!!landing;resting=!landing;
    walkBlock=approved?null:collision||{ok:false,message:'落脚路径受阻，已保持当前支撑姿态。'};
    return state();
  }
  function advanceWalk(dt,goal,options){
    // Measure acceleration over at least one physical tick. Very short render
    // intervals otherwise amplify float32 pose noise into false contact loads.
    dt+=walkRemainder;
    if(dt<STEP-1e-9){walkRemainder=dt;return state();}
    walkRemainder=0;
    const returning=options.gait==='return';
    if(!walk){
      walkBlock=null;walkBalance=null;
      if(absent.size || standActive || options.serviceStand || options.batteryOut || options.handleFraction){
        walkBlock={ok:false,message:'请先装回零件并锁合电池，再从四足支撑姿态行走。'};
        return state();
      }
      if(returning && (atWalkOrigin||!stations.length))return state();
      let station=stations.at(-1);
      const delta=station?headingTo(station):0;
      if(Math.abs(delta)>.003){
        if(returning)return turnAtStation(dt,options,delta);
        station=null;
      }
      const position=new Vector3().copy(base.rb.translation());
      const rotation=new Quaternion().copy(base.rb.rotation());
      const comOffset=new Vector3(...state().centerOfMass).sub(position);
      walk=createWalk(calibration,base.pivot,{position,rotation,comOffset},(code,point)=>{
        const part=bodies.get(code+'.shin');
        return local(part,point).applyQuaternion(qb.copy(part.rb.rotation())).add(part.rb.translation());
      },{origin:station,referenceFeet,returning});
      balanceTracker=trackWalkBalance(walkCenter(),GRAVITY,.81);
      referenceFeet=walk.referenceFeet;
      if(!station)stations.push(walk.origin);
      rotorTime=0;
    }
    const previous=bodyMatrix.clone(),prior=structuredClone(angles),priorForces=forces;
    if(dt<=0)return state();
    const feedback={center:walkCenter()};
    let desired=walk.update(dt,options.gait,feedback,options.forwardSpeed);
    function blocked(hit){
      bodyMatrix.copy(previous);for(const code of LEG_CODES)Object.assign(angles[code],prior[code]);
      mech.update(angles,{bodyMatrix});syncDrivenBodies();forces=priorForces;
      walkBlock=hit;walk=null;walkBalance=null;landing=makeWalkLanding();
      awake=!!landing;resting=!landing;accumulator=0;
      return state();
    }
    if(!desired)return blocked({ok:false,message:'下一步将超出台面或进入零件托盘，已停止迈步。'});
    let demand;
    for(let attempt=0;attempt<4;attempt++){
      bodyMatrix.copy(previous);
      const baseLoc=walk.bodyPosition().add(cadToWorldOrigin).multiplyScalar(1000);
      kinBody.compose(baseLoc,walk.rotation,ONE).multiply(baseInverse);
      const geometry=options.checkWalk?.(prior,desired,kinBody);
      if(geometry && !geometry.ok)return blocked(geometry);
      bodyMatrix.copy(kinBody);
      for(const code of LEG_CODES)Object.assign(angles[code],desired[code]);
      mech.update(angles,{bodyMatrix});syncDrivenBodies();measureTreadContacts(true);
      const interference=workpieceTableContact();
      if(interference)return blocked(interference);
      demand=balanceTracker.demand(walkCenter(),dt,forces);
      if(demand.edge.distance>=.001 && equilibrium(demand.normal,0,demand))break;
      if(attempt===3||forces.length<3||!Number.isFinite(demand.edge.distance)||
          demand.normal<=0||demand.frictionRatio>1||demand.edge.distance>=.001){
        return blocked({ok:false,message:'当前足端支撑或可用牵引力不足，已停止迈步。'});
      }
      // The COM acceleration controls the pressure point. Adjust this sample
      // a fraction of a millimetre, keeping the foot targets in world space,
      // then recompute the real CAD, load, friction and torque constraints.
      const pressureGain=1-demand.center.y*demand.accelGain/demand.normal;
      const correction=demand.edge.inward.clone().multiplyScalar((.003-demand.edge.distance)/pressureGain);
      if(correction.length()>.003)return blocked({ok:false,message:'下一步所需重心修正超过当前支撑范围。'});
      desired=walk.adjustBody(correction);
    }
    balanceTracker.commit(demand);
    walkBalance={marginMm:demand.edge.distance*1000,supportCount:forces.length,cop:demand.cop.toArray(),
      acceleration:demand.acceleration.toArray(),frictionRatio:demand.frictionRatio};
    for(const m of motors)m.reference=angles[m.code][m.name];
    rotorTime+=dt;awake=true;resting=false;atWalkOrigin=false;
    if(walk.stopped){
      if(walk.arrived)stations.pop();
      atWalkOrigin=walk.arrived&&stations.length===0;
      walk=null;resting=true;awake=false;accumulator=0;
    }
    return state();
  }
  // For a crouched or staggered stance a plate can reach the table before a
  // nominal joint limit. Query the mounted physical solid when its CAD box
  // approaches the support plane.
  const jumpBounds=assembly.nodes.filter(n=>n.geometry&&!n.name.includes('077 足端')).map(n=>({
    id:n.id,host:n.hostId||n.id,box:new Box3(v3(n.min),v3(n.max))
  }));
  const nearFloor=new Box3();
  function workpieceTableContact(){
    for(const part of jumpBounds){
      if(nearFloor.copy(part.box).applyMatrix4(mech.matrixFor(part.host)).min.y>origin.y+2)continue;
      const col=allColliders.get(part.id);
      const hit=floor.contactShape(col.shape,col.translation(),col.rotation(),0);
      if(hit&&hit.distance<-.0002)return {ok:false,partId:part.id,blockerId:'workbench',
        message:nodes.get(part.id).name+' 与工作台发生干涉，动作已停止。'};
    }
    return null;
  }
  let jump=null,jumpPhase=null,jumpBlock=null,jumpVelocity=0,jumpYawRate=0;
  const jumpBlocked=message=>({ok:false,message});
  function cancelJump(hit){
    if(jumpPhase==='flight'){
      const com=state().centerOfMass;
      for(const part of bodies.values()){
        const p=part.rb.worldCom();
        part.rb.setLinvel({x:jumpYawRate*(p.z-com[2]),y:jumpVelocity,z:-jumpYawRate*(p.x-com[0])},true);
        part.rb.setAngvel({x:0,y:jumpYawRate,z:0},true);
      }
    }
    jump=null;jumpPhase=null;jumpBlock=hit;resting=false;awake=true;unchangedTime=0;
    return state();
  }
  function advanceJump(dt,options){
    if(!jump){
      const loaded=new Set(forces.filter(c=>c.source==='table'&&c.normalN>.5).map(c=>c.id));
      if(walk||options.gait||standActive||options.serviceStand||absent.size||options.batteryOut||options.handleFraction||
        !LEG_CODES.every(code=>loaded.has(bodies.get(code+'.shin').soleId))){
        return cancelJump(jumpBlocked('请在电池锁合、四足着地并停稳后起跳。'));
      }
      const links=[...bodies.values()].map(p=>({mass:p.mass,id:p.items[0].id,sole:p.soleId?mech.legFor(p.soleId):null,
        center:new Vector3().copy(p.rb.localCom()).multiplyScalar(1000).add(p.pivot)}));
      jump=createJump(assembly,calibration,base.pivot,bodyMatrix.clone(),links,(code,p)=>
        new Vector3(...p).applyMatrix4(mech.matrixFor(bodies.get(code+'.shin').soleId)),
        options.jump==='left'?1:options.jump==='right'?-1:0);
      if(jump?.blocked)return cancelJump(jump.blocked);
      if(!jump)return cancelJump(jumpBlocked('当前腿部行程不足，请先恢复站立。'));
      jumpVelocity=0;
    }
    const sample=jump.sample(dt);
    const hit=options.checkWalk?.(angles,sample.angles,sample.matrix);
    if(hit&&!hit.ok)return cancelJump(hit);
    const old=bodyMatrix.clone(),prior=structuredClone(angles),oldForces=forces;
    bodyMatrix.copy(sample.matrix);
    for(const code of LEG_CODES)Object.assign(angles[code],sample.angles[code]);
    mech.update(angles,{bodyMatrix});syncDrivenBodies();
    let invalid=workpieceTableContact();
    if(sample.phase==='flight')forces=[];
    else{
      measureTreadContacts();
      if(!invalid&&(forces.length!==4||!equilibrium(GRAVITY+sample.acceleration,sample.yawAcceleration))){
        invalid=jumpBlocked('足端支撑或驱动力矩不足，已中止跳跃。');
      }
    }
    if(invalid){
      bodyMatrix.copy(old);
      for(const code of LEG_CODES)Object.assign(angles[code],prior[code]);
      mech.update(angles,{bodyMatrix});syncDrivenBodies();forces=oldForces;
      return cancelJump(invalid);
    }
    jumpPhase=sample.phase;jumpVelocity=sample.velocity;jumpYawRate=sample.yawRate;
    for(const m of motors)m.reference=angles[m.code][m.name];
    awake=true;resting=false;accumulator=0;
    if(sample.done){jump=null;jumpPhase=null;resting=true;awake=false;}
    return state();
  }
  function integrate(goal,options) {
    const target=goal;
    advanceStand();
    for(const m of motors){
      const spec=DRIVES[m.name];
      const limit=m.operatingLimits;
      const requested=clamp(target[m.code]?.[m.name]||0,...limit);
      m.reference+=clamp(requested-m.reference,-spec.rate*STEP,spec.rate*STEP);
      m.hinge.configureMotorPosition(m.reference*DEG*m.sign,spec.stiffness*(options.raiseService?3:1),spec.damping*(options.raiseService?1.4:1));
    }
    checkClosePairs();
    world.step(events,contactHooks);
  }
  function reset(){
    turn=null;turnBlock=null;
    jump=null;jumpPhase=null;jumpBlock=null;jumpVelocity=0;
    walk=null;walkBlock=null;walkBalance=null;balanceTracker=null;walkRemainder=0;landing=null;stations.length=0;referenceFeet=null;returnTurning=false;atWalkOrigin=true;nestState=null;nestKey=null;accumulator=0;resting=false;awake=true;unchangedTime=0;lastCommand='';
    absent=new Set();maskKey='';previousPull=-1;rotorTime=0;
    dismantleStand();
    for(const part of bodies.values()){
      const r=restBodies.get(part.id);
      part.rb.setEnabled(true);
      part.rb.setTranslation(r.position,true);
      part.rb.setRotation(r.rotation,true);
      part.rb.setLinvel({x:0,y:0,z:0},true);part.rb.setAngvel({x:0,y:0,z:0},true);
      for(const {col} of part.colliders)col.setEnabled(true);
    }
    for(const m of motors)m.reference=0;
    for(const part of bodies.values())updateMass(part,new Set(),0);
    massKg=[...bodies.values()].reduce((sum,part)=>sum+part.mass,0);
    readConfiguration();forces=[];
    return state();
  }
  let nestState=null, nestKey=null;
  const restingAngles=poseAngles();
  function buildNest(ids){
    // A partially built assembly has no connected leg chain to solve. Index
    // the workpiece on adjustable hard stops below real B-rep surface points.
    // Barycentric weights are vertical reactions satisfying F and both moments.
    const missing=new Set(ids), candidates=[], center=new Vector3();
    let kg=0;
    for(const item of byPhysicalId.values()){
      if(item.ancestors.some(id=>missing.has(id)))continue;
      const n=nodes.get(item.id);
      // All workpieces use the CAD assembly-zero posture of the fixture.
      const c=inertials.parts[n.id]?.c||n.center;
      center.addScaledVector(cadWorld(c),item.m);kg+=item.m;
      let sites=inertials.parts[n.id]?.supports;
      if(!sites){
        sites=[];
        for(const x of [n.min[0],n.max[0]])for(const z of [n.min[2],n.max[2]])sites.push([x,n.min[1],z]);
      }
      for(const p of sites)candidates.push({p:cadWorld(p),id:n.id});
    }
    if(kg)center.divideScalar(kg);
    // Take the lowest accessible vertex in each small projected cell.
    const bins=new Map();
    for(const entry of candidates){
      const point=entry.p;const cell=Math.round(point.x*80)+','+Math.round(point.z*80);
      if(!bins.has(cell)||point.y<bins.get(cell).p.y)bins.set(cell,entry);
    }
    const points=[...bins.values()].sort((a,b)=>a.p.x-b.p.x||a.p.z-b.p.z);
    const turn=(a,b,c)=>(b.p.x-a.p.x)*(c.p.z-a.p.z)-(b.p.z-a.p.z)*(c.p.x-a.p.x);
    function boundary(list){
      const hull=[];
      for(const p of list){
        while(hull.length>=2&&turn(hull.at(-2),hull.at(-1),p)<=0)hull.pop();
        hull.push(p);
      }
      return hull.slice(0,-1);
    }
    const hull=[...boundary(points),...boundary([...points].reverse())];
    let choice=null,score=-Infinity;
    for(let i=0;i<hull.length;i++)for(let j=i+1;j<hull.length;j++)for(let k=j+1;k<hull.length;k++){
      const sites=[hull[i],hull[j],hull[k]];
      const [a,b,c]=sites,area=turn(a,b,c);
      if(Math.abs(area)<1e-12)continue;
      const u=turn({p:center},b,c)/area,v=turn(a,{p:center},c)/area;
      const weights=[u,v,1-u-v],margin=Math.min(...weights);
      if(margin<-.0001)continue;
      const quality=margin+Math.min(.1,Math.abs(area)*2);
      if(quality>score){choice={sites,weights};score=quality;}
    }
    const supported=(choice?.sites||[]).map(({p,id},i)=>({
      id,name:'装配定位支承',source:'fixture',point:p.toArray(),normalN:kg*GRAVITY*choice.weights[i]
    }));
    bodyMatrix.identity();
    mech.update(restingAngles,{bodyMatrix});
    const pads=supported.map(h=>h.point);
    return {angles:restingAngles,active:false,bodyMatrix,contacts:supported,massKg:kg,weightN:kg*GRAVITY,
      totalSupportN:supported.reduce((sum,h)=>sum+h.normalN,0),standPads:pads,standSettled:true,centerOfMass:center.toArray(),gaitTime:0};
  }
  function state() {
    if(nestState)return nestState;
    const center=new Vector3();
    for(const part of bodies.values())if(part.rb.isEnabled())center.addScaledVector(part.rb.worldCom(),part.mass);
    center.divideScalar(Math.max(massKg,.0001));
    return {angles,active:awake,bodyMatrix,contacts:forces,massKg,weightN:massKg*GRAVITY,
      totalSupportN:forces.reduce((sum,x)=>sum+x.normalN,0),standPads,standSettled:standActive&&Math.abs(standY-standTarget)<1e-6,centerOfMass:center.toArray(),gaitTime:rotorTime,gaitActive:!!walk||!!landing||returnTurning,returnTurning,atWalkOrigin,walkBlock,walkBalance,turnActive:!!turn,turnBlock,jumpActive:!!jump,jumpPhase,jumpBlock};
  }
  function step(dt,goal=poseAngles(),options={}){
    turnBlock=null;
    jumpBlock=null;
    const removed=new Set(options.detachedIds||[]);
    const supportedLegs=LEG_CODES.filter(code=>{
      const shank=bodies.get(code+'.shin').items.find(item=>nodes.get(item.id).name.endsWith(' 小腿'));
      return shank && !shank.ancestors.some(id=>removed.has(id));
    }).length;
    const indexed=Boolean(options.serviceStand) && (supportedLegs<3 || options.indexedFixture);
    if(indexed){
      const key=[...removed].sort().join('|');
      if(key!==nestKey){nestState=buildNest(removed);nestKey=key;}
      return nestState;
    }
    if(nestState)reset();
    const command=JSON.stringify([goal,Boolean(options.serviceStand),options.serviceLift,
      [...(options.detachedIds||[])].sort(),Math.round((options.batteryOut||0)*10000)]);
    if(command!==lastCommand){
      resting=false;unchangedTime=0;lastCommand=command;
    }
    // Folded maintenance pose raises the right side past the cassette path.
    // Put the real rails on the four visible jack pads while that leg is unloaded.
    if(LEG_CODES.every(code=>JOINTS.every(joint=>goal[code]?.[joint]===batteryServicePose[code][joint]))){
      options={...options,serviceStand:true,serviceLift:.056,raiseService:true};
    }
    configure(options);
    if(landing)return landAfterVeto(clamp(dt,0,.055),options);
    if(!walk && !options.gait){walkBalance=null;walkRemainder=0;}
    if(returnTurning)return turnAtStation(clamp(dt,0,.055),options);
    if(options.turn||turn)return advanceTurn(clamp(dt,0,.055),options);
    if(options.jump||jump)return advanceJump(clamp(dt,0,.055),options);
    if(options.gait||walk)return advanceWalk(clamp(dt,0,.055),goal,options);
    walkBlock=null;
    if(resting)return state();
    accumulator+=Math.min(Math.max(0,dt),.25);
    while(accumulator+1e-10>=STEP){
      integrate(goal,options);accumulator-=STEP;unchangedTime+=STEP;
      readConfiguration();
      if(!walk && !options.gait && unchangedTime>.55 && (!standActive||(options.serviceStand&&Math.abs(standY-standTarget)<1e-6)) &&
         motors.every(m=>!m.child.rb.isEnabled()||Math.abs(angles[m.code][m.name]-(goal[m.code]?.[m.name]||0))<4.5) &&
         [...bodies.values()].every(({rb})=>!rb.isEnabled()||
           (vec.copy(rb.linvel()).lengthSq()<.0012 && vec.copy(rb.angvel()).lengthSq()<.16))){
        readContactForces();
        if(equilibrium()){
          for(const {rb} of bodies.values())if(rb.isEnabled()){rb.setLinvel({x:0,y:0,z:0},true);rb.setAngvel({x:0,y:0,z:0},true);}
          resting=true;awake=false;accumulator=0;break;
        }
      }
    }
    if(!resting){readContactForces();awake=true;}
    return state();
  }
  const mates=new Map();
  function declareMate(a,b){
    if(!mates.has(a))mates.set(a,new Set());
    if(!mates.has(b))mates.set(b,new Set());
    mates.get(a).add(b);mates.get(b).add(a);
  }
  // Coarse fitted geometry can share tiny portions at the nominal pressed
  // pin, gear and thread interfaces. Only list pairs against the same
  // joint axis or configured fastening seat, with measured home contact.
  for(const n of assembly.nodes.filter(n=>n.geometry)){
    if(n.fastener)declareMate(n.id,n.hostId);
  }
  // Inside each coaxial motor package its shaft, gear, housing and mounting
  // collar share design surfaces. Only these named interfaces at the same
  // mounting location can exchange load through the existing revolute joint.
  function seatingZone(n){
    const host=nodes.get(n.hostId)||n,code=mech.legFor(host.id);
    const zones=[];
    if(!code)return zones;
    const part=host.name;
    const def=calibration.legs[code];
    for(const [name,pivot,pattern,dist] of [
      ['roll',def.roll,/侧摆|齿圈|驱动器盖|固定块|转子线扣/,72],
      ['hip',def.hip,/髋|齿圈|驱动器盖|抱箍|固定块|转子线扣|铜套/,78],
      ['knee-drive',def.hip,/膝关节|齿圈|舵臂|抱箍|大腿内侧|大腿外侧|侧面上盖/,96],
      ['crank-pin',def.crankPin,/舵臂|小腿连杆/,30],
      ['knee-pin',def.kneePin,/小腿|膝关节销|大腿内侧|大腿外侧/,38]
    ]){
      if(!pattern.test(part))continue;
      const dist2=pivot.reduce((sum,x,k)=>sum+Math.max(0,host.min[k]-x,x-host.max[k])**2,0);
      if(dist2<=dist**2)zones.push(code+'/'+name);
    }
    return zones;
  }
  const region=new Map([...allColliders.keys()].map(id=>[id,seatingZone(nodes.get(id))]));
  for(const [a,ca] of allColliders){
    const na=nodes.get(a);
    for(const [b,cb] of allColliders){
      if(a>=b||ca.parent().handle===cb.parent().handle)continue;
      const nb=nodes.get(b);
      if(na.min.some((lo,k)=>lo>nb.max[k]+1.5||nb.min[k]>na.max[k]+1.5))continue;
      // The shank pivots on a separate pin. Its exterior can hit either
      // thigh plate or the four-bar link as the knee folds.
      const shankMate=na.name.endsWith(' 小腿')?nb:nb.name.endsWith(' 小腿')?na:null;
      if(shankMate && /大腿外侧|大腿内侧|小腿连杆/.test(shankMate.name))continue;
      const common=region.get(a).some(k=>region.get(b).includes(k));
      const names=na.name+' '+nb.name;
      const mount=/身体框架支撑件|身体电机两侧固定件/.test(names) && /侧摆|齿圈/.test(names);
      if(common||mount||(/铜套/.test(names)&&/髋关节定子壳/.test(names)))declareMate(a,b);
    }
  }
  const handles=new Map(),closePairs=new Map(),trees=new Map();
  const carry=assembly.nodes.filter(n=>n.name.includes('010 把手件'));
  const stators=assembly.nodes.filter(n=>n.name.includes('034 髋关节定子壳'));
  const boundsFor=n=>{
    if(!trees.has(n.part))trees.set(n.part,createOccupiedBounds(solids.pieces(n.id)));
    return trees.get(n.part);
  };
  for(const h of carry)for(const n of stators){
    if(Math.abs(h.center[2]-n.center[2])>95)continue;
    const colA=allColliders.get(h.id),colB=allColliders.get(n.id),a=colA.handle,b=colB.handle;
    const hostA=bodies.get('body'),hostB=bodies.get(mech.legFor(n.id)+'.roll');
    const info={test:occupiedPairTest(boundsFor(h),boundsFor(n)),a:hostA,b:hostB,
      baseA:solids.parts.get(h.id).matrix.clone().invert().multiply(new Matrix4().makeTranslation(...hostA.pivot.toArray())),
      baseB:new Matrix4().makeTranslation(...hostB.pivot.toArray().map(x=>-x)).multiply(solids.parts.get(n.id).matrix),mayTouch:true};
    if(!handles.has(a))handles.set(a,new Map());handles.get(a).set(b,info);
    closePairs.set(h.id+'|'+n.id,info);
  }
  const aPose=new Matrix4(),bPose=new Matrix4(),unit=new Vector3(1,1,1),boundPos=new Vector3(),boundRot=new Quaternion();
  function setPose(m,rb){
    return m.compose(boundPos.copy(rb.translation()).multiplyScalar(1000),boundRot.copy(rb.rotation()),unit);
  }
  function checkClosePairs(){
    for(const c of closePairs.values()){
      setPose(aPose,c.a.rb);setPose(bPose,c.b.rb);
      const rel=bPose.premultiply(aPose.invert()).premultiply(c.baseA).multiply(c.baseB);
      c.mayTouch=c.test(rel);
    }
  }
  const contactHooks={
    filterContactPair(a,b){
      const pair=handles.get(a)?.get(b)||handles.get(b)?.get(a);
      if(pair&&!pair.mayTouch)return null;
      const left=contacts.get(a),right=contacts.get(b);
      return left&&right&&mates.get(left.id)?.has(right.id)?null:R.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair(){return true;}
  };
  configure({});readConfiguration();
  return {step,state,reset,solids,allColliders,world,contacts,dispose:()=>{events.free();world.free();},driveLimits:DRIVES};
}
