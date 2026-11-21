import {Vector3,Quaternion,MathUtils} from 'three';
import {createFootLegs,solveSole} from './foot-ik.js';
import {onWalkingSurface} from './bench.js';

const ORDER=['LF','RR','RF','LR'];
// Bench-scale static crawl. Distances use metres and timing uses seconds.
const interval=0.79;
const speed=0.039;
export const forwardSpeedRange=Object.freeze({min:.03,max:.09,default:.065});
const clearance=.022;
const {clamp}=MathUtils;

const ease=x=>x*x*x*(10+x*(-15+6*x));
const phase=(v,a,b)=>clamp((v-a)/(b-a),0,1);

export function createWalk(calibration,basePivot,bodyPose,measureSole,{origin,referenceFeet,returning=false}={}){
  const legs=createFootLegs(calibration,basePivot);
  const legsByCode=new Map(legs.map(l=>[l.code,l]));
  const position=bodyPose.position,rotation=bodyPose.rotation;
  const fwd=new Vector3(0,0,1).applyQuaternion(rotation);fwd.y=0;fwd.normalize();
  const yaw=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.atan2(fwd.x,fwd.z));
  const undoYaw=yaw.clone().invert(),toTrack=p=>p.sub(position).applyQuaternion(undoYaw);
  const comOffset=bodyPose.comOffset.clone().applyQuaternion(undoYaw);
  const destination=origin?toTrack(origin.position.clone()):new Vector3();
  destination.y=0;
  const length=returning?destination.length():Infinity;
  const direction=returning?destination.clone().normalize():new Vector3(0,0,1);
  const originFeet={},footprint={};
  const order=returning?[...ORDER].reverse():ORDER;
  for(const leg of legs){
    const foot=measureSole(leg.code,leg.pad);
    originFeet[leg.code]=foot.clone();
    leg.anchor=toTrack(foot);
    leg.anchor.y=-position.y;
    // Cruise about the original chassis-local stance after a corner. A foot
    // parked far forward at a stop is a starting anchor, not its new neutral.
    leg.home=referenceFeet?.[leg.code]?.clone()??leg.anchor.clone();
    leg.home.y=-position.y;
    footprint[leg.code]=leg.home.clone();
    leg.finish=origin?toTrack(origin.feet[leg.code].clone()).sub(destination):leg.anchor.clone();
    leg.finish.y=-position.y;
  }
  // The CAD standing pose places the battery mass aft of the mid-foot line.
  // Center the cruise footprint under the load, within the available joint range.
  if(!referenceFeet){
    const footCenter=legs.reduce((sum,leg)=>sum+leg.home.z,0)/legs.length;
    const stanceOffset=clamp(comOffset.z-footCenter,-.10,.10)-.005;
    for(const leg of legs){leg.home.z+=stanceOffset;footprint[leg.code].copy(leg.home);}
  }
  origin??={position:position.clone(),heading:Math.atan2(fwd.x,fwd.z),feet:originFeet};
  let step=-1,swing,elapsed=0,travel=0,braking=false,settle=0,arrived=false;
  let startIndex=0;
  if(returning || referenceFeet){
    let trailing=-.001;
    for(const [i,code] of order.entries()){
      const leg=legsByCode.get(code);
      const offset=leg.anchor.clone().sub(leg.home).dot(direction);
      if(offset<trailing){trailing=offset;startIndex=i;}
    }
  }
  let holdFeet=false,blocked=false,travelSpeed=0;
  const up=new Vector3(0,1,0);
  const localTilt=yaw.clone().invert().multiply(rotation),bodyRotation=rotation.clone();
  const localUp=new Vector3(),undoTilt=new Quaternion(),levelTilt=new Quaternion();
  // In the CAD parking stance the measured mass is behind the footprint
  // centre. Advance on four planted treads before lifting a hind leg.
  const preloadTime=referenceFeet?0:1.55;
  let activeTime=0,cadenceSpeed=speed;
  const currentTargets=legs.map(()=>new Vector3());
  const balanceCorrection=new Vector3();
  const supportBias=new Vector3(),prevBias=new Vector3(),nextBias=new Vector3();
  const target=new Vector3(),virtualBase=new Vector3();
  // A parked chassis can have its feet forward of the mass-centred cruise
  // stance. On return, carry the trunk over this changing support polygon.
  // Once all original footprints are occupied, finish the final weight shift.
  const parkedLead = returning ? clamp(legs.reduce((sum,leg)=>sum+leg.finish.z-leg.home.z,0)/4,-.075,.075) : 0;
  function approachLead(distance,time){
    return parkedLead*ease(phase(distance-length,-.32,0))*ease(phase(time,0,1.2));
  }
  function beginStep(){
    step++;swing=legsByCode.get(order[(startIndex+step)%4]);
    swing.depart=swing.anchor.clone();
    const upcoming=Math.min(length,travel+(step===0?preloadTime*speed:0)+speed*interval*2.35);
    swing.land=swing.home.clone();
    if(returning)swing.land.lerp(swing.finish,ease(phase(upcoming-length,-speed*interval*4,0)));
    swing.land.addScaledVector(direction,upcoming);
    // Check the swept tread before unloading the foot. Keep a radius about
    // the measured contact patch to account for the whole toe and heel.
    const checks=Math.max(1,Math.ceil(swing.land.distanceTo(swing.depart)/.012));
    for(let i=0;i<=checks;i++){
      target.lerpVectors(swing.depart,swing.land,i/checks).applyQuaternion(yaw).add(position);
      if(!onWalkingSurface(target.x,target.z,.034)){blocked=true;return;}
    }
    // Short aligning steps at the origin need less clearance than a full stride.
    swing.clearance=returning?Math.min(clearance,.60*swing.land.distanceTo(swing.depart)):clearance;
    prevBias.copy(supportBias);nextBias.set(0,0,0);
    // Triangle edge between the diagonal pair. Move the COM into the
    // three-foot support polygon before unloading the remaining foot.
    const diagonal=legsByCode.get((swing.code[0]==='L'?'R':'L')+(swing.code[1]==='F'?'R':'F'));
    const side=legsByCode.get(swing.code[0]+(swing.code[1]==='F'?'R':'F'));
    const end=legsByCode.get((swing.code[0]==='L'?'R':'L')+swing.code[1]);
    const line=end.anchor.clone().sub(side.anchor);
    const normal=new Vector3(line.z,0,-line.x).normalize();
    if(normal.dot(diagonal.anchor.clone().sub(side.anchor))<0)normal.negate();
    const predicted=direction.clone().multiplyScalar(Math.min(length,travel+speed*interval*.65)).add(comOffset);
    predicted.z+=approachLead(Math.min(length,travel+speed*interval*.65),activeTime+interval*.65);
    const distance=normal.dot(predicted.sub(side.anchor));
    // In steady travel, the trunk crosses each supporting diagonal as the
    // fore and hind feet exchange load. During stance changes, shift along
    // the heading to obtain the same crossing from the measured footprint.
    const reserve=referenceFeet || step>3 ? .009 : 0;
    const startTransfer=1-ease(phase(step,2,5));
    const endTransfer=returning ? ease(phase(travel-length,-.32,-.16)) : 0;
    const longitudinalShift=clamp(Math.max(0,reserve-distance)/normal.z,-.075,.075);
    nextBias.z=Math.max(startTransfer,endTransfer)*longitudinalShift;
  }
  function update(dt,wantWalk,feedback,forwardSpeed){
    const requested=Number.isFinite(forwardSpeed)&&!returning ? clamp(forwardSpeed,forwardSpeedRange.min,forwardSpeedRange.max) : speed;
    const desiredCadenceSpeed=braking||!wantWalk ? speed : requested;
    const nextCadence=cadenceSpeed+clamp(desiredCadenceSpeed-cadenceSpeed,-.035*dt,.035*dt);
    // Keep the measured footholds and stride length, and slew the stepping
    // frequency. COM acceleration and ground forces still use elapsed seconds.
    const phaseDt=dt*(nextCadence+cadenceSpeed)/(2*speed);
    cadenceSpeed=nextCadence;
    if(feedback?.center){
      // Observe where the articulated mass actually moved relative to the trunk.
      const measured=toTrack(feedback.center.clone()).sub(virtualBase);
      comOffset.lerp(measured,1-Math.exp(-dt/.22));
    }
    if(step<0)beginStep();
    if(!wantWalk && !braking){
      braking=true;
      if(elapsed<interval*0.5){
        // On a stop during weight transfer all four feet are still planted.
        // Preserve that anchor and settle directly without launching another stride.
        holdFeet=true;
      }
    }
    if(elapsed>=interval && !braking){
      swing.anchor.copy(swing.land);
      if(returning && travel>=length && legs.every(l=>target.copy(l.anchor).sub(l.finish).sub(destination).lengthSq()<1e-10)){
        arrived=true;braking=true;holdFeet=true;
        prevBias.copy(supportBias);nextBias.copy(supportBias);
      }else{elapsed-=interval;beginStep();}
    }
    if(blocked)return null;
    elapsed=Math.min(interval,elapsed+Math.min(phaseDt,Math.max(0,activeTime+phaseDt-preloadTime)));
    const desiredSpeed=braking?0:Math.min(speed,Math.sqrt(.40*Math.max(0,length-travel)));
    const newSpeed=travelSpeed+clamp(desiredSpeed-travelSpeed,-.21*phaseDt,.21*phaseDt);
    travel=Math.min(length,travel+.5*(travelSpeed+newSpeed)*phaseDt);
    travelSpeed=newSpeed;activeTime+=phaseDt;
    bodyRotation.copy(yaw).multiply(undoTilt.copy(localTilt).slerp(levelTilt,ease(phase(activeTime,0,.72))));
    localUp.copy(up).applyQuaternion(undoTilt.invert());
    const t=elapsed/interval;
    supportBias.lerpVectors(prevBias,nextBias,ease(phase(t,0,0.89)));
    const u=phase(t,0.5,.97),lift=Math.sin(Math.PI*u)**2;
    if(braking && activeTime<preloadTime){holdFeet=true;elapsed=interval;}
    if(braking && elapsed>=interval){
      settle+=dt;
      supportBias.multiplyScalar(1-ease(phase(settle,0,.55)));
    }
    balanceCorrection.multiplyScalar(Math.exp(-dt/.22));
    virtualBase.copy(supportBias).addScaledVector(direction,travel).add(balanceCorrection);
    virtualBase.z+=approachLead(travel,activeTime)*(1-ease(phase(settle,0,.85)));
    for(const [i,leg] of legs.entries()){
      const target=currentTargets[i].copy(leg.anchor);
      if(leg===swing&&!holdFeet){
        target.lerpVectors(swing.depart,swing.land,ease(u));
        target.y+=swing.clearance*lift;
      }
    }
    return solveBody();
  }
  function solveBody(){
    const output={};
    for(const [i,leg] of legs.entries()){
      target.copy(currentTargets[i]).sub(virtualBase).applyQuaternion(undoTilt);
      output[leg.code]=solveSole(leg,target,calibration.limits,localUp);
    }
    return output;
  }
  return {
    update,origin,referenceFeet:referenceFeet??footprint,rotation:bodyRotation,
    adjustBody(deltaWorld){
      target.copy(deltaWorld).applyQuaternion(undoYaw);target.y=0;
      balanceCorrection.add(target);virtualBase.add(target);return solveBody();
    },
    bodyPosition(){return virtualBase.clone().applyQuaternion(yaw).add(position);},
    get arrived(){return arrived;},
    get stopped(){return settle>(parkedLead ? .86 : .56);}
  };
}
