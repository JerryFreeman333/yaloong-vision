import {MathUtils,Quaternion,Vector3} from 'three';

const {clamp,radToDeg}=MathUtils;
const wrapDegrees=rad=>radToDeg(Math.atan2(Math.sin(rad),Math.cos(rad)));
const pitchAxis=new Vector3(1,0,0),sideAxis=new Vector3(0,0,1),up=new Vector3(0,1,0);
const pitch=new Quaternion(),roll=new Quaternion(),v=new Vector3(),target=new Vector3();

export function createFootLegs(calibration,basePivot){
  return Object.entries(calibration.legs).map(([code,def])=>{
    const low=Math.min(...def.soleSupportPoints.map(p=>p[1]));
    const patch=def.soleSupportPoints.filter(p=>p[1]<low+1);
    const sole=patch.reduce((sum,p)=>sum.add(new Vector3(...p)),new Vector3()).divideScalar(patch.length);
    const cad=p=>new Vector3(...p).sub(basePivot).multiplyScalar(.001);
    const roll=cad(def.roll),hip=cad(def.hip),knee=cad(def.kneePin),end=cad(sole.toArray());
    const thigh=knee.clone().sub(hip),shank=end.clone().sub(knee);thigh.x=0;shank.x=0;
    return {code,roll,hip,sole:end,pad:sole.toArray(),surface:def.soleSupportPoints.map(p=>cad(p).sub(end)),thigh,shank,sign:code[0]==='L'?1:-1};
  });
}

function solveFoot(leg,p,limits) {
  // Undo the side-swing rotation. The lateral distance from the roll shaft to
  // the toe plane is constant through both pitch joints.
  const x=p.x-leg.roll.x, y=p.y-leg.roll.y;
  const radius=Math.hypot(x,y);
  const lateral=leg.sole.x-leg.roll.x;
  const localY=-Math.sqrt(Math.max(.000001,radius*radius-lateral*lateral));
  const roll=Math.atan2(y,x)-Math.atan2(localY,lateral);
  const dy=localY+leg.roll.y-leg.hip.y, dz=p.z-leg.hip.z;
  const L=leg.thigh.length(), S=leg.shank.length(),reach=Math.hypot(dy,dz);
  const alpha=Math.atan2(leg.thigh.z,leg.thigh.y),beta=Math.atan2(leg.shank.z,leg.shank.y);
  const hip=Math.atan2(dz,dy)+Math.acos(clamp((L*L+reach*reach-S*S)/(2*L*reach),-1,1))-alpha;
  const delta=Math.acos(clamp((reach*reach-L*L-S*S)/(2*L*S),-1,1));
  return {sway:clamp(wrapDegrees(roll)*leg.sign,...limits.roll),hip:clamp(wrapDegrees(hip),...limits.hip),
    knee:clamp(wrapDegrees(beta-alpha+delta),...limits.knee)};
}

// Place the lowest material point of the rounded CAD tread on the support
// plane. localUp is the vertical expressed in the chassis coordinate system.
export function solveSole(leg,anchor,limits,localUp=up){
  target.copy(anchor);
  let angles;
  for(let i=0;i<3;i++){
    angles=solveFoot(leg,target,limits);
    pitch.setFromAxisAngle(pitchAxis,MathUtils.degToRad(angles.hip-angles.knee));
    roll.setFromAxisAngle(sideAxis,MathUtils.degToRad(angles.sway*leg.sign));
    pitch.premultiply(roll);
    let bottom=Infinity;
    for(const local of leg.surface)bottom=Math.min(bottom,v.copy(local).applyQuaternion(pitch).dot(localUp));
    target.copy(anchor).addScaledVector(localUp,-bottom);
  }
  return angles;
}
