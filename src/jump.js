import {Matrix4,Quaternion,Vector3} from 'three';
import {createFootLegs,solveSole} from './foot-ik.js';
import {createMechanics} from './mechanics.js';
import {onWalkingSurface} from './bench.js';

const GRAVITY=9.80665;
const up=new Vector3(0,1,0);
const ease=u=>u*u*u*(10+u*(-15+6*u));
const easeAcceleration=u=>60*u*(1-u)*(1-2*u);

// All elevations and COM calculations use metres; occurrence transforms use mm.
export function createJump(assembly,calibration,basePivot,initial,links,measureSole,turn=0){
  const legs=createFootLegs(calibration,basePivot),probe=createMechanics(assembly,calibration);
  const chassis=new Matrix4(),rotation=new Quaternion().setFromRotationMatrix(initial);
  const initialPivot=basePivot.clone().applyMatrix4(initial);
  const inverse=rotation.clone().invert(),localUp=up.clone().applyQuaternion(inverse);
  const ground=assembly.nodes[0].min[1],datum=assembly.nodes[0].center;
  for(const leg of legs){
    leg.anchor=measureSole(leg.code,leg.pad);
    leg.anchor.y=ground;
  }
  const mass=links.reduce((s,l)=>s+l.mass,0),point=new Vector3(),target=new Vector3();
  const spinCenter=initialPivot.clone();
  function yawMatrix(yaw,height){
    const yawRotation=new Quaternion().setFromAxisAngle(up,yaw);
    chassis.makeRotationFromQuaternion(yawRotation).multiply(initial);
    const offset=spinCenter.clone().sub(point.copy(spinCenter).applyQuaternion(yawRotation));
    chassis.elements[12]+=offset.x;
    chassis.elements[13]+=height*1000;
    chassis.elements[14]+=offset.z;
    return chassis;
  }
  function pose(height,yaw=0,footYaw=0){
    const angles={};
    for(const leg of legs){
      // In the ground phases the chassis can yaw while the sole stays planted.
      target.copy(leg.anchor).sub(spinCenter).applyAxisAngle(up,footYaw-yaw).add(spinCenter);
      target.sub(initialPivot).multiplyScalar(.001).applyQuaternion(inverse).addScaledVector(localUp,-height);
      angles[leg.code]=solveSole(leg,target,calibration.limits,localUp);
    }
    yawMatrix(yaw,height);
    probe.update(angles,{bodyMatrix:chassis});
    const com=new Vector3();
    for(const link of links)com.addScaledVector(point.copy(link.center).applyMatrix4(probe.matrixFor(link.id)),link.mass/mass/1000);
    return {height,angles,com,matrix:chassis.clone()};
  }
  const neutral=pose(0),samples=[neutral];
  for(const sign of [-1,1]){
    for(let i=1;i<=(sign<0?10:3);i++){
      const p=pose(sign*i*.006);
      if(Object.values(p.angles).some(a=>a.knee>44.5||a.knee<calibration.limits.knee[0]+1||
        a.hip<calibration.limits.hip[0]+1||a.hip>calibration.limits.hip[1]-1))break;
      samples.push(p);
    }
  }
  samples.sort((a,b)=>a.height-b.height);
  const low=samples[0],high=samples.at(-1),stroke=high.com.y-low.com.y;
  if(neutral.com.y-low.com.y<.014 || stroke<.026)return null;
  spinCenter.copy(high.com).multiplyScalar(1000);
  function poseAtCom(y,yaw=0,footYaw=0){
    const i=samples.findIndex(p=>p.com.y>=y);
    let h=high.height;
    if(i===0)h=low.height;
    else if(i>0){
      const a=samples[i-1],b=samples[i];
      h=a.height+(b.height-a.height)*(y-a.com.y)/(b.com.y-a.com.y);
    }
    return pose(h,yaw,footYaw);
  }
  const accel=turn?14.0:7.2,launch=Math.sqrt(2*stroke*accel);
  const prepare=turn?.65:.52,push=launch/accel,air=2*launch/GRAVITY,recover=.63;
  const total=prepare+push*2+air+recover;
  const angle=turn*Math.PI/4,omega=angle/air,windup=omega*push/2;
  function at(elapsed){
    let t=elapsed,phase,acceleration=0,velocity=0,p,yawAcceleration=0,yawRate=0;
    if(t<prepare){
      phase='crouch';const u=t/prepare,d=low.com.y-neutral.com.y;
      p=poseAtCom(neutral.com.y+d*ease(u),-windup*ease(u));
      acceleration=d*easeAcceleration(u)/prepare**2;
      yawAcceleration=-windup*easeAcceleration(u)/prepare**2;
    }else if((t-=prepare)<push){
      phase='push';acceleration=accel;velocity=accel*t;
      yawAcceleration=omega/push;yawRate=yawAcceleration*t;
      p=poseAtCom(low.com.y+accel*t*t/2,-windup+yawRate*t/2);
    }else if((t-=push)<air){
      phase='flight';acceleration=-GRAVITY;velocity=launch-GRAVITY*t;yawRate=omega;
      // Holding limb configuration during the turn keeps axial inertia and
      // angular velocity constant. Rotate around the launch COM in world space.
      const yaw=omega*t,tuck=turn?0:.012*Math.sin(Math.PI*t/air)**2;
      p=pose(high.height-tuck,yaw,yaw);
      const offset=high.com.clone().sub(p.com);
      offset.y+=launch*t-GRAVITY*t*t/2;
      p.matrix.elements[12]+=1000*offset.x;p.matrix.elements[13]+=1000*offset.y;p.matrix.elements[14]+=1000*offset.z;
    }else if((t-=air)<push){
      phase='land';acceleration=accel;velocity=-launch+accel*t;
      yawAcceleration=-omega/push;yawRate=omega+yawAcceleration*t;
      p=poseAtCom(high.com.y-launch*t+accel*t*t/2,angle+omega*t+yawAcceleration*t*t/2,angle);
    }else{
      phase='settle';const u=Math.min(1,(t-push)/recover),d=neutral.com.y-low.com.y;
      p=poseAtCom(low.com.y+d*ease(u),angle+windup*(1-ease(u)),angle);
      acceleration=d*easeAcceleration(u)/recover**2;
      yawAcceleration=-windup*easeAcceleration(u)/recover**2;
    }
    return {...p,phase,acceleration,velocity,yawRate,yawAcceleration,done:elapsed>=total};
  }
  // Preflight the entire foot sweep near the deck, including approach to the
  // tray rim. Evaluate the pad geometry at its planned time and placement.
  if(turn){
    const mounts=legs.map(leg=>({
      id:links.find(link=>link.sole===leg.code).id,
      vertices:calibration.legs[leg.code].soleSupportPoints.map(p=>new Vector3(...p))
    }));
    for(let i=0;i<=32;i++){
      const p=at(i*total/32);
      probe.update(p.angles,{bodyMatrix:p.matrix});
      for(const pad of mounts){
        const matrix=probe.matrixFor(pad.id);
        for(const vertex of pad.vertices){
          point.copy(vertex).applyMatrix4(matrix);
          if(point.y>ground+32)continue;
          if(!onWalkingSurface((point.x-datum[0])/1000,(point.z-datum[2])/1000,.008))
            return {blocked:{ok:false,message:'高跳转向的足垫路径接近台边或托盘，请先移到台面中央。',blockerId:'workbench'}};
        }
      }
    }
  }
  let elapsed=0;
  return {sample(dt){
    elapsed=Math.min(total,elapsed+dt);
    return at(elapsed);
  }};
}
