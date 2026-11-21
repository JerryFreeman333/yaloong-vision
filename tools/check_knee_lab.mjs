// Starts from the simulator navigation. Run against the built release or Vite.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {restoreAttempt, scoreAttempt} from '../src/knee-rules.js';

const base = process.argv[2] || 'http://127.0.0.1:5318/';
const browser = await chromium.launch({channel:'chrome', headless:true,
  args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page = await browser.newPage({viewport:{width:1366,height:768},acceptDownloads:true});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(25000);
const click = label => page.getByRole('button',{name:label,exact:true}).click();
const choose = id => page.locator('[data-choice="'+id+'"]').click();
const pickHole = n => page.locator('[data-hole-choice="'+n+'"]').click();
const stage = title => page.locator('.work-card').getByRole('heading',{name:title,exact:true}).waitFor();
async function feedback(text) {
  await page.locator('.feedback').filter({hasText:text}).waitFor();
}
async function kit(side,spec) {
  await choose('side-'+side);
  await choose('motor-KNEE');
  await choose('spec-'+spec);
  await page.getByLabel('领用数量').fill('6');
  await page.getByRole('button',{name:/提交领料单/}).click();
}
async function seat(face) {
  await choose('face-'+face);
  await choose('slot-lower');
  await page.getByRole('button',{name:/沿导向入座/}).click();
}
async function preload(n) {
  await pickHole(n);
  await click('预装此孔');
  await feedback(n+' 号孔已预装');
}
async function finishFastening(preloadFrom,early) {
  for(let n=preloadFrom;n<=6;n++) {
    if(early && n===6){
      await pickHole(1);
      await click('终紧此孔');
      await feedback('终紧条件未齐');
    }
    await preload(n);
  }
  await click('复核配合面对齐');
  for(const hole of [2,5,1,4,3,6]){
    await pickHole(hole);
    await click('终紧此孔');
  }
  await stage('质量交检');
}
// Reproduce the rejected whole-workpiece release separately so the LF score fixture
// still measures its original three errors.
async function rejectIncorrectRelease(defective, tight, records) {
  const context = await browser.newContext({storageState:await page.context().storageState()});
  try {
    const resumed = await context.newPage();
    await resumed.goto(page.url());
    await resumed.getByRole('heading',{name:'质量交检'}).waitFor();
    const hole = n => resumed.locator('[data-hole-choice="'+n+'"]');
    assert.deepEqual(await resumed.locator('[data-hole-choice] small').allTextContents(),records);
    await hole(tight).click();
    assert.match(await resumed.locator('.signature').innerText(), /已终紧/);
    await resumed.locator('[data-choice="decision-pass"]').click();
    await resumed.getByRole('button',{name:'提交交检结论'}).click();
    const refusal = resumed.locator('.feedback.error');
    await refusal.waitFor();
    assert.match(await refusal.innerText(),new RegExp(defective+'\\s*号孔'));
    await resumed.getByRole('heading',{name:'质量交检'}).waitFor();
    await hole(defective).click();
    await resumed.locator('[data-choice="decision-repair"]').click();
    await resumed.locator('[data-choice="reason-loose"]').click();
    await resumed.getByRole('button',{name:'提交交检结论'}).click();
    await resumed.getByRole('heading',{name:'返修与复检'}).waitFor();
  } finally {
    await context.close();
  }
}
async function diagnose(expectedDefect) {
  const labels = page.locator('[data-hole-choice] small');
  const expected = Array(6).fill('待查');
  assert.deepEqual(await labels.allTextContents(),expected);
  for(let n=1;n<=6;n++) {
    await pickHole(n);
    assert.deepEqual(await labels.allTextContents(),expected,'selecting a hole must not reveal a record');
    await click('查此孔紧固记录');
    const status=await labels.nth(n-1).innerText();
    assert.ok(['缺钉','未终紧','已终紧'].includes(status));
    expected[n-1]=status;
    assert.deepEqual(await labels.allTextContents(),expected,'checked records must remain individually readable');
  }
  const defective = expected.findIndex(status=>status!=='已终紧')+1;
  const reason = defective ? (expected[defective-1]==='缺钉'?'missing':'loose') : 'normal';
  if(expectedDefect) assert.equal(reason,expectedDefect);
  if(defective) {
    assert.equal(expected.filter(s=>s!=='已终紧').length,1);
    if(expectedDefect==='loose') await rejectIncorrectRelease(defective,expected.indexOf('已终紧')+1,expected);
    await pickHole(defective);
    await choose('decision-repair');
    await choose('reason-'+reason);
  } else {
    await choose('decision-pass');
  }
  await click('提交交检结论');
  await stage('返修与复检');
  if(defective) {
    await pickHole(defective);
    await click('执行所选孔返修');
    if(reason==='missing') {
      await click('复检工件');
      await feedback('未完成');
      await click('执行所选孔返修');
    }
  }
  await click('复检工件');
  await stage('工单结算');
  await click('交卷并保存成绩');
}
try {
  await page.goto(new URL('simulator.html?feature=walk',base).href);
  await page.locator('#system-state.ready').waitFor({timeout:60000});
  await page.locator('[data-mode=guide]').click();
  assert.equal(await page.locator('.chapter-select option').count(),4);
  await page.locator('.training-launch').click();
  await page.getByRole('link',{name:/膝关节专项/}).click();
  await stage('领取工单');
  await page.getByPlaceholder('输入姓名或学号').fill('KNEE-QA-LF');
  await click('开始引导练习');
  await stage('识件领料');
  await page.getByRole('button',{name:/^提示/}).click();
  await page.locator('.hint').waitFor();
  await click('工艺图');
  const modal=page.getByRole('dialog');
  await modal.waitFor();
  await modal.locator('img').evaluate(el=>el.decode());
  await modal.getByRole('button',{name:'关闭'}).click();
  await kit('L','M6×16');
  await feedback('螺钉规格');
  await kit('L','M3×8');
  await stage('定向入座');
  await seat('back');
  await feedback('无法按当前朝向入座');
  await seat('arrow');
  await stage('预装与终紧');
  await choose('tool-hex');
  await preload(3);
  await click('撤销');
  assert.equal(await page.locator('[data-hole-choice="3"] small').innerText(),'空孔');
  await preload(1);
  await preload(2);
  await click('工单台');
  await click('观看工序演示');
  await stage('识件领料');
  await click('演示下一动作');
  await stage('定向入座');
  await click('工单台');
  await page.getByRole('button',{name:/继续 KNEE-QA-LF 的工单/}).click();
  await stage('预装与终紧');
  await page.reload();
  await stage('预装与终紧');
  assert.equal(await page.locator('[data-hole-choice="2"] small').innerText(),'已预装');
  assert.equal(await page.locator('[data-hole-choice="3"] small').innerText(),'空孔');
  await choose('tool-hex');
  await finishFastening(3,true);
  await diagnose('loose');
  const download=page.waitForEvent('download');
  await click('下载个人工单');
  const personal=await download;
  const filepath=await personal.path();
  const recordFile=await readFile(filepath);
  const row=restoreAttempt(JSON.parse(recordFile).attempts[0]);
  assert.equal(row.student,'KNEE-QA-LF');
  assert.equal(scoreAttempt(row).total,77);
  assert.ok(row.events.some(e=>e.type==='undo'));
  assert.ok(row.events.some(e=>e.type==='hint'));
  console.log('PASS · 仿真入口、左前练习、错误拦截、逐孔预装、撤销、刷新恢复和个人工单');

  await click('返回工单台');
  await stage('领取工单');
  await page.getByRole('button',{name:/^独立考核/}).click();
  await page.getByPlaceholder('输入姓名或学号').fill('KNEE-QA-RF');
  await click('开始独立考核');
  await stage('识件领料');
  assert.equal(await page.getByRole('button',{name:/^提示|^撤销/}).count(),0);
  await kit('R','M3×8');
  await stage('定向入座');
  await seat('arrow');
  await stage('预装与终紧');
  await choose('tool-hex');
  await finishFastening(1,false);
  await diagnose();
  assert.match(await page.locator('.score').innerText(),/100\s*\/100/);
  const examDownload=page.waitForEvent('download');
  await click('下载个人工单');
  const file=await readFile(await (await examDownload).path(),'utf8');
  const exam=restoreAttempt(JSON.parse(file).attempts[0]);
  assert.equal(exam.student,'KNEE-QA-RF');
  assert.equal(exam.mode,'exam');
  assert.equal(scoreAttempt(exam).total,100);
  assert.deepEqual(errors,[]);
  console.log('PASS · 工序演示、个人草稿续做、右前独立考核、交检、满分交卷及个人下载');
} finally {
  await browser.close();
}
