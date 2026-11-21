// Each lesson owns its recipe and CAD occurrence IDs. Restore records by replaying
// committed actions against that recipe, independently of cached UI state or scores.
const VERSION = 'BPX-PROCESS.1';
const UNIT = 'bpx.process.1.';
const BUNDLE = 'bpx-process-reports';
const modes = ['demo','practice','exam'];
const memory = new Map();
const undoStack = Symbol('undo');
const baseEventCount = Symbol('durable event count');
const maxFileBytes = 8 * 1024 * 1024;
const fields = {
  kit:['choice'],method:['choice'],preload:['id','tool'],align:[],commit:['id','tool','sourceId','targetId'],blocked:['id','message'],
  selectWrong:['id','sourceId','targetId'],check:['point'],judge:['decision','point'],repair:['point','choice'],
  recheck:[],submit:[],hint:['level'],undo:[],beginAssembly:[],
};
const result = (ok,code,message) => ({ok,code,message});
const changed = (code,message) => result(true,code,message);
const denied = (code,message) => result(false,code,message);
const isIndex = (i,list) => Number.isInteger(i) && i >= 0 && i < list.length;
const isDate = v => typeof v==='string' && v.length===24 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
const nameOf = v => String(v ?? '').trim().slice(0,80);

function recipe(lesson) {
  const signature=JSON.stringify([lesson.chapterId,lesson.id,lesson.kind,lesson.roots,lesson.kit,lesson.method,
    lesson.screw ?? null,lesson.inspection.points]);
  let hash = 2166136261;
  for(let i=0; i<signature.length; i++) hash=Math.imul(hash ^ signature.charCodeAt(i),16777619);
  return (hash>>>0).toString(36);
}

function build(lesson,meta) {
  const a = {...meta,version:VERSION,recipe:recipe(lesson),chapterId:lesson.chapterId,lessonId:lesson.id,
    stage:'kit',preloaded:[],aligned:false,committed:[],checked:[],repaired:false,submittedAt:null,events:[]};
  Object.defineProperties(a,{[undoStack]:{value:[]},[baseEventCount]:{value:-1,writable:true}});
  return a;
}

export function newProcessAttempt(lesson,{mode='practice',student='',defectIndex}={}) {
  if(!modes.includes(mode)) throw new Error('工单模式无效');
  const points=lesson.inspection.points;
  if(defectIndex===undefined) {
    const choice=Math.floor(Math.random()*(points.length+1));
    defectIndex=choice===points.length ? null : choice;
  }
  if(defectIndex!==null && !isIndex(defectIndex,points)) throw new Error('异常检查点无效');
  const a=build(lesson,{id:globalThis.crypto.randomUUID(),createdAt:new Date().toISOString(),student:nameOf(student),mode,defectIndex});
  if(mode!=='exam')performProcess(lesson,a,{type:'beginAssembly'});
  return a;
}

function snapshot(a) {
  return {stage:a.stage,preloaded:a.preloaded.slice(),aligned:a.aligned,committed:a.committed.slice(),
    checked:a.checked.slice(),repaired:a.repaired,submittedAt:a.submittedAt};
}

function normalizeAction(input) {
  if(!input || !Object.hasOwn(fields,input.type))return null;
  const clean={type:input.type};
  for(const key of fields[input.type]) {
    const value=input[key];
    if(value===undefined)continue;
    if(key==='tool' && (typeof value!=='string'||value.length>40))return null;
    if((key==='sourceId'||key==='targetId') && value===null)continue;
    if((key==='sourceId'||key==='targetId') && (typeof value!=='string'||!value.length||value.length>128))return null;
    if(value===null || Number.isSafeInteger(value) || (typeof value==='string' && value.length<=240))clean[key]=value;
    else return null;
  }
  return clean;
}

export function inspectValue(lesson,a,point) {
  if(!a.checked.includes(point) || !isIndex(point,lesson.inspection.points))return null;
  const data=lesson.inspection.points[point];
  return point===a.defectIndex&&!a.repaired ? data.bad : data.good;
}

const requiredStage = {
  kit:'kit',method:'method',preload:'operate',align:'operate',commit:'operate',
  blocked:'operate',selectWrong:'operate',check:'inspect',judge:'inspect',repair:'repair',
  recheck:'recheck',submit:'result',
};

