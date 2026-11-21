// Only the embedding course can exchange progress with its own simulator.
const channel = 'bpx-whole-v1';
export const embeddedCourse = window.parent !== window &&
  new URLSearchParams(location.search).get('feature') === 'whole-course';

function send(type, payload) {
  window.parent.postMessage({channel,type,...payload}, location.origin);
}
export function reportCourseFailure(message) {
  if (embeddedCourse) send('error', {message});
  if (embeddedStation) send('station-error',{code:'load',message});
}

export function connectCourse({procedures, state, restore, busy, step, select, focus, view, rollback}) {
  const chapters = procedures.chapters.map(({id,title,subtitle,pages,steps}) => ({
    id,title,subtitle,pages,steps:steps.map(({id,title,detail,page,kind,role,leg,roots,uiLabel}) =>
      ({id,title,detail,page,kind,role,leg,roots,uiLabel}))
  }));
  let initialized = false;

  function ready() { send('ready', {chapters}); }
  function progress(cause, requestId) {
    if (!initialized) return;
    const g = procedures.snapshot();
    send('progress', {cause, requestId, ...state(),
      chapter:g.chapter.id,history:procedures.guideHistory,index:g.index,count:g.count,stepId:g.step?.id ?? null,
      acceptedCount:g.acceptedCount,requiredCount:g.requiredCount,complete:g.complete,targetIds:g.targetRootIds});
  }
  function handle(e) {
    const m = e.data;
    if (e.origin !== location.origin || e.source !== window.parent || m?.channel !== channel) return;
    if (m.type === 'hello') {ready(); return;}
    if (m.type === 'rollback') {rollback(); return;}
    if (busy()) {send('error',{requestId:m.requestId,message:'请等待当前动作完成，受阻时可先退回起点。'});return;}
    if (m.type === 'init') {
      if (!restore(m.chapter,m.history)) {
        send('error',{requestId:m.requestId,message:'装配记录与本版工序不匹配，未载入本章。'});
        return;
      }
      initialized = true;
      progress('init',m.requestId);
      return;
    }
    if (!initialized) return;
    switch (m.type) {
      case 'next': case 'prev': step(m.type); break;
      case 'select': select(m.id); break;
      case 'focus': focus(); break;
      case 'view': if (['iso','front','side','top'].includes(m.view)) view(m.view); break;
    }
  }
  window.addEventListener('message', handle);
  ready();
  return {progress, selection() { if (initialized) send('selection',state()); }};
}

export const embeddedStation = window.parent!==window &&
  new URLSearchParams(location.search).get('feature')==='process-station';

