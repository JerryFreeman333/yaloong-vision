import React,{useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import {drawingRegion} from './drawing-regions.js';
import './course-drawing.css';

export function Drawing({pages,initial,step,onClose}){
  const [page,setPage]=useState(initial),[full,setFull]=useState(false);const dialog=useRef();
  useEffect(()=>{const el=dialog.current;el.showModal();return ()=>el.close();},[]);
  const choices=[...new Set([...pages,initial])].sort((a,b)=>a-b);
  const pos=choices.indexOf(page);
  const rect=drawingRegion(step,page),cropped=rect&&!full;
  const src='./training/whole/p'+String(page).padStart(2,'0')+'.webp';
  function turn(to){setPage(to);setFull(false);}
  return <dialog className="wc-dialog" ref={dialog} aria-labelledby="wc-drawing-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <header><div><small>C2P20724 改1</small><h2 id="wc-drawing-title">原厂装配工艺图</h2></div><button aria-label="关闭工艺图" onClick={onClose} autoFocus><X size={18}/></button></header>
    <div className="wc-page-tools"><button aria-label="前一页" disabled={pos<1} onClick={()=>turn(choices[pos-1])}><ChevronLeft size={16}/></button>
    <select aria-label="工艺图页码" value={page} onChange={e=>turn(+e.target.value)}>{choices.map(n=><option value={n} key={n}>说明书 · 第 {n} 页</option>)}</select>
    <button aria-label="后一页" disabled={pos===choices.length-1} onClick={()=>turn(choices[pos+1])}><ChevronRight size={16}/></button>
    {rect&&<button className="wc-drawing-switch" onClick={()=>setFull(!full)}>{full?'查看本步局部图':'查看原页'}</button>}</div>
    <div className="wc-paper" key={page+'-'+full}>{cropped?<div className="wc-figure-crop" style={{'--figure-ratio':(1273*rect[2])/(1800*rect[3])}}>
      <img src={src} alt={step.title+'，说明书第 '+page+' 页局部图'} style={{width:(100/rect[2])+'%',left:(-100*rect[0]/rect[2])+'%',top:(-100*rect[1]/rect[3])+'%'}}/>
    </div>:<img src={src} alt={'BLACK PANTHER X 拼装说明书第 '+page+' 页'}/>}</div>
  </dialog>;
}
export function Question({q,selected,onSelect,title}){
  return <fieldset className="wc-question"><legend>{title||q.question}</legend><div>{q.options.map((option,i)=>
    <button key={i} type="button" data-option={i} aria-pressed={i===selected} onClick={()=>onSelect(i)}><i aria-hidden="true">{String.fromCharCode(65+i)}</i><span>{option}</span></button>)}</div></fieldset>;
}
