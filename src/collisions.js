import {Box3, Matrix4, Quaternion, Vector3, MathUtils} from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {screwAxesFit} from './screw-fit.js';

const ZERO = {x:0,y:0,z:0};
// A dedicated, gravity-free CAD query space works in millimetres. This keeps
// sub-millimetre bores above GJK's numerical scale; the dynamics world uses SI.
const MM = 1;
const SKIN_MM = .12;
const BLOCKED = '零件移动路径受到阻挡';
const OK = Object.freeze({ok:true, fraction:1, blockerId:null, partId:null, message:'已通过路径检查。'});

export function readCollisionAsset(buffer) {
  const metaLength = new DataView(buffer).getUint32(0,true);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,metaLength)));
  const start = 4 + metaLength;
  const records = new Map();
  for(const [key,part] of Object.entries(manifest.parts)) {
    records.set(key,{...part,packed:new Uint16Array(buffer,start+part.pos,part.vertices*3),
      triangles:new Uint32Array(buffer,start+part.idx,part.indices)});
  }
  return records;
}

async function loadCollisionAsset() {
  const response=await fetch('./assets/collision-v1.bin.gz');
  if(!response.ok)throw new Error('CAD 碰撞模型读取失败');
  let buffer=await response.arrayBuffer();
  // Some static hosts perform Content-Encoding decompression themselves.
  if(new Uint8Array(buffer)[0]===0x1f){
    const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    buffer=await new Response(stream).arrayBuffer();
  }
  return readCollisionAsset(buffer);
}

function proxyBoxes(part, localBounds, node) {
  if(node.fastener){
    const [diameter,length]=node.spec.slice(1).split('×').map(Number);
    const m3=diameter===3;
    // The thread root defines the nominal engaged pair. Independent head and
    // shaft tests preserve contact with surrounding hardware and the shoulder.
    return [[0,-length/2,0,m3?1.16:2.32,length/2-.08,'cylinder'],
      [0,diameter/2,0,m3?2.62:4.84,diameter/2-.10,'cylinder']].map(([x,y,z,r,h])=>({
        local:new Vector3(x,y,z),shape:new RAPIER.Cylinder(h*MM,r*MM),half:new Vector3(r,h,r),cylinder:true
      }));
  }
  const size=localBounds.getSize(new Vector3()).multiplyScalar(.5);
  const center=localBounds.getCenter(new Vector3());
  const runs=part?.boxes.length ? part.boxes : [[...center,...size.toArray().map(s=>Math.max(.002,s-Math.min(.16,s*.08)))]];
  return runs.map(([x,y,z,hx,hy,hz])=>({local:new Vector3(x,y,z),half:new Vector3(hx,hy,hz),shape:new RAPIER.Cuboid(hx*MM,hy*MM,hz*MM)}));
}

function rayPose(matrix, center, pos, rotation) {
  matrix.decompose(_origin,rotation,_scale);
  pos.copy(center).applyMatrix4(matrix).multiplyScalar(MM);
}
const _origin=new Vector3(),_scale=new Vector3();
const colliderRotation=new Quaternion(),colliderPosition=new Vector3();
const _q0=new Quaternion(),_q1=new Quaternion(),_qMid=new Quaternion();
const _from=new Vector3(),_to=new Vector3(),_delta=new Vector3();
const _probeBox=new Box3(),_box2=new Box3();
const _proj=new Vector3(),_endProj=new Vector3(),_half=new Vector3();

function sweptProbeBounds(block,start,end) {
  const a=start.elements;
  const p=block.half;
  _half.set(Math.abs(a[0])*p.x+Math.abs(a[4])*p.y+Math.abs(a[8])*p.z,
    Math.abs(a[1])*p.x+Math.abs(a[5])*p.y+Math.abs(a[9])*p.z,
    Math.abs(a[2])*p.x+Math.abs(a[6])*p.y+Math.abs(a[10])*p.z);
  _proj.copy(block.local).applyMatrix4(start);_endProj.copy(block.local).applyMatrix4(end);
  _probeBox.min.copy(_proj).sub(_half);_probeBox.max.copy(_proj).add(_half);
  const b=end.elements;
  _half.set(Math.abs(b[0])*p.x+Math.abs(b[4])*p.y+Math.abs(b[8])*p.z,
    Math.abs(b[1])*p.x+Math.abs(b[5])*p.y+Math.abs(b[9])*p.z,
    Math.abs(b[2])*p.x+Math.abs(b[6])*p.y+Math.abs(b[10])*p.z);
  _box2.min.copy(_endProj).sub(_half);_box2.max.copy(_endProj).add(_half);
  return _probeBox.union(_box2).expandByScalar(.24);
}

