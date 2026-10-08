import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const output = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
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
        schemaVersion: 1, kind: 'PARTNER', actorId: 'qa-first-two', actorDisplayName: 'فروشنده آزمایشی',
        contractNumberPreview: '100777', profileId: 'qa-first-two', writable: true, inquiryIds: [], recoverableDrafts: [],
        customers: [{ id: 'qa-customer', displayName: 'مهدی جعفری', phone: '09170000000', address: 'تهران' }], projects: [],
      } : pathname.endsWith('/catalog/query') ? { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: input.kind, items: [] }
        : pathname.endsWith('/recoveries/acquire') ? { schemaVersion: 1, recoveryId: input.recoveryId, browserSessionId: input.browserSessionId,
          leaseToken: 'qa-lease', baseRevision: input.baseRevision, updatedAt: new Date().toISOString(), takenOver: false }
        : pathname.endsWith('/recoveries/read') ? { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: 0, updatedAt: new Date().toISOString(), draft: null }
        : pathname.endsWith('/recoveries/checkpoint') ? { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: input.expectedRecoveryRevision + 1,
          inputRevision: input.draft.inputRevision, updatedAt: new Date().toISOString(), replayed: false } : null;
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto('http://localhost:3000/dashboard/sales/contracts/create' + (kind === 'partner' ? '?newInquiry=1' : ''));
    const workflow = page.locator('main.sds-workspace').last();
    await expect(workflow.getByRole('heading', { name: kind === 'partner' ? 'ایجاد قرارداد همکار' : 'ایجاد قرارداد', exact: true })).toBeVisible({ timeout: 60000 });
    const preview = workflow.getByRole('textbox', { name: kind === 'partner' ? 'پیش‌نمایش شماره احتمالی قرارداد همکار' : 'پیش‌نمایش شماره احتمالی قرارداد', exact: true });
    await expect(preview).toBeVisible();
    if (kind === 'partner') await expect(preview).toHaveValue('100777');
    for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      observations.push({ kind, width, theme, previewFont: await preview.evaluate(el => getComputedStyle(el).fontSize) });
      await page.screenshot({ path: path.join(output, `${kind}-date-${width}-${theme}.png`), fullPage: true });
    }
    await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
    await expect(workflow.getByRole('searchbox', { name: 'جستجوی مشتری' })).toBeVisible();
    if (kind === 'partner') {
      const card = workflow.getByRole('button', { name: /مهدی جعفری.*09170000000/ });
      await expect(card).toBeVisible();
      const name = await card.locator('h4').boundingBox();
      const phone = await card.locator('[dir=ltr]').boundingBox();
      expect(Math.abs(name.y - phone.y)).toBeLessThan(10);
      await expect(workflow.getByRole('button', { name: 'باز کردن پرونده', exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: path.join(output, `${kind}-customers-390-dark.png`), fullPage: true });
    await page.goto('http://localhost:3000/dashboard/crm/customers/create');
    await expect(page.getByRole('heading', { name: 'ایجاد مشتری جدید', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    const additional = page.getByRole('button', { name: 'اطلاعات تکمیلی', exact: true });
    await expect(additional).toBeVisible();
    const box = await additional.boundingBox();
    expect(box.width).toBeLessThan(230);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(48);
    await additional.click();
    await expect(additional).toHaveAttribute('aria-expanded', 'true');
    await additional.click();
    await expect(additional).toHaveAttribute('aria-expanded', 'false');
    observations.push({ kind, additionalButton: box });
    await page.screenshot({ path: path.join(output, `${kind}-customer-create-390-dark.png`), fullPage: true });
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2)); }
console.log('Date previews, shared sizing, responsive themes and inline Partner phone passed. Partner APIs mocked; no commercial submission.');
