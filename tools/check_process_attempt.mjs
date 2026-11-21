import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildProcessCatalog} from '../src/process-catalog.js';
import {newProcessAttempt,saveProcessAttempt,readProcessAttempt,restoreProcess,performProcess,previewProcess,scoreProcess,inspectValue,
  listProcessReports} from '../src/process-attempt.js';

const json=name=>JSON.parse(readFileSync(new URL('../public/assets/'+name+'.json',import.meta.url)));
const catalog=buildProcessCatalog(json('assembly'),json('procedures'),json('fasteners'));
for(const chapter of catalog)for(const lesson of chapter.steps)lesson.chapterId=chapter.id;
const all=catalog.flatMap(c=>c.steps);
const storage=new Map();
globalThis.localStorage={
  get length(){return storage.size;}, key(i){return [...storage.keys()][i];},
  setItem(k,v){storage.set(k,v);},getItem(k){return storage.get(k)??null;}
};
function setup(l,a){
  for(const type of ['kit','method'])assert.ok(performProcess(l,a,{type,choice:l[type].answer}).ok);
}
const submit=(l,a,type,args={})=>performProcess(l,a,{type,...args});
function operation(l,a){
  const roots=l.kind==='part'?l.roots:[null];
  if(l.screw){
    assert.ok(!submit(l,a,'commit',{id:roots[0]}).ok);
    for(const id of roots)assert.ok(submit(l,a,'preload',{id}).ok);
    assert.ok(submit(l,a,'align').ok);
  }
  const sequence=l.screw?.opposites?.flat().map(i=>roots[i])||roots;
  for(const id of sequence){
    const prior=a.committed.length;
    assert.ok(previewProcess(l,a,{type:'commit',id}).ok);
    assert.equal(a.committed.length,prior);
    assert.ok(submit(l,a,'commit',{id}).ok);
    const length=a.events.length;
    assert.ok(submit(l,a,'commit',{id}).ok);
    assert.equal(a.events.length,length);
  }
  assert.equal(a.stage,'inspect',l.id);
}
function inspect(l,a){
  for(const [point,p] of l.inspection.points.entries()){
    assert.equal(inspectValue(l,a,point),null);
    assert.ok(submit(l,a,'check',{point}).ok);
    assert.equal(inspectValue(l,a,point),point===a.defectIndex?p.bad:p.good);
  }
  const point=a.defectIndex;
  if(point!==null){
    assert.ok(!submit(l,a,'judge',{decision:'pass'}).ok);
    assert.ok(submit(l,a,'judge',{decision:'repair',point}).ok);
    assert.ok(submit(l,a,'repair',{point,choice:point}).ok);
    assert.equal(inspectValue(l,a,point),l.inspection.points[point].good);
  }else assert.ok(submit(l,a,'judge',{decision:'pass'}).ok);
  assert.ok(submit(l,a,'recheck').ok);
  assert.ok(submit(l,a,'submit').ok);
  assert.ok(a.submittedAt);
}
for(const [i,l] of all.entries()){
  const a=newProcessAttempt(l,{mode:'exam',student:'机械 A',defectIndex:i%2?0:null});
  assert.ok(!submit(l,a,'hint',{level:1}).ok);
  setup(l,a);operation(l,a);inspect(l,a);
  assert.ok(saveProcessAttempt(l,a));
  const b=readProcessAttempt(l,'exam','机械 A');
  assert.equal(a.id,b.id);
  assert.deepEqual(scoreProcess(a),scoreProcess(b));
  assert.equal(readProcessAttempt(l,'practice','机械 A'),null);
}
assert.equal(listProcessReports(catalog).length,all.length);
const l=all.find(l=>l.screw?.opposites);
const a=newProcessAttempt(l,{student:'机械 B',mode:'practice',defectIndex:0});
assert.ok(saveProcessAttempt(l,a));
assert.equal(a.stage,'operate');
assert.ok(!a.events.some(e=>['kit','method'].includes(e.type)));
assert.equal(scoreProcess(a).total,null);
assert.ok(submit(l,a,'hint',{level:1}).ok);
const old=readProcessAttempt(l,'practice','机械 B');
assert.ok(saveProcessAttempt(l,a));
assert.ok(!saveProcessAttempt(l,old));
assert.ok(!saveProcessAttempt(l,newProcessAttempt(l,{student:'机械 B',mode:'practice'})));
const other = newProcessAttempt(l,{student:'机械 A',mode:'practice'});
assert.ok(saveProcessAttempt(l,other));
assert.equal(readProcessAttempt(l,'practice','机械 B').id,a.id);
assert.equal(submit(l,a,'preload',{id:l.roots[0],tool:'phillips'}).code,'tool');
assert.equal(a.preloaded.length,0);
for(const id of l.roots)assert.ok(submit(l,a,'preload',{id,tool:'hex'}).ok);
assert.ok(submit(l,a,'align').ok);
assert.equal(submit(l,a,'commit',{id:l.roots[0],tool:'flat'}).code,'tool');
assert.equal(a.committed.length,0);
assert.equal(a.events.at(-1).action.tool,'flat');
const [start,opposite]=l.screw.opposites[0];
assert.ok(submit(l,a,'commit',{id:l.roots[start]}).ok);
const offPair=l.roots.find((_, i)=>i!==start&&i!==opposite);
assert.ok(!submit(l,a,'commit',{id:offPair}).ok);
assert.equal(a.committed.length,1);
assert.ok(submit(l,a,'undo').ok);
assert.equal(a.committed.length,0);
const restored=restoreProcess(l,JSON.parse(JSON.stringify(a)));
assert.ok(submit(l,restored,'undo').ok);assert.equal(restored.aligned,false);
for(const i of l.screw.opposites.flat())assert.ok(submit(l,a,'commit',{id:l.roots[i]}).ok);
inspect(l,a);assert.ok(saveProcessAttempt(l,a));
const fresh=newProcessAttempt(l,{student:'机械 B',mode:'practice'});
assert.ok(saveProcessAttempt(l,fresh));assert.equal(readProcessAttempt(l,'practice','机械 B').id,fresh.id);
const tampered=JSON.parse(JSON.stringify(a));tampered.events.find(e=>e.type==='preload'&&e.ok).action.id='unknown-screw';
assert.equal(restoreProcess(l,tampered),null);
assert.ok(listProcessReports(catalog).some(report=>report.id===a.id));
// Replay a pre-update practice draft that paused after a real preparation answer.
const legacyRaw=newProcessAttempt(l,{mode:'exam',student:'旧工单',defectIndex:null});
submit(l,legacyRaw,'kit',{choice:l.kit.answer});
legacyRaw.mode='practice';
const legacy=restoreProcess(l,legacyRaw);
assert.equal(legacy.stage,'method');
assert.ok(saveProcessAttempt(l,legacy));
const resumed=readProcessAttempt(l,'practice','旧工单');
assert.equal(resumed.id,legacy.id);
assert.equal(resumed.stage,'operate');
assert.deepEqual(resumed.events.map(e=>e.type),['kit','beginAssembly']);
assert.ok(!submit(l,resumed,'undo').ok);
assert.equal(scoreProcess(resumed).method,null);
assert.ok(saveProcessAttempt(l,resumed));
assert.deepEqual(readProcessAttempt(l,'practice','旧工单').events,resumed.events);
const wire=all.find(s=>s.kind==='confirm' && s.role==='wire');
const wireJob=newProcessAttempt(wire,{mode:'exam',student:'W',defectIndex:0});
setup(wire,wireJob);
assert.equal(submit(wire,wireJob,'selectWrong',{id:null,sourceId:'线束A',targetId:'错误接口'}).ok,false);
assert.ok(submit(wire,wireJob,'commit',{id:null,sourceId:'线束A',targetId:'正确接口'}).ok);
assert.equal(restoreProcess(wire,wireJob).events.at(-1).action.targetId,'正确接口');
assert.equal(restoreProcess(wire,wireJob).events.at(-2).action.targetId,'错误接口');
assert.ok(saveProcessAttempt(wire,wireJob));

assert.equal(readProcessAttempt(wire,'exam','W').defectIndex,0);
console.log('PASS · '+all.length+' 项工序成绩重放、独立提交、预装对齐、对孔限制、交检返修、撤销、草稿隔离和个人成绩归档');
