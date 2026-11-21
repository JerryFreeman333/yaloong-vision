import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
try {
  const page=await browser.newPage({viewport:{width:1120,height:760}});
  const errors=[];
  page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.argv[2]||'http://127.0.0.1:5318/simulator.html');
  await page.locator('#system-state.ready').waitFor({timeout:60000});
  const piece='bpx1_1_23_20',pins=['bpx1_1_23_21','bpx1_1_23_22'];
  const remove=page.getByRole('button',{name:'拆下零件'}), restore=page.getByRole('button',{name:'装回原位'});
  async function select(id){
    await page.locator('#part-search').fill(id);
    await page.locator('.part-row[data-id="'+id+'"]').click();
  }
  async function action(id,insert){
    await select(id);
    const [before,after]=insert?[restore,remove]:[remove,restore];
    assert(await before.isEnabled(),await page.locator('#selection').textContent());
    await before.click();
    try {await after.waitFor();}
    catch(error) {throw new Error([id,await page.locator('.contact-readout').textContent(),await page.locator('#scene-message').textContent(),JSON.stringify(errors)].join(' · '),{cause:error});}
    console.log(id,insert?'restored':'removed');
  }
  await select(piece);
  assert(await remove.isDisabled(),'Foot was released before either retainer');
  await action(pins[0],false);
  await select(piece);
  assert(await remove.isDisabled(),'Foot was released with one retainer still engaged');
  await action(pins[1],false);
  await action(piece,false);
  await select(pins[0]);assert(await restore.isDisabled(),'Retainer was allowed back before the foot');
  for(const id of [piece,...[...pins].reverse()])await action(id,true);
  await select(piece);assert(await remove.isDisabled());
  assert.deepEqual(errors,[]);
}finally{
  await browser.close();
}
