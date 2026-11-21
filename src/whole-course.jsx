import React,{useEffect,useReducer,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowDownToLine,ArrowLeft,ArrowRight,Check,ClipboardCheck,Frame,Layers,LockKeyhole,PlugZap,RotateCcw,Settings2,X} from 'lucide-react';
import '@fontsource/barlow-condensed/latin-700.css';
import {GalleryReturn} from './gallery-return.jsx';
import {Drawing} from './course-controls.jsx';
import {WHOLE_CHAPTERS} from './whole-course-content.js';
import {applyProgress,canFinish,canOpenChapter,downloadCourseReport,isFinished,newCourse,nextChapter,readCourse,saveCourse,signCourse} from './whole-course-state.js';
import {WholeWorkcell} from './whole-workcell.jsx';
import './whole-course.css';

const chapters = WHOLE_CHAPTERS;
const icons = {frame:Frame,legs:Settings2,mount:Layers,battery:PlugZap};

function route(course) {
  const [,name,id] = location.hash.match(/^#(chapter|final)(?:\/([^/]+))?$/) || [];
  if (name === 'final' && canFinish(course)) return 'final';
  if (name === 'chapter' && canOpenChapter(course,id)) return id;
  return nextChapter(course) ?? 'final';
}
function navigate(id) {
  location.hash = id === 'final' ? 'final' : 'chapter/' + id;
}

function NewOrder({course,onClose,onStart}) {
  const dialog = useRef(null);
  useEffect(()=>{
    const el = dialog.current;
    el.showModal();
    return ()=>el.close();
  },[]);
  return <dialog ref={dialog} className="wc-dialog wc-new-order" aria-labelledby="wc-new-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <header><h2 id="wc-new-title">从头装配这台机器狗？</h2><button aria-label="取消" onClick={onClose}><X size={16}/></button></header>
    <p>新工单会替换本机的整机装配记录，从第一根底梁重新开始。</p>
    <div className="wc-buttons">{isFinished(course)&&<button onClick={()=>downloadCourseReport(course)}>下载本次记录</button>}
      <button onClick={onClose} autoFocus>保留当前工单</button><button className="wc-primary" onClick={onStart}>开始新工单</button></div>
  </dialog>;
}

function ChapterNav({course,active}) {
  return <nav className="build-path" aria-label="整机装配顺序">{chapters.map((chapter,index)=>{
    const Icon = icons[chapter.id];
    const available = canOpenChapter(course,chapter.id);
    const finished = available && course.chapters[chapter.id].complete;
    return <button key={chapter.id} disabled={!available} aria-current={active===chapter.id?'step':undefined}
      title={!available?'完成前一章后开放':undefined} onClick={()=>navigate(chapter.id)}>
      <Icon size={19}/><span>{index+1}. {chapter.title}</span>
      {finished?<Check size={15} aria-label="已完成"/>:!available?<LockKeyhole size={13} aria-label="待解锁"/>:null}
    </button>;
  })}</nav>;
}

function Final({course,onSign}) {
  const [name,setName] = useState(course.student);
  const signed = isFinished(course);
  return <section className="wc-final build-final">
    <div className="build-final-heading"><ClipboardCheck size={25}/><h1>整机装配记录</h1></div>
    <p>四条腿与提手已固定，电池已推入导槽并锁合。</p>
    <div className="wc-delivery-grid">{chapters.map(c=><button key={c.id} onClick={()=>navigate(c.id)}>
      {c.title}<b>{c.steps} 道工序 · 已提交 {course.chapters[c.id].history.length} 次操作</b>
    </button>)}</div>
    {signed?<><p>{course.student||'本机学员'} · {new Date(course.signedAt).toLocaleString('zh-CN')}</p>
      <button className="wc-primary" onClick={()=>downloadCourseReport(course)}><ArrowDownToLine size={16}/>下载装配记录</button></>:
      <><label className="wc-signature">装配人<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="姓名或学号（选填）"/></label>
        <button className="wc-primary" onClick={()=>onSign(name)}>签署装配记录 <Check size={16}/></button></>}
  </section>;
}

function App() {
  const [course,setCourse] = useState(()=>readCourse() || newCourse());
  const [active,setActive] = useState(()=>route(course));
  const [,refresh] = useReducer(n=>n+1,0);
  const [drawing,setDrawing] = useState(null);
  const [resetting,setResetting] = useState(false);
  const [warning,setWarning] = useState('');
  const chapter = chapters.find(c=>c.id===active);
  const index = chapters.indexOf(chapter);
  const historyLength = chapters.reduce((sum,c)=>sum+course.chapters[c.id].history.length,0);

  useEffect(()=>{
    function sync() {
      const next = route(course);
      setActive(next);
      setDrawing(null);
      const wanted = next==='final'?'#final':'#chapter/' + next;
      if (location.hash && location.hash !== wanted) history.replaceState(history.state,'',wanted);
    }
    sync();
    window.addEventListener('hashchange',sync);
    return ()=>window.removeEventListener('hashchange',sync);
  },[course]);

  function persist() {
    setWarning(saveCourse(course)?'':'进度未写入本机。请检查存储空间，或关闭正在编辑同一工单的其他标签页。');
    refresh();
  }
  function startFresh() {
    const fresh = newCourse();
    const saved = saveCourse(fresh,course);
    setResetting(false);
    setWarning(saved?'':'当前浏览器未保存新工单。');
    setCourse(fresh);
    history.replaceState(history.state,'','#chapter/frame');
    setActive('frame');
  }

  return <><header className="wc-header build-header"><GalleryReturn brandClass="wc-logo"/>
    <span className="wc-product">机器狗整机装配</span><a href="./simulator.html?feature=assembly"><ArrowLeft size={15}/>返回仿真</a></header>
    <main className="wc-main build-main">
      <ChapterNav course={course} active={active}/>
      {warning&&<p role="status" className="wc-notice">{warning}</p>}
      {chapter?<WholeWorkcell key={course.id+chapter.id} chapter={chapter} saved={course.chapters[chapter.id]}
        onDrawing={setDrawing} nextChapter={chapters[index+1]}
        subsequentWork={chapters.slice(index+1).some(c=>course.chapters[c.id].history.length>0)}
        onNext={()=>navigate(chapters[index+1]?.id ?? 'final')}
        onProgress={m=>{if(applyProgress(course,chapter.id,m.history,m.complete))persist();}}/>:
        <Final course={course} onSign={name=>{if(signCourse(course,name))persist();}}/>}
      <footer className="build-footer">
        <div><a href="./stations.html">单项工位 <ArrowRight size={13}/></a><a href="./knee.html">膝关节专项练习与考核 <ArrowRight size={13}/></a></div>
        {historyLength>0&&<button onClick={()=>setResetting(true)}><RotateCcw size={13}/>从头装配</button>}
      </footer>
    </main>
    {resetting&&<NewOrder course={course} onClose={()=>setResetting(false)} onStart={startFresh}/>}
    {drawing!==null&&<Drawing initial={drawing.page} step={drawing.step} pages={chapter.pages} onClose={()=>setDrawing(null)}/>}
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
