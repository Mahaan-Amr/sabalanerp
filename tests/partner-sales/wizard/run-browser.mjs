import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { preflight } from '../harness/safety.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const requireFrontend = createRequire(path.join(root, 'frontend/package.json'));
const { build } = requireFrontend('esbuild');
const output = path.join(root, 'test-results/partner-sales/wizard');
await mkdir(output, { recursive: true });
const runtime = await preflight();
await build({ entryPoints: [path.join(root, 'frontend/src/features/partner-sales/__tests__/wizardBrowserFixture.tsx')],
  outfile: path.join(output, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
  tsconfig: path.join(root, 'frontend/tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
});
const cssInput = `${await readFile(path.join(root, 'frontend/src/app/globals.css'), 'utf8')}\n${await readFile(path.join(root, 'frontend/src/styles/design-system-tokens.css'), 'utf8')}\nbody{font-family:'Yekan Bakh',sans-serif;background:var(--sds-surface-canvas);color:var(--sds-text-primary)}`;
await writeFile(path.join(output, 'fixture-input.css'), cssInput);
const css = spawnSync(process.execPath, [requireFrontend.resolve('tailwindcss/lib/cli.js'), '-c', 'tailwind.config.js', '-i', path.join(output, 'fixture-input.css'), '-o', path.join(output, 'fixture.css')], { cwd: path.join(root, 'frontend'), encoding: 'utf8', windowsHide: true });
if (css.status !== 0) throw new Error(css.stderr);
const js = await readFile(path.join(output, 'fixture.js'), 'utf8');
const styles = await readFile(path.join(output, 'fixture.css'), 'utf8');
const identity = { executedAt: new Date().toISOString(),
  fixtureSha256: createHash('sha256').update(js).digest('hex'),
  stylesheetSha256: createHash('sha256').update(styles).digest('hex'),
  services: runtime.services,
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const evidence = [];
try {
  for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://127.0.0.1:3000/__partner330-fixture**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fa" dir="rtl" data-theme="${theme}" class="${theme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>` }));
    await page.goto('http://127.0.0.1:3000/__partner330-fixture');
    const dock = page.getByRole('button', { name: 'ساخت پرونده و ورود به Wizard', exact: true });
    await dock.waitFor();
    assert.equal(await dock.count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `${theme}-${width}-inquiry.png`), fullPage: true });
    await dock.click();
    await page.getByRole('button', { name: 'ادامه', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: 'قیمت فروش', exact: true }).evaluate(element => element === document.activeElement), true);
    const retail = page.getByRole('textbox', { name: 'قیمت فروش به مشتری — سنگ طولی آزمایشی' });
    await retail.fill('700');
    await page.getByRole('checkbox').check();
    assert.equal(await retail.inputValue(), '700');
    await page.getByRole('button', { name: 'آزمون پایان اعتبار' }).click();
    await page.getByText(/ورودی‌های پرونده حفظ شده‌اند/).waitFor();
    assert.equal(await retail.inputValue(), '700');
    await page.getByRole('button', { name: 'استعلام مجدد', exact: true }).click();
    await page.screenshot({ path: path.join(output, `${theme}-${width}-retail.png`), fullPage: true });
    await page.getByRole('button', { name: 'آزمون بازیابی' }).click();
    await page.getByRole('button', { name: 'شروع پرونده جدید' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'ادامه ویرایش در اینجا' }).click();
    assert.equal(await retail.inputValue(), '700');
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `${theme}-${width}-zoom200.png`), fullPage: true });
    await page.getByRole('button', { name: 'ادامه', exact: true }).click();
    await page.getByRole('heading', { name: 'تحویل', exact: true }).waitFor();
    await page.getByRole('button', { name: 'ادامه', exact: true }).click();
    await page.getByRole('button', { name: 'ادامه', exact: true }).click();
    await page.getByRole('button', { name: 'ثبت پرونده', exact: true }).click();
    await page.getByRole('button', { name: 'باز کردن پرونده', exact: true }).click();
    await page.getByText('جزئیات پرونده آزمایشی', { exact: true }).waitFor();
    await page.goto('http://127.0.0.1:3000/__partner330-fixture?reinquiry');
    await page.getByRole('button', { name: 'استعلام مجدد', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'دلیل استعلام مجدد' }).fill('تغییر مشخصات سنگ');
    await dialog.getByRole('button', { name: 'ارسال استعلام مجدد', exact: true }).click();
    await dialog.getByRole('button', { name: 'بررسی نتیجه ارسال', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 1);
    await dialog.getByRole('button', { name: 'بررسی نتیجه ارسال', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText('تعداد ارسال: 2', { exact: true }).waitFor();
    evidence.push({ theme, width, partial: true, retailOverride: true, lossConfirmation: true, expiryPreservesDraft: true, takeoverPreservesDraft: true, escape: true, focus: true, uncertainSuccessorRetry: true, zoom200: true, zoom200ContinueClick: true, caseFixtureSubmission: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ scope: 'Component fixtures only; not live policy/inquiry/Case acceptance', identity, evidence, errors }, null, 2));
  console.log(`Partner wizard component browser acceptance passed: ${output}`);
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => undefined);
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ identity, message: String(error), errors, evidence }, null, 2));
  console.error(JSON.stringify({ browserErrors: errors }));
  throw error;
} finally { await browser.close(); }
