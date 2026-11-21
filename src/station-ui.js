// Instrumentation is driven by the solver and the active manipulation request.
export function createStationUI(handlers) {
  const motion=document.querySelector('[data-page="motion"] .technical-note');
  const monitor=document.createElement('section');
  monitor.className='solve-monitor field-block';
  monitor.innerHTML='<h3>接触与承重</h3><div class="metrics"><span>模型质量 <b data-mass>—</b></span><span>支撑合力 <b data-force>—</b></span></div><small data-contacts></small>';
  motion.before(monitor);
  motion.querySelector('p').textContent='质量、惯量、摩擦和驱动上限为估算教学参数。';
  const guide=document.querySelector('[data-page="guide"] .guide-actions');
  const align=document.createElement('fieldset');
  align.className='align-fixture field-block';align.hidden=true;
  align.innerHTML='<legend>装配对准</legend><label>横向偏移 <output>0 mm</output><input type="range" min="-8" max="8" step=".1" value="0" aria-label="横向偏移"></label><label>轴线倾角 <output>0°</output><input type="range" min="-8" max="8" step=".5" value="0" aria-label="轴线倾角"></label><button type="button" class="focus-part">回到导向轴</button>';
  guide.before(align);
  const inputs=[...align.querySelectorAll('input')];
  function readAlign(){
    return {lateralMm:Number(inputs[0].value),tiltDeg:Number(inputs[1].value)};
  }
  function paint(){
    const {lateralMm,tiltDeg}=readAlign();
    const out=align.querySelectorAll('output');out[0].textContent=lateralMm+' mm';out[1].textContent=tiltDeg+'°';
  }
  function reset(){for(const el of inputs)el.value='0';paint();}
  inputs.forEach(el=>el.addEventListener('input',()=>{paint();handlers.alignment(readAlign());}));
  align.querySelector('button').onclick=()=>{reset();handlers.alignment(readAlign());};
  const feedback=document.createElement('div');feedback.className='contact-readout';feedback.hidden=true;feedback.setAttribute('aria-live','polite');
  const text=document.createElement('span'),rollback=document.createElement('button');rollback.textContent='退回起点';rollback.type='button';
  feedback.append(text,rollback);document.querySelector('#scene').append(feedback);
  rollback.onclick=()=>handlers.cancel();
  const balance=document.querySelector('#walk-balance');
  const supportCount=balance.querySelector('[data-support-count]');
  const margin=balance.querySelector('[data-stability-margin]');
  let last='',lastBalance='';
  return {
    showAlignment(show,clear=false){align.hidden=!show;if(clear) reset();},
    alignment:readAlign,
    feedback(message='',retry=false){
      feedback.hidden=!message;feedback.classList.toggle('blocked',retry);text.textContent=message;rollback.hidden=!retry;
    },
    update(s){
      if(!s)return;
      const measured=s.walkBalance;
      const reading=measured ? measured.marginMm.toFixed(1)+' mm' : '';
      const balanceKey=measured ? measured.supportCount+'/'+reading : '';
      if(lastBalance!==balanceKey){
        balance.hidden=!measured;
        if(measured){supportCount.textContent=measured.supportCount; margin.textContent=reading;}
        lastBalance=balanceKey;
      }
      const labels=(s.contacts||[]).filter(p=>p.normalN>.5).map(p=>p.name||p.id);
      const values=[s.massKg?.toFixed(1),Math.round(s.totalSupportN||0),[...new Set(labels)].join(' · ')||(s.jumpPhase==='flight'?'四足离台':'等待接触')];
      if(last===values.join('/'))return;
      last=values.join('/');monitor.querySelector('[data-mass]').textContent=values[0]+' kg';
      monitor.querySelector('[data-force]').textContent=values[1]+' N';monitor.querySelector('[data-contacts]').textContent=values[2];
    }
  };
}
