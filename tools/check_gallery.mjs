// Run against the production server to exercise the gallery, real entry points, and return state.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { categories, features, featureUrl } from '../src/gallery-features.js';

const url = process.argv[2] || 'http://127.0.0.1:5318/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1152, height: 740 } });
  const errors = [], homeRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => homeRequests.push(request.url()));
  const dialog = page.getByRole('dialog');
  const filter = id => page.getByRole('button', { name: categories.find(category => category.id === id).label, exact: true });
  const card = id => page.locator('.feature-card').filter({ has: page.locator('[data-preview="'+id+'"]') });

  await page.goto(url);
  await page.locator('.feature-card').first().waitFor();
  assert.equal(await page.locator('.feature-card').count(), features.length);
  assert.equal(await page.locator('[href$="#teacher"], [data-preview="teaching"]').count(), 0);
  for (const removed of ['gallery/teaching.gif','gallery/teaching.webp']) {
    assert.equal((await page.request.get(new URL(removed,url).href)).status(),404);
  }
  for (const item of features) {
    const gif = await page.request.get(new URL('gallery/'+item.id+'.gif', url).href);
    assert(gif.ok());
    assert.match((await gif.body()).toString('ascii',0,6), /^GIF8[79]a$/);
    const poster = await page.request.get(new URL('gallery/'+item.id+'.webp', url).href);
    assert(poster.ok());
    assert.equal((await poster.body()).toString('ascii',8,12),'WEBP');
    const target = await card(item.id).getByRole('link').getAttribute('href');
    assert.equal(new URL(target,url).href, new URL(featureUrl(item),url).href);
  }
  for (const category of categories.filter(c=>c.id !== 'all')) {
    await filter(category.id).click();
    assert.equal(await page.locator('.feature-card').count(), features.filter(i => i.category === category.id).length);
  }
  await filter('all').click();
  await page.getByRole('button', {name:'俯视',exact:true}).click();
  assert.match(await page.locator('.machine').getAttribute('src'), /hero-top.webp/);

  const first = features.find(item=>item.id==='part');
  const adjacent = features[(features.indexOf(first)+1)%features.length];
  await card(first.id).locator('.thumb').click();
  await dialog.waitFor();
  assert.equal(await dialog.locator('h2').innerText(), first.title);
  await dialog.getByRole('button',{name:'停止播放'}).click();
  assert.match(await dialog.locator('img').getAttribute('src'), /part.webp/);
  await page.keyboard.press('ArrowRight');
  assert.equal(await dialog.locator('h2').innerText(), adjacent.title);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await dialog.locator('h2').innerText(), first.title);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').count(), 0);
  assert(!homeRequests.some(request => /\.glb|collision-v1|\/assets\/simulator-/.test(request)), 'gallery loaded simulation assets');

  await page.setViewportSize({width:390,height:760});
  async function roundTrip(id,viaPreview) {
    const item = features.find(f=>f.id===id);
    await filter(item.category).click();
    const trigger = card(id).locator(viaPreview ? '.thumb' : 'a');
    await trigger.scrollIntoViewIfNeeded();
    if (viaPreview) await trigger.click();
    const y = await page.evaluate(()=>scrollY);
    assert(y>0, 'test should leave the top of the page');
    const destination = viaPreview ? dialog.locator('.preview-foot .btn') : trigger;
    await destination.click();
    await page.waitForURL(new URL(featureUrl(item),url).href);
    if (id==='turn') {
      await page.locator('#system-state.ready').waitFor({timeout:90000});
      assert.equal(await page.locator('[data-mode="motion"]').getAttribute('aria-pressed'),'true');
    }
    const back = page.getByRole('link',{name:'返回图库',exact:true});
    await back.click();
    await card(id).waitFor();
    assert.equal(await filter(item.category).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.waitForFunction(id => {
      const focused = document.activeElement;
      return focused?.matches('[data-preview="'+id+'"]') ||
        focused?.closest('.feature-card')?.querySelector('[data-preview="'+id+'"]') != null;
    }, id);
    assert(Math.abs(await page.evaluate(()=>scrollY)-y)<5,'scroll position lost for '+id);
  }
  await roundTrip('turn',true);
  for (const [id,viaPreview] of [['assembly-course',true],['fastening',false],['inspection',true],['wire',false]]) {
    await roundTrip(id,viaPreview);
  }

  const hero = page.getByRole('button',{name:'观看工序演示',exact:true});
  await hero.scrollIntoViewIfNeeded();
  await hero.click();
  await dialog.waitFor();
  const y = await page.evaluate(()=>scrollY);
  await dialog.locator('.preview-foot .btn').click();
  await page.getByRole('link',{name:'返回图库',exact:true}).click();
  await hero.waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent.includes('观看工序演示'));
  assert(Math.abs(await page.evaluate(()=>scrollY)-y)<5,'hero scroll position lost');

  const reduced = await browser.newPage({viewport:{width:320,height:680},reducedMotion:'reduce'});
  await reduced.goto(url);
  const play = reduced.getByRole('button',{name:'播放动图'});
  await play.waitFor();
  assert.equal(await reduced.locator('.thumb img[src$=".gif"]').count(),0);
  assert(await reduced.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
  await play.click();
  await reduced.locator('.thumb').first().scrollIntoViewIfNeeded();
  await reduced.locator('.thumb img[src$=".gif"]').first().waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS · '+features.length+' 部动图与封面、过滤与预览、五个真实入口及首页返回、移动布局和减弱动态效果。');
} finally {
  await browser.close();
}
