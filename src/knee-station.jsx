import React,{useEffect,useRef,useState} from 'react';
import {BookOpen,Check,ChevronRight,ClipboardCheck,Focus,RotateCcw} from 'lucide-react';
import {scoreAttempt} from './knee-rules.js';
import {screwAxesFit} from './screw-fit.js';

export const stageNames={kit:'识件领料',seat:'定向入座',fasten:'预装与终紧',inspect:'质量交检',repair:'返修与复检',done:'工单结算'};
const holeNames={empty:'空孔',preloaded:'已预装',tight:'已终紧'};
const inspectionNames={empty:'缺钉',preloaded:'未终紧',tight:'已终紧'};
const inspectionDetails={empty:'空孔，缺少螺钉',preloaded:'已预装，尚未终紧',tight:'已终紧'};
const materialPhotos={L:'thigh',R:'right-thigh',KNEE:'knee',HIPY:'hip',HIPX:'roll'};
const holes=[1,2,3,4,5,6];
const diagramInfo=[
  ['tray','备料图','核对钢印和电机类型。第 5 页将 KNEE 列为通用膝电机。'],
  ['entry','安装面','对照电机上的箭头面和大腿下端槽位，选择进给方向。'],
  ['fixing','固定孔','输出端使用六颗 M3×8。先全部预装，复核对齐，再按对角关系终紧。']
];
export function Drawing({leg,onClose,initial}) {
  const [which,setWhich]=useState(initial);
  const dialog=useRef(null);
  useEffect(()=>{const node=dialog.current;node.showModal();return ()=>node.close();},[]);
  const [key,title,note]=diagramInfo[which];
  const page=(leg==='RF'?[15,16,16]:[9,9,10])[which];
  return <dialog ref={dialog} className="lab-dialog drawing" aria-labelledby="drawing-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <header><div><small>BLACK PANTHER X · C2P20724 改1</small><h2 id="drawing-title">装配工艺图</h2></div><button onClick={onClose} autoFocus>关闭</button></header>
    <div className="seg">{diagramInfo.map((d,i)=><button key={d[0]} aria-pressed={i===which} onClick={()=>setWhich(i)}>{d[1]}</button>)}</div>
    <figure><img src={'./training/'+leg.toLowerCase()+'-'+key+'.webp'} alt={title+'，'+note}/><figcaption>拼装说明书 · 第 {page} 页</figcaption></figure>
    <p>{note}</p>
  </dialog>;
}
function order(items,seed,salt) {
  // Stable across refreshes, independent for each tray.
  const hash=value=>[...value].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261);
  return [...items].sort((a,b)=>hash(a+salt+seed)-hash(b+salt+seed));
}
function Choices({label,options,value,onChange,photos=false,labels={},test}) {
  return <fieldset className="choice-field"><legend>{label}</legend><div className={'choices '+(photos?'photos':'')}>
    {options.map(id=><button type="button" data-choice={test+'-'+id} key={id} aria-pressed={value===id} onClick={()=>onChange(id)}>
      {photos&&<img src={'./training/'+materialPhotos[id]+'.webp'} alt=""/>}<span>{labels[id]||id}</span>
    </button>)}</div></fieldset>;
}
function Kit({attempt,run,onPart}) {
  const [side,S]=useState(''),[motor,M]=useState(''),[spec,F]=useState(''),[count,N]=useState('');
  const opts=(items,salt)=>attempt.mode==='exam'?order(items,attempt.id,salt):items;
  return <><p className="lead">查看料盘和工艺图，领取本工位所需的零件。</p>
    <Choices label="大腿组件 · 钢印" test="side" photos options={opts(['L','R'],'thigh')} value={side} onChange={v=>{S(v);onPart('leg');}}/>
    <Choices label="电机 · 铭牌类型" test="motor" photos options={opts(['HIPY','KNEE','HIPX'],'motor')} value={motor} onChange={v=>{M(v);onPart('motor');}}/>
    <Choices label="螺钉规格" test="spec" options={opts(['M6×16','M3×8','M6×22'],'screw')} value={spec} onChange={F}/>
    <label className="inline-field">领用数量<input aria-label="领用数量" type="number" min="1" max="24" value={count} onChange={e=>N(e.target.value)}/>颗</label>
    <button className="primary wide" disabled={!(side&&motor&&spec&&Number(count)>0&&Number(count)<=24)} onClick={()=>run({type:'kit',side,motor,spec,count:Number(count)})}>提交领料单 <ChevronRight size={16}/></button>
  </>;
}
function Seat({run,pose,setPose}) {
  return <><p className="lead">对照工艺图，确定电机接近工件的安装面和目标槽。</p>
    <Choices label="朝向工件的一面" test="face" options={['arrow','back']} labels={{arrow:'箭头标记面',back:'背面'}} value={pose.face} onChange={face=>setPose({...pose,face})}/>
    <Choices label="进给目标" test="slot" options={['upper','lower']} labels={{upper:'大腿上端',lower:'大腿下端槽'}} value={pose.slot} onChange={slot=>setPose({...pose,slot})}/>
    <button className="primary wide" disabled={!(pose.face&&pose.slot)} onClick={()=>run({type:'seat',face:pose.face,slot:pose.slot})}>沿导向入座 <ChevronRight size={16}/></button></>;
}
function HolePicker({selected,onSelect,status,inspection}) {
  return <fieldset className="choice-field"><legend>{inspection?'逐孔检查记录':'工作孔位'}</legend>
    <div className="hole-strip">{holes.map(i=>{
      const checked=inspection?.checked.includes(i);
      const result=checked ? inspection.holes[i-1] : undefined;
      const label=inspection ? (checked ? inspectionNames[result] : '待查') : holeNames[status[i-1]];
      return <button key={i} type="button" data-hole-choice={i} aria-label={'孔位 '+i+'，'+label}
        data-inspection={result} aria-pressed={i===selected} onClick={()=>onSelect(i)}>
        {i}<small>{label}</small></button>;
    })}</div>
  </fieldset>;
}
function Fasten({a,selected,onSelect,run,pose,setPose}) {
  const [tool,setTool]=useState('');
  const pre=a.holes.filter(x=>x!=='empty').length,tight=a.holes.filter(x=>x==='tight').length;
  return <><div className="counters"><span>已预装 <b>{pre} / 6</b></span><span>已终紧 <b>{tight} / 6</b></span></div>
    <HolePicker selected={selected} onSelect={onSelect} status={a.holes}/>
    <Choices label="手工具" test="tool" options={['hex','phillips','flat']} labels={{hex:'内六角',phillips:'十字',flat:'一字'}} value={tool} onChange={setTool}/>
    <details className="axis-adjust"><summary>夹具对轴调整</summary><label>横向偏移 <output>{pose.lateral.toFixed(1)} mm</output><input aria-label="横向偏移" type="range" min="-2" max="2" step=".1" value={pose.lateral} onChange={e=>setPose({...pose,lateral:+e.target.value})}/></label>
      <label>轴线倾角 <output>{pose.tilt}°</output><input type="range" aria-label="轴线倾角" min="-6" max="6" step=".5" value={pose.tilt} onChange={e=>setPose({...pose,tilt:+e.target.value})}/></label></details>
    <div className="btn-pair"><button className="primary" disabled={!selected||!tool} onClick={()=>run({type:'preload',hole:selected,tool,blocked:!screwAxesFit('M3×8',pose.lateral,pose.tilt),lateralMm:pose.lateral,tiltDeg:pose.tilt})}>预装此孔</button>
    <button disabled={!selected||!tool} onClick={()=>run({type:'tighten',hole:selected,tool})}>终紧此孔</button></div>
    <button className="quiet wide" onClick={()=>run({type:'align'})}><Focus size={15}/>{a.aligned?'已复核配合面':'复核配合面对齐'}</button></>;
}
function Inspect({a,selected,onSelect,run}) {
  const [decision,setDecision]=useState(''),[finding,setFinding]=useState(null);
  const {checked,holes:states}=a.inspection;
  const selectedState=checked.includes(selected) ? states[selected-1] : null;
  const reason=finding?.hole===selected ? finding.reason : '';
  return <><p className="lead">现检验另一件待交接工件。逐孔查看紧固记录，六孔均已终紧才可移交。</p>
    <HolePicker selected={selected} onSelect={onSelect} inspection={a.inspection}/>
    <button className="wide" disabled={!selected} onClick={()=>run({type:'check',hole:selected})}>查此孔紧固记录</button>
    {selectedState&&<p className="signature" data-inspection={selectedState}>孔 {selected} · {inspectionDetails[selectedState]}</p>}
    <Choices label="整件交检结论" test="decision" options={['pass','repair']} labels={{pass:'可移交',repair:'返修'}} value={decision} onChange={setDecision}/>
    {decision==='repair'&&<Choices label={selected?'孔 '+selected+' 的返修原因':'请先选择返修孔位'} test="reason" options={['missing','loose']}
      labels={{missing:'缺少螺钉',loose:'尚未终紧'}} value={reason} onChange={value=>setFinding({hole:selected,reason:value})}/>}
    <button className="primary wide" disabled={!decision||(decision==='repair'&&(!selected||!reason))} onClick={()=>run({type:'judge',decision,...(decision==='repair'?{hole:selected,reason}:{})})}>提交交检结论</button></>;
}
function Repair({a,selected,onSelect,run}) {
  const normal=a.inspection.defect==='normal';
  return <><p className="lead">{normal?'交接件已判为可移交。请完成最后复检。':'按交检单选择返修孔位。空孔需先补装，再完成终紧。'}</p>
    {!normal&&<><HolePicker selected={selected} onSelect={onSelect} inspection={a.inspection}/>
      <button disabled={!selected} className="wide" onClick={()=>run({type:'repair',hole:selected})}>执行所选孔返修</button></>}
    <button className="primary wide" onClick={()=>run({type:'recheck'})}>复检工件 <ClipboardCheck size={16}/></button></>;
}
function Result({a,run,download,onMenu}) {
  const score=scoreAttempt(a);
  return <><div className="score"><small>{a.submittedAt?'已提交':'待提交'} · 工件复检合格</small><strong>{score.total}<i>/100</i></strong></div>
    <div className="breakdown">{[['备料识件','kit',20],['定向入座','seat',20],['预装与终紧','fasten',35],['质量交接','inspection',25]].map(([label,k,n])=><div key={k}><span>{label}</span><b>{score[k]} / {n}</b></div>)}</div>
    {a.submittedAt?<><p className="signature">{score.passed?'达到课程通过标准':'建议重练易错工序'}</p>{a.mode!=='demo'&&<button className="primary wide" onClick={download}>下载个人工单</button>}<button className="wide" onClick={onMenu}>返回工单台</button></>:<button className="primary wide" onClick={()=>run({type:'submit'})}>{a.mode==='demo'?'完成演示':'交卷并保存成绩'} <Check size={16}/></button>}</>;
}
const hints={
  kit:['查备料图中的钢印与铭牌。','先辨左右，再看关节类型和输出端固定孔数。','左前使用 L 大腿、通用 KNEE 和六颗 M3×8。'],
  seat:['打开安装面图，定位箭头。','把槽的位置与图中足端方向进行对照。','选择箭头标记面，进给至大腿下端槽。'],
  fasten:['对照固定孔图，检查六处工艺状态。','先全部预装并复核，再依对孔逐对终紧。','可从 1、4 开始，再做 2、5 和 3、6。'],
  inspect:['交接件有独立的紧固记录。','逐孔查验是否有螺钉和终紧签记。','将缺件或未终紧的孔号及返修原因填入交检单。'],
  repair:['按返修单定位工件上的孔。','补装后仍须终紧。','孔位均终紧后发起复检。']
};
export function Actions({a,run,selected,onSelect,pose,setPose,onPart,feedback,openDrawing,download,onMenu,nextDemo}) {
  const [hint,setHint]=useState(0);
  useEffect(()=>setHint(0),[a.stage,a.id]);
  let body;
  if(a.stage==='kit') body=<Kit attempt={a} run={run} onPart={onPart}/>;
  if(a.stage==='seat') body=<Seat {...{run,pose,setPose}}/>;
  if(a.stage==='fasten') body=<Fasten {...{a,selected,onSelect,run,pose,setPose}}/>;
  if(a.stage==='inspect') body=<Inspect {...{a,selected,onSelect,run}}/>;
  if(a.stage==='repair') body=<Repair {...{a,selected,onSelect,run}}/>;
  if(a.stage==='done') body=<Result {...{a,run,download,onMenu}}/>;
  return <><div className="panel-cap"><span>工序卡</span><span>{a.leg}-K01</span></div><h2>{stageNames[a.stage]}</h2>
    {a.mode==='demo'&&!a.submittedAt&&<button className="demo-next wide" onClick={nextDemo}>演示下一动作 <ChevronRight size={16}/></button>}
    {feedback&&(a.stage!=='inspect'||feedback.code!=='check')&&<p className={'feedback '+(feedback.ok?'ok':'error')} role="status">{feedback.message}</p>}
    {body}
    {!a.submittedAt&&a.stage!=='done'&&<div className="resources"><button onClick={openDrawing}><BookOpen size={15}/> 工艺图</button>
      {a.mode!=='exam'&&<button onClick={()=>{const n=Math.min(hint+1,3);run({type:'hint',level:n});setHint(n);}}>提示 {hint||''}</button>}
      {a.mode!=='exam'&&<button disabled={!a.events.some(e=>e.ok&&e.type!=='hint')} onClick={()=>run({type:'undo'})}><RotateCcw size={14}/> 撤销</button>}</div>}
    {hint>0&&hints[a.stage]&&<p className="hint">{hints[a.stage][hint-1]}</p>}
  </>;
}