function step(lesson,a,action,at) {
  const {type,choice,id,point}=action;
  const points=lesson.inspection.points;
  const roots=lesson.kind==='part' ? lesson.roots : [null];
  if(a.submittedAt) return type==='submit' ? changed('repeat','工单已提交。') : denied('closed','工单已提交，可在本工位查看成绩。');
  if(type==='beginAssembly'){
    if(a.mode==='exam')return denied('mode','独立考核需按工单完成准备。');
    if(a.events.some(e=>e.type===type))return changed('repeat','已进入实操。');
    if(a.stage==='kit'||a.stage==='method')a.stage='operate';
    // Older practice drafts can contain preparation actions in their undo history.
    for(let i=a[undoStack].length-1;i>=0;i--){
      if(['kit','method'].includes(a[undoStack][i].stage))a[undoStack].splice(i,1);
    }
    return changed('beginAssembly','已进入装配工位。');
  }
  if(requiredStage[type] && a.stage!==requiredStage[type])return denied('stage','请完成当前工序。');
  if(lesson.screw && (type==='preload' || type==='commit') && action.tool!==undefined && action.tool!=='hex') {
    return denied('tool','所选工具与螺钉头部规格不匹配。');
  }
  if(type==='kit'||type==='method'){
    const q=lesson[type];
    if(!isIndex(choice,q.options))return denied('input','请选择一个选项。');
    if(choice!==q.answer) return denied('wrong',a.mode==='exam'?'本项与工艺要求不符，请查图核对。':q.feedback);
    a.stage=type==='kit'?'method':'operate';
    return changed(type,type==='kit'?'备料核对通过。':'工艺条件核对通过。');
  }
  switch(type){
    case 'selectWrong': return denied('target','所选对象不符合当前工位要求，请复核零件与安装位置。');
    case 'blocked': return denied('blocked',action.message || '安装路径受阻。请退出并重新对正。');
    case 'preload':
      if(!lesson.screw||!roots.includes(id))return denied('target','请选择本工序的紧固件。');
      if(a.preloaded.includes(id))return changed('repeat','该位置已预装。');
      a.preloaded.push(id);
      return changed('preload','该位置预装已记录。');
    case 'align':
      if(!lesson.screw)return denied('stage','请执行当前工序。');
      if(a.aligned)return changed('repeat','已复核对齐。');
      if(a.preloaded.length!==roots.length)return denied('early','请先完成全部安装位的预装。');
      a.aligned=true;
      return changed('align','预装齐全，配合面对齐已复核。');
    case 'commit': {
      if(!roots.includes(id))return denied('target','所选对象与本工序不符。');
      if(a.committed.includes(id))return changed('repeat','该操作已提交。');
      if(lesson.screw && !a.aligned)return denied('early','完成所有预装并复核对齐后再终紧。');
      const pairs=lesson.screw?.opposites;
      if(pairs && a.committed.length%2===1) {
        const last=roots.indexOf(a.committed.at(-1));
        const pair=pairs.find(group=>group.includes(last));
        if(pair && !pair.includes(roots.indexOf(id)))return denied('order','上一颗的对孔尚未终紧，请核对孔位。');
      }
      a.committed.push(id);
      if(a.committed.length===roots.length)a.stage='inspect';
      return changed('commit',a.stage==='inspect'?'本工序动作已完成，可领取交接件。':'已完成所选安装位。');
    }
    case 'check':
      if(!isIndex(point,points))return denied('input','请选择检查点。');
      if(a.checked.includes(point))return changed('repeat',inspectValue(lesson,a,point));
      a.checked.push(point);
      return changed('check',inspectValue(lesson,a,point));
    case 'judge': {
      if(!['pass','repair'].includes(action.decision))return denied('input','请选择移交或返修。');
      const release=action.decision==='pass';
      if(release && a.checked.length!==points.length)return denied('evidence','放行前请完成全部检查点的核验。');
      if(!release && (!isIndex(point,points)||!a.checked.includes(point)))return denied('evidence','先获取所选返修部位的检查记录。');
      if(release ? a.defectIndex!==null : point!==a.defectIndex)
        return denied('diagnosis','请对照已查记录，复核交接结论和异常位置。');
      a.stage=release?'recheck':'repair';
      return changed('judge',release?'各项签记齐全，可复检。':'已确定异常位置，请执行返修。');
    }
    case 'repair':
      if(point!==a.defectIndex || !isIndex(choice,points) || points[choice].repair!==points[point].repair)
        return denied('correction','返修部位或措施与异常签记不符。');
      a.repaired=true;a.stage='recheck';
      return changed('repair','返修动作已记录，可复检。');
    case 'recheck':
      if(a.defectIndex!==null&&!a.repaired)return denied('unfinished','异常尚未排除，请先完成返修。');
      a.stage='result';
      return changed('recheck','复检通过，可提交本工序工单。');
    case 'submit':
      a.submittedAt=at;return changed('submit','本工序工单已提交。');
    case 'hint':
      if(a.mode==='exam' || ![1,2,3].includes(action.level))return denied('mode','独立考核可查阅工艺图。');
      return changed('hint','已查看第 '+action.level+' 级提示。');
    case 'undo': {
      if(a.mode==='exam')return denied('mode','独立考核仅记录已提交操作。');
      const prior=a[undoStack].pop();
      if(!prior)return denied('input','没有可撤销的成功操作。');
      Object.assign(a,prior);
      return changed('undo','已撤销上一步。');
    }
  }
}

