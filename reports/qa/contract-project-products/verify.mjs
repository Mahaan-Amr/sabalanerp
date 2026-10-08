import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: 'chrome' });
const observations = [];
try {
  for (const kind of ['ordinary', 'partner']) {
    const context = await browser.newContext({ locale: 'fa-IR', timezoneId: 'Asia/Tehran', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/login');
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
    await page.locator('input[type=password]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60000 });
    await page.route('**/api/sales/contract-edit-sessions/**', route => route.fulfill({ json: { success: true, data: null } }));
    if (kind === 'partner') await page.route('**/api/partner/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const input = route.request().postData() ? route.request().postDataJSON() : {};
      const data = pathname.endsWith('/creation-context') ? {
        schemaVersion: 1, kind: 'PARTNER', actorId: 'qa-project', actorDisplayName: 'فروشنده آزمایشی',
        contractNumberPreview: '100777', profileId: 'qa-project', writable: true, inquiryIds: [], recoverableDrafts: [],
        customers: [{ id: 'qa-customer', displayName: 'مشتری آزمایشی', phone: '09170000000', address: 'تهران' }],
        projects: [{ id: 'qa-project', customerId: 'qa-customer', title: 'پروژه آزمایشی', address: 'خیابان آزمایشی، کوچه ۱۰', city: 'شیراز' }],
      } : pathname.endsWith('/catalog/query') ? { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: input.kind, items: [] }
        : pathname.endsWith('/recoveries/acquire') ? { schemaVersion: 1, recoveryId: input.recoveryId, browserSessionId: input.browserSessionId,
          leaseToken: 'qa-lease', baseRevision: input.baseRevision, updatedAt: new Date().toISOString(), takenOver: false }
        : pathname.endsWith('/recoveries/read') ? { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: 0, updatedAt: new Date().toISOString(), draft: null }
        : pathname.endsWith('/recoveries/checkpoint') ? { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: input.expectedRecoveryRevision + 1,
          inputRevision: input.draft.inputRevision, updatedAt: new Date().toISOString(), replayed: false } : null;
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto('http://localhost:3000/dashboard/sales/contracts/create' + (kind === 'partner' ? '?newInquiry=1' : ''));
    let workflow = page.locator('main.sds-workspace').last();
    await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
    await workflow.locator('button[aria-pressed]').filter({ has: page.locator('h4') }).first().click();
    await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
    for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: path.join(output, `${kind}-projects-${width}-${theme}.png`), fullPage: true });
    }
    await workflow.getByRole('button', { name: 'ایجاد پروژه', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'افزودن آدرس پروژه' });
    await expect(dialog).toBeVisible({ timeout: 60000 });
    const fonts = [];
    for (const name of ['نام پروژه', 'آدرس', 'شهر', 'نام مدیر پروژه', 'شماره مدیر پروژه', 'نام بازاریاب', 'نام خانوادگی بازاریاب', 'شماره تماس بازاریاب']) {
      const input = dialog.getByRole('textbox', { name, exact: true });
      await expect(input).toHaveCount(1);
      fonts.push({ name, font: await input.evaluate(el => getComputedStyle(el).fontSize), height: (await input.boundingBox()).height });
    }
    await expect(dialog.getByRole('textbox', { name: 'آدرس', exact: true })).toHaveAttribute('rows', '3');
    await expect(dialog.getByRole('button', { name: 'افزودن', exact: true })).toBeVisible();
    for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      await page.screenshot({ path: path.join(output, `${kind}-project-form-${width}-${theme}.png`), fullPage: true });
    }
    await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    observations.push({ kind, fonts });
    if (kind === 'partner') {
      const project = workflow.getByRole('button', { name: /پروژه آزمایشی.*خیابان آزمایشی/ });
      await expect(project).toBeVisible();
      await project.click();
      await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
      await expect(workflow.getByRole('tab', { name: 'طولی', exact: true })).toBeVisible();
      await expect(workflow.getByRole('tab', { name: 'آماده', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(output, 'partner-products-390-dark.png'), fullPage: true });
    }
    await context.close();
  }
  expect(observations[0].fonts).toEqual(observations[1].fonts);
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2));
}
console.log('Shared project fields, dimensions, address display, cancel, compact catalog and responsive themes passed. No project/contract submitted.');
