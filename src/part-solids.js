// One CAD-local set of occupied volumes per manufactured occurrence. The same
// solids follow its articulated mount, appear in the overlay and land in the tray.
import R from '@dimforge/rapier3d-compat';
import {Matrix4,Vector3,Quaternion} from 'three';
import library from './part-volumes.json' with {type:'json'};

const identity={x:0,y:0,z:0,w:1};
export function createPartSolids(assembly,entries=[]){
  const input=new Map(entries.map(e=>[e.id,e]));
  const templates=new Map(),parts=new Map(),definitionShapes=new Map();
  function geometry(n){
    if(n.fastener){
      const [diameter,length]=n.spec.slice(1).split('×').map(Number);
      return [{type:'cylinder',center:[0,-length/2,0],halfHeight:length/2,radius:diameter/2},
        {type:'cylinder',center:[0,diameter/2,0],halfHeight:diameter/2,radius:diameter===3?2.75:5}];
    }
    if(n.part==='manual-battery-cassette'){
      const [d,h,w]=n.max.map((v,i)=>v-n.min[i]),rib=1.4;
      return [{type:'box',half:[(d-2)/2,(h-rib)/2,(w-2)/2],center:[0,-rib/2,0]},
        ...[-.3,0,.3].map(t=>({type:'box',half:[d*.73/2,.95,1.85],center:[0,h/2-.95,w*t]}))];
    }
    const data=library.definitions[n.part];
    if(data?.spans)return data.spans.map(s=>({type:'box',
      center:data.origin.map((v,k)=>v+(s[k]+s[k+3]/2)*data.cell[k]),
      half:data.cell.map((v,k)=>v*s[k+3]/2)}));
    if(!data)throw Error('缺少工件实体 '+n.id);
    if(data.boxes)return data.boxes.map(b=>({type:'box',center:data.center.map((c,i)=>c+b[i]),half:b.slice(3)}));
    return data.hulls.map(points=>({type:'hull',center:data.center,points}));
  }
  function makeTemplate(pieces,mirror,grid){
    if(grid?.spans){
      const coords=[];
      for(const [a,b,c,w,h,d] of grid.spans)for(let z=c;z<c+d;z++)for(let y=b;y<b+h;y++)for(let x=a;x<a+w;x++)coords.push(mirror?-x-1:x,y,z);
      const shape=new R.Voxels(Int32Array.from(coords),new Vector3(...grid.cell).multiplyScalar(.001));
      return {shape,origin:new Vector3(...grid.origin)};
    }
    const origin=new Vector3(...pieces[0].center);
    const shapes=[],offsets=[];
    for(const p of pieces){
      let shape;
      if(p.type==='box')shape=new R.Cuboid(...p.half.map(v=>v*.001));
      else if(p.type==='cylinder')shape=new R.Cylinder(p.halfHeight*.001,p.radius*.001);
      else {
        const points=Float32Array.from(p.points,(v,i)=>v*.001*(mirror&&i%3===0?-1:1));
        const made=R.ColliderDesc.convexHull(points);
        if(!made)continue;
        shape=made.shape;
      }
      const pos=new Vector3(...p.center).sub(origin).multiplyScalar(.001);
      if(mirror)pos.x=-pos.x;
      shapes.push(shape);offsets.push(pos);
    }
    if(!shapes.length)throw Error('工件轮廓无法构成非零体积');
    const shape=shapes.length===1?shapes[0]:new R.Compound(shapes,offsets,shapes.map(()=>identity));
    return {shape,origin};
  }
  for(const n of assembly.nodes.filter(n=>n.geometry)){
    if(!templates.has(n.part))templates.set(n.part,geometry(n));
    const matrix=input.get(n.id)?.base?.clone()||new Matrix4().fromArray(library.matrices[n.id]);
    const mirror=matrix.determinant()<0,key=n.part+(mirror?'-X':'');
    if(!definitionShapes.has(key))definitionShapes.set(key,makeTemplate(templates.get(n.part),mirror,library.definitions[n.part]));
    parts.set(n.id,{n,matrix,template:definitionShapes.get(key)});
  }
  const off=new Vector3(),q=new Quaternion(),sc=new Vector3();
  function pose(id,matrix){
    const part=parts.get(id);
    matrix.decompose(off,q,sc);
    off.copy(part.template.origin).applyMatrix4(matrix).multiplyScalar(.001);
    return {position:off,rotation:q};
  }
  function descriptor(id,matrix){
    const {position:p,rotation}=pose(id,matrix);
    return new R.ColliderDesc(parts.get(id).template.shape).setTranslation(p.x,p.y,p.z).setRotation(rotation);
  }
  return {pieces:id=>templates.get(parts.get(id)?.n.part)||[],parts,pose,descriptor,batteryMotion:library.batteryMotion};
}