export function previewProcess(lesson,a,input) {
  const action=normalizeAction(input);
  if(!action)return denied('input','操作格式无效。');
  if(action.type==='commit' && a.committed.includes(action.id))return changed('repeat','该操作已提交。');
  const trial={...a,...snapshot(a)};
  Object.defineProperty(trial,undoStack,{value:a[undoStack].slice()});
  return step(lesson,trial,action,new Date().toISOString());
}

function apply(lesson,a,action,at) {
  if(action.type==='commit' && a.committed.includes(action.id))return changed('repeat','该操作已提交。');
  const before=snapshot(a);
  const r=step(lesson,a,action,at);
  if(['stage','closed','input','mode','repeat'].includes(r.code))return r;
  const last=a.events.at(-1);
  if(!r.ok && last && !last.ok && last.code===r.code && last.stage===before.stage &&
    JSON.stringify(last.action)===JSON.stringify(action))return r;
  if(r.ok && !['hint','undo','submit','beginAssembly'].includes(action.type))a[undoStack].push(before);
  a.events.push({seq:a.events.length+1,at,stage:before.stage,type:action.type,action,...r});
  return r;
}

export function performProcess(lesson,a,input) {
  const action=normalizeAction(input);
  if(!action)return denied('input','操作格式无效。');
  return apply(lesson,a,action,new Date(Math.max(Date.now(),Date.parse(a.events.at(-1)?.at||a.createdAt))).toISOString());
}

export function scoreProcess(a){
  if(a.events.some(e=>e.type==='beginAssembly')){
    return {kit:null,method:null,operation:null,inspection:null,total:null,passed:a.stage==='result'};
  }
  const first=type=>a.events.find(e=>e.type===type);
  function question(type,completed){
    if(!completed)return 0;
    return first(type)?.ok ? 20 : 10;
  }
  const kit=question('kit',a.stage!=='kit');
  const method=question('method',!['kit','method'].includes(a.stage));
  let operation=0,inspection=0;
  if(!['kit','method','operate'].includes(a.stage)){
    const errors=a.events.filter(e=>e.stage==='operate'&&!e.ok);
    operation=Math.max(10,35-5*errors.length);
  }
  if(a.stage==='result'){
    const firstJudge=a.events.find(e=>e.type==='judge'&&e.code!=='evidence');
    const wrongRepair=a.events.some(e=>e.code==='correction');
    inspection=10+(firstJudge?.ok?10:0)+(wrongRepair?0:5);
  }
  const total=kit+method+operation+inspection;
  return {kit,method,operation,inspection,total,passed:a.stage==='result'&&total>=80};
}

