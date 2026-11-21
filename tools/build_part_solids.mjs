// Rebuild compact CAD-local occupancy volumes from the original CAD triangles.
// The compliant rubber tread uses its measured exterior support hull.
import fs from 'node:fs';
import {occupiedCells} from './mesh-cells.mjs';
import {gunzipSync} from 'node:zlib';
import {Matrix4,Object3D,Group,Vector3} from 'three';
import {readCollisionAsset} from '../src/collisions.js';
import {addFasteners} from '../src/fasteners.js';
import {addBatteryBody} from '../src/battery.js';
const dir=new URL('../public/assets/',import.meta.url);
const load=name=>JSON.parse(fs.readFileSync(new URL(name,dir)));
const assembly=load('assembly.json'),glb=fs.readFileSync(new URL('bpx.glb',dir));
const gltf=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)));
const frame=new Group();
for(const n of gltf.nodes.filter(n=>n.mesh!==undefined)){
  const obj=new Object3D();obj.name=n.name;obj.matrix.fromArray(n.matrix);
  obj.matrix.decompose(obj.position,obj.quaternion,obj.scale);frame.add(obj);
}
addBatteryBody(assembly,frame);addFasteners(assembly,frame,load('fasteners.json'));
const raw=gunzipSync(fs.readFileSync(new URL('collision-v1.bin.gz',dir)));
const parts=readCollisionAsset(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const matrices=Object.fromEntries(frame.children.map(o=>[o.name,o.matrix.toArray().map(n=>+n.toFixed(9))]));
const q=n=>+n.toFixed(4);
const target=new URL('../src/part-volumes.json',import.meta.url);
const only=process.argv[2];
const definitions=only?JSON.parse(fs.readFileSync(target)).definitions:{};
for(const [id,part] of parts){
 if(only && only!==id)continue;
 const name=assembly.nodes.find(n=>n.part===id&&n.geometry)?.name||id;
 const center=part.lo.map((n,i)=>q(n+part.size[i]*.5));
 const vertices=Float32Array.from(part.packed,(n,i)=>(n/65535-.5)*part.size[i%3]);
 if(!/077 足端/.test(name)){
   const pitch=name.includes('C2-3-2-034 ')?.75:name.includes('C2-3-0-010 ')?.85:
     Math.max(.10,Math.min(2.1,Math.max(...part.size)/55,Math.min(...part.size)/6));
   const boxes=occupiedCells(vertices,part.triangles,part.size,pitch,/C2-3-0-010 |C2-3-2-034 /.test(name));
   if(boxes.length){
     const dims=part.size.map(s=>Math.ceil(s/pitch)),cell=part.size.map((s,k)=>s/dims[k]);
     const spans=boxes.map(row=>[...row.slice(0,3).map((v,k)=>Math.round((v-row[3+k]+part.size[k]/2)/cell[k])),
       ...row.slice(3).map((v,k)=>Math.round(2*v/cell[k]))]);
     definitions[id]={origin:part.lo,cell,spans};console.log(id,name.slice(0,25),'voxels',spans.length);continue;
   }
 }
 if(!/077 足端/.test(name))throw Error('CAD solid has zero occupied cells: '+id);
 // The support hull preserves the rubber tread profile at any foot angle.
 const support=load('kinematics.json').legs.LF.soleSupportPoints;
 const row=assembly.nodes.find(n=>n.part===id&&n.geometry);
 const inverse=new Matrix4().fromArray(matrices[row.id]).invert();
 const offset=new Vector3(...center);
 const points=support.flatMap(p=>new Vector3(...p).applyMatrix4(inverse).sub(offset).toArray().map(q));
 definitions[id]={center,hulls:[points]};console.log(id,name,'tread hull');
}
fs.writeFileSync(target,JSON.stringify({definitions,matrices,batteryMotion:load('procedures.json').batteryMotion}));
