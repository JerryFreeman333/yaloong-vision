import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GalleryReturn} from './gallery-return.jsx';
import {ArrowRight,ArrowLeft,Check,ChevronRight,ClipboardCheck,Layers,Search,Settings2} from 'lucide-react';
import '@fontsource/barlow-condensed/latin-700.css';
import {Drawing} from './course-controls.jsx';
import {WHOLE_CHAPTERS} from './whole-course-content.js';
import {buildProcessCatalog} from './process-catalog.js';
import {ProcessStation,modes} from './process-station.jsx';
import {listProcessReports,scoreProcess} from './process-attempt.js';
import './whole-course.css';
import './process-course.css';

const preference='bpx.process.workstation';
function getSettings(){try{return JSON.parse(localStorage.getItem(preference))||{};}catch{return {};}}
function getRoute(){return location.hash.slice(1).split('/');}
function go(...to){location.hash=to.join('/');}
async function readAsset(name){const r=await fetch('./assets/'+name+'.json');if(!r.ok)throw new Error('无法读取 '+name);return r.json();}
async function loadCatalog(){
  const data=await Promise.all(['assembly','procedures','fasteners'].map(readAsset));
  return buildProcessCatalog(...data).map(c=>({...c,...WHOLE_CHAPTERS.find(w=>w.id===c.id),
    steps:c.steps.map(s=>({...s,chapterId:c.id}))}));
}
function Header(){return <header className="wc-header"><GalleryReturn brandClass="wc-logo"/><span className="wc-product">机器狗装配实训</span><nav><a href="./simulator.html?feature=assembly"><ArrowLeft size={15}/> 返回仿真</a></nav></header>;}
function Settings({mode,student,updateMode,updateStudent}){
  return <div className="ps-settings"><label>学习模式<select aria-label="学习模式" value={mode} onChange={e=>updateMode(e.target.value)}>{Object.entries(modes).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {mode!=='demo'&&<label>学员<input aria-label="学生代号" maxLength="48" key={student} defaultValue={student} onBlur={e=>{const v=e.currentTarget.value.trim()||'本机学员';e.currentTarget.value=v;updateStudent(v);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>}</div>;
}
function tileTitle(c){return WHOLE_CHAPTERS.find(x=>x.id===c.id)?.title||c.title;}
function Overview({catalog,all,passed,mode,settings}){
  const next=all.find(l=>!passed.has(l.id));
  return <><section className="wc-hero"><div className="wc-intro"><p className="wc-eyebrow">BLACK PANTHER X</p><h1>装配工序专项练习</h1>
    <p>选一道工序，练习对位、安装、紧固或接线。每个工位会备好前道工序的组件。</p>
    <button className="wc-primary" onClick={()=>next?go('station',next.chapterId,next.id):go('final')}>{next?(passed.size?'继续工序训练':'开始工序训练'):'查看训练记录'} <ArrowRight size={16}/></button>
    <div className="wc-progress"><div><span>{modes[mode]}</span><b>{passed.size} / {all.length} 道完成</b></div><progress value={passed.size} max={all.length} aria-label="工序进度"/></div></div>
    <figure><img src="./gallery/hero-iso.webp" alt="BLACK PANTHER X 整机和四条腿的安装位置"/></figure></section>
    <div className="wc-section-title"><h2>选择工序</h2>{settings}</div>
    <div className="wc-chapters">{catalog.map((c,i)=><button key={c.id} className="wc-chapter-tile" onClick={()=>go('chapter',c.id)}><div><Layers size={18}/><small>{c.steps.filter(l=>passed.has(l.id)).length} / {c.steps.length} 道完成</small></div>
    <h3>{i+1}. {tileTitle(c)}</h3><p>{c.summary}</p><span>查看全部 {c.steps.length} 道工序 <ChevronRight size={14}/></span></button>)}</div>
    <div className="wc-lower"><button onClick={()=>go('final')}><ClipboardCheck size={18}/>专项训练记录<ChevronRight size={16}/></button>
    <a href="./assembly.html"><Layers size={17}/>从零组装整机<ChevronRight size={16}/></a></div>
    <a className="ps-knee" href="./knee.html"><Settings2 size={15}/>膝关节专项练习与考核</a></>;
}
function Chapter({chapter,passed,settings}){
  const [query,Q]=useState(''),[leg,L]=useState('');
  const legs=[['LF','左前腿'],['LR','左后腿'],['RF','右前腿'],['RR','右后腿']];
  const count=chapter.steps.length;
  const visible=chapter.steps.filter(s=>(!leg||leg===s.leg)&&[s.title,s.detail].join(' ').includes(query.trim()));
  return <><div className="wc-work-title"><div><p className="wc-eyebrow">BLACK PANTHER X</p><h1>{tileTitle(chapter)}</h1></div>{settings}</div><p className="ps-summary">{chapter.summary}</p>
    <div className="ps-search"><label><Search size={15}/><input placeholder="查找工序或零件" value={query} onChange={e=>Q(e.target.value)}/></label>{chapter.steps.some(s=>s.leg)&&<select aria-label="筛选腿位" value={leg} onChange={e=>L(e.target.value)}><option value="">全部腿位</option>{legs.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select>}<span>{visible.length} / {count} 道工序</span></div>
    <div className="ps-library">{visible.map(s=><button key={s.id} onClick={()=>go('station',chapter.id,s.id)}><i>{String(chapter.steps.indexOf(s)+1).padStart(2,'0')}</i><span><strong>{s.title}</strong><small>说明书第 {s.page} 页 · {s.screw?s.screw.spec+' × '+s.screw.count:s.kind==='part'?s.roots.length+' 个安装位':'工艺操作'}</small></span>
    {passed.has(s.id)?<Check size={18}/>:<ChevronRight size={17}/>}</button>)}</div>{!visible.length&&<p className="ps-summary">没有匹配工序，请调整关键词或腿位。</p>}</>;
}
function downloadText(name,text){
 const u=URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=u;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(u),2000);
}
function Delivery({catalog,passed,mode,student}){
  const lessons=catalog.flatMap(c=>c.steps).filter(l=>passed.has(l.id));
  function download(){
    const lines=['BLACK PANTHER X · 装配专项训练记录',student+' · '+modes[mode]];
    for(const lesson of lessons){
      const a=passed.get(lesson.id),s=scoreProcess(a);
      lines.push(lesson.title+'　'+(s.total===null?'装配 '+a.committed.length+' 次，复检通过':s.total+' / 100'));
    }
    downloadText('BPX-专项训练记录.txt',lines.join('\n'));
  }
  return <><h1>专项训练记录</h1><div className="wc-delivery-grid">{catalog.map(c=><button key={c.id} onClick={()=>go('chapter',c.id)}>{tileTitle(c)} <b>{c.steps.filter(s=>passed.has(s.id)).length} / {c.steps.length} 道完成</b></button>)}</div>
    {mode==='demo'?<p>请切换到练习或考核查看个人记录。</p>:<p>{student} · {modes[mode]} · 已完成 {lessons.length} 道工序</p>}
    {!!lessons.length&&<button className="wc-primary" onClick={download}>下载已完成工序记录</button>}</>;
}
function Course(){
  const [catalog,C]=useState(null),[error,E]=useState(''),[route,R]=useState(getRoute);
  const [mode,M]=useState(()=>{
    const value=new URLSearchParams(location.search).get('mode');
    return Object.hasOwn(modes,value)?value:'practice';
  }),[student,S]=useState(()=>getSettings().student||'本机学员');
  function updateMode(value){
    const url=new URL(location.href);
    if(value==='practice')url.searchParams.delete('mode');else url.searchParams.set('mode',value);
    history.replaceState(history.state,'',url);
    M(value);
  }
  const [drawing,D]=useState(null),[revision,refresh]=useState(0);
  useEffect(()=>{loadCatalog().then(C).catch(e=>E(e.message));},[]);
  useEffect(()=>{
    function syncRoute(){
      const route=getRoute();
      if(route[0] && !['overview','chapter','station','final'].includes(route[0])){
        history.replaceState(history.state,'','#overview');
        R(['overview']);
      }else R(route);
      D(null);window.scrollTo(0,0);
    }
    syncRoute();
    window.addEventListener('hashchange',syncRoute);
    return ()=>window.removeEventListener('hashchange',syncRoute);
  },[]);
  useEffect(()=>{try{localStorage.setItem(preference,JSON.stringify({student}));}catch{}},[student]);
  const passed=useMemo(()=>{
    const result=new Map();if(catalog&&mode!=='demo')for(const a of listProcessReports(catalog)){
      if(a.mode===mode&&a.student===student&&scoreProcess(a).passed&&!result.has(a.lessonId))result.set(a.lessonId,a);
    }return result;
  },[catalog,mode,student,revision,route]);
  if(!catalog)return <><Header/><main className="wc-main"><p role="status">{error||'正在读取整机工艺目录…'}</p>{error&&<button onClick={()=>location.reload()}>重新加载</button>}</main></>;
  const [name,chapterId,lessonId]=route;
  const all=catalog.flatMap(c=>c.steps),chapter=catalog.find(c=>c.id===chapterId),lesson=chapter?.steps.find(s=>s.id===lessonId);
  const settings=<Settings {...{student,mode,updateMode,updateStudent:S}}/>,home=()=>go('overview');
  let body;
  if(name==='final')body=<Delivery key={student+mode} {...{catalog,passed,mode,student}}/>;
  else if(name==='station'&&lesson){
    const nextLesson=all[all.indexOf(lesson)+1];
    body=<><div className="wc-work-title"><div><p className="wc-eyebrow">{tileTitle(chapter)} · 工序 {chapter.steps.indexOf(lesson)+1} / {chapter.steps.length}</p><h1>{lesson.title}</h1></div>{settings}</div>
      <ProcessStation key={[lesson.id,student,mode].join('|')} lesson={lesson} mode={mode} student={student} draw={D} onReported={()=>refresh(n=>n+1)}
        next={()=>nextLesson?go('station',nextLesson.chapterId,nextLesson.id):go('final')}/></>;
  }else if(name==='chapter'&&chapter)body=<Chapter key={chapter.id} {...{chapter,passed,settings}}/>;
  else body=<Overview {...{catalog,all,passed,mode,settings}}/>;
  return <><Header/><main className="wc-main">{['station','chapter','final'].includes(name)&&<div className="wc-crumb"><button onClick={home}><ArrowLeft size={14}/> 课程总览</button>{name==='station'&&chapter&&<><span>/</span><button onClick={()=>go('chapter',chapter.id)}>{tileTitle(chapter)}工序目录</button></>}</div>}{body}</main>
    {drawing!=null&&<Drawing initial={drawing} step={lesson} pages={chapter?.pages||[drawing]} onClose={()=>D(null)}/>}</>;
}
createRoot(document.getElementById('root')).render(<Course/>);
