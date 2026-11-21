import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { features } from '../src/gallery-features.js';

const site = new URL(process.argv[2]);
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(120_000);
  const response = await page.goto(site.href);
  assert.equal(response.status(), 200);
  await page.locator('#hero-course').click();
  const work = page.frameLocator('iframe');
  await work.locator('.bench-pick:visible').click();
  await work.locator('.bench-place:visible').click();
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('bpx.whole-course.v1'))?.chapters.frame.history.length === 1);
  await page.getByRole('button', { name: '当前工艺图' }).click();
  await page.getByRole('dialog').locator('img').evaluate(image => image.decode());
  await page.getByRole('button', { name: '关闭工艺图' }).click();
  await page.getByRole('link', { name: '返回图库', exact: true }).click();
  await page.locator('.feature-card').first().waitFor();
  assert.equal(await page.locator('.feature-card').count(), features.length);
  console.log('Verified the published gallery, first CAD installation, drawing and return navigation.');
} finally {
  await browser.close();
}