export async function createCollisionGuard(assembly,entries,providedAsset) {
  const [,parts]=await Promise.all([RAPIER.init(),providedAsset||loadCollisionAsset()]);
  const world=new RAPIER.World(ZERO);
  const rows=new Map(assembly.nodes.map(n=>[n.id,n]));
  const cache=new Map();
  for(const entry of entries){
    const {mesh,id,base}=entry;
    const node=rows.get(id);
    const part=parts.get(node.part);
    let bounds;
    if(part){
      const lo=new Vector3(...part.lo);
      bounds=new Box3(lo,lo.clone().add(new Vector3(...part.size)));
    }else{
      const g=mesh.userData.collisionGeometry || mesh.geometry;
      if(!g.boundingBox)g.computeBoundingBox();
      bounds=g.boundingBox.clone();
    }
    const blocks=proxyBoxes(part,bounds,node);
    cache.set(id,{id,mesh,part,node,base,bounds,blocks,center:bounds.getCenter(new Vector3()),worldBox:new Box3(),last:new Matrix4().makeScale(0,0,0)});
  }
  // A coarse surface mask culls empty space inside CAD bounds. Every triangle
  // marks all cells touched by its local bounding box. A negative result is a
  // conservative rejection. A positive one still gets the full Rapier sweep.
  const masks=new Map();
  const CELLS=12,maskCenter=new Vector3(),maskHalf=new Vector3();
  function surfaceMask(part){
    if(masks.has(part))return masks.get(part);
    const grid=new Uint8Array(CELLS**3),q=part.packed,idx=part.triangles;
    const cells=new Uint8Array(q.length);
    for(let i=0;i<q.length;i++)cells[i]=Math.min(CELLS-1,Math.floor(q[i]*CELLS/65535));
    for(let t=0;t<idx.length;t+=3){
      const i=3*idx[t],j=3*idx[t+1],k=3*idx[t+2];
      const x0=Math.min(cells[i],cells[j],cells[k]),x1=Math.max(cells[i],cells[j],cells[k]);
      const y0=Math.min(cells[i+1],cells[j+1],cells[k+1]),y1=Math.max(cells[i+1],cells[j+1],cells[k+1]);
      const z0=Math.min(cells[i+2],cells[j+2],cells[k+2]),z1=Math.max(cells[i+2],cells[j+2],cells[k+2]);
      for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++){
        const line=(z*CELLS+y)*CELLS;grid.fill(1,line+x0,line+x1+1);
      }
    }
    masks.set(part,grid);return grid;
  }
  function mayTouchSurface(el,b){
    if(!el.part)return true;
    if(!el.mask){el.mask=surfaceMask(el.part);el.maskInverse=new Matrix4();el.maskPose=new Matrix4().makeScale(0,0,0);}
    if(!el.maskPose.equals(el.mesh.matrix)){el.maskInverse.copy(el.mesh.matrix).invert();el.maskPose.copy(el.mesh.matrix);}
    const m=el.maskInverse.elements,c=maskCenter,h=maskHalf;
    b.getCenter(c).applyMatrix4(el.maskInverse);b.getSize(h).multiplyScalar(.5);
    const x=Math.abs(m[0])*h.x+Math.abs(m[4])*h.y+Math.abs(m[8])*h.z;
    const y=Math.abs(m[1])*h.x+Math.abs(m[5])*h.y+Math.abs(m[9])*h.z;
    const z=Math.abs(m[2])*h.x+Math.abs(m[6])*h.y+Math.abs(m[10])*h.z;
    const lo=el.part.lo,size=el.part.size;
    const ix=Math.max(0,Math.floor((c.x-x-lo[0])*CELLS/size[0])),jx=Math.min(CELLS-1,Math.floor((c.x+x-lo[0])*CELLS/size[0]));
    const iy=Math.max(0,Math.floor((c.y-y-lo[1])*CELLS/size[1])),jy=Math.min(CELLS-1,Math.floor((c.y+y-lo[1])*CELLS/size[1]));
    const iz=Math.max(0,Math.floor((c.z-z-lo[2])*CELLS/size[2])),jz=Math.min(CELLS-1,Math.floor((c.z+z-lo[2])*CELLS/size[2]));
    for(let zz=iz;zz<=jz;zz++)for(let yy=iy;yy<=jy;yy++){
      const line=(zz*CELLS+yy)*CELLS;
      for(let xx=ix;xx<=jx;xx++)if(el.mask[line+xx])return true;
    }
    return false;
  }
  const guideWall=assembly.nodes.find(n=>n.name.startsWith('C2-2-0-079'))?.id;
  const isPack=id=>id && (rows.get(id)?.name.includes('电池组')||rows.get(id)?.part==='manual-battery-cassette');
  function obstruction(partId,blockerId,fraction,message=BLOCKED) {
    const name=rows.get(blockerId)?.name|| (blockerId==='workbench'?'工作台':'装配工位');
    return {ok:false,partId,blockerId,fraction:MathUtils.clamp(fraction,0,1),message:message+' · '+name};
  }
  function mate({id,targetId,lateralMm=0,tiltDeg=0}) {
    const row=rows.get(id);
    if(row?.fastener){
      const allowedTarget=row.hostId??row.parent;
      if ((targetId && targetId!==allowedTarget && targetId!==id) || !screwAxesFit(row.spec,lateralMm,tiltDeg))
        return obstruction(id,allowedTarget,0,'螺钉轴线与该安装孔未对正');
    }else if(isPack(id)){
      // This is an estimated body with 3 mm nominal vertical/lateral gap.
      // Reserve 0.5 mm for the unmeasured slide and manufacturing tolerances.
      const radialError=Math.abs(lateralMm)+120*Math.abs(Math.sin(MathUtils.degToRad(tiltDeg)));
      if(radialError>2.5)return obstruction(id,guideWall,0,'电池盒体与导向槽未对正');
    }
    return OK;
  }

  function poseCollider(el) {
    const matrix=el.mesh.matrix;
    if(!el.collider){
      const part=el.part;
      const isMirrored=matrix.determinant()<0;
      let vertices,indices;
      if(part){
        const q=part.packed;
        vertices=new Float32Array(q.length);
        for(let i=0;i<q.length;i++){
          const k=i%3;
          // Centering before conversion avoids large CAD definition origins.
          vertices[i]=(q[i]/65535-.5)*part.size[k]*MM*(isMirrored&&k===0?-1:1);
        }
        indices=part.triangles;
      }else{
        const g=el.mesh.userData.collisionGeometry || el.mesh.geometry,a=g.attributes.position;
        vertices=new Float32Array(a.count*3);
        for(let i=0;i<a.count;i++){
          vertices[3*i]=(a.getX(i)-el.center.x)*MM*(isMirrored?-1:1);
          vertices[3*i+1]=(a.getY(i)-el.center.y)*MM;
          vertices[3*i+2]=(a.getZ(i)-el.center.z)*MM;
        }
        indices=g.index?Uint32Array.from(g.index.array):Uint32Array.from({length:a.count},(_,i)=>i);
      }
      if(isMirrored){
        indices=indices.slice();
        for(let i=0;i<indices.length;i+=3)[indices[i],indices[i+1]]=[indices[i+1],indices[i]];
      }
      el.collider=world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices).setSensor(true));
    }
    if(!el.last.equals(matrix)){
      rayPose(matrix,el.center,colliderPosition,colliderRotation);
      el.collider.setTranslation(colliderPosition);
      el.collider.setRotation(colliderRotation);
      el.last.copy(matrix);
    }
    return el.collider;
  }

  function sweep({ids,at,kind='part',floorY=-Infinity,ignoreIds=[],obstacleIds,targetId,approachError,segments=1}){
    const moving=new Set(ids);
    if(!moving.size || typeof at!=='function')throw new Error('缺少待检零件或运动路径');
    if(approachError){
      const result=mate({id:approachError.id||[...moving][0],targetId,...approachError});
      if(!result.ok)return result;
    }
    const ignored=new Set(ignoreIds);
    const subset=obstacleIds&&new Set(obstacleIds);
    const obstacles=[];
    for(const el of cache.values()){
      if(moving.has(el.id)||ignored.has(el.id)||el.mesh.visible===false||(subset&&!subset.has(el.id)))continue;
      el.worldBox.copy(el.bounds).applyMatrix4(el.mesh.matrix);
      obstacles.push(el);
    }
    const active=[...moving].map(id=>cache.get(id)).filter(Boolean);
    if(!active.length)return obstruction([...moving][0],null,0,'没有可供检验的碰撞几何');
    return sweepSolids(active,obstacles,at,kind,floorY,segments);
  }

  function sweepSolids(active,obstacles,at,kind,floorY,segments){
    let earliest=OK;
    for(const el of active){
      const {id}=el;
      const pose=t=>{const out=new Matrix4();return at(t,id,out)||out;};
      const start=pose(0),end=pose(1),mid=pose(.5);
      const radius=el.bounds.getSize(new Vector3()).length()*.5;
      start.decompose(_origin,_q0,_scale);mid.decompose(_origin,_qMid,_scale);end.decompose(_origin,_q1,_scale);
      const angle=_q0.angleTo(_qMid)+_qMid.angleTo(_q1);
      // The sagitta limit bounds rotational chord error. A spinning screw's
      // axial cylinders are rotationally symmetric and need no spin samples.
      const angularStep=Math.min(Math.PI/40,2*Math.acos(Math.max(-1,1-.12/Math.max(.2,radius))));
      const steps=Math.max(1,segments, kind==='screw'?1:Math.ceil(angle/angularStep));
      let m0=start;
      for(let s=1;s<=steps;s++){
        const t0=(s-1)/steps,t1=s/steps;
        if(t0>=earliest.fraction)break;
        const m1=s===steps?end:pose(t1);
        const swept=el.bounds.clone().applyMatrix4(m0).union(el.bounds.clone().applyMatrix4(m1)).expandByScalar(.35);
        const candidates=obstacles.filter(other=>other.worldBox.intersectsBox(swept));
        if(candidates.length===0 && swept.min.y>=floorY){m0=m1;continue;}
        // A rigid transform has the same rotation at every compound component.
        // Decompose it once per time sample, not for each candidate component.
        m0.decompose(_origin,_q0,_scale);
        m1.decompose(_origin,_q1,_scale);
        const rotateTravel=_q0.angleTo(_q1);
        for(const block of el.blocks){
          const bb=sweptProbeBounds(block,m0,m1);
          const baseY=_probeBox.min.y;
          if(Number.isFinite(floorY)&&baseY<floorY-.2){
            const y0=_proj.y-_half.y,y1=_endProj.y-_half.y;
            if(y1<Math.min(y0,floorY)-.16){
              const hit=MathUtils.clamp((y0-floorY)/(y0-y1),0,1);
              const frac=t0+hit/steps;
              if(frac<=earliest.fraction)earliest=obstruction(id,'workbench',frac);
            }
          }
          for(const other of candidates){
            if(!bb.intersectsBox(other.worldBox) || (kind==='joint' && !mayTouchSurface(other,bb)))continue;
            const collider=poseCollider(other);
            _from.copy(_proj).multiplyScalar(MM);
            _to.copy(_endProj).multiplyScalar(MM);
            _delta.subVectors(_to,_from);
            if(_delta.lengthSq()<1e-16 && rotateTravel<1e-6)continue;
            const hit=collider.castShape(ZERO,block.shape,_from,_q0,_delta,0,1,false);
            let fraction=hit?.time_of_impact;
            if(fraction==null && angle>1e-7 && kind!=='screw'){
              const contact=collider.contactShape(block.shape,_to,_q1,0);
              if(contact && contact.distance<-SKIN_MM*MM)fraction=1;
            }
            if(fraction==null || fraction>1)continue;
            // End-face seating is valid. A proxy already touching its mate can
            // leave or slide tangentially; deeper travel still stops.
            const dist=_delta.length()/MM + (kind==='screw'?0:block.half.length()*rotateTravel);
            if(fraction<.00001){
              const a=collider.contactShape(block.shape,_from,_q0,0);
              const b=collider.contactShape(block.shape,_to,_q1,0);
              const leaving=kind==='joint'
                ? b && (b.distance>=-SKIN_MM*MM || b.distance>(a?.distance||0)+.00001)
                : b && b.distance>=Math.min(0,a?.distance||0)-SKIN_MM*MM;
              if(!b || leaving)continue;
            }
            if((1-fraction)*dist<SKIN_MM && s===steps){
              if(kind!=='joint')continue;
              const endContact=collider.contactShape(block.shape,_to,_q1,0);
              if(!endContact || endContact.distance>=-SKIN_MM*MM)continue;
            }
            const safe=t0+Math.max(0,fraction-SKIN_MM/Math.max(dist,1))/steps;
            if(safe<earliest.fraction){
              earliest=obstruction(id,other.id,safe);
              if(kind==='joint'){
                const contact=collider.contactShape(block.shape,_to,_q1,SKIN_MM);
                earliest.contact=contact?{at:contact.point1,distance:contact.distance}:null;
              }
            }
            if(earliest.fraction===0)return earliest;
          }
        }
        m0=m1;
      }
    }
    return earliest;
  }
  function articulate(groups,count) {
    let first=OK;
    const relative=new Matrix4(),end=new Matrix4(),start=new Matrix4(),sweptBox=new Box3(),atEnd=new Box3();
    const p0=new Vector3(),p1=new Vector3(),p=new Vector3(),sa=new Vector3(),sb=new Vector3();
    const qa=new Quaternion(),qb=new Quaternion(),q=new Quaternion();
    const pose=(t,id,out)=>{
      if(t===0)return out.copy(start);
      if(t===1)return out.copy(end);
      return out.compose(p.lerpVectors(p0,p1,t),q.slerpQuaternions(qa,qb,t),sa);
    };
    const previous=new Matrix4();
    for(const g of groups){
      g.box.makeEmpty();
      g.solids=g.entries.map(e=>cache.get(e.id));
      for(const e of g.entries){
        const solid=cache.get(e.id);
        solid.worldBox.copy(solid.bounds).applyMatrix4(e.mesh.matrix);
        g.box.union(solid.worldBox);
      }
      g.inversePath=g.path.map(m=>m.clone().invert());
    }
    for(let step=1;step<=count && first.ok;step++){
      for(let i=0;i<groups.length && first.ok;i++){
        for(let j=i+1;j<groups.length && first.ok;j++){
          let g=groups[i],o=groups[j];
          if(g.entries.length>o.entries.length)[g,o]=[o,g];
          previous.multiplyMatrices(o.inversePath[step-1],g.path[step-1]);
          relative.multiplyMatrices(o.inversePath[step],g.path[step]);
          if(previous.elements.every((v,i)=>Math.abs(v-relative.elements[i])<1e-7))continue;
          sweptBox.copy(g.box).applyMatrix4(previous).union(atEnd.copy(g.box).applyMatrix4(relative)).expandByScalar(.35);
          if(!sweptBox.intersectsBox(o.box))continue;
          for(const entry of g.entries){
            const el=cache.get(entry.id),base=entry.mesh.matrix;
            start.multiplyMatrices(previous,base);end.multiplyMatrices(relative,base);
            sweptBox.copy(el.bounds).applyMatrix4(start).union(atEnd.copy(el.bounds).applyMatrix4(end)).expandByScalar(.35);
            const candidates=o.solids.filter(e=>sweptBox.intersectsBox(e.worldBox));
            if(!candidates.length)continue;
            start.decompose(p0,qa,sa);end.decompose(p1,qb,sb);
            const hit=sweepSolids([el],candidates,pose,'joint',-Infinity,1);
            if(!hit.ok){first={...hit,fraction:(step-1+hit.fraction)/count};break;}
          }
        }
      }
    }
    return first;
  }
  function approach(id, fallback = new Vector3(0, 1, 0)) {
    const row = rows.get(id);
    const fallbackVector = fallback instanceof Vector3 ? fallback.clone() : new Vector3().fromArray(fallback || [0, 1, 0]);
    if (row?.fastener) return new Vector3().fromArray(row.removalAxis || fallbackVector.toArray()).normalize();
    const name = row?.name || '';
    if (/电池组|电池盒体/.test(name)) return new Vector3(-1, 0, 0);
    if (/电池把手/.test(name)) return new Vector3(0, 0, 1);
    if (/螺钉|螺丝/.test(name)) return new Vector3().fromArray(row.removalAxis || fallbackVector.toArray()).normalize();
    return fallbackVector.lengthSq() > 1e-12 ? fallbackVector.normalize() : new Vector3(0, 1, 0);
  }
  return {sweep,mate,approach,articulate,dispose:()=>world.free(),partCount:cache.size,definitionCount:parts.size};
}
