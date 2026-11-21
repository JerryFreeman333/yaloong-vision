// Usage: node tools/check_viewer.mjs [http://127.0.0.1:5318/simulator.html] [--swiftshader]
// Fresh browser context, HTTP cache disabled. Outputs metrics for this run's renderer.
// --swiftshader deliberately selects software rendering for a repeatable fallback test.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const args=process.argv.slice(2);
const url=args.find(a=>!a.startsWith('--')) || 'http://127.0.0.1:5318/simulator.html';
const software=args.includes('--swiftshader');
const browser=await chromium.launch({channel:'chrome',headless:true,
  args:software?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:['--enable-gpu']});
const context=await browser.newContext({viewport:{width:1120,height:760},deviceScaleFactor:1});
const page=await context.newPage();
page.setDefaultTimeout(60000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const cdp=await context.newCDPSession(page);
await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
await cdp.send('Performance.enable',{timeDomain:'timeTicks'});

function stats(numbers) {
  if(!numbers.length)return null;
  const sorted=[...numbers].sort((a,b)=>a-b);
  const percentile=p=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
  const sum=numbers.reduce((a,b)=>a+b,0);
  return {samples:numbers.length,meanMs:+(sum/numbers.length).toFixed(2),p50Ms:+percentile(.5).toFixed(2),p95Ms:+percentile(.95).toFixed(2)};
}
function metricMap(result){return Object.fromEntries(result.metrics.map(m=>[m.name,m.value]));}
async function measure(label,ms=3200) {
  const before=metricMap(await cdp.send('Performance.getMetrics'));
  const frames=await page.evaluate(async ms=>{
    const gl=document.querySelector('#viewport').getContext('webgl2');
    const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const gpu=[],intervals=[],pending=[];
    // Queries cover each interval between consecutive rAF callbacks, including
    // commands submitted by the application. CPU-only samples do not fabricate GPU times.
    let active=null;
    const queryStart=()=>{if(timer){active=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,active);}};
    const queryFinish=()=>{if(active){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push(active);active=null;}};
    function collect(){
      if(!timer)return;
      if(gl.getParameter(timer.GPU_DISJOINT_EXT)){for(const q of pending)gl.deleteQuery(q);pending.length=0;return;}
      while(pending.length && gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){
        const q=pending.shift();gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);
      }
    }
    await new Promise(resolve=>{
      let begin,last;
      function sample(t){
        if(begin===undefined){begin=last=t;queryStart();requestAnimationFrame(sample);return;}
        queryFinish();collect();intervals.push(t-last);last=t;
        if(t-begin<ms || intervals.length<8){queryStart();requestAnimationFrame(sample);}else resolve();
      }
      requestAnimationFrame(sample);
    });
    collect();for(const q of pending)gl.deleteQuery(q);
    return {intervals,gpu,timerSupported:!!timer};
  },ms);
  const after=metricMap(await cdp.send('Performance.getMetrics'));
  const elapsed=after.Timestamp-before.Timestamp;
  return {label,raf:stats(frames.intervals),gpuTimerAvailable:frames.timerSupported,
    gpuElapsedBetweenCallbacks:stats(frames.gpu),
    mainThreadTaskDutyPercent:+(100*(after.TaskDuration-before.TaskDuration)/elapsed).toFixed(1),
    mainThreadScriptMs:+(1000*(after.ScriptDuration-before.ScriptDuration)).toFixed(1)};
}

