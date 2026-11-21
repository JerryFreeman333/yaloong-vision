import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,Check,Download,RotateCcw} from 'lucide-react';
import {Question} from './course-controls.jsx';
import {materialImage} from './process-materials.js';
import {ProcessView} from './process-view.jsx';
import {newProcessAttempt,readProcessAttempt,saveProcessAttempt,performProcess,previewProcess,scoreProcess,inspectValue,exportProcessReport,canUndoProcess} from './process-attempt.js';

export const modes={practice:'引导练习',exam:'独立考核',demo:'工序演示'};
const steps={kit:'识件备料',method:'工艺准备',operate:'三维操作',inspect:'质量交检',repair:'返修',recheck:'复检',result:'装配记录'};
const codeForStage=s=>['repair','recheck'].includes(s)?'inspect':s;
function choiceOrder(length,seed){
  const values=Array.from({length},(_,i)=>i);
  let state=2166136261;for(const c of seed)state=Math.imul(state^c.charCodeAt(0),16777619)>>>0;
  for(let i=values.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[values[i],values[j]]=[values[j],values[i]];}return values;
}
function Prep({q,a,act}){
  const [choice,setChoice]=useState(null);
  const order=choiceOrder(q.options.length,a.id+a.stage);
  const options=order.map(i=>q.options[i]);
  const photos=a.stage==='kit'?options.map(materialImage):[];
  return <>{photos.length&&photos.every(Boolean)?<fieldset className="wc-question ps-tray"><legend>{q.question}</legend><div>
    {options.map((label,i)=><button key={label} data-option={i} aria-pressed={choice===i} onClick={()=>setChoice(i)}><img src={photos[i]} alt=""/><span>{label}</span></button>)}
    </div></fieldset>:<Question q={{...q,options}} selected={choice} onSelect={setChoice}/>}
    <button className="wc-primary ps-wide" disabled={choice===null} onClick={()=>act({type:a.stage,choice:order[choice]})}>{a.stage==='kit'?'提交备料选择':'确认工艺选择'} <ArrowRight size={15}/></button></>;
}
function Operate({lesson,a,status,id,choose,wire,wirePick,tool,setTool,lateral,setLateral,tilt,setTilt,act,blocked,rollback}){
  const targets=status?.candidates||[],screw=lesson.screw;
  const adjust=screw||lesson.id==='battery-04';
  const material=lesson.kit.options[lesson.kit.answer],photo=materialImage(material);
  return <>{a.mode==='exam'?<p className="ps-instruction">按工单和原厂图完成此项操作，再交付质检。</p>:
    <div className="ps-guide">{photo&&<img src={photo} alt={material}/>}<div><strong>{material}</strong><p>{lesson.method.options[lesson.method.answer]}。</p></div></div>}
    {status?.wire&&<><label className="ps-field">线束来源<select value={wire.sourceId||''} onChange={e=>wirePick('sourceId',e.target.value)}><option value="">选择线束或出线部件</option>{status.wire.sourceOptions.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <label className="ps-field">目标接口<select value={wire.targetId||''} onChange={e=>wirePick('targetId',e.target.value)}><option value="">选择要连接的部件</option>{status.wire.targetOptions.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label></>}
    {!!targets.length&&<label className="ps-field">操作对象<select value={id||''} onChange={e=>choose(e.target.value||null)}><option value="">从料盘或三维工件中选择</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}{a.committed.includes(t.id)?' · 已完成':a.preloaded.includes(t.id)?' · 已预装':''}</option>)}</select></label>}
    {screw&&<label className="ps-field">手工具<select value={tool} onChange={e=>setTool(e.target.value)}><option value="">选择刀头</option><option value="hex">内六角</option><option value="phillips">十字</option><option value="flat">一字</option></select></label>}
    {adjust&&<details className="ps-adjust"><summary>调整夹具对轴</summary><label>横向偏移 <b>{lateral.toFixed(1)} mm</b><input aria-label="横向偏移" type="range" min="-5" max="5" step=".1" value={lateral} onChange={e=>setLateral(+e.target.value)}/></label><label>轴线倾角 <b>{tilt}°</b><input aria-label="轴线倾角" type="range" min="-6" max="6" step=".5" value={tilt} onChange={e=>setTilt(+e.target.value)}/></label></details>}
    {blocked?<button className="ps-wide" onClick={rollback}><RotateCcw size={15}/>退回待装位</button>:screw?<><div className="ps-counts"><span>预装 <b>{a.preloaded.length} / {screw.count}</b></span><span>终紧 <b>{a.committed.length} / {screw.count}</b></span></div>
      <div className="wc-buttons"><button disabled={!id||!tool} onClick={()=>act({type:'preload',id,tool})}>预装所选螺钉</button><button onClick={()=>act({type:'align'})}>{a.aligned?'已复核对齐':'复核配合面对齐'}</button>
      <button className="wc-primary" disabled={!id||!tool} onClick={()=>act({type:'commit',id,tool})}>终紧所选螺钉</button></div></>:<>
      <button className="wc-primary ps-wide" disabled={(lesson.kind==='part'&&!id)||(status?.wire&&(!wire.sourceId||!wire.targetId))} onClick={()=>act({type:'commit',id:lesson.kind==='part'?id:null,...wire})}>{status?.wire?'对接所选线束与接口':lesson.actionLabel||lesson.uiLabel||'执行当前操作'} <ArrowRight size={15}/></button>
      {lesson.kind==='part'&&<small>已完成 {a.committed.length} / {lesson.roots.length} 个安装位</small>}</>}
  </>;
}
function Inspection({a,lesson,act}){
  const [point,setPoint]=useState(null),[decision,setDecision]=useState('');
  const points=lesson.inspection.points;
  const [repairChoice,setRepairChoice]=useState(null);
  return <><p className="ps-instruction">{a.stage==='inspect'?'已换入本工序的待交接件。逐项查看工件与签记，再决定移交或返修。':a.stage==='repair'?'按已提交的缺陷定位选择对应返修操作。':'复核修正后的工件和交接记录。'}</p>
    <div className="ps-points">{points.map((p,i)=>{
      const val=inspectValue(lesson,a,i);
      return <button key={i} aria-pressed={point===i} data-point={i} onClick={()=>setPoint(i)}><span>{p.label}</span><small>{val||'待查'}</small></button>;
    })}</div>
    {a.stage==='inspect'?<><button className="ps-wide" disabled={point===null} onClick={()=>act({type:'check',point})}>检查此项并读取记录</button>
      <fieldset className="ps-disposition"><legend>整项交检结论</legend>
      <button aria-pressed={decision==='pass'} onClick={()=>setDecision('pass')}>可移交</button><button aria-pressed={decision==='repair'} onClick={()=>setDecision('repair')}>返修所选项</button></fieldset>
      <button className="wc-primary ps-wide" disabled={!decision||(decision==='repair'&&point===null)} onClick={()=>act({type:'judge',decision,point:decision==='repair'?point:undefined})}>提交交检结论</button></>:
    a.stage==='repair'?<><label className="ps-field">返修操作<select value={repairChoice??''} onChange={e=>setRepairChoice(e.target.value===''?null:+e.target.value)}><option value="">选择操作</option>{points.map((p,i)=>points.findIndex(x=>x.repair===p.repair)===i&&<option key={i} value={i}>{p.repair}</option>)}</select></label>
      <button className="wc-primary ps-wide" disabled={point===null||repairChoice===null} onClick={()=>act({type:'repair',point,choice:repairChoice})}>执行返修</button></>:
      <button className="wc-primary ps-wide" onClick={()=>act({type:'recheck'})}>复检并生成工单</button>}</>;
}
function Results({a,lesson,act,next,again}){
  const s=scoreProcess(a);
  return <>{s.total===null?<dl className="ps-scores"><div><dt>已完成安装动作</dt><dd>{a.committed.length} 次</dd></div>
    {lesson.screw&&<div><dt>预装并终紧</dt><dd>{a.committed.length} 处</dd></div>}
    <div><dt>交接件复检</dt><dd>{a.repaired?'返修后通过':'通过'}</dd></div></dl>:
    <><div className="ps-score"><small>{a.submittedAt?'已提交':'待提交'} · {modes[a.mode]}</small><b>{s.total}<small> / 100</small></b></div>
    <dl className="ps-scores">{[['备料','kit'],['工艺','method'],['操作','operation'],['交检','inspection']].map(([name,k])=><div key={k}><dt>{name}</dt><dd>{s[k]} 分</dd></div>)}</dl></>}
    {!a.submittedAt?<button className="wc-primary ps-wide" onClick={()=>act({type:'submit'})}>{a.mode==='demo'?'完成演示':a.mode==='exam'?'交卷并保存成绩':'保存装配记录'}</button>:<><p className="wc-success">{s.passed?'本工序已完成':'已交卷，可重练本工序'}</p>
    <div className="wc-buttons">{a.mode!=='demo'&&<button onClick={()=>exportProcessReport(lesson,a)}><Download size={15}/>个人工单</button>}<button onClick={again}>重新开单</button><button className="wc-primary" onClick={next}>下一工序 <ArrowRight size={14}/></button></div></>}</>;
}
function demoChoice(l,a){
  const type=a.stage;
  if(['kit','method'].includes(type))return {type,choice:l[type].answer};
  if(type==='operate'){
    if(l.screw&&a.preloaded.length<l.roots.length)return {type:'preload',id:l.roots.find(r=>!a.preloaded.includes(r))};
    if(l.screw&&!a.aligned)return {type:'align'};
    const pool=l.kind==='part'?l.roots:[null];
    return pool.filter(id=>!a.committed.includes(id)).map(id=>({type:'commit',id})).find(x=>previewProcess(l,a,x).ok);
  }
  if(type==='inspect'){
    const point=l.inspection.points.findIndex((_,i)=>!a.checked.includes(i));
    if(point>=0)return {type:'check',point};
    return {type:'judge',decision:a.defectIndex==null?'pass':'repair',point:a.defectIndex??undefined};
  }
  if(type==='repair')return {type,point:a.defectIndex,choice:a.defectIndex};
  if(type==='recheck')return {type};if(type==='result')return {type:'submit'};
}
function pendingAttempt(l,mode,student){return (mode!=='demo'&&readProcessAttempt(l,mode,student))||newProcessAttempt(l,{mode,student});}
export function ProcessStation({lesson,mode,student,draw,next,onReported}){
  const [a,setA]=useState(()=>pendingAttempt(lesson,mode,student)),[,tick]=useState(0);
  const view=useRef(null),live=useRef(true),lock=useRef(false);
  const [busy,setBusy]=useState(false),[status,S]=useState(null),[id,I]=useState(null);
  const [wire,W]=useState({sourceId:null,targetId:null}),[tool,setTool]=useState('');
  const [flash,F]=useState(null),[lateral,L]=useState(0),[tilt,T]=useState(0),[blocked,B]=useState(false),[hint,H]=useState(0);
  const [storeError,setStoreError]=useState(false);
  useEffect(()=>{live.current=true;return ()=>{live.current=false;};},[]);
  useEffect(()=>{view.current?.showInspection();},[a.stage,a.repaired,a.id]);
  function change(action){
    const old=a.stage,r=performProcess(lesson,a,action);
    if(mode!=='demo'&&!saveProcessAttempt(lesson,a))setStoreError(true);
    if(old!==a.stage){H(0);I(null);L(0);T(0);}
    if(a.submittedAt&&action.type==='submit')onReported();
    tick(n=>n+1);F(r);return r;
  }
  async function act(action){
    if(!action||lock.current)return;
    const physical=['preload','commit'].includes(action.type);
    if(!physical&&action.type!=='undo'){change(action);return;}
    if(!status){F({ok:false,message:'三维工位正在加载。'});return;}
    if(blocked){F({ok:false,message:'请先将受阻工件退回待装位。'});return;}
    if(physical){
      const preview=previewProcess(lesson,a,action);
      if(!preview.ok||preview.code==='repeat'){change(action);return;}
    }
    lock.current=true;setBusy(true);
    try{
      if(action.type==='undo'){
        const r=change(action);
        if(r.ok){const reset=await view.current.restore();if(live.current&&!reset.ok)F(reset);else view.current?.showInspection();}return;
      }
      const ack=await view.current.request(action.type==='preload'?'station-preload':'station-action',{id:action.id,lateralMm:lateral,tiltDeg:tilt,sourceId:action.sourceId,targetId:action.targetId});
      if(!live.current)return;
      if(ack.ok){change(action);}
      else if(!ack.cancelled){const msg=ack.message||'装配受阻，请检查操作对象和配合方向。';B(!!ack.blocked);change({type:ack.code==='wire'||ack.code==='target'?'selectWrong':'blocked',id:action.id,sourceId:action.sourceId,targetId:action.targetId,message:msg});F({ok:false,message:msg});}
    }finally{lock.current=false;if(live.current)setBusy(false);}
  }
  async function rollback(){if(lock.current)return;lock.current=true;setBusy(true);try{const r=await view.current.request('station-rollback');if(live.current){B(!r.ok);F({ok:r.ok,message:r.ok?'夹具已退出。调整对轴后可以重试。':r.message});}}finally{lock.current=false;if(live.current)setBusy(false);}}
  function wirePick(field,value){
    W(previous=>({...previous,[field]:value}));
    if(value){view.current?.post('select',{id:value});view.current?.post('focus',{id:value});}
  }
  function cadPick(value){
    I(value);
    if(!value||!status?.wire)return;
    if(status.wire.sourceOptions.some(p=>p.id===value))W(previous=>({...previous,sourceId:value}));
    if(status.wire.targetOptions.some(p=>p.id===value))W(previous=>({...previous,targetId:value}));
  }
  function choose(value){I(value);view.current?.post('select',{id:value});}
  function again(){const fresh=newProcessAttempt(lesson,{mode,student});setA(fresh);saveProcessAttempt(lesson,fresh);I(null);S(null);H(0);F(null);B(false);L(0);T(0);setTool('');W({sourceId:null,targetId:null});}
  const demo=mode==='demo';
  return <><div className="ps-workgrid"><ProcessView key={a.id} ref={view} lesson={lesson} attempt={a} onStatus={snapshot=>{S(snapshot);if(snapshot?.cause==='init')B(false);}} onSelect={cadPick}/>
    <aside className="ps-card"><div className="ps-cap"><span>{modes[mode]}</span><span>说明书 · 第 {lesson.page} 页</span></div><h2>{steps[a.stage]}</h2>
      {storeError&&<p className="wc-notice">本机存储暂时不可写，完成后请下载工单。</p>}
      {flash&&<p role="status" className={flash.ok?'ps-good':'wc-notice'}>{flash.message}</p>}
      <fieldset className="ps-actions" disabled={busy}><div aria-live="polite">{busy&&<small>夹具正在执行…</small>}</div>
      {demo&&!a.submittedAt&&<button disabled={!status||blocked} className="ps-demo ps-wide" onClick={()=>{const cmd=demoChoice(lesson,a);if(cmd?.id)choose(cmd.id);if(lesson.screw&&['preload','commit'].includes(cmd?.type)){cmd.tool='hex';setTool('hex');}if(cmd?.type==='commit'&&status?.wire){cmd.sourceId=status.wire.sourceId;cmd.targetId=status.wire.targetId;W({sourceId:cmd.sourceId,targetId:cmd.targetId});}act(cmd);}}>演示下一动作 <ArrowRight size={15}/></button>}
      {['kit','method'].includes(a.stage)?<Prep key={a.stage+a.id} q={lesson[a.stage]} a={a} act={act}/>:a.stage==='operate'?<Operate {...{lesson,a,status,id,choose,wire,wirePick,tool,setTool,lateral,setLateral:L,tilt,setTilt:T,act,blocked,rollback}}/>:
      a.stage==='result'?<Results {...{a,lesson,act,next,again}}/>:<Inspection {...{a,lesson,act}}/>}
      <div className="ps-resources"><button onClick={()=>draw(lesson.page)}><BookOpen size={14}/> 工艺图</button>{mode!=='exam'&&a.stage!=='result'&&<><button onClick={()=>{const n=Math.min(3,hint+1);change({type:'hint',level:n});H(n);}}>分级提示</button><button disabled={blocked||!canUndoProcess(a)} onClick={()=>act({type:'undo'})}><RotateCcw size={14}/>撤销</button></>}</div>
      {hint>0&&<p className="ps-hint">{hint===1?'对照说明书第 '+lesson.page+' 页，核对工件标记和安装基准。':hint===2?lesson.hint:(a.stage==='kit'?lesson.kit.feedback:a.stage==='method'?lesson.method.feedback:a.stage==='operate'?lesson.detail:'逐项读取交检记录，判断哪个检查项需要返修。')}</p>}
      </fieldset></aside></div><nav className="ps-stages" aria-label="专项工艺路线">{(mode==='exam'?['kit','method','operate','inspect','result']:['operate','inspect','result']).map(s=><span key={s} aria-current={codeForStage(a.stage)===s?'step':undefined}>{steps[s]}</span>)}</nav></>;
}
