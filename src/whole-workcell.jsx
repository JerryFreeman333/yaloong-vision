import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,ChevronDown,ChevronUp} from 'lucide-react';

const channel='bpx-whole-v1';
export function WholeWorkcell({chapter,saved,onProgress,onDrawing,nextChapter,onNext,subsequentWork}){
  const frame=useRef(null),savedHistory=useRef([...saved.history]),handlers=useRef(null);
  handlers.current={onProgress};
  const [progress,setProgress]=useState(null),[steps,setSteps]=useState([]);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0),[expanded,setExpanded]=useState(false);
  const ready=useRef(false);
  useEffect(()=>{
    const requestId=crypto.randomUUID();
    let initialized=false,hadError=false;
    ready.current=false;setError('');setProgress(null);
    const send=(type,body={})=>frame.current?.contentWindow?.postMessage({channel,type,...body},location.origin);
    function receive(e){
      if(e.origin!==location.origin||e.source!==frame.current?.contentWindow||e.data?.channel!==channel)return;
      const m=e.data;
      if(m.type==='ready'&&!initialized){
        const section=m.chapters?.find(c=>c.id===chapter.id);
        if(!section)return;
        initialized=true;setSteps(section.steps);
        send('init',{chapter:chapter.id,history:savedHistory.current,requestId});
      }
      if(m.type==='progress'&&m.chapter===chapter.id){
        if(!ready.current&&(m.cause!=='init'||m.requestId!==requestId))return;
        ready.current=true;setError('');setProgress(m);
        savedHistory.current=m.history.slice();
        handlers.current.onProgress(m);
      }
      if(m.type==='error'&&!ready.current){hadError=true;setError(m.message||'工位初始化失败。');}
    }
    window.addEventListener('message',receive);
    send('hello');
    const ping=setInterval(()=>{if(!initialized)send('hello');},1500);
    const timeout=setTimeout(()=>{if(!ready.current&&!hadError)setError('三维工位加载时间较长。可继续等待，或重新载入工位。');},45000);
    return ()=>{window.removeEventListener('message',receive);clearInterval(ping);clearTimeout(timeout);};
  },[chapter.id,retry]);
  const step=steps[progress?.index],count=progress?.count||steps.length;
  const legs=[['LF','左前腿'],['LR','左后腿'],['RF','右前腿'],['RR','右后腿']];
  const showLegs=chapter.id==='legs'||chapter.id==='mount';
  const page = step?.page || (progress?.complete ? chapter.pages.at(-1) : chapter.pages[0]);
  return <section className="wc-workcell build-cell">
    <div className="wc-cellbar build-cellbar"><div className="build-current">
      <h1>{chapter.title}</h1>
      <span aria-live="polite">{progress?.complete?'本章已装完':'工序 '+((progress?.index??0)+1)+' / '+(count||chapter.steps)}</span>
    </div><div>
      <button onClick={()=>onDrawing({page,step})} aria-label="当前工艺图"><BookOpen size={15}/> 工艺图 · 第 {page} 页</button>
      <button aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>工序清单 {expanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>
    </div></div>
    {showLegs&&steps.length>0&&<ul className="wc-leg-progress" aria-label="四条腿的装配进度">{legs.map(([id,name])=>{
      const positions=steps.map((s,i)=>s.leg===id?i:-1).filter(i=>i>=0);
      const done=positions.filter(i=>i<(progress?.index??0)).length;
      return <li key={id} aria-current={step?.leg===id?'step':undefined}><b>{name}</b> {done}/{positions.length}</li>;
    })}</ul>}
    {expanded&&<ol className="wc-step-list">{steps.map((item,i)=><li key={item.id} aria-current={i===progress?.index?'step':undefined}><span>{item.title}</span><small>{progress&&(i<progress.index||progress.complete)?'已完成':i===progress?.index?'当前':''}</small></li>)}</ol>}
    <div className="wc-sim-box">
      <iframe key={retry} ref={frame} title={chapter.title+'三维装配工位'} src="./simulator.html?feature=whole-course" allowFullScreen/>
      {!progress&&<div className="wc-veil" role="status">{error||'正在准备三维模型和安装工装…'}{error&&<button onClick={()=>setRetry(n=>n+1)}>重新载入工位</button>}</div>}
    </div>
    <div className="wc-cellfoot">
      <small>{subsequentWork?'本章之后已装有其他部件。撤销本章操作将重置后续工位。':
        progress?.complete?'本章全部装配动作已完成。':
        step?.stage?'点选零件和安装位，或按住「拿取零件」拖到绿色定位处。拖动空白处可旋转模型。':'拖动空白处旋转模型，可对照当前工艺图核对操作位置。'}</small>
      {progress?.complete?<button className="wc-primary" onClick={onNext}>{nextChapter?'装配下一工位 · '+nextChapter.title:'查看整机装配记录'}<ArrowRight size={16}/></button>:
        <small>本章已完成 {progress?.history.length??saved.history.length} / {chapter.actions} 次操作</small>}
    </div>
  </section>;
}
