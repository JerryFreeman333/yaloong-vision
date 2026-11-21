import {Box3,BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,Quaternion,Vector3} from 'three';

export function toolHead(frame) {
  const group=new Group();group.name='装配夹爪';group.visible=false;frame.add(group);
  const mat=new MeshStandardMaterial({color:0x505a61,metalness:.72,roughness:.36});
  const pads=new MeshStandardMaterial({color:0x443f38,roughness:.72});
  const build=(material)=>{const m=new Mesh(new BoxGeometry(1,1,1),material);group.add(m);return m;};
  const bridge=build(mat),left=build(pads),right=build(pads);
  return {hide(){group.visible=false;},show(entities){
    const box=new Box3();
    for(const {mesh} of entities){
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
    }
    if(box.isEmpty())return;
    const c=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
    const w=Math.max(3,size.x),h=Math.min(16,Math.max(3,size.y*.18)),t=Math.max(1.4,Math.min(4,w*.07));
    group.position.set(c.x,box.max.y,c.z);bridge.scale.set(w+2*t,t,t*2.5);bridge.position.y=t*1.5;
    for(const [pad,sgn] of [[left,-1],[right,1]]){pad.scale.set(t,h+2*t,t*2.5);pad.position.set(sgn*(w+t)/2,t-h/2,0);}
    group.visible=true;
  }};
}

// Rigid transfer about one common pivot preserves every transform inside an assembly.
export function rigidRoute(entities,from,to,liftY=null,waypoints=null) {
  const ids=entities.map(e=>e.id);
  const pivot=(matrices)=>{
    const box=new Box3();
    for(const e of entities){
      if(!e.mesh.geometry.boundingBox)e.mesh.geometry.computeBoundingBox();
      box.union(e.mesh.geometry.boundingBox.clone().applyMatrix4(matrices.get(e.id)));
    }
    return box.getCenter(new Vector3());
  };
  const a=pivot(from),b=pivot(to),m=ids[0];
  const r0=new Quaternion().setFromRotationMatrix(from.get(m)),r1=new Quaternion().setFromRotationMatrix(to.get(m));
  const relative=r1.clone().multiply(r0.clone().invert()),identity=new Quaternion();
  const rot=new Quaternion(),p=new Vector3(),v=new Vector3(),delta=new Matrix4();
  const points=waypoints?[a,...waypoints,b]:liftY===null?[a,b]:[a,new Vector3(a.x,liftY,a.z),new Vector3(b.x,liftY,b.z),b];
  const lengths=points.slice(1).map((v,i)=>v.distanceTo(points[i]));
  const total=lengths.reduce((x,y)=>x+y,0);
  return (t,id,out)=>{
    if(t<=0)return out.copy(from.get(id));if(t>=1)return out.copy(to.get(id));
    let travel=t*total,i=0;
    while(i<lengths.length-1 && travel>lengths[i]){travel-=lengths[i];i++;}
    p.lerpVectors(points[i],points[i+1],lengths[i]>0?travel/lengths[i]:0);
    rot.slerpQuaternions(identity,relative,liftY===null?t:Math.max(0,Math.min(1,(t-.3)/.4)));
    v.copy(a).applyQuaternion(rot);delta.makeRotationFromQuaternion(rot);delta.setPosition(v.multiplyScalar(-1).add(p));
    return out.multiplyMatrices(delta,from.get(id));
  };
}
