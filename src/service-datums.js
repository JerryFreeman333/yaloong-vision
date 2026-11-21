// Tooling datums in the service station. The immutable CAD master retains the
// original occurrence placements. Three kit occurrences were exported skewed
// relative to their mirrored mounts, leaving the nominal screw bores opposed.
import {Matrix4,Vector3,Euler,Quaternion} from 'three';

export function alignServiceDatums(assembly,frame) {
  const master=new Map(frame.children.map(mesh=>[mesh.userData.instanceId||mesh.name,mesh]));
  const rows=new Map(assembly.nodes.map(n=>[n.id,n]));
  const corrected={};
  function write(id,rotation,position) {
    const mesh=master.get(id),row=rows.get(id);
    if(!mesh || row.serviceDatum)return;
    mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
    mesh.quaternion.copy(rotation);mesh.position.copy(position);mesh.updateMatrix();mesh.matrixWorldNeedsUpdate=true;
    row.serviceDatum=true;corrected[id]=mesh.matrix;
    const geometry=mesh.geometry;
    if(geometry){
      if(!geometry.boundingBox)geometry.computeBoundingBox();
      const b=geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
      row.min=b.min.toArray();row.max=b.max.toArray();row.center=b.getCenter(new Vector3()).toArray();
    }
  }
  // The skewed buffer's first M6 bore is on axis. Pivot at that bore to
  // bring the second bore onto the same extrusion center-line.
  const buffer='bpx1_1_11', opposite=master.get('bpx1_1_12');
  if(master.has(buffer)&&opposite){
    const rot=new Quaternion().setFromRotationMatrix(opposite.matrix);
    const firstLocal=new Vector3(-21,5,0);
    const fixed=firstLocal.clone().applyMatrix4(master.get(buffer).matrix);
    write(buffer,rot,fixed.sub(firstLocal.applyQuaternion(rot)));
  }
  // Each matched clamp pair has its two socket screw heads on diagonally
  // opposite ends. The two right-leg assemblies place the second clamp
  // end-for-end in the STEP file. Align to the opposite half's two bores.
  const flip=new Quaternion().setFromEuler(new Euler(0,Math.PI,0));
  for(const leg of ['bpx1_1_24','bpx1_1_26']){
    const id=leg+'_9',mesh=master.get(id);
    if(!mesh)continue;
    const m=mesh.matrix;
    const center=new Vector3(0,0,8).applyMatrix4(m);
    const q=new Quaternion().setFromRotationMatrix(m).multiply(flip);
    const origin=center.sub(new Vector3(0,0,8).applyQuaternion(q));
    write(id,q,origin);
  }
  return corrected;
}
