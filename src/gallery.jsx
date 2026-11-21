import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowUpRight, Boxes, ChevronLeft, ChevronRight, ClipboardCheck, Expand, Film, LayoutGrid, Layers3, Move3d, Pause, Play, ScanLine, X } from 'lucide-react';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { categories, categoryLabel, features, featureUrl } from './gallery-features.js';
import './gallery.css';

const galleryAssets = './gallery/';
const resumeKey = 'bpx.gallery.return.v1';
const playbackKey = 'bpx.gallery.playback';
const course = features.find(item => item.id === 'assembly-course');
const views = [['iso', '等轴'], ['side', '侧视'], ['top', '俯视']];
const facts = [
  [Layers3, '86', '装配工序'], [Boxes, '412', '零件实例'],
  [Move3d, '12', '主动关节'], [ClipboardCheck, '222', '工序交检项'],
];

function saved(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}
function save(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Navigation also works without storage. */ }
}
const returnRequested = new URLSearchParams(location.search).get('return') === 'gallery';
const backNavigation = performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
const restored = returnRequested ? saved(resumeKey) : backNavigation ? history.state?.gallery || saved(resumeKey) : null;

function restorePosition(mark) {
  if (!mark) return;
  const target = document.getElementById(mark.trigger) || document.getElementById('preview-' + mark.feature);
  if (!target && (mark.trigger || mark.feature)) {
    document.getElementById('gallery-name')?.focus({preventScroll:true});
    document.getElementById('gallery')?.scrollIntoView();
    return;
  }
  target?.focus({preventScroll:true});
  if (Number.isFinite(mark.y)) window.scrollTo({top:mark.y, behavior:'instant'});
}

function Wordmark() {
  return <span className="wordmark"><span className="brand-symbol" aria-hidden="true"><i/><i/><i/></span>BPX <b>STUDIO</b></span>;
}

