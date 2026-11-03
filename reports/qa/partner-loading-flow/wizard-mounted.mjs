import { chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../../..');
const requireFrontend = createRequire(path.join(project, 'frontend/package.json'));
const { build } = requireFrontend('esbuild');
const baseline = process.argv.includes('--baseline');
const result = await build({
  plugins: baseline ? [{ name: 'baseline-wizard', setup(builder) {
    builder.onLoad({ filter: /PartnerContractWizard\.tsx$/ }, args => ({
      contents: execFileSync('git', ['show', 'HEAD:frontend/src/features/contract-creation/partner/PartnerContractWizard.tsx'], { cwd: project, encoding: 'utf8' }),
      loader: 'tsx', resolveDir: path.dirname(args.path),
    }));
  } }] : [], entryPoints: [path.join(directory, 'wizard-mounted.tsx')], absWorkingDir: path.join(project, 'frontend'),
  nodePaths: [path.join(project, 'frontend/node_modules')], bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: path.join(project, 'frontend/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, banner: { js: 'var process = { env: {} };' } });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => console.error(error.message));
  await page.goto('http://localhost:3000/login');
  await page.setContent('<!doctype html><html lang="fa" dir="rtl"><body></body></html>');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const observations = [];
  for (const scenario of ['success', 'uncertain', 'service-only']) {
    await page.evaluate(scenario => window.mountScenario(scenario), scenario);
    await expect.poll(() => page.evaluate(() => window.observed.commands.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.observed.preparations)).toBe(1);
    await expect(page.getByRole('textbox', { name: /قیمت فروش به مشتری/ })).toHaveCount(0);
    if (scenario === 'service-only') {
      await expect(page.getByText('مرحله ۵ از ۷', { exact: true })).toHaveCount(2);
      await expect(page.getByText('برنامه تحویل آزمایشی', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.observed.commands[0].intent.pricingRequest)).toBeUndefined();
    } else {
      await expect(page.getByText('مرحله ۵ از ۸', { exact: true })).toHaveCount(2);
      await expect(page.locator('section[aria-label="استعلام قیمت سبلان"]')).toHaveCount(1);
      expect(await page.evaluate(() => window.observed.commands[0].intent.pricingRequest.rows.length)).toBe(1);
    }
    // StrictMode replay and subsequent state updates must never resend the initial command.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.observed.commands.length)).toBe(1);
    if (scenario === 'uncertain') {
      await expect(page.getByRole('button', { name: 'تلاش مجدد برای ارسال استعلام', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'بررسی نتیجه ثبت', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.observed.commands.length)).toBe(2);
      expect(await page.evaluate(() => window.observed.commands[0].commandId === window.observed.commands[1].commandId)).toBe(true);
    } else if (scenario === 'success') {
      await page.getByRole('button', { name: 'قبلی', exact: true }).click();
      expect(await page.evaluate(() => window.observed.edits)).toBe(1);
    }
    observations.push({ scenario, ...(await page.evaluate(() => ({ commands: window.observed.commands.length, preparations: window.observed.preparations, edits: window.observed.edits }))) });
  }
  console.log(JSON.stringify(observations));
} finally { await browser.close(); }
