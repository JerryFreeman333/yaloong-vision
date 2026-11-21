// Exercise real CAD station operations and verify personal reports and course navigation.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {buildProcessCatalog} from '../src/process-catalog.js';
import {newProcessAttempt,saveProcessAttempt} from '../src/process-attempt.js';

const base=new URL(process.argv[2]||'http://127.0.0.1:5318/');
const asset=async name=>JSON.parse(await readFile(new URL('../public/assets/'+name+'.json',import.meta.url),'utf8'));
const catalog=buildProcessCatalog(...await Promise.all(['assembly','procedures','fasteners'].map(asset)));
const screw=catalog[0].steps.find(s=>s.id==='frame-03-frameBase');
const battery=catalog[3].steps.at(-1);
assert.ok(screw&&battery);

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
// Predetermine only the starting QC workpieces; every student action below
// is submitted on screen, validated, animated and recorded by the application.
const saved=new Map();
globalThis.localStorage={
  getItem:key=>saved.get(key)??null,
  setItem:(key,value)=>saved.set(key,value)
};
for (const [chapterId,step,mode,defectIndex] of [['frame',screw,'practice',1],['battery',battery,'exam',null]]) {
  const lesson={...step,chapterId};
  const fresh=newProcessAttempt(lesson,{mode,student:'BPX-专项回归',defectIndex});
  assert.ok(saveProcessAttempt(lesson,fresh));
  assert.ok(!fresh.events.some(e=>e.type==='kit'||e.type==='method'));
}
const storageState={cookies:[],origins:[{origin:base.origin,localStorage:[...saved].map(([name,value])=>({name,value}))}]};
const page=await browser.newPage({viewport:{width:1400,height:880},acceptDownloads:true,storageState});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(55000);
const card=page.locator('.ps-card');
const button=(name)=>page.getByRole('button',{name,exact:true});
const click=(name)=>button(name).click();
const stage=(name)=>card.getByRole('heading',{name,exact:true}).waitFor();
const status=(text)=>card.locator('[role=status]').filter({hasText:text}).waitFor();
const wait3D=()=>page.locator('.ps-canvas .wc-veil').waitFor({state:'hidden'});

async function answer(q,which,submit){
  await card.locator('.wc-question button').filter({hasText:q.options[which]}).click();
  await click(submit);
}
async function prepare(lesson,wrong){
  await stage('识件备料');
  await wait3D();
  if(wrong) {
    await click('分级提示');
    await card.locator('.ps-hint').waitFor();
    await answer(lesson.kit,(lesson.kit.answer+1)%3,'提交备料选择');
    await status(lesson.kit.feedback);
  }
  await answer(lesson.kit,lesson.kit.answer,'提交备料选择');
  await stage('工艺准备');
  await answer(lesson.method,lesson.method.answer,'确认工艺选择');
  await stage('三维操作');
}
async function selectTarget(id){await card.getByLabel('操作对象').selectOption(id);}
async function tighten(){
  const {roots}=screw;
  await selectTarget(roots[0]);
  await card.getByLabel('手工具').selectOption('phillips');
  await click('预装所选螺钉');await status('规格不匹配');
  assert.equal(await card.locator('.ps-counts b').first().innerText(),'0 / '+roots.length);
  await card.getByLabel('手工具').selectOption('hex');
  await click('终紧所选螺钉');
  await status('完成所有预装');
  for(const [i,id] of roots.entries()){
    await selectTarget(id);await click('预装所选螺钉');
    await page.waitForFunction(n=>document.querySelector('.ps-counts span b')?.innerText.startsWith(n+' /'),i+1);
    if(i===0){
      await page.reload();await stage('三维操作');await wait3D();
      assert.equal(await card.locator('.ps-counts b').first().innerText(),'1 / '+roots.length);
      assert.equal(await card.locator('select option:has-text("已预装")').count(),1);
      await card.getByLabel('手工具').selectOption('hex');
    }
  }
  await click('复核配合面对齐');await button('已复核对齐').waitFor();
  for(const [i,id] of roots.entries()){
    await selectTarget(id);await click('终紧所选螺钉');
    if(i+1<roots.length)await page.waitForFunction(n=>document.querySelectorAll('.ps-counts b')[1]?.innerText.startsWith(n+' /'),i+1);
  }
  await stage('质量交检');
}
async function diagnose(lesson){
  let fault=-1;
  const points=lesson.inspection.points;
  assert.deepEqual(await card.locator('[data-point] small').allTextContents(),points.map(()=> '待查'));
  for(const [i,p] of points.entries()){
    const inspect=card.locator('[data-point="'+i+'"]');
    await inspect.click();await click('检查此项并读取记录');
    const seen=await inspect.locator('small').innerText();
    assert.ok([p.good,p.bad].includes(seen),seen);
    if(seen===p.bad)fault=i;
  }
  if(fault>=0){
    await click('可移交');await click('提交交检结论');await status('复核');
    await card.locator('[data-point="'+fault+'"]').click();
    await click('返修所选项');await click('提交交检结论');await stage('返修');
    await card.getByLabel('返修操作').selectOption({label:points[fault].repair});
    await card.locator('[data-point="'+fault+'"]').click();await click('执行返修');
  }else{
    await card.locator('[data-point="0"]').click();
    await click('返修所选项');await click('提交交检结论');await status('复核');
    await click('可移交');await click('提交交检结论');
  }
  await stage('复检');await click('复检并生成工单');await stage('装配记录');
  await click(await button('保存装配记录').count()?'保存装配记录':'交卷并保存成绩');
  const dl=page.waitForEvent('download');
  await click('个人工单');
  const file=await dl;
  const path=await file.path(),raw=JSON.parse(await readFile(path,'utf8'));
  assert.equal(raw.reports.length,1);const report=raw.reports[0];
  assert.equal(report.lessonId,lesson.id);
  assert.ok(report.submittedAt);
  assert.ok(report.events.some(e=>e.type==='judge'&&!e.ok));
  assert.ok(report.events.some(e=>e.type==='commit'&&e.ok));
  if(fault>=0)assert.ok(report.events.some(e=>e.type==='repair'&&e.ok));
  return {report,fault};
}

