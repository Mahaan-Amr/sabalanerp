import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, assertNoSeriousAxeViolations, setTheme } from './support/design-system';

const timestamp = '2026-10-08T08:00:00.000Z';
const duty = {
  id: 'qa-expired-review', status: 'OPEN', access: 'SHARED', canReassign: false,
  claimRequiresReason: false, responseRequiresReason: true, currentAssigneeUserId: null,
  currentAssignee: null, accessProvenance: [], workspace: 'accounting',
  sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION', sourceVersion: 4, envelopeVersion: 1,
  dueAt: '2026-10-10T08:00:00.000Z', dueAtDisplay: '۱۴۰۵/۰۷/۱۸', overdue: false,
  fields: { title: 'اصلاح قرارداد 100608', description: 'مشتری: مشتری آزمون\nمهلت پایان‌یافته؛ ارجاع به حسابداری' },
  destinationHref: null, evidence: [], allowedActionCodes: ['VERIFY', 'RETURN_TO_SELLER'],
  result: null, resultActor: null, detailAvailable: true, createdAt: timestamp,
  respondedAt: null, updatedAt: timestamp, history: [],
};

for (const width of [1280, 390]) test(`expired correction Accounting decision and searchable history at ${width}px`, async ({ page }, testInfo) => {
  let completed = false;
  const responses: any[] = [];
  const searches: string[] = [];
  let historySeen = 0;
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  await setTheme(page, width === 390 ? 'dark' : 'light');
  await page.route('**/duties/workspaces/accounting/summary', route => route.fulfill({ json: { success: true, data: {
    open: completed ? 0 : 1, available: 0, availableUnseen: 0, attention: 0,
    dueSoon: 0, overdue: 0, triage: 0, historyUnseen: 0, canManageTriage: false,
  } } }));
  await page.route('**/duties/workspaces/accounting/history-seen', route => {
    historySeen++;
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/duties/workspaces/accounting/duties?**', route => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') || '';
    searches.push(search);
    return route.fulfill({ json: { success: true, data: url.searchParams.get('view') === 'history'
      ? search === 'نام ناموجود' ? [] : [{ ...duty, status: 'COMPLETED', allowedActionCodes: [],
        result: { actionCode: 'EDIT_PERIOD_EXPIRED' } }]
      : completed ? [] : [duty] } });
  });
  await page.route(`**/duties/workspaces/accounting/duties/${duty.id}`, route => route.fulfill({ json: { success: true,
    data: completed ? { ...duty, status: 'COMPLETED', allowedActionCodes: [], result: { actionCode: 'VERIFY' } } : duty,
  } }));
  await page.route(`**/duties/${duty.id}/respond`, async route => {
    responses.push(route.request().postDataJSON());
    if (responses.length === 1) return route.fulfill({ status: 409, json: { success: false,
      error: 'بستن درخواست ممکن نیست؛ ابتدا رسیدگی مالی وابسته را تکمیل کنید.' } });
    completed = true;
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/dashboard/accounting/duties');
  await page.getByRole('button', { name: /تاریخچه/ }).click();
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی سوابق' });
  await expect(search).toBeVisible();
  await expect(page.getByText('مهلت پایان‌یافته؛ ارجاع به حسابداری', { exact: true })).toBeVisible();
  await expect.poll(() => historySeen).toBeGreaterThan(0);
  const seenBeforeSearch = historySeen;
  await search.fill('۱۰۰۶۰۸');
  await expect.poll(() => searches.at(-1)).toBe('۱۰۰۶۰۸');
  expect(historySeen).toBe(seenBeforeSearch);
  await search.fill('نام ناموجود');
  await expect(page.getByText('سابقه‌ای با این عبارت پیدا نشد.')).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath(`history-search-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: /وظایف من/ }).click();
  await page.getByRole('link', { name: 'مشاهده وظیفه' }).click();
  await expect(page.getByRole('button', { name: 'درخواست فرصت مجدد از مدیر' })).toBeVisible();
  await page.getByRole('button', { name: 'بستن درخواست', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت تصمیم', exact: true }).click();
  await expect(page.getByText('برای این اقدام، دلیل کوتاه و روشن وارد کنید.')).toBeVisible();
  expect(responses).toHaveLength(0);
  const reason = page.getByRole('textbox', { name: 'دلیل اقدام' });
  await reason.fill('رسیدگی مالی بررسی شد؛ بستن با حفظ سوابق');
  await page.getByRole('button', { name: 'ثبت تصمیم', exact: true }).click();
  await expect(page.getByText(/ابتدا رسیدگی مالی وابسته را تکمیل کنید/)).toBeVisible();
  await expect(reason).toHaveValue('رسیدگی مالی بررسی شد؛ بستن با حفظ سوابق');
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath(`accounting-review-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'ثبت تصمیم', exact: true }).click();
  await expect(page.getByRole('button', { name: 'بستن درخواست', exact: true })).toHaveCount(0);
  expect(responses).toHaveLength(2);
  expect(responses[1]).toMatchObject({ actionCode: 'VERIFY', reason: 'رسیدگی مالی بررسی شد؛ بستن با حفظ سوابق',
    expectedSourceVersion: 4, expectedEnvelopeVersion: 1 });
});