// A station starts with the manual's prerequisites in place. Its public history
// contains only work on the selected procedure; a motion callback owns each commit.
export function connectStation({procedures, describe, state, restore, stage, busy, step, select,
  focus, view, align, driveScrew, rollback}) {
  const parentPost=(type,payload={})=>send('station-'+type,payload);
  const chapters=procedures.chapters.map(c=>({id:c.id,title:c.title,subtitle:c.subtitle,pages:c.pages,
    steps:c.steps.map(s=>{
      const {id,title,detail,page,kind,role,leg,roots,uiLabel}=s;
      const parts=roots.map(describe);
      return {id,title,detail,page,kind,role,leg,roots,uiLabel,rootNames:parts.map(p=>p.name),
        required:kind==='part'?roots.length:1,spec:parts[0]?.spec||'',tool:role==='screw'?'内六角':''};
    })}));
  let job=null,pending=null,rollbackRequest=null;
  const replies=new Map();
  const key=()=>({chapter:job?.chapter,stepId:job?.step.id});
  function reply(type,data,remember=false){
    const result={...key(),...data};
    if(remember && result.requestId) replies.set(result.requestId,[type,result]);
    parentPost(type,result);
  }
  function reject(code,message,requestId,blocked=false){
    reply('error',{code,message,requestId,blocked},true);
  }
  function validId(id){return typeof id==='string'&&id.length>0&&id.length<=130;}
  function remaining(){return job.step.roots.filter(id=>!job.history.includes(id));}
  function broadcast(cause,requestId){
    const done=job.history.length===job.required;
    stage(job);
    reply('progress',{cause,requestId,mode:job.mode,history:[...job.history],preloaded:[...job.preloaded],
      done,complete:done,required:job.required,acceptedCount:job.history.length,requiredCount:job.required,
      candidates:job.candidates,wire:job.wire,selectedId:state().selectedId},true);
  }
  function makeCandidates(c,s) {
    if(s.kind!=='part')return [];
    const right=s.roots.map(describe),seen=new Set(right.map(p=>p.name));
    const alternatives=[];
    const pool=[...c.steps,...procedures.chapters.filter(x=>x!==c).flatMap(x=>x.steps)];
    // Keep plausible same-family distractors first. Same-spec screws at another
    // site are identified by their actual CAD installation occurrence.
    const rank=t=>t.role===s.role?0:(t.role==='screw')===(s.role==='screw')?1:2;
    for(const t of pool.slice().sort((a,b)=>rank(a)-rank(b))){
      if(t.kind!=='part')continue;
      for(const id of t.roots){
        const part=describe(id);
        if(s.roots.includes(id)||seen.has(part.name))continue;
        seen.add(part.name);alternatives.push(part);break;
      }
      if(alternatives.length===2)break;
    }
    return [...right,...alternatives].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})||a.id.localeCompare(b.id));
  }
  function init(m){
    const c=procedures.chapters.find(ch=>ch.id===m.chapter);
    const index=c?.steps.findIndex(s=>s.id===m.stepId)??-1;
    if(index<0||!Array.isArray(m.history)||!['exam','practice','demo'].includes(m.mode)){
      reject('init','工位或学习记录无法识别。',m.requestId);return;
    }
    const s=c.steps[index],required=s.kind==='part'?s.roots.length:1;
    const history=m.history, preloaded=m.preloaded??(s.role==='screw'?history:[]);
    if(history.length>required||!Array.isArray(preloaded)||new Set(history).size!==history.length||
       new Set(preloaded).size!==preloaded.length||
       (s.kind==='part'?history.some(id=>!s.roots.includes(id)):history.some(id=>id!==null))||
       (s.role==='screw'?preloaded.some(id=>!s.roots.includes(id))||history.some(id=>!preloaded.includes(id)):preloaded.length>0)){
      reject('history','保存的安装点与当前工序不符。',m.requestId);return;
    }
    const prefix=c.steps.slice(0,index).flatMap(t=>t.kind==='part'?t.roots:[null]);
    if(!restore(c.id,[...prefix,...history])){reject('restore','当前工序无法恢复。',m.requestId);return;}
    const endpoints=procedures.wireTargets(c.id,s);
    const wire=endpoints?{sourceId:endpoints.sourceId,targetId:endpoints.targetId,
      sourceOptions:endpoints.sourceIds.map(describe),targetOptions:endpoints.targetIds.map(describe)}:null;
    job={chapter:c.id,step:s,mode:m.mode,required,wire,history:[...history],preloaded:new Set(preloaded),
      candidates:makeCandidates(c,s),visual:'none',targetId:null};
    broadcast('init',m.requestId);
    if(m.mode!=='exam')focus(job.step.roots[0]||job.wire?.sourceId);
  }
  function progress(cause){
    if(!job||!pending)return;
    const m=pending;
    pending=null;
    if(cause==='prev') job.history.pop();
    else if(cause==='next') job.history.push(m.id);
    broadcast(cause,m.requestId);
  }
  function blocked(message) {
    if(!pending)return;
    reject('blocked',message,pending.requestId,true);
  }
  function failed(message) {
    if(!pending)return;
    reject('operation',message,pending.requestId);
    pending=null;
  }
  function rolledBack(){
    if(!job)return;
    const id=rollbackRequest?.requestId||pending?.requestId;pending=null;rollbackRequest=null;
    broadcast('rollback',id);
  }
  function handle(e){
    const m=e.data;
    if(e.origin!==location.origin||e.source!==window.parent||m?.channel!==channel)return;
    if(m.type==='hello'){parentPost('ready',{chapters});return;}
    if(!m.type?.startsWith?.('station-')&&!['select','focus','view','rollback'].includes(m.type))return;
    if(m.type==='view'){if(['iso','front','side','top'].includes(m.view))view(m.view);return;}
    if(m.type==='focus'){if(job)focus(m.id||state().selectedId||job.step.roots[0]);return;}
    if(m.type==='select'){if(job&&!busy()&&!pending&&(job.candidates.some(c=>c.id===m.id)||[...(job.wire?.sourceOptions||[]),...(job.wire?.targetOptions||[])].some(p=>p.id===m.id)))select(m.id);return;}
    if(m.type==='rollback'||m.type==='station-rollback'){
      if(job&&(!m.chapter||m.chapter===job.chapter)&&(!m.stepId||m.stepId===job.step.id)){
        if(rollbackRequest?.requestId===m.requestId && rollbackRequest)return;
        if(replies.has(m.requestId)){const [type,data]=replies.get(m.requestId);parentPost(type,data);return;}
        if(rollbackRequest){reject('busy','夹具正在退出。',m.requestId);return;}
        rollbackRequest=m;
        if(!busy())rolledBack();
        else if(!rollback()){rollbackRequest=null;reject('busy','正在调整机构姿态，请等动作完成。',m.requestId);}
      }
      return;
    }
    if(!validId(m.requestId) && m.type!=='station-inspect')return;
    if(replies.has(m.requestId)){
      const [type,data]=replies.get(m.requestId);parentPost(type,data);return;
    }
    if(pending?.requestId===m.requestId)return;
    if(busy()||pending){reject('busy','请等待当前动作完成。',m.requestId);return;}
    if(m.type==='station-init'){init(m);return;}
    if(!job||m.chapter!==job.chapter||m.stepId!==job.step.id){reject('stale','此操作属于其他工位。',m.requestId);return;}
    if(m.type==='station-inspect'){
      const visual=m.visual||'none';
      if(!['none','loose','missing','unseated'].includes(visual)||visual!=='none'&&!job.step.roots.includes(m.targetId)){
        reject('inspect','交检点与当前工位不符。',m.requestId);return;
      }
      job.visual=visual;job.targetId=m.targetId||null;stage(job);
      reply('inspection',{visual,targetId:job.targetId,requestId:m.requestId},true);return;
    }
    if(m.type==='station-undo'){
      if(!job.history.length){reject('undo','本步还没有已完成的动作。',m.requestId);return;}
      pending=m;step('prev');return;
    }
    if(m.type!=='station-preload'&&m.type!=='station-action')return;
    if(job.history.length>=job.required){reject('complete','本工序已完成。',m.requestId);return;}
    const s=job.step,id=m.id??null;
    if((s.kind==='part'?!remaining().includes(id):id!==null)){
      reject('target','选中的零件或安装点与工序不符。',m.requestId);return;
    }
    if(job.wire&&(m.sourceId!==job.wire.sourceId||m.targetId!==job.wire.targetId)){
      reject('wire','线束起点或插接目标与工艺要求不符，请核对腿位及端点。',m.requestId);return;
    }
    const lateral=m.lateralMm??0,tilt=m.tiltDeg??0;
    if(!Number.isFinite(lateral)||!Number.isFinite(tilt)||Math.abs(lateral)>8||Math.abs(tilt)>8){
      reject('alignment','夹具偏移或倾角超出可调范围。',m.requestId);return;
    }
    const preload=m.type==='station-preload';
    if(preload&&(s.role!=='screw'||job.preloaded.has(id))){
      reject('preload','该安装点不能重复预装。',m.requestId);return;
    }
    if(!preload&&s.role==='screw'&&job.preloaded.size!==job.required){
      reject('preload','请先完成本工序所有螺钉的预装。',m.requestId);return;
    }
    pending={...m,id};
    align(lateral,tilt);select(id);
    if(s.role==='screw'){
      driveScrew(id,preload,()=>{
        if(preload){pending=null;job.preloaded.add(id);broadcast('preload',m.requestId);}
        else step('commit');
      });
    }else step('next');
  }
  window.addEventListener('message',handle);
  parentPost('ready',{chapters});
  return {progress,blocked,failed,rolledBack,
    selection(){if(job)reply('selection',state());}};
}
