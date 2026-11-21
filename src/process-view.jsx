import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {Box,Focus,RotateCcw} from 'lucide-react';

const channel='bpx-whole-v1';
export const ProcessView=forwardRef(function ProcessView({lesson,attempt,onStatus,onSelect},ref){
  const frame=useRef(null),latest=useRef(null),requests=useRef(new Map());
  const [version,reload]=useState(0),[error,setError]=useState(''),[ready,setReady]=useState(false);
  latest.current={attempt,onStatus,onSelect};
  const post=(type,payload={})=>frame.current?.contentWindow?.postMessage({
    channel,type,chapter:lesson.chapterId,stepId:lesson.id,...payload
  },location.origin);
  function request(type,payload={}){
    const requestId=crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{requests.current.delete(requestId);resolve({ok:false,message:'工位没有确认此动作，请重载当前工位后再试。',recover:true});},40000);
      requests.current.set(requestId,m=>{clearTimeout(timer);resolve(m);});post(type,{...payload,requestId});
    });
  }
  const restore=()=>{const a=latest.current.attempt;return request('station-init',{mode:a?.mode||'practice',history:a?.committed||[],preloaded:a?.preloaded||[]});};
  function showInspection(){
    const a=latest.current.attempt;
    if(!a||!['inspect','repair','recheck','result'].includes(a.stage))return;
    const point=a.repaired?null:lesson.inspection.points[a.defectIndex];
    post('station-inspect',{requestId:crypto.randomUUID(),visual:point?.visual||'none',targetId:point?.targetId,defectIndex:a.repaired?null:a.defectIndex,pointCount:lesson.inspection.points.length});
  }
  useImperativeHandle(ref,()=>({request,restore,post,showInspection}),[lesson]);
  useEffect(()=>{
    let connected=false,alive=true;
    setReady(false);setError('');latest.current.onStatus(null);
    function receive(e){
      const m=e.data;
      if(e.source!==frame.current?.contentWindow||e.origin!==location.origin||m?.channel!==channel)return;
      if(m.type==='station-ready'&&!connected){
        connected=true;
        restore().then(r=>{if(!alive)return;if(!r.ok){setError(r.message);return;}showInspection();});
        return;
      }
      if((m.chapter&&m.chapter!==lesson.chapterId)||(m.stepId&&m.stepId!==lesson.id))return;
      if(m.type==='station-selection'){latest.current.onSelect(m.selectedId);return;}
      if(m.type==='station-progress'){
        setReady(true);setError('');latest.current.onStatus(m);
      }
      if(m.type==='station-error'&&!m.requestId&&!connected)setError(m.message||'工位创建失败');
      if(m.type==='station-error'||m.type==='station-progress'){
        const done=requests.current.get(m.requestId);
        if(done){requests.current.delete(m.requestId);done({...m,ok:m.type==='station-progress'});}
      }
    }
    window.addEventListener('message',receive);
    const interval=setInterval(()=>{if(!connected)post('hello');},1000);
    const timer=setTimeout(()=>{if(!connected)setError('三维工位加载时间较长，可以继续等待或重新加载。');},50000);
    return ()=>{alive=false;clearInterval(interval);clearTimeout(timer);window.removeEventListener('message',receive);
      for(const done of requests.current.values())done({ok:false,message:'已离开工位。',cancelled:true});requests.current.clear();};
  },[lesson,version]);
  return <section className="ps-model"><header><span><i/> {lesson.leg?({LF:'左前腿',LR:'左后腿',RF:'右前腿',RR:'右后腿'}[lesson.leg]):'整机'}装配工位</span><small>3D CAD</small></header>
    <div className="ps-canvas"><iframe ref={frame} key={version} title="工序三维装配工位" src="./simulator.html?feature=process-station" allowFullScreen/>{!ready&&<div className="wc-veil" role="status">{error||'正在准备当前工序的零件与夹具…'}{error&&<button onClick={()=>reload(n=>n+1)}>重新加载</button>}</div>}</div>
    <footer><div><button onClick={()=>post('view',{view:'iso'})}><Box size={14}/>全件</button><button onClick={()=>post('focus')}><Focus size={14}/>操作部位</button><button onClick={()=>post('view',{view:'side'})}>侧视</button></div><button onClick={()=>reload(n=>n+1)} title="按已完成的操作重载"><RotateCcw size={13}/>重载工位</button></footer></section>;
});
