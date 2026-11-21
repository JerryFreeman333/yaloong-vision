import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WHOLE_CHAPTERS} from '../src/whole-course-content.js';
import {buildProcessCatalog} from '../src/process-catalog.js';
import {
  applyProgress,canFinish,canOpenChapter,courseReportText,isFinished,newCourse,
  nextChapter,readCourse,saveCourse,signCourse,
} from '../src/whole-course-state.js';

const records = new Map([['bpx.knee.draft.v1','knee-in-progress']]);
let writable = true;
globalThis.localStorage = {
  getItem:key => records.get(key) ?? null,
  setItem(key,value) { if (!writable) throw new Error('quota'); records.set(key,value); },
};
const catalog = buildProcessCatalog(...['assembly','procedures','fasteners'].map(name=>
  JSON.parse(readFileSync(new URL('../public/assets/'+name+'.json',import.meta.url)))));
const histories = Object.fromEntries(catalog.map(c=>[c.id,c.steps.flatMap(s=>s.kind==='part'?s.roots:[null])]));
const key='bpx.whole-course.v1';
const course=newCourse();
assert.equal(readCourse(),null);
assert.equal(nextChapter(course),'frame');
assert.equal(applyProgress(course,'battery',histories.battery,true),false);
assert.equal(signCourse(course,'学员'),false);
assert.ok(saveCourse(course));
assert.equal(saveCourse(newCourse()),false);
for (const chapter of WHOLE_CHAPTERS) {
  const {id}=chapter;
  const history=histories[id];
  assert.equal(chapter.steps,catalog.find(c=>c.id===id).steps.length);
  assert.equal(chapter.actions,history.length);
  assert.ok(canOpenChapter(course,id));
  assert.equal(applyProgress(course,id,[undefined],false),false);
  assert.equal(applyProgress(course,id,[],true),false);
  assert.equal(applyProgress(course,id,history.slice(0,-1),true),false);
  assert.ok(applyProgress(course,id,history.slice(0,-1),false));
  assert.ok(saveCourse(course));
  assert.deepEqual(readCourse(),course);
  assert.ok(applyProgress(course,id,history,true));
  assert.ok(!applyProgress(course,id,history,true));
}
assert.ok(canFinish(course));
assert.equal(nextChapter(course),null);
assert.ok(signCourse(course,'  机电 03  '));
assert.equal(signCourse(course,'重签'),false);
assert.equal(course.student,'机电 03');
assert.ok(isFinished(course));
const report=courseReportText(course);
assert.ok(WHOLE_CHAPTERS.every(({title,actions})=>report.includes(title)&&report.includes('已提交操作 '+actions+' 次')));
assert.equal(/错答|工前题/.test(report),false);
assert.ok(saveCourse(course));

const duplicate=readCourse();
assert.ok(applyProgress(course,'frame',histories.frame.slice(0,-1),false));
assert.ok(!canFinish(course));
assert.equal(course.signedAt,null);
for(const id of ['legs','mount','battery']) assert.deepEqual(course.chapters[id],{history:[],complete:false});
assert.ok(saveCourse(course));
assert.equal(saveCourse(duplicate),false);
assert.equal(courseReportText(course),null);
const replacement=newCourse();
writable=false;
assert.equal(saveCourse(replacement,course),false);
assert.equal(readCourse().id,replacement.id);
writable=true;
assert.ok(saveCourse(replacement));
assert.equal(saveCourse(course),false);
assert.equal(records.get('bpx.knee.draft.v1'),'knee-in-progress');

const legacy={...course,version:'BPX-WHOLE.1',student:'旧工单',activeChapter:'battery',
  chapters:Object.fromEntries(WHOLE_CHAPTERS.map(({id})=>[id,{history:id==='frame'?[]:histories[id], complete:id!=='frame',
    reviewed:false,prepared:true,prepWrong:1,reviewWrong:0}])) ,final:{answers:[],wrong:0,passedAt:null}};
records.set(key,JSON.stringify(legacy));
const migrated=readCourse();
assert.equal(migrated.student,'旧工单');
assert.equal(nextChapter(migrated),'frame');
assert.equal(canOpenChapter(migrated,'battery'),false);
assert.deepEqual(migrated.chapters.battery.history,histories.battery);
assert.ok(applyProgress(migrated,'frame',histories.frame,true));
assert.ok(canOpenChapter(migrated,'battery'));
assert.ok(signCourse(migrated,''));
assert.ok(courseReportText(migrated).includes('本机学员'));
assert.ok(saveCourse(migrated));
assert.ok(isFinished(readCourse()));
for(const raw of ['{','{}',' '.repeat(310000),JSON.stringify({...replacement,version:'BPX-WHOLE.0'}),
  JSON.stringify({...replacement,signedAt:new Date().toISOString()})]) {
  records.set(key,raw);
  assert.equal(readCourse(),null);
}
console.log('PASS · 86 道工序、176 次三维操作、章节依赖、连续装配签署、跨章撤销、旧工单、刷新与存储冲突');
