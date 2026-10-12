import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';

const id = 'qa-ordinary-confirmation-recipient';
const reply = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
for (const width of [1280, 390]) test(`recipient selection, failed-send retry and pending protection at ${width}px`, async ({ page }, info) => {
  await loginAsAdmin(page);
  await page.clock.install();
  await setViewportAndZoom(page, { width, height: 900 });
  await page.route(`**/api/sales/contracts/${id}`, route => reply(route, {
    id, contractNumber: 'QA-RECIPIENT', titlePersian: 'قرارداد فروش سنگ', status: 'PENDING_APPROVAL',
    commercialFlowVersion: 1, commercialRevision: 1, totalAmount: 100000, currency: 'ریال',
    createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
    customer: { id: 'qa-customer', firstName: 'مشتری', lastName: 'آزمون', customerType: 'INDIVIDUAL' },
    department: { id: 'sales', namePersian: 'فروش' },
    createdByUser: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
    responsibleSeller: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
    items: [], deliveries: [], payments: [],
    commercialActions: { canRenew: false, canEdit: true, canApproveSales: false, canSendConfirmation: true },
  }));
  await page.route('**/api/sales/reports/sellers*', route => reply(route, []));
  await page.route(`**/api/sales/contracts/${id}/cancellation-notice`, route => reply(route, null));
  let numbers = ['09120000002', '09120000004'];
  await page.route(`**/api/sales/contracts/${id}/confirmation-recipients`, route => reply(route, {
    availablePhoneNumbers: numbers, defaultPhoneNumber: numbers[0], phoneNumber: '09120000001', sessionStatus: 'PENDING',
  }));
  let attempts = 0;
  let release: (() => void) | undefined;
  await page.route(`**/api/sales/contracts/${id}/resend-confirmation`, async route => {
    expect(route.request().postDataJSON()).toEqual({ phoneNumber: '09120000004' });
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'ارسال پیامک تایید انجام نشد' }) });
    await new Promise<void>(resolve => { release = resolve; });
    await reply(route, { phoneNumber: '09120000004' });
  });
  await page.goto(`/dashboard/sales/contracts/${id}`);
  await page.getByRole('button', { name: 'ارسال دوباره کد تایید', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ارسال دوباره کد تأیید', exact: true });
  const recipient = dialog.getByRole('combobox', { name: 'شماره گیرنده' });
  await expect(recipient).toHaveValue('09120000002');
  await recipient.selectOption('09120000004');
  await expect(dialog).toContainText('گیرنده تغییر کرده است');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`recipient-${width}-${theme}.png`), fullPage: true });
  }
  const submit = dialog.getByRole('button', { name: 'ارسال کد تأیید', exact: true });
  await submit.click();
  await expect(dialog).toContainText('ارسال پیامک تایید انجام نشد');
  await expect(page.getByText('پیامک با موفقیت ارسال شد ✨', { exact: true })).toHaveCount(0);
  await expect(recipient).toHaveValue('09120000004');
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(submit).toBeDisabled();
  await expect(recipient).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.clock.pauseAt(new Date());
  release!();
  await expect(dialog).toHaveCount(0);
  const success = page.getByText('پیامک با موفقیت ارسال شد ✨', { exact: true });
  await expect(success).toBeVisible();
  const box = await success.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  await page.clock.runFor(2_000);
  await expect(success).toBeVisible();
  await page.getByRole('button', { name: 'ارسال دوباره کد تایید', exact: true }).click();
  await recipient.selectOption('09120000004');
  await submit.click();
  await expect.poll(() => attempts).toBe(3);
  release!();
  await expect(dialog).toHaveCount(0);
  await page.clock.runFor(3_999);
  await expect(success).toBeVisible();
  await page.clock.runFor(1);
  await expect(success).toHaveCount(0);
  numbers = [];
  await page.getByRole('button', { name: 'ارسال دوباره کد تایید', exact: true }).click();
  await expect(dialog).toContainText('موبایل فعال و معتبر ثبت نشده است');
  await expect(submit).toBeDisabled();
});