async function openChapter(index){await page.locator('.wc-chapter-tile').nth(index).click();}
async function openLesson(title){await page.locator('.ps-library button').filter({hasText:title}).first().click();}
async function student(id){const input=page.getByRole('textbox',{name:'学生代号'});await input.fill(id);await input.press('Enter');}
try {
  await page.goto(new URL('stations.html',base).href);
  await page.getByRole('heading',{name:'装配工序专项练习'}).waitFor();
  assert.equal(await page.locator('.wc-chapter-tile').count(),4);
  await student('BPX-专项回归');
  await openChapter(1);
  await page.getByLabel('筛选腿位').selectOption('RF');
  await page.getByPlaceholder('查找工序或零件').fill('膝电机');
  const subset=await page.locator('.ps-library button').allTextContents();
  assert.ok(subset.length>0 && subset.every(s=>s.includes('右前')));
  await click('课程总览');await openChapter(2);
  await page.getByLabel('筛选腿位').selectOption('RR');
  assert.ok((await page.locator('.ps-library button').allTextContents()).every(s=>s.includes('右后')));
  await click('课程总览');await openChapter(0);await openLesson(screw.title);
  await stage('三维操作');await wait3D();
  assert.equal(await card.locator('.wc-question').count(),0);
  assert.equal(await button('撤销').isDisabled(),true);
  await card.locator('.ps-guide').waitFor();
  await click('工艺图');
  const drawing=page.getByRole('dialog');
  await drawing.locator('.wc-figure-crop img').waitFor();
  await click('查看原页');
  assert.equal(await drawing.locator('.wc-figure-crop').count(),0);
  await drawing.getByLabel('工艺图页码').selectOption('7');
  assert.match(await drawing.locator('img').getAttribute('src'),/p07\.webp$/);
  await click('前一页');
  await drawing.locator('.wc-figure-crop img').waitFor();
  await click('关闭工艺图');
  await tighten();
  const first=await diagnose(screw);
  assert.equal(first.fault,1);
  assert.ok(!first.report.events.some(e=>e.type==='kit'||e.type==='method'));
  assert.equal(first.report.committed.length,screw.roots.length);
  assert.equal(first.report.preloaded.length,screw.roots.length);
  assert.ok(first.report.events.some(e=>e.type==='commit'&&e.code==='early'));
  console.log('PASS · 躯干螺钉直接上手、真实三维预装/终紧、断点恢复与工单导出');

  await click('课程总览');await openChapter(3);await openLesson(battery.title);
  await page.getByLabel('学习模式').selectOption('exam');
  await stage('识件备料');await wait3D();
  assert.equal(await button('分级提示').count(),0);
  assert.equal(await button('撤销').count(),0);
  await answer(battery.kit,(battery.kit.answer+1)%3,'提交备料选择');
  await status('请查图核对');
  assert.ok(!(await card.locator('[role=status]').innerText()).includes(battery.kit.feedback));
  await prepare(battery,false);
  await selectTarget(battery.roots[0]);await click(battery.actionLabel);
  await stage('质量交检');const second=await diagnose(battery);
  assert.equal(second.report.mode,'exam');
  assert.equal(second.fault,-1);

  await click('课程总览');await openChapter(1);
  await page.getByLabel('筛选腿位').selectOption('LF');
  const cable=catalog[1].steps.find(l=>l.id==='legs-05');
  await openLesson(cable.title);await page.getByLabel('学习模式').selectOption('practice');await stage('三维操作');await wait3D();
  const source=card.getByLabel('线束来源'), target=card.getByLabel('目标接口');
  const sourceId=await source.locator('option').filter({hasText:'髋膝连接线'}).first().getAttribute('value');
  const wrongId=await target.locator('option').filter({hasText:'侧摆电机'}).first().getAttribute('value');
  const targetId=await target.locator('option').filter({hasText:'膝关节电机'}).first().getAttribute('value');
  assert.ok(sourceId&&targetId&&wrongId&&targetId!==wrongId);
  await source.selectOption(sourceId);await target.selectOption(wrongId);
  await click('对接所选线束与接口');await status('起点或插接目标');
  await target.selectOption(targetId);await click('对接所选线束与接口');await stage('质量交检');
  console.log('PASS · 左前髋膝线束错端拒绝并改接膝电机');

  await page.goto(new URL('stations.html#teacher',base).href);
  await page.getByRole('heading',{name:'装配工序专项练习'}).waitFor();
  assert.equal(new URL(page.url()).hash,'#overview');
  assert.equal(await page.getByLabel('学习模式').locator('option').allTextContents().then(items=>items.includes('工序演示')),true);
  await page.getByLabel('学习模式').selectOption('exam');
  await click('专项训练记录');
  await page.getByRole('heading',{name:'专项训练记录'}).waitFor();
  assert.match(await page.locator('.wc-delivery-grid button').last().innerText(),/1 \/ 5 道完成/);
  assert.deepEqual(errors,[]);
  console.log('PASS · 四章目录、左右筛选、电池独立考核、质量交检、个人成绩单与旧链接回退');
} catch(error) {
  console.error('Current URL',page.url(),'\n', (await page.locator('body').innerText()).slice(-1250));
  throw error;
} finally {await browser.close();}