export function restoreProcess(lesson,raw){
  try{
    const d=typeof raw==='string'?JSON.parse(raw):raw;
    if(!d || d.version!==VERSION || d.recipe!==recipe(lesson) || d.chapterId!==lesson.chapterId || d.lessonId!==lesson.id ||
       !modes.includes(d.mode) || typeof d.id!=='string' || !d.id || d.id.length>96 ||
       typeof d.student!=='string' || d.student!==nameOf(d.student) || !isDate(d.createdAt) ||
       !Array.isArray(d.events) || (d.defectIndex!==null&&!isIndex(d.defectIndex,lesson.inspection.points)))return null;
    const {id,mode,student,createdAt,defectIndex}=d;
    const a=build(lesson,{id,mode,student,createdAt,defectIndex});
    let previous=createdAt;
    for(const event of d.events){
      const action=normalizeAction(event.action);
      if(!action||!isDate(event.at)||event.at<previous||event.seq!==a.events.length+1||event.type!==action.type)return null;
      const r=apply(lesson,a,action,event.at);
      const generated=a.events.at(-1);
      if(!generated || generated.seq!==event.seq || r.code!==event.code || r.ok!==event.ok || generated.stage!==event.stage)return null;
      previous=event.at;
    }
    a[baseEventCount]=a.events.length;
    return a;
  }catch{return null;}
}

const reportKey=id=>UNIT+'report.'+encodeURIComponent(id);
const draftKey=(lesson,mode,student)=>UNIT+'draft.'+[lesson.chapterId,lesson.id,mode,nameOf(student)].map(encodeURIComponent).join('.');
function rawGet(key) {
  if(memory.has(key))return memory.get(key);
  try{return localStorage.getItem(key);}catch{return null;}
}
function rawSet(key,raw){
  try{localStorage.setItem(key,raw);memory.delete(key);return true;}
  catch{memory.set(key,raw);return false;}
}
function unpack(raw){
  try{return raw&&typeof raw==='string'&&raw.length<=maxFileBytes ? JSON.parse(raw) : null;}
  catch{return null;}
}
export function readProcessAttempt(lesson, mode, student){
  const a=restoreProcess(lesson,unpack(rawGet(draftKey(lesson,mode,student))));
  if(!a || a.mode!==mode || a.student!==nameOf(student))return null;
  if(mode!=='exam'&&!a.submittedAt&&!a.events.some(e=>e.type==='beginAssembly'))performProcess(lesson,a,{type:'beginAssembly'});
  return a;
}
export function canUndoProcess(a){return a.mode!=='exam'&&!a.submittedAt&&a[undoStack].length>0;}
export function saveProcessAttempt(lesson,a){
  if(a.mode==='demo')return true;
  const key=draftKey(lesson,a.mode,a.student);
  const old=unpack(rawGet(key));
  if(old && old.recipe===a.recipe){
    if(old.id===a.id && old.events.length>a[baseEventCount]){
      if(JSON.stringify(old.events)!==JSON.stringify(a.events))return false;
    }
    if(old.id!==a.id && (a[baseEventCount]!==-1||!old.submittedAt))return false;
  }
  const raw=JSON.stringify(a);
  if(raw.length>maxFileBytes)return false;
  const archived=a.submittedAt?rawSet(reportKey(a.id),raw):true;
  const stored=rawSet(key,raw);
  a[baseEventCount]=a.events.length;
  return stored&&archived;
}
function lessonIndex(catalog){
  const map=new Map();
  for(const chapter of catalog)for(const lesson of chapter.steps)map.set(chapter.id+'/'+lesson.id,lesson);
  return map;
}
function reportFor(index,raw){
  const data=typeof raw==='string'?unpack(raw):raw;
  const lesson=data&&index.get(data.chapterId+'/'+data.lessonId);
  if(!lesson)return null;
  const a=restoreProcess(lesson,data);
  return a?.submittedAt && a.mode!=='demo' ? a : null;
}

export function listProcessReports(catalog){
  const index=lessonIndex(catalog),keys=new Set(memory.keys());
  try{for(let i=0;i<localStorage.length;i++) keys.add(localStorage.key(i));}catch{/* In-memory session. */}
  const reports=[];
  for(const key of keys){
    if(!key?.startsWith(UNIT+'report.'))continue;
    const a=reportFor(index,rawGet(key));
    if(a&&reportKey(a.id)===key)reports.push(a);
  }
  return reports.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));
}

function download(raw,name,type){
  const url=URL.createObjectURL(new Blob([raw],{type}));
  const link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export function exportProcessReport(lesson,a){
  const valid=restoreProcess(lesson,a);
  if(!valid?.submittedAt||valid.mode==='demo')return false;
  const data=JSON.stringify({format:BUNDLE,version:VERSION,reports:[valid]});
  download(data,'BPX-工序工单-'+valid.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json','application/json;charset=utf-8');
  return true;
}
