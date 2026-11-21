// Exercise the production course, including all CAD movement and contact checks.
// Only native simulator controls submit actions. The bridge is observed for commits.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {WHOLE_CHAPTERS} from '../src/whole-course-content.js';

const base = process.argv[2] || 'http://127.0.0.1:5318/';
const browser = await chromium.launch({channel:'chrome',headless:true,
  args:process.env.BPX_SOFTWARE_GL === '1' ? ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] : ['--enable-gpu','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1366,height:850},acceptDownloads:true});
const failures = [];
const actionCounts = [];
page.on('pageerror', error => failures.push(error.message));
page.setDefaultTimeout(30000);

await page.addInitScript(() => {
  if (window !== window.top) return;
  // A progress event arrives only after the simulator commits an action.
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== document.querySelector('iframe')?.contentWindow ||
        e.data?.channel !== 'bpx-whole-v1' || e.data.type !== 'progress') return;
    window.lastGuideCommit = e.data;
  });
});

async function waitGuide(chapter, length, cause) {
  try {
    const handle = await page.waitForFunction(({chapter,length,cause}) => {
      const m = window.lastGuideCommit;
      return m?.chapter === chapter && m.history.length === length && m.cause === cause ? m : false;
    }, {chapter,length,cause}, {timeout:75000,polling:80});
    return handle.jsonValue();
  } catch (error) {
    const sim = page.frames().find(frame => frame.url().includes('feature=whole-course'));
    const detail = sim ? await sim.locator('body').innerText({timeout:1500}).catch(()=>'') : '';
    throw new Error('Waiting for '+chapter+' commit '+length+' ('+cause+')\n'+detail.slice(-1800), {cause:error});
  }
}

async function assemble(chapter) {
  await page.getByRole('heading',{name:chapter.title,exact:true}).waitFor();
  const work = page.frameLocator('iframe');
  let m = await waitGuide(chapter.id,0,'init');
  const expectedSteps = m.count;
  let length = 0;
  const legNames = new Set();
  while (!m.complete) {
    const title = await work.locator('#guide-title').innerText();
    for (const leg of ['左前','左后','右前','右后']) if (title.includes(leg)) legNames.add(leg);
    if (chapter.id === 'frame' && length === 0) {
      await work.locator('.bench-pick').click();
      await work.locator('.bench-place').click();
    } else {
      const source = work.locator('.guide-wire-source');
      if (await source.count()) {
        await source.click();
        await work.locator('.guide-wire-target').click();
      } else if (m.targetIds.length) {
        await work.locator('.guide-targets button').first().click();
      }
      await work.locator('#next-step').click();
    }
    m = await waitGuide(chapter.id,++length,'next');
    if (chapter.id === 'frame' && length === 4) {
      const history = m.history,stepId = m.stepId;
      await page.reload();
      m = await waitGuide(chapter.id,length,'init');
      assert.deepEqual(m.history,history);
      assert.equal(m.stepId,stepId);
    }
    if (length%20 === 0) console.log(chapter.id+' · '+length+' committed');
    assert.ok(length <= 200, 'The course must finish within its expected CAD occurrences');
  }
  if (chapter.id === 'legs' || chapter.id === 'mount') assert.equal(legNames.size,4);
  assert.equal(m.index,expectedSteps);
  actionCounts.push(length);
  console.log('PASS '+chapter.title+' · '+length+' 次实际提交，'+expectedSteps+' 个工序');
  await page.getByRole('button',{name:chapter.id==='battery'?'查看整机装配记录':/^装配下一工位/}).click();
}

try {
  await page.goto(new URL('whole.html#chapter/battery',base).href);
  await page.getByRole('heading',{name:WHOLE_CHAPTERS[0].title,exact:true}).waitFor();
  assert.equal(await page.locator('.build-path button:disabled').count(),3);
  assert.equal(await page.locator('.wc-question').count(),0);
  await page.getByRole('button',{name:'当前工艺图'}).click();
  await page.getByRole('dialog').locator('img').evaluate(image=>image.decode());
  await page.getByRole('button',{name:'关闭工艺图'}).click();
  for (const chapter of WHOLE_CHAPTERS) await assemble(chapter);
  assert.equal(actionCounts.reduce((sum,n)=>sum+n,0),176);
  await page.getByRole('heading',{name:'整机装配记录',exact:true}).waitFor();
  assert.equal(await page.locator('.wc-question').count(),0);
  await page.getByPlaceholder('姓名或学号（选填）').fill('BPX 整机验收');
  await page.getByRole('button',{name:'签署装配记录'}).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button',{name:'下载装配记录'}).click();
  const download = await downloadEvent;
  const text = await readFile(await download.path(),'utf8');
  assert.ok(text.includes('BPX 整机验收'));
  for (const [i,ch] of WHOLE_CHAPTERS.entries()) {
    assert.ok(text.includes(ch.title));
    assert.ok(text.includes('已提交操作 '+actionCounts[i]+' 次'));
  }
  assert.ok(text.includes('电池已沿槽入座并锁合'));
  assert.deepEqual(failures,[]);
  console.log('PASS · 四工位 176 次操作、工艺图、先后依赖、刷新续装、签署与导出');
} finally {
  await browser.close();
}
