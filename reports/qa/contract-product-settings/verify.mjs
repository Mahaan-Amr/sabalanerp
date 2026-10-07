import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: 'chrome' });
const observations = [];
const version = '2026-10-03T00:00:00.000Z';
const product = { catalogItemId: 'qa-stone', catalogSnapshotVersion: version, code: '123', name: 'سنگ آزمایشی', families: ['longitudinal'], salesUnits: { prepared: 'count', volumetric: 'count' }, dimensions: { motherWidthCentimeters: '40', thicknessCentimeters: '2' }, attributes: { stoneType: 'مرمریت', mine: 'آباد', finish: 'صیقل', color: 'سفید', quality: '1', cuttingDimension: 'طولی' }, isAvailable: true };
const tool = { catalogItemId: 'qa-tool', catalogSnapshotVersion: version, kind: 'TOOL', name: 'ابزار آزمایشی', unit: 'meter' };
const finishing = { catalogItemId: 'qa-finishing', catalogSnapshotVersion: version, kind: 'FINISHING', name: 'پرداخت آزمایشی', unit: 'squareMeter', incompatibleCatalogItemIds: [] };
try {
  for (const kind of ['partner']) {
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
      } : pathname.endsWith('/catalog/query') ? { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: input.kind, items: input.kind === 'PRODUCT' ? [product] : input.kind === 'TOOL' ? [tool] : input.kind === 'FINISHING' ? [finishing] : input.kind === 'SERVICE' ? input.sourceType === 'cutting' ? [] : [{ catalogItemId: input.sourceType === 'tool' ? 'qa-tool' : 'qa-finishing', catalogSnapshotVersion: version, sourceType: input.sourceType, name: input.sourceType === 'tool' ? 'ابزار آزمایشی' : 'پرداخت آزمایشی', unit: input.sourceType === 'tool' ? 'meter' : 'squareMeter', suggestedRetailUnitPrice: { amount: input.sourceType === 'tool' ? '200000' : '800000', currency: 'IRT' } }] : [] }
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
    await workflow.getByRole('button', { name: /پروژه آزمایشی/ }).click();
    await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
    await workflow.getByRole('option', { name: /سنگ آزمایشی/ }).click();
    const dialog = page.getByRole('dialog', { name: 'تنظیمات محصول' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#longitudinal-length').fill('1.2');
    await dialog.locator('#longitudinal-length').blur();
    await dialog.locator('#longitudinal-width').fill('40');
    await dialog.locator('#longitudinal-width').blur();
    await dialog.locator('#longitudinal-quantity').fill('12');
    await dialog.locator('#longitudinal-quantity').blur();
    const price = dialog.getByRole('textbox', { name: 'فی هر مترمربع (تومان)', exact: true });
    await price.fill('5000000');
    await price.blur();
    expect(await dialog.evaluate(el => {
      const labels = [...el.querySelectorAll('label')].map(item => item.textContent);
      return labels.findIndex(item => item.includes('فی هر مترمربع')) > labels.indexOf('مترمربع') && labels.findIndex(item => item.includes('فی هر مترمربع')) < labels.indexOf('درصد حکمی');
    })).toBe(true);
    await dialog.getByRole('button', { name: 'افزودن ابزار', exact: true }).click();
    await dialog.getByRole('button', { name: /ابزار آزمایشی.*۲۰۰٬۰۰۰/ }).click();
    await dialog.getByRole('button', { name: 'جلو', exact: true }).click();
    await expect(dialog.getByText('۲٬۸۸۰٬۰۰۰ تومان', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'افزودن پرداخت', exact: true }).click();
    await dialog.getByRole('button', { name: /پرداخت آزمایشی.*۸۰۰٬۰۰۰/ }).click();
    await expect(dialog.getByText('۴٬۶۰۸٬۰۰۰ تومان', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'عقب', exact: true }).click();
    await expect(dialog.getByText('۵٬۷۶۰٬۰۰۰ تومان', { exact: true })).toBeVisible();
    for (const width of [800, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      observations.push({ width, theme, lengthFont: await dialog.locator('#longitudinal-length').evaluate(el => getComputedStyle(el).fontSize), priceFont: await price.evaluate(el => getComputedStyle(el).fontSize) });
      await dialog.locator('#longitudinal-area').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `settings-${width}-${theme}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'جلو', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `operations-${width}-${theme}.png`), animations: 'disabled' });
    }
    await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
    await context.close();
  }

} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2));
}
console.log('Partner price placement, authorized operation prices, perimeter-dependent amounts and responsive themes passed. No contract/product submitted.');