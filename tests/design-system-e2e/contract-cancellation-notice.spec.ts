import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';

const id = 'qa-cancellation-notice';
const reply = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
for (const width of [1280, 390]) test(`cancellation notice selection, delivery history and pending protection at ${width}px`, async ({ page }, info) => {
  await loginAsAdmin(page);
  await setViewportAndZoom(page, { width, height: 900 });
  await page.route(`**/api/sales/contracts/${id}`, route => reply(route, {
    id, contractNumber: 'QA-CANCEL', titlePersian: 'قرارداد فروش سنگ', status: 'CANCELLED',
    commercialFlowVersion: 1, commercialRevision: 1, totalAmount: 100000, currency: 'ریال',
    createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z',
    customer: { id: 'qa-customer', firstName: 'مشتری', lastName: 'آزمون', customerType: 'INDIVIDUAL' },
    department: { id: 'sales', namePersian: 'فروش' },
    createdByUser: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
    responsibleSeller: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
    items: [], deliveries: [], payments: [], commercialActions: { canEdit: false, canSendConfirmation: false },
  }));
  await page.route('**/api/sales/reports/sellers*', route => reply(route, []));
  let status = 'NEEDS_SELECTION';
  await page.route(`**/api/sales/contracts/${id}/cancellation-notice`, route => reply(route, {
    status, canRetry: status !== 'SENT', canChoosePhone: true, availablePhoneNumbers: ['09120000002', '09120000003'],
    defaultPhoneNumber: null, lastError: null,
    attempts: [{ id: 'attempt-1', status: 'FAILED', phoneNumber: '09120000001', createdAt: '2026-10-12T00:00:00Z' }],
  }));
  let release: (() => void) | undefined;
  let requests = 0;
  await page.route(`**/api/sales/contracts/${id}/cancellation-notice/retry`, async route => {
    expect(route.request().postDataJSON()).toEqual({ phoneNumber: '09120000003' });
    requests++;
    await new Promise<void>(resolve => { release = resolve; });
    status = 'PENDING';
    await reply(route, { status });
  });
  await page.goto(`/dashboard/sales/contracts/${id}`);
  await expect(page.getByText('نیازمند انتخاب شماره مشتری', { exact: true })).toBeVisible();
  const submit = page.getByRole('button', { name: 'درخواست ارسال', exact: true });
  await expect(submit).toBeDisabled();
  const recipient = page.getByRole('combobox', { name: 'شماره گیرنده' });
  await recipient.selectOption('09120000003');
  await page.getByRole('button', { name: 'سابقه ارسال' }).click();
  await expect(page.getByText('09120000001 — ارسال ناموفق', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme); await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`cancellation-${width}-${theme}.png`), fullPage: true });
  }
  await submit.click();
  await expect.poll(() => requests).toBe(1);
  await expect(submit).toBeDisabled(); await expect(recipient).toBeDisabled();
  release!();
  await expect(page.getByText('در انتظار ارسال', { exact: true })).toBeVisible();
  await expect(page.getByText('پیامک با موفقیت ارسال شد ✨', { exact: true })).toHaveCount(0);
});
