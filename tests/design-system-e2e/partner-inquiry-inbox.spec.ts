import { test, expect } from '@playwright/test';
import { createPartnerWorkspaceFixturesV2 } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin, setTheme, assertNoSeriousAxeViolations, setViewportAndZoom } from './support/design-system';

// ADR-0116 uses a contract list and a dedicated responder page.
for (const width of [1280, 390]) test(`Partner inquiry list paginates contracts and detail retains the response draft at ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerWorkspaceFixturesV2();
  const queries: Record<string, unknown>[] = [];
  const inquiry = (number: number, view = 'all') => ({ ...fixture.responder,
    inquiryId: `inbox-${number}`, caseId: `case-${number}`, customerContractNumber: `100${number}`,
    partnerDisplayName: `همکار ${number}`, actions: [{ action: 'INQUIRY_RESPOND', enabled: true }],
    rows: [{ ...fixture.responder.rows[1], rowId: `row-${number}`,
      state: view === 'answered' ? 'REJECTED' : view === 'history' ? 'APPROVED' : 'PENDING',
      ...(view === 'answered' ? { noteOrReason: 'اصلاح مشخصات لازم است' } : {}),
      ...(view === 'history' ? { superseded: true, approvedPrice: { amount: '2000000', currency: 'IRT' },
        approvedAt: fixture.responder.rows[0].approvedAt, expiresAt: fixture.responder.rows[0].expiresAt } : {}),
      description: `سنگ قرارداد ${number}`, partnerRejectionReason: 'قیمت پیشنهادی بالا است؛ کاهش قیمت',
      negotiationHistory: [{ rowId: `old-${number}`, price: { amount: '2000000', currency: 'IRT' }, rejectionReason: 'قیمت اول زیاد بود' }] }] });
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true, data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
  await page.route('**/api/partner/workspaces/query-v2', route => {
    const query = route.request().postDataJSON(); queries.push(query);
    const start = query.cursor ? 21 : 1;
    const numbers = query.contractId ? [Number(String(query.contractId).replace('case-', ''))]
      : query.search ? [11] : Array.from({ length: query.cursor ? 3 : 20 }, (_, index) => start + index);
    return route.fulfill({ json: { success: true, data: { ...fixture.responderWorkspace, contracts: undefined,
      inquiries: numbers.map(number => inquiry(number, query.view)),
      contractCounts: { pending: 23, answered: 23, history: 23 },
      ...(!query.contractId && !query.cursor && !query.search ? { nextCursor: 'page-two' } : {}) } } });
  });
  await page.goto('/dashboard/sales/partner-inquiries');
  await expect(page.getByRole('heading', { name: 'استعلام های همکار', exact: true })).toBeVisible();
  const links = page.getByRole('link', { name: 'مشاهده قرارداد', exact: true });
  await expect(links).toHaveCount(20);
  await expect(links.first()).toHaveAttribute('href', '/dashboard/sales/partner-inquiries/case-1');
  await expect(page.getByRole('textbox', { name: /^قیمت هر/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'صفحه بعد', exact: true }).click();
  await expect(links).toHaveCount(3);
  await expect(links.first()).toHaveAttribute('href', '/dashboard/sales/partner-inquiries/case-21');
  await page.getByRole('button', { name: 'صفحه قبل', exact: true }).click();
  await expect(links).toHaveCount(20);
  const view = page.getByRole('combobox', { name: 'وضعیت پاسخ', exact: true });
  await view.click(); await page.getByRole('option', { name: 'پاسخ داده شده', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.view).toBe('answered');
  await view.click(); await page.getByRole('option', { name: 'سوابق', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.view).toBe('history');
  const search = page.getByRole('searchbox', { name: 'جستجو', exact: true });
  await search.fill('10011');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('href', '/dashboard/sales/partner-inquiries/case-11');
  expect(queries.some(query => query.view === 'history' && query.search === '10011')).toBe(true);
  expect(queries.every(query => (query.limit ?? 20) === 20)).toBe(true);
  await search.fill('');
  await view.click(); await page.getByRole('option', { name: 'نیازمند پاسخ', exact: true }).click();
  await expect(links).toHaveCount(20);
  await links.first().click();
  await expect(page).toHaveURL(/partner-inquiries\/case-1$/);
  const amount = page.getByRole('textbox', { name: /^قیمت هر/ });
  await amount.fill('1750000');
  await page.getByRole('button', { name: /جزئیات.*ردیف اصلی/ }).click();
  await expect(page.getByText('دلیل رد قیمت توسط همکار: قیمت پیشنهادی بالا است؛ کاهش قیمت', { exact: true })).toBeVisible();
  await expect(page.getByText(/دلیل رد: قیمت اول زیاد بود/)).toBeVisible();
  const readsBeforeRefresh = queries.length;
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(readsBeforeRefresh);
  await expect(amount).toBeEnabled();
  await expect(amount).toHaveValue('1,750,000');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoSeriousAxeViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `tmp/qa/partner-inbox-2026-10-04-five/${width}-${theme}.png`, fullPage: true });
  }
  if (width === 1280) {
    await setViewportAndZoom(page, { width, height: 900 }, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole('heading', { name: 'استعلام های همکار', exact: true })).toBeVisible();
  }
});

test('a repricing duty outside the first inbox page opens its exact row and rejection reason', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerWorkspaceFixturesV2();
  const target = { ...fixture.responder, inquiryId: 'repricing-duty-target', caseId: 'repricing-case',
    actions: [{ action: 'INQUIRY_RESPOND', enabled: true }], rows: [{ ...fixture.responder.rows[1],
      rowId: 'repricing-row', state: 'PENDING', description: 'سنگ درخواست قیمت مجدد',
      partnerRejectionReason: 'قیمت جدید هم بالا است؛ لطفاً کاهش دهید',
      negotiationHistory: [
        { rowId: 'first-price', price: { amount: '2000000', currency: 'IRT' }, rejectionReason: 'قیمت اول زیاد است' },
        { rowId: 'second-price', price: { amount: '1500000', currency: 'IRT' }, rejectionReason: 'قیمت جدید هم بالا است؛ لطفاً کاهش دهید' },
      ] }] };
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true, data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
  await page.route('**/api/partner/workspaces/query-v2', route => route.fulfill({ json: { success: true,
    data: { ...fixture.responderWorkspace, contracts: undefined, inquiries: [target], contractCounts: { pending: 1, answered: 0, history: 0 } } } }));
  await page.route('**/api/partner/inquiries/query-v2', route => {
    expect(route.request().postDataJSON()).toMatchObject({ purpose: 'RESPONDER_INQUIRY', inquiryId: target.inquiryId });
    return route.fulfill({ json: { success: true, data: target } });
  });
  await page.goto(`/dashboard/sales/partner-inquiries?inquiryId=${target.inquiryId}`);
  await expect(page.getByText('سنگ درخواست قیمت مجدد', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /جزئیات.*ردیف اصلی/ }).click();
  await expect(page.getByText(`دلیل رد قیمت توسط همکار: ${target.rows[0].partnerRejectionReason}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^قیمت هر/ })).toBeEnabled();
  await expect(page.getByText(/دلیل رد: قیمت اول زیاد است/)).toBeVisible();
  await expect(page.getByText(/شواهد پرونده با نسخه فعلی سازگار نیست/)).toHaveCount(0);
});