function Hero({ onEnter, onPreview }) {
  const [view, setView] = useState('iso');
  return <>
    <section className="hero" aria-labelledby="project-name">
      <div className="hero-copy">
        <div className="hero-kicker"><span/>BLACK PANTHER X</div>
        <h1 id="project-name">机器狗整机装配<br/>与运动仿真</h1>
        <p>从工作台上的第一根长梁开始，亲手组装机器狗。<br/>搭好机身、装上四腿，再观察整机如何迈步和转向。</p>
        <div className="hero-actions">
          <a id="hero-course" className="btn primary" href={featureUrl(course)} onClick={e=>onEnter(e.currentTarget.id)}>进入整机装配台<ArrowUpRight size={16}/></a>
          <button type="button" id="hero-preview" className="hero-browse" onClick={e=>onPreview(course.id, e.currentTarget.id)}><Play size={15}/>观看工序演示</button>
        </div>
      </div>
      <div className={'hero-stage hero-'+view}>
        <div className="stage-floor" aria-hidden="true"/>
        <div className="stage-shadow" aria-hidden="true"/>
        <img className="machine" src={galleryAssets+'hero-'+view+'.webp'} alt={'BLACK PANTHER X 四足机器人 CAD 模型，'+views.find(v=>v[0]===view)[1]+'视角'} width="1350" height="864" fetchPriority="high"/>
        <div className="stage-marker" aria-hidden="true"/>
        <div className="view-switch" role="group" aria-label="模型预览视角"><ScanLine size={14}/>{views.map(([id,label])=><button key={id} type="button" aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</div>
      </div>
    </section>
    <dl className="facts">{facts.map(([Icon,value,label])=><div className="fact" key={label}><Icon size={21} strokeWidth={1.5}/><div><dt>{label}</dt><dd>{value}</dd></div></div>)}</dl>
  </>;
}

function Gif({ item, playing, large=false }) {
  const image = useRef(null);
  const [visible,setVisible] = useState(false);
  useEffect(()=>{
    const element=image.current;
    if(large || !('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{threshold:0.03});
    observer.observe(element);
    return ()=>observer.disconnect();
  },[large]);
  return <img ref={image} width="960" height="540" loading={large?'eager':'lazy'} alt={item.alt}
    src={galleryAssets+item.id+(playing && (large || visible)?'.gif':'.webp')}/>;
}

function FeatureCard({item,playing,onPreview,onEnter}) {
  return <article className="feature-card" id={'work-'+item.id}>
    <button className="thumb" id={'preview-'+item.id} onClick={e=>onPreview(item.id,e.currentTarget.id)} data-preview={item.id} aria-label={'放大观看'+item.title}>
      <Gif item={item} playing={playing}/>
      <span className="gif-flag"><Film size={12}/>GIF</span>
      <span className="expand"><Expand size={14}/></span>
    </button>
    <div className="card-copy">
      <div className="card-meta"><span>{categoryLabel(item.category)}</span><i/>{item.metric}</div>
      <h3><button id={'title-'+item.id} onClick={e=>onPreview(item.id,e.currentTarget.id)}>{item.title}</button></h3>
      <p>{item.summary}</p>
      <a id={'enter-'+item.id} href={featureUrl(item)} onClick={e=>onEnter(e.currentTarget.id)}>{item.action || '进入此项仿真'}<ArrowUpRight size={14}/></a>
    </div>
  </article>;
}

function Preview({ item, items, playback, onSelect, onClose, onEnter }) {
  const dialog = useRef(null);
  const [playing,setPlaying] = useState(playback);
  useLayoutEffect(()=>{
    const node=dialog.current;node.showModal();
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return ()=>{node.close();document.body.style.overflow=previous;};
  },[]);
  const index=items.findIndex(f=>f.id===item.id);
  const change=delta=>onSelect(items[(index+delta+items.length)%items.length].id);
  return <dialog ref={dialog} className="preview" aria-labelledby="preview-title"
    onCancel={event=>{event.preventDefault();onClose();}}
    onClick={event=>{if(event.target===dialog.current)onClose();}}
    onKeyDown={event=>{if(event.key==='ArrowLeft'){event.preventDefault();change(-1);}if(event.key==='ArrowRight'){event.preventDefault();change(1);}}}>
    <div className="preview-inside">
      <div className="preview-head"><span><Film size={16}/>动图预览</span><button type="button" aria-label="关闭预览" onClick={onClose} autoFocus><X size={20}/></button></div>
      <div className="preview-media"><Gif item={item} playing={playing} large/><button type="button" className="media-play" onClick={()=>setPlaying(!playing)}>{playing?<Pause size={14}/>:<Play size={14}/>} {playing?'停止播放':'播放动图'}</button></div>
      <div className="preview-info"><div className="card-meta"><span>{categoryLabel(item.category)}</span><i/>{item.metric}</div><h2 id="preview-title">{item.title}</h2><p>{item.detail}</p></div>
      <div className="preview-foot"><div className="stepper">{items.length>1&&<><button aria-label="上一项演示" onClick={()=>change(-1)}><ChevronLeft size={17}/></button><span>{index+1} / {items.length}</span><button aria-label="下一项演示" onClick={()=>change(1)}><ChevronRight size={17}/></button></>}</div><a className="btn primary" href={featureUrl(item)} onClick={onEnter}>{item.action || '进入此项仿真'}<ArrowUpRight size={16}/></a></div>
    </div>
  </dialog>;
}

function App() {
  const [category,setCategory]=useState(()=>{
    const previous = restored?.category === 'teaching' ? 'quality' : restored?.category;
    return categories.some(c=>c.id===previous) ? previous : 'all';
  });
  const [preview,setPreview]=useState(null);
  const [playing,setPlaying]=useState(()=>saved(playbackKey)??!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const grid = useRef(null);
  const opener = useRef(null);
  const visible=features.filter(item=>category==='all'||category===item.category);
  const previewItems=opener.current==='hero-preview'?[course]:visible;
  const previewItem=previewItems.find(item=>item.id===preview);
  function openPreview(id, trigger) {
    opener.current = trigger;
    setPreview(id);
  }
  function enter(trigger) {
    const mark = {category, trigger, y:window.scrollY};
    save(resumeKey, mark);
    history.replaceState({...history.state, gallery:mark}, '');
  }
  function closePreview() {
    setPreview(null);
    requestAnimationFrame(()=>document.getElementById(opener.current)?.focus({preventScroll:true}));
  }
  useLayoutEffect(()=>{
    if(restored) restorePosition(restored);
    else if(returnRequested) grid.current.scrollIntoView();
    if(returnRequested) {
      const url = new URL(location.href);
      url.searchParams.delete('return');
      history.replaceState({...history.state,gallery:restored},'',url);
    }
    function resumePage(event) {
      if(!event.persisted) return;
      setPreview(null);
      requestAnimationFrame(()=>restorePosition(history.state?.gallery));
    }
    window.addEventListener('pageshow',resumePage);
    return ()=>window.removeEventListener('pageshow',resumePage);
  },[]);
  const togglePlayback=()=>{setPlaying(!playing);save(playbackKey,!playing);};
  return <>
    <header className="site-header"><div className="wrap mast"><a className="brand-link" href="#top" aria-label="BPX Studio 项目概览"><Wordmark/></a>
      <nav aria-label="主导航"><a className="nav-gallery" href="#gallery"><LayoutGrid size={14}/>功能图库</a><a id="nav-sim" className="nav-sim" href="./simulator.html" onClick={e=>enter(e.currentTarget.id)}>进入仿真<ArrowUpRight size={15}/></a></nav>
    </div></header>
    <main id="top" className="wrap">
      <Hero onEnter={enter} onPreview={openPreview}/>
      <section className="gallery" id="gallery" ref={grid} aria-labelledby="gallery-name">
        <div className="gallery-title"><h2 id="gallery-name" tabIndex={-1}>功能图库</h2><span className="gallery-count" aria-live="polite">{String(visible.length).padStart(2,'0')} <span>组演示</span></span></div>
        <div className="gallery-tools"><div className="filters" role="group" aria-label="按功能筛选">{categories.map(c=><button key={c.id} type="button" aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.id==='all'&&<LayoutGrid size={14}/>} {c.label}</button>)}</div>
          <button className="play-toggle" type="button" aria-pressed={playing} onClick={togglePlayback}>{playing?<Pause size={14}/>:<Play size={14}/>}<span>{playing?'停止动图':'播放动图'}</span></button>
        </div>
        <div className="card-grid">{visible.map(item=><FeatureCard key={item.id} item={item} playing={playing&&!preview} onPreview={openPreview} onEnter={enter}/>)}</div>
      </section>
    </main>
    <footer className="wrap footer"><Wordmark/><a href="#top">回到顶部<ArrowRight size={13}/></a></footer>
    {previewItem&&<Preview item={previewItem} items={previewItems} playback={playing} onSelect={setPreview} onClose={closePreview} onEnter={()=>enter(opener.current)}/>}
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
