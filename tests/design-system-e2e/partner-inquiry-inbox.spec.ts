import { test, expect } from '@playwright/test';
import { createPartnerWorkspaceFixturesV2 } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin, setTheme, assertNoSeriousAxeViolations, setViewportAndZoom } from './support/design-system';

for (const width of [1280, 390]) test(`Partner contract inbox keeps drafts across five-contract pages ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerWorkspaceFixturesV2();
  const queries: Record<string, unknown>[] = [];
  const inquiry = (number: number, state = 'PENDING') => ({ ...fixture.responder,
    inquiryId: `inbox-${number}`, caseId: `case-${number}`, customerContractNumber: `100${number}`,
    partnerDisplayName: `همکار ${number}`, actions: [{ action: 'INQUIRY_RESPOND', enabled: true }],
    rows: [{ ...fixture.responder.rows[1], rowId: `row-${number}`, state,
      ...(state === 'REJECTED' ? { noteOrReason: 'اصلاح مشخصات لازم است' } : {}),
      ...(state === 'SUPERSEDED' ? { approvedPrice: { amount: '2000000', currency: 'IRT' },
        approvedAt: fixture.responder.rows[0].approvedAt, expiresAt: fixture.responder.rows[0].expiresAt } : {}),
      description: `سنگ قرارداد ${number}`, partnerRejectionReason: 'قیمت پیشنهادی بالا است؛ کاهش قیمت',
      negotiationHistory: [{ rowId: `old-${number}`, price: { amount: '2000000', currency: 'IRT' }, rejectionReason: 'قیمت اول زیاد بود' }] }] });
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true, data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
  await page.route('**/api/partner/workspaces/query-v2', route => {
    const query = route.request().postDataJSON(); queries.push(query);
    const start = query.cursor ? 6 : 1, view = query.view || 'pending';
    const numbers = query.search ? [11] : Array.from({ length: 5 }, (_, index) => start + index);
    return route.fulfill({ json: { success: true, data: { ...fixture.responderWorkspace,
      inquiries: numbers.map(number => inquiry(number, view === 'pending' ? 'PENDING' : view === 'answered' ? 'REJECTED' : 'SUPERSEDED')),
      contractCounts: { pending: 20, answered: 20, history: 20 },
      ...(!query.cursor && !query.search ? { nextCursor: 'page-two' } : {}) } } });
  });
  await page.goto('/dashboard/sales/partner-inquiries');
  await expect(page.getByRole('heading', { name: 'صندوق کار استعلام‌های همکار' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^100\d+ · همکار/ })).toHaveCount(5);
  await expect(page.getByText('دلیل رد قیمت توسط همکار: قیمت پیشنهادی بالا است؛ کاهش قیمت', { exact: true })).toBeVisible();
  const amount = page.getByRole('textbox', { name: /قیمت هر واحد/ });
  await amount.fill('1750000');
  if (width === 390) {
    const responseBox = await amount.boundingBox();
    const listBox = await page.getByRole('heading', { name: 'قراردادها', exact: true }).boundingBox();
    expect(listBox!.y).toBeGreaterThan(responseBox!.y);
  }
  await page.getByRole('button', { name: 'صفحه بعد', exact: true }).click();
  await expect(page.getByRole('button', { name: '1006 · همکار 6', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^100\d+ · همکار/ })).toHaveCount(5);
  await page.getByRole('button', { name: 'صفحه قبل', exact: true }).click();
  await expect(amount).toHaveValue('1,750,000');
  await page.getByRole('button', { name: /پاسخ داده‌شده/ }).click();
  await expect(page.getByText('سنگ قرارداد 1', { exact: true })).toBeVisible();
  await expect(amount).toHaveCount(0);
  await page.getByRole('button', { name: /سوابق/ }).click();
  await expect(page.getByRole('button', { name: /پیشنهادها و دلایل قبلی/ }).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'جستجوی قرارداد یا همکار' }).fill('10011');
  await expect(page.getByRole('button', { name: /^100\d+ · همکار/ })).toHaveCount(1);
  expect(queries.every(query => query.limit === 5)).toBe(true);
  expect(queries.some(query => query.view === 'history' && query.search === '10011')).toBe(true);
  await page.getByRole('textbox', { name: 'جستجوی قرارداد یا همکار' }).fill('');
  await page.getByRole('button', { name: /نیازمند پاسخ/ }).click();
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
    await expect(amount).toBeVisible();
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
    data: { ...fixture.responderWorkspace, inquiries: [], contractCounts: { pending: 6, answered: 0, history: 0 } } } }));
  await page.route('**/api/partner/inquiries/query-v2', route => {
    expect(route.request().postDataJSON()).toMatchObject({ purpose: 'RESPONDER_INQUIRY', inquiryId: target.inquiryId });
    return route.fulfill({ json: { success: true, data: target } });
  });
  await page.goto(`/dashboard/sales/partner-inquiries?inquiryId=${target.inquiryId}`);
  await expect(page.getByText('سنگ درخواست قیمت مجدد', { exact: true })).toBeVisible();
  await expect(page.getByText(`دلیل رد قیمت توسط همکار: ${target.rows[0].partnerRejectionReason}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /قیمت هر واحد/ })).toBeEnabled();
  await page.getByRole('button', { name: /پیشنهادها و دلایل قبلی/ }).click();
  await expect(page.getByText('دلیل رد: قیمت اول زیاد است', { exact: true })).toBeVisible();
  await expect(page.getByText(/شواهد پرونده با نسخه فعلی سازگار نیست/)).toHaveCount(0);
});