async function waitNext(before,what){
  try{
    await page.waitForFunction(before=>document.querySelector('#guide-title').textContent!==before,before,{timeout:60000});
  }catch(err){
    throw new Error(what+' failed: '+await page.locator('.contact-readout').innerText()+' '+await page.locator('#scene-message').textContent(),{cause:err});
  }
}
async function next(){const title=await page.locator('#guide-title').textContent();await page.locator('#next-step').click();await waitNext(title,title);}
async function target(){await page.locator('.guide-targets button').first().click();}
const report={url,chrome:browser.version(),viewport:{width:1120,height:760},softwareRequested:software,checks:[]};
try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#system-state.ready').waitFor();
  assert.equal(await page.locator('#part-count').textContent(),'412');
  const meta=await page.evaluate(()=>{
    const gl=document.querySelector('#viewport').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      navigationToReadyObservedMs:Math.round(performance.now()),devicePixelRatio,
      transferredBytes:performance.getEntriesByType('resource').reduce((s,r)=>s+r.transferSize,0)};
  });
  Object.assign(report,meta);
  console.log('cold',JSON.stringify(meta));
  await page.waitForTimeout(1100);
  report.idle=await measure('simulation awake, no user inputs');
  console.log('idle',JSON.stringify(report.idle));

  const shin='bpx1_1_23_15';
  await page.locator('#part-search').fill(shin);
  await page.locator('.part-row[data-id="'+shin+'"]').click();
  await page.getByRole('button',{name:'显示碰撞体'}).click();
  assert.equal(await page.getByRole('button',{name:'隐藏碰撞体'}).getAttribute('aria-pressed'),'true');
  report.checks.push('selected shin physical volume overlay');

  await page.locator('[data-mode="motion"]').click();
  await page.locator('[data-leg="LF"]').click();
  await page.locator('#joint-hip').fill('3');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#joint-hip').inputValue(),'3','slider command blocked or lost');
  await page.getByRole('button',{name:'向前行走'}).click();
  assert.equal(await page.getByRole('button',{name:'停稳'}).getAttribute('aria-pressed'),'true');
  report.moving=await measure('gait');
  console.log('gait',JSON.stringify(report.moving));
  await page.waitForFunction(()=>document.querySelector('#walk-toggle').getAttribute('aria-pressed')==='true' &&
    Number(document.querySelector('#walk-distance').textContent.match(/-?\d+/)?.[0])>=4);
  await page.getByRole('button',{name:'停稳'}).click();
  await page.waitForFunction(()=>!document.querySelector('#walk-toggle').disabled);
  const rangeAtStop=Number((await page.locator('#walk-distance').textContent()).match(/-?\d+/)[0]);
  await page.getByRole('button',{name:'倒退回原点'}).click();
  assert.equal(await page.locator('#walk-reset').textContent(),'正在倒退');
  assert(rangeAtStop>=4 && await page.locator('#walk-distance').isVisible());
  await page.waitForFunction(()=>document.querySelector('#scene-message').textContent.includes('已倒退回原点'),null,{timeout:60000});
  assert(Math.abs(Number((await page.locator('#walk-distance').textContent()).match(/-?\d+/)[0]))<=1);
  await page.evaluate(()=>{
    const phase=document.querySelector('#jump-phase');
    window.jumpObservations=[];
    const observer=new MutationObserver(()=>{
      if(!phase.hidden)window.jumpObservations.push([phase.textContent,document.querySelector('[data-force]').textContent]);
      else if(window.jumpObservations.length)observer.disconnect();
    });
    observer.observe(phase,{childList:true,subtree:true,attributes:true});
  });
  await page.getByRole('button',{name:'原地跳跃'}).click();
  await page.waitForFunction(()=>document.querySelector('#scene-message').textContent.includes('已落地站稳'),null,{timeout:30000});
  const phases=await page.evaluate(()=>window.jumpObservations);
  for(const phase of ['下蹲蓄力','蹬地起跳','腾空','触地缓冲','恢复站姿'])assert(phases.some(([p])=>p===phase),JSON.stringify(phases));
  assert(phases.some(([p,force])=>p==='腾空'&&force==='0 N'),JSON.stringify(phases));
  assert.equal(await page.locator('#walk-reset').isDisabled(),true);
  const readHeading=()=>page.locator('#heading').evaluate(el=>{
    const sign=el.textContent.includes('右')?-1:1;
    return sign*Number(el.textContent.match(/\d+/)[0]);
  });
  for(const [label,change] of [['左转',30],['高跳右转',-45],['右转',-30],['高跳左转',45]]){
    const before=await readHeading(),button=page.getByRole('button',{name:label,exact:true});
    await button.click();
    await page.waitForFunction(()=>!document.querySelector('#jump').disabled);
    const measured=(await readHeading())-before;
    assert(Math.abs(measured-change)<2,label+' measured heading change '+measured);
    assert((await page.locator('[data-contacts]').textContent()).split(' · ').length===4,'four-foot landing after '+label);
  }
  report.checks.push('left and right stepping turns and airborne turning jumps');
  await page.locator('#joint-knee').fill('80');
  await page.waitForFunction(()=>document.querySelector('#scene-message').textContent.includes('干涉'));
  assert(Number(await page.locator('#joint-knee').inputValue())<49);
  report.checks.push('forward travel, reverse return, in-place jump and CAD knee interference');

  await page.locator('[data-mode="explode"]').click();
  await page.locator('[data-explosion="1"]').click();
  assert.equal(await page.locator('#explode-value').textContent(),'100%');
  // A frame-time limit in the app protects integration across discarded frames.
  // Waiting a fixed number of frames proves both endpoints have actually animated.
  const waitFrames=n=>page.evaluate(n=>new Promise(resolve=>{
    let i=0;const frame=()=>{if(++i>=n)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);
  }),n);
  await waitFrames(35);const open=await page.locator('#viewport').screenshot();
  await page.locator('[data-explosion="0"]').click();
  assert.equal(await page.locator('#explode-value').textContent(),'0%');
  await waitFrames(35);const closed=await page.locator('#viewport').screenshot();
  assert(!open.equals(closed),'explosion endpoints produced identical frames');
  report.checks.push('full explosion rendered and collapsed');

  await page.locator('[data-mode="guide"]').click();
  await page.locator('.chapter-select').selectOption('battery');
  await next();await next();await target();await next();
  assert.equal(await page.locator('#guide-title').textContent(),'沿槽推进电池');
  await target();
  await page.getByRole('slider',{name:'横向偏移'}).fill('6');
  await page.locator('#next-step').click();
  try {
    await page.locator('.contact-readout.blocked').waitFor({state:'visible',timeout:20000});
  } catch (e) {
    throw new Error('Battery failed to report blockage. JS errors='+JSON.stringify(errors)+' state='+JSON.stringify(await page.evaluate(()=>({
      title:document.querySelector('#guide-title').textContent,offset:document.querySelector('.align-fixture input').value,
      enabled:!document.querySelector('#next-step').disabled,feedback:document.querySelector('.contact-readout').textContent,
      status:document.querySelector('#scene-message').textContent
    }))),{cause:e});
  }
  assert.equal(await page.locator('#guide-title').textContent(),'沿槽推进电池','blocked insertion advanced task');
  report.batteryObstruction=await page.locator('.contact-readout span').textContent();
  await page.getByRole('button',{name:'退回起点'}).click();
  await page.locator('.contact-readout').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'回到导向轴'}).click();
  assert.equal(await page.getByRole('slider',{name:'横向偏移'}).inputValue(),'0');
  await next();await target();await next();
  assert.equal(await page.locator('#guide-title').textContent(),'本章装配完成');
  report.checks.push('all five battery actions, 6 mm obstruction, rollback and successful aligned retry');

  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-mode="motion"]').click();await page.locator('[data-leg="RR"]').click();
  const mobile=await page.evaluate(()=>{
    const r=document.querySelector('#viewport').getBoundingClientRect();
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,
      canvasWidth:Math.round(r.width),canvasHeight:Math.round(r.height)};
  });
  assert(mobile.documentWidth<=mobile.width && mobile.canvasWidth>0 && mobile.canvasHeight>0);
  assert.equal(await page.locator('[data-leg="RR"]').getAttribute('aria-pressed'),'true');
  report.mobile=mobile;report.checks.push('390 × 844 mobile viewport and interactive controls');
  assert.deepEqual(errors,[],'browser console / page error');
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
