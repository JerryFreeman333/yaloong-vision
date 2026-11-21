import {Vector3} from 'three';

const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);

function supportHull(hits) {
  // Preserve the source sole on every vertex. A lifted sole is never in hits.
  const sorted=hits.flatMap((hit,foot)=>(hit.patch??[hit.point]).map(point=>({point,foot})))
    .sort((a,b)=>a.point[0]-b.point[0] || a.point[2]-b.point[2]);
  function chain(points) {
    const line=[];
    for(const p of points){
      while(line.length>=2 && cross(line.at(-2).point,line.at(-1).point,p.point)<=0)line.pop();
      line.push(p);
    }
    return line.slice(0,-1);
  }
  return [...chain(sorted),...chain(sorted.reverse())];
}

function supportEdge(hull,point) {
  let distance=-Infinity;
  const inward=new Vector3();
  if(hull.length>=3){
    distance=Infinity;
    for(let i=0;i<hull.length;i++){
      const a=hull[i].point,b=hull[(i+1)%hull.length].point;
      const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
      const d=(dx*(point.z-a[2])-dz*(point.x-a[0]))/length;
      if(d<distance){distance=d;inward.set(-dz/length,0,dx/length);}
    }
  }
  return {distance,inward};
}

// Write the desired pressure point as a convex combination of a nominal
// positive load on every sole and two vertices of the actual support hull.
// The aggregate per sole is its normal load and centre of pressure.
export function distributePatchPressure(hits,demand,totalLoad){
  const hull=demand.hull;
  const centre=[0,0,0],target=demand.cop.toArray();
  for(const hit of hits){centre[0]+=hit.point[0]/hits.length;centre[2]+=hit.point[2]/hits.length;}
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],area=cross(centre,a.point,b.point);
    if(area<1e-12)continue;
    const w0=cross(target,a.point,b.point)/area;
    const w1=cross(centre,target,b.point)/area;
    const w2=cross(centre,a.point,target)/area;
    if(Math.min(w0,w1,w2)<-1e-10)continue;
    const baseLoad=Math.max(0,w0)*totalLoad/hits.length;
    const solved=hits.map(hit=>({...hit,normalN:baseLoad,
      point:[hit.point[0]*baseLoad,0,hit.point[2]*baseLoad]}));
    for(const [vertex,weight] of [[a,w1],[b,w2]]){
      const hit=solved[vertex.foot],load=totalLoad*Math.max(0,weight);
      hit.point[0]+=load*vertex.point[0];hit.point[2]+=load*vertex.point[2];hit.normalN+=load;
    }
    for(const hit of solved){
      if(!(hit.normalN>0))return null;
      hit.point[0]/=hit.normalN;hit.point[2]/=hit.normalN;
    }
    return solved;
  }
  return null;
}

// Backward differences for unequal time steps. Positions are mass weighted
// over all attached CAD links. The flat-ground centroidal model assumes
// negligible whole-body angular-momentum rate during the slow level crawl.
export function trackWalkBalance(initialCenter,gravity,friction) {
  let previous=initialCenter.clone(),velocity=new Vector3(),previousDt=0;
  function demand(center,dt,hits) {
    const nextVelocity=new Vector3().subVectors(center,previous).divideScalar(dt);
    const accelGain=2/(dt*(previousDt+dt));
    const acceleration=nextVelocity.clone().sub(velocity).multiplyScalar(accelGain*dt);
    const normal=gravity+acceleration.y;
    const cop=new Vector3(center.x-center.y*acceleration.x/normal,0,center.z-center.y*acceleration.z/normal);
    const frictionRatio=normal>0?Math.hypot(acceleration.x,acceleration.z)/(friction*normal):Infinity;
    const hull=supportHull(hits),edge=supportEdge(hull,cop);
    return {center,velocity:nextVelocity,acceleration,cop,hull,edge,frictionRatio,normal,accelGain,dt};
  }
  return {demand,commit(sample){
    previous.copy(sample.center);velocity.copy(sample.velocity);previousDt=sample.dt;
  }};
}
