import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const kind of ['ordinary', 'partner']) {
    const context = await browser.newContext({ locale: 'fa-IR', timezoneId: 'Asia/Tehran', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/login');
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
    await page.locator('input[type="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60000 });
    await page.route('**/api/sales/contract-edit-sessions/**', route => route.fulfill({ json: { success: true, data: null } }));
    if (kind === 'partner') await page.route('**/api/partner/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const input = route.request().postData() ? route.request().postDataJSON() : {};
      const data = pathname.endsWith('/creation-context') ? {
        schemaVersion: 1, kind: 'PARTNER', actorId: 'comparison-only', actorDisplayName: 'فروشنده همکار آزمایشی',
        profileId: 'comparison-only', writable: true, inquiryIds: [], recoverableDrafts: [], customers: [], projects: [],
      } : pathname.endsWith('/catalog/query') ? { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: input.kind, items: [] }
        : pathname.endsWith('/recoveries/acquire') ? { schemaVersion: 1, recoveryId: input.recoveryId, browserSessionId: input.browserSessionId,
          leaseToken: 'comparison-lease', baseRevision: input.baseRevision, updatedAt: new Date().toISOString(), takenOver: false }
        : pathname.endsWith('/recoveries/read') ? { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: 0, updatedAt: new Date().toISOString(), draft: null } : null;
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto('http://localhost:3000/dashboard/sales/contracts/create' + (kind === 'partner' ? '?newInquiry=1' : ''));
    await page.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last().waitFor({ timeout: 60000 });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        await page.screenshot({ path: path.join(output, `${kind}-date-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        results.push({ kind, width, theme, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          mainText: await page.locator('main').last().innerText() });
      }
    }
    await page.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last().click();
    const calendar = page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' });
    await calendar.waitFor();
    await page.screenshot({ path: path.join(output, `${kind}-calendar.png`), fullPage: true, animations: 'disabled' });
    results.push({ kind, calendarButtons: await calendar.locator('[data-date]').evaluateAll(nodes => nodes.map(node => ({ date: node.getAttribute('data-date'), disabled: node.disabled, ariaDisabled: node.getAttribute('aria-disabled') }))) });
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(path.join(output, 'ui-observations.json'), JSON.stringify(results, null, 2)); }
console.log('Comparison UI captures saved. Partner requests were mocked; ordinary blank entry used live local APIs. No contract submission.');
