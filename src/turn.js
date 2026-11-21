import {MathUtils,Quaternion,Vector3} from 'three';
import {createFootLegs,solveSole} from './foot-ik.js';
import {onWalkingSurface} from './bench.js';

const up=new Vector3(0,1,0);
const footOrder=['LR','LF','RR','RF'];
const stepTime=.72, settlingTime=.38;
const smooth=t=>t*t*t*(10+t*(-15+6*t));
const phase=(v,a,b)=>MathUtils.clamp((v-a)/(b-a),0,1);

export function createTurn(calibration,pivot,body,measureSole,radians,first=0,margin=.022){
  const legs=createFootLegs(calibration,pivot),byCode=new Map(legs.map(l=>[l.code,l]));
  const turningSteps=4*Math.max(1,Math.ceil(Math.abs(radians)/MathUtils.degToRad(15)));
  const order=radians>0?footOrder:[...footOrder].reverse();
  const center=body.position, rotation=new Quaternion(),relative=new Quaternion(),inverse=new Quaternion();
  for(const leg of legs){
    leg.start=measureSole(leg.code,leg.pad).sub(center);
    leg.start.y=-center.y;
    leg.anchor=leg.start.clone();
    leg.site=new Vector3();
    leg.neutral=leg.sole.clone().applyQuaternion(body.rotation);
    leg.neutral.y=-center.y;
  }
  // A staggered halt first places each sole back under its own hip.
  const prep=legs.some(l=>l.start.distanceTo(l.neutral)>.045)?4:0;
  const count=turningSteps+prep;
  // Keep a full tread-width reserve at candidate landings before unloading any foot.
  for(let i=0;i<=count;i++){
    relative.setFromAxisAngle(up,radians*i/count);
    for(const leg of legs){
      const site=(prep?leg.neutral:leg.start).clone().applyQuaternion(relative).add(center);
      if(!onWalkingSurface(site.x,site.z,.034))return null;
    }
  }
  const oldBias=new Vector3(),newBias=new Vector3(),bias=new Vector3(),offset=new Vector3();
  const target=new Vector3(),localUp=new Vector3(),position=new Vector3();
  let elapsed=0,step=-1,swing,depart,land;
  function begin(index){
    oldBias.copy(bias);
    step=index;
    if(step===count){newBias.set(0,0,0);return;}
    swing=byCode.get(order[(first+step)%4]);
    depart=swing.anchor.clone();
    const targetAngle=radians*Math.max(0,Math.floor((step-prep)/4)+1)*4/turningSteps;
    land=(prep?swing.neutral:swing.start).clone().applyAxisAngle(up,targetAngle);
    // Transfer weight inside the triangle of planted feet before swinging.
    const otherSide=swing.code[0]==='L'?'R':'L',otherEnd=swing.code[1]==='F'?'R':'F';
    const opposite=byCode.get(otherSide+otherEnd).anchor;
    const side=byCode.get(swing.code[0]+otherEnd).anchor,end=byCode.get(otherSide+swing.code[1]).anchor;
    const normal=new Vector3(end.z-side.z,0,side.x-end.x).normalize();
    if(normal.dot(offset.subVectors(opposite,side))<0)normal.negate();
    const contactYaw=radians*Math.max(0,step-prep+.65)/turningSteps;
    const predicted=offset.copy(body.comOffset).applyAxisAngle(up,contactYaw);
    const distance=normal.dot(predicted.sub(side));
    newBias.copy(normal).multiplyScalar(Math.max(0,margin-distance));
  }
  return {sample(dt){
    const endTime=count*stepTime+settlingTime;
    elapsed=Math.min(endTime,elapsed+dt);
    const next=Math.min(count,Math.floor(elapsed/stepTime));
    if(next!==step){
      if(swing)swing.anchor.copy(land);
      begin(next);
    }
    const t=phase(elapsed,step*stepTime,(step+1)*stepTime);
    const finish=step===count;
    bias.lerpVectors(oldBias,newBias,smooth(finish?phase(elapsed,count*stepTime,endTime):phase(t,0,.42)));
    const angle=radians*(finish?1:Math.max(0,step-prep+smooth(t))/turningSteps);
    relative.setFromAxisAngle(up,angle);
    rotation.multiplyQuaternions(relative,body.rotation);
    inverse.copy(rotation).invert();localUp.copy(up).applyQuaternion(inverse);
    const travel=phase(t,.42,.95);
    const angles={};
    for(const leg of legs){
      target.copy(leg.anchor);
      if(!finish && leg===swing){
        target.lerpVectors(depart,land,smooth(travel));
        target.y+=Math.min(.023,.60*depart.distanceTo(land))*Math.sin(Math.PI*travel)**2;
      }
      leg.site.copy(target).add(center);
      target.sub(bias).applyQuaternion(inverse);
      angles[leg.code]=solveSole(leg,target,calibration.limits,localUp);
    }
    const yawAcceleration=!finish&&step>=prep?
      radians/turningSteps*60*t*(1-t)*(1-2*t)/(stepTime*stepTime):0;
    return {angles,rotation,legs,yawAcceleration,position:position.copy(center).add(bias),done:elapsed>=endTime};
  }};
}
