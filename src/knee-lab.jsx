import React,{useEffect,useReducer,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GalleryReturn} from './gallery-return.jsx';
import {ArrowLeft, ArrowUpRight, BookOpen, Box, Check, ChevronRight, ClipboardList, Crosshair, Layers, Maximize2, RotateCw} from 'lucide-react';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import {applyAction,previewAction,createAttempt} from './knee-rules.js';
import {archiveAttempt,exportAttempt,loadDraft,saveDraft} from './knee-records.js';
import {Actions,Drawing,stageNames} from './knee-station.jsx';
import './knee-lab.css';

const labels={practice:'引导练习',exam:'独立考核',demo:'工序演示'};
const zeroPose=()=>({face:'',slot:'',tilt:0,lateral:0});
const initialView={leg:'LF',phase:'kit',holes:[0,0,0,0,0,0],selected:null};
function Toolbar() {
  return <header className="masthead"><GalleryReturn brandClass="wordmark"/>
    <span className="unit">机器狗装配实训</span><nav><a href="./assembly.html"><ArrowLeft size={16}/>整机装配课程</a></nav></header>;
}
function Cad({state,onHole,onPart,api,animating}) {
  const host=useRef(),latest=useRef({}),[error,setError]=useState(''),[generation,reload]=useReducer(n=>n+1,0);
  latest.current={state,onHole,onPart};
  useEffect(()=>{
    let alive=true,view;
    setError('');
    import('./knee-view.js').then(({createKneeView})=>createKneeView(host.current,{
      onHole:n=>latest.current.onHole(n),onPart:p=>latest.current.onPart(p)
    })).then(v=>{if(!alive){v.dispose();return;}view=v;api.current=v;v.update(latest.current.state);})
      .catch(()=>{if(alive)setError('三维模型加载失败，请检查本地模型服务和浏览器图形加速。');});
    return ()=>{alive=false;view?.dispose();api.current=null;};
  },[api,generation]);
  useEffect(()=>{if(!animating)api.current?.update(state);},[state,api,animating]);
  return <div className="cad-field"><div ref={host} className="cad-host"/>{error&&<div className="cad-error" role="alert">{error} <button onClick={reload}>重新加载模型</button></div>}</div>;
}
function Intro({mode,setMode,student,setStudent,draft,onBegin,onResume,onDrawing,onDemo}) {
  return <><div className="panel-cap"><span>训练工单</span><span>BPX / K01</span></div><h2>领取工单</h2>
    <p className="lead">完成膝电机输出端固定，向下一工位交付一份质量记录。</p>
    {draft&&!draft.submittedAt&&<button className="resume wide" onClick={onResume}>继续 {draft.student} 的工单 · {stageNames[draft.stage]} <ChevronRight size={15}/></button>}
    <fieldset className="choice-field"><legend>训练方式</legend><div className="mode-list">
      {[['practice','左前腿','分级提示，可撤销操作'],['exam','右前腿','独立操作，保留查图工具']].map(([id,side,desc])=>
      <button key={id} aria-pressed={mode===id} onClick={()=>setMode(id)}><span><strong>{labels[id]}</strong> <i>{side}</i></span><small>{desc}</small></button>)}
    </div></fieldset><label className="student-field">{mode==='exam'?'学生代号':'学生代号（选填）'}<input placeholder="输入姓名或学号" maxLength="48" value={student} onChange={e=>setStudent(e.target.value)}/></label>
    <button className="primary wide" disabled={mode==='exam'&&!student.trim()} onClick={onBegin}>开始{labels[mode]} <ArrowUpRight size={17}/></button>
    <button className="wide quiet" onClick={onDrawing}><BookOpen size={16}/> 查看工艺图</button>
    <button className="wide quiet" onClick={onDemo}>观看工序演示</button></>;
}
function demoAction(a) {
  const h=a.inspection.hole;
  switch(a.stage) {
    case 'kit':return {type:'kit',side:'L',motor:'KNEE',spec:'M3×8',count:6};
    case 'seat':return {type:'seat',face:'arrow',slot:'lower'};
    case 'fasten':{
      const n=a.holes.indexOf('empty');
      if(n!==-1)return {type:'preload',hole:n+1,tool:'hex'};
      if(!a.aligned)return {type:'align'};
      return {type:'tighten',hole:a.pendingOpposite||a.holes.indexOf('preloaded')+1,tool:'hex'};
    }
    case 'inspect':{
      const unchecked=h&&!a.inspection.checked.includes(h)?h:
        (!h?[1,2,3,4,5,6].find(n=>!a.inspection.checked.includes(n)):null);
      if(unchecked)return {type:'check',hole:unchecked};
      return {type:'judge',decision:h?'repair':'pass',hole:h,reason:h?a.inspection.defect:undefined};
    }
    case 'repair':return h&&a.inspection.holes[h-1]!=='tight'?{type:'repair',hole:h}:{type:'recheck'};
    case 'done':return {type:'submit'};
  }
}
function Lab(){
  const [draft,setDraft]=useState(loadDraft);
  const active=useRef(draft);
  const [screen,setScreen]=useState(()=>draft?'work':'start');
  const [,redraw]=useReducer(n=>n+1,0);
  const [mode,setMode]=useState('practice'),[student,setStudent]=useState(draft?.student||'');
  const [pose,setPose]=useState(zeroPose),[selected,setSelected]=useState(null),[part,setPart]=useState(null);
  const [feedback,setFeedback]=useState(null),[drawing,setDrawing]=useState(null),[warning,setWarning]=useState('');
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false),motionLock=useRef(false);
  const api=useRef(null),stageArea=useRef(null),rail=useRef(null);
  const a=screen==='work'?active.current:null;
  const leg=a?.leg||(mode==='exam'?'RF':'LF'),stage=a?.stage||'kit';
  const inspection=['inspect','repair','done'].includes(stage);
  const viewState={...initialView,leg,mode:a?.mode||mode,phase:stage==='repair'?'inspect':stage,selected,part,flipped:stage==='seat'&&pose.face==='back',slot:pose.slot,lateral:pose.lateral,tilt:pose.tilt,
    holes:(a?(inspection?a.inspection.holes:a.holes):[]).map(s=>['empty','preloaded','tight'].indexOf(s))};
  const jumpStage=()=>{setPose(zeroPose());setSelected(null);setPart(null);rail.current?.scrollTo({top:0});};
  const resume=()=>{const v=loadDraft()||draft;if(v){active.current=v;jumpStage();setFeedback(null);setScreen('work');}};
  function launch(m) {
    const defect=m==='exam'?['missing','normal','loose'][Math.floor(Math.random()*3)]:'loose';
    const next=createAttempt({mode:m,student:m==='demo'?'':student.trim()||'本机学员',defect,defectHole:m==='demo'?3:undefined});
    active.current=next;setConfirm(false);jumpStage();setFeedback(null);setWarning('');
    if(m!=='demo'){setDraft(next);if(!saveDraft(next))setWarning('浏览器无法保存进度。完成后请下载工单。');}
    setScreen('work');redraw();
  }
  const menu=()=>{setDraft(loadDraft());setConfirm(false);setFeedback(null);jumpStage();setScreen('start');};
  async function run(action){
    const v=active.current;
    if(!v||motionLock.current)return;
    const moves=['seat','preload','tighten','repair'];
    if(moves.includes(action.type)&&previewAction(v,action).ok){
      const view=api.current;
      if(!view){setFeedback({ok:false,message:'等待模型就绪后再执行装配。'});return;}
      const next={...viewState,holes:[...viewState.holes],selected:action.hole||selected};
      if(action.type==='seat'){next.phase='fasten';next.flipped=false;}
      else next.holes[action.hole-1]=action.type==='repair'?Math.min(2,next.holes[action.hole-1]+1):(action.type==='preload'?1:2);
      motionLock.current=true;setBusy(true);
      try{if(!await view.move(next))return;}
      catch{setFeedback({ok:false,message:'动作尚未完成，可重新执行。'});return;}
      finally{motionLock.current=false;setBusy(false);}
      if(active.current!==v||api.current!==view)return;
    }
    const before=v.stage,result=applyAction(v,action);
    if(v.mode!=='demo'){
      const stored=saveDraft(v);
      const archived=v.submittedAt?archiveAttempt(v):true;
      if(!stored||!archived)setWarning('本机存储空间不足或不可写。请在本页完成并下载个人工单。');
    }
    if(v.stage!==before)jumpStage();
    setFeedback(result);redraw();
  }
  const openDrawing=()=>setDrawing(stage==='kit'?0:stage==='seat'?1:2);
  const nextDemo=()=>{const action=demoAction(a);if(action.hole)setSelected(action.hole);run(action);};
  const side=leg==='LF'?'左前腿':'右前腿';
  return <><Toolbar/>
    <main className="lab">
      <div className="heading"><div><p>BLACK PANTHER X <span>/</span> {side}</p><h1>膝关节电机装配</h1></div>
        {a?<div className="work-label"><b>{labels[a.mode]}</b>{a.student&&<span>{a.student}</span>}<button disabled={busy} onClick={menu}><ClipboardList size={16}/> 工单台</button></div>:<span className="course-code">课程工位　K01</span>}</div>
      {warning&&<div className="storage-note" role="status">{warning}</div>}
      <div className="station-grid"><section className="model-card" aria-label="装配模型" ref={stageArea}>
        <div className="view-header"><div><i/> {side}装配工位 {busy&&<span role="status">· 正在执行</span>}</div><button title="全屏工位" aria-label="全屏工位" onClick={()=>{if(document.fullscreenElement)document.exitFullscreen()?.catch(()=>{});else stageArea.current?.requestFullscreen?.()?.catch(()=>{});}}><Maximize2 size={16}/></button></div>
        <Cad state={viewState} animating={busy} onHole={n=>{if(!motionLock.current)setSelected(n);}} onPart={p=>{if(!motionLock.current)setPart(p);}} api={api}/>
        <div className="view-bar"><div className="camera-buttons">{[['overview','全件',Box],['part','安装面',Layers],['holes','孔位',Crosshair]].map(([key,title,Icon])=><button key={key} onClick={()=>api.current?.focus(key)}><Icon size={14}/>{title}</button>)}</div>
          <span><RotateCw size={13}/> 拖动旋转 · 滚轮缩放</span></div></section>
        <aside className="work-card" ref={rail}>{a?<fieldset className="station-actions" disabled={busy}><Actions key={a.id} {...{a,run,selected,onSelect:setSelected,pose,setPose,onPart:setPart,feedback,openDrawing,nextDemo}} download={()=>exportAttempt(a)} onMenu={menu}/></fieldset>:<>
          <Intro {...{mode,setMode,student,setStudent,draft,onBegin:()=>{if(draft&&!draft.submittedAt)setConfirm(true);else launch(mode);},onResume:resume,onDrawing:openDrawing,onDemo:()=>launch('demo')}}/>
          {confirm&&<div className="replace" role="alert"><p>开始新工单会替换本机未交卷的草稿。</p><div className="btn-pair"><button onClick={()=>setConfirm(false)}>保留草稿</button><button onClick={()=>launch(mode)}>开始新工单</button></div></div>}</>}</aside></div>
      <nav className="process" aria-label="工艺路线"><span>工艺路线</span>{['kit','seat','fasten','inspect','done'].map((s,i)=>{
        const activeIndex=['kit','seat','fasten','inspect','done'].indexOf(stage==='repair'?'inspect':stage);
        return <React.Fragment key={s}>{i>0&&<ChevronRight size={13}/>}<b aria-current={a&&i===activeIndex?'step':undefined} className={a&&i<activeIndex?'complete':''}>{a&&i<activeIndex&&<Check size={13}/>} {s==='inspect'?'交检返修':stageNames[s]}</b></React.Fragment>;})}</nav>
      <footer><span>BPX · 装配实训</span><span>工艺依据　C2P20724 改1</span></footer>
    </main>
    {drawing!==null&&<Drawing leg={leg} initial={drawing} onClose={()=>setDrawing(null)}/>}
  </>;
}
createRoot(document.getElementById('root')).render(<Lab/>);
