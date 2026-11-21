import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Group,Object3D} from 'three';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';
import {createProcedures} from '../src/procedures.js';
import {buildProcessCatalog} from '../src/process-catalog.js';

const dir=new URL('../public/assets/',import.meta.url);
const json=name=>JSON.parse(readFileSync(new URL(name+'.json',dir)));
const master=json('assembly'),manual=json('procedures'),fasteners=json('fasteners');
const originalNodes=master.nodes.length;
const catalog=buildProcessCatalog(master,manual,fasteners);
assert.equal(master.nodes.length,originalNodes,'The content view must not mutate the CAD source');

// Recreate the renderer’s real metadata and corrected instance transforms as
// an independent index. WebGL need not be available on the verification host.
const bytes=readFileSync(new URL('bpx.glb',dir));
const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
const frame=new Group();
for(const node of doc.nodes.filter(n=>n.mesh!==undefined)) {
  const mesh=new Object3D();mesh.name=node.name;
  mesh.matrix.fromArray(node.matrix);
  mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
  frame.add(mesh);
}
const actual=structuredClone(master);
addBatteryBody(actual,frame);
addFasteners(actual,frame,fasteners);
const chapters=createProcedures(actual,manual).chapters;
const byId=new Map(fasteners.items.map(s=>[s.id,s]));
const allScrews=[],pairsFor=[];
const snapshot=c=>c.steps.map(s=>[s.id,s.kind,s.leg??null,s.roots]);
assert.deepEqual(catalog.map(snapshot),chapters.map(snapshot));
assert.deepEqual(buildProcessCatalog(actual,manual,fasteners).map(snapshot),catalog.map(snapshot));
assert.deepEqual(catalog.map(c=>c.steps.length),[10,48,23,5]);
let actions=0,qualityPoints=0;
for(const chapter of catalog)for(const step of chapter.steps) {
  actions+=step.kind==='part'?step.roots.length:1;
  if(step.kind==='part')assert.ok(step.roots.length>0);
  assert.ok(step.page>=5&&step.page<=26, step.id);
  for(const task of [step.kit,step.method]) {
    assert.equal(new Set(task.options).size,3,step.id);
    assert.ok(task.options[task.answer]&&task.question&&task.feedback,step.id);
  }
  assert.ok(step.inspection.points.length>=2,step.id);
  assert.equal(new Set(step.inspection.points.map(p=>p.label)).size,step.inspection.points.length,step.id);
  for(const p of step.inspection.points) {
    qualityPoints++;
    assert.ok(p.good!==p.bad&&p.repair&&p.label,step.id);
    assert.ok(['none','unseated','missing','loose'].includes(p.visual));
    if(p.visual!=='none')assert.ok(step.roots.includes(p.targetId),step.id);
  }
  if(!step.screw)continue;
  const screws=step.roots.map(id=>byId.get(id));
  assert.equal(step.screw.count,screws.length);
  for(const row of screws) {
    assert.equal(row.spec,step.screw.spec);
    assert.ok(step.inspection.points.some(p=>p.targetId===row.id));
    allScrews.push(row.id);
  }
  if(step.screw.opposites) {
    pairsFor.push(step.leg);
    const indices=step.screw.opposites.flat().sort((a,b)=>a-b);
    assert.deepEqual(indices,[0,1,2,3,4,5],step.id);
    for(const [i,j] of step.screw.opposites) {
      const a=screws[i],b=screws[j];assert.equal(a.hostId,b.hostId);
      // Bore-to-bore separation is the CAD bolt-circle diameter (24 mm).
      const delta=b.seat.map((v,k)=>v-a.seat[k]);
      const axial=delta.reduce((sum,v,k)=>sum+v*a.axis[k],0);
      assert.ok(Math.abs(Math.sqrt(delta.reduce((s,v)=>s+v*v,0)-axial*axial)-24)<.02);
    }
  }
}
assert.equal(actions,176);
assert.deepEqual([...new Set(allScrews)].sort(),fasteners.items.map(x=>x.id).sort());
assert.equal(allScrews.length,108);
assert.deepEqual(pairsFor,['LF','LR','RF','RR']);
console.log('PASS · 86 道工序与三维实例一致、176 次提交、108 颗螺钉、4 组膝电机对孔、'+qualityPoints+' 项工艺签记');
