import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { preflight } from '../harness/safety.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const requireFrontend = createRequire(path.join(root, 'frontend/package.json'));
const { build } = requireFrontend('esbuild');
const output = path.join(root, 'test-results/partner-sales/async-wizard');
await mkdir(output, { recursive: true });
await preflight();
await build({ entryPoints: [path.join(root, 'frontend/src/features/partner-sales/__tests__/wizardBrowserFixture.tsx')],
  outfile: path.join(output, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
  tsconfig: path.join(root, 'frontend/tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } });
const js = await readFile(path.join(output, 'fixture.js'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://127.0.0.1:3000/__async-fixture**', route => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html lang="fa" dir="rtl"><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>` }));
  await page.goto('http://127.0.0.1:3000/__async-fixture?async=1');
  assert.equal(await page.getByRole('button', { name: 'مرحله بعدی', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'مرحله بعدی', exact: true }).click();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت پیش‌نویس', exact: true }).click();
  await page.getByText('تکمیل: true · قطعیت: 0', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'دریافت قیمت آزمایشی', exact: true }).click();
  await page.getByRole('button', { name: 'تأیید و نهایی‌سازی قرارداد', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByText('خرید از سبلان', { exact: true }).waitFor();
  assert.equal(await page.getByText('تکمیل: true · قطعیت: 0', { exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'استعلام قیمت', exact: true }).click();
  await page.getByRole('button', { name: 'رد قیمت و درخواست پیشنهاد مجدد', exact: true }).click();
  const rejection = page.getByRole('dialog');
  const send = rejection.getByRole('button').filter({ hasText: 'ارسال' });
  assert.equal(await send.isEnabled(), false);
  await rejection.getByRole('textbox').fill('قیمت پیشنهادی نیاز به بازنگری دارد');
  await send.click();
  await rejection.waitFor({ state: 'detached' });
  await page.getByText('دلیل رد: قیمت پیشنهادی نیاز به بازنگری دارد', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'پذیرش قیمت‌ها و نهایی‌سازی', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'پذیرش مبلغ خرید و نهایی‌سازی', exact: true }).click();
  await page.getByText('تکمیل: true · قطعیت: 1', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Asynchronous Partner wizard browser behavior passed (isolated component fixture).');
} finally { await browser.close(); }
