import {Box3, Matrix4, Quaternion, Vector3} from 'three';
import {createMechanics} from './mechanics.js';

const CODES=['LF','RF','LR','RR'];
const JOINTS=['sway','hip','knee'];
const IDENTITY=new Matrix4();
const CLEAR={ok:true,fraction:1};

export function createArticulationGuard(assembly,kinematics,entries,guard) {
  const probe=createMechanics(assembly,kinematics);
  const center=new Vector3(...assembly.nodes[0].center);
  const firstOrigin=new Vector3(),lastOrigin=new Vector3(),origin=new Vector3(),shift=new Vector3();
  const firstQ=new Quaternion(),lastQ=new Quaternion(),rotation=new Quaternion();
  const chassis=new Matrix4(),unit=new Vector3(1,1,1);
  return {check(from,to,{bodyMatrix=IDENTITY,endBodyMatrix=bodyMatrix,freeLeaf=new Map()}={}){
    const delta=Math.max(...CODES.flatMap(code=>JOINTS.map(j=>Math.abs(to[code][j]-from[code][j]))));
    const bodyMoves=!bodyMatrix.equals(endBodyMatrix);
    if(delta===0 && !bodyMoves)return CLEAR;
    firstOrigin.copy(center).applyMatrix4(bodyMatrix);
    lastOrigin.copy(center).applyMatrix4(endBodyMatrix);
    firstQ.setFromRotationMatrix(bodyMatrix);lastQ.setFromRotationMatrix(endBodyMatrix);
    const turn=firstQ.angleTo(lastQ)*180/Math.PI;
    probe.update(from,{bodyMatrix});
    const mounted=new Map();
    // Only a set sharing an identical rigid transform can omit internal tests.
    // Held parts retain their rendered pose and remain obstacles for every link.
    for(const entry of entries){
      if(!entry.mesh.visible)continue;
      const host=entry.host||entry.id;
      const rig=probe.groupFor(host);
      let key=rig==='fixed'?'frame':probe.legFor(host)+'.'+rig;
      if(freeLeaf.has(entry.id))key='held';
      let group=mounted.get(key);
      if(!group){
        const start=key==='held'?IDENTITY:probe.matrixFor(host);
        group={key,host,inverse:start.clone().invert(),entries:[],path:[],box:new Box3()};
        mounted.set(key,group);
      }
      group.entries.push(entry);
    }
    const count=Math.max(1,Math.ceil(Math.max(delta,turn)/3));
    const pose=structuredClone(from);
    const groups=[...mounted.values()];
    for(let i=0;i<=count;i++){
      const t=i/count;
      for(const code of CODES)for(const j of JOINTS)pose[code][j]=from[code][j]+(to[code][j]-from[code][j])*t;
      // Interpolate the rigid body's anchor in CAD space; its CAD origin
      // can be over a metre from the robot. Interpolating the raw matrix
      // translation would turn about that unrelated point.
      rotation.slerpQuaternions(firstQ,lastQ,t);
      origin.lerpVectors(firstOrigin,lastOrigin,t).sub(shift.copy(center).applyQuaternion(rotation));
      chassis.compose(origin,rotation,unit);
      probe.update(pose,{bodyMatrix:chassis});
      for(const g of groups){
        const motion=g.key==='held'?IDENTITY:new Matrix4().multiplyMatrices(probe.matrixFor(g.host),g.inverse);
        g.path.push(motion);
      }
    }
    return guard.articulate(groups,count);
  }};
}
