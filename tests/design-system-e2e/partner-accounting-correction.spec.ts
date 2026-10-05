import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, loginAsAdmin, setTheme } from './support/design-system';

for (const width of [1280, 390]) test(`Partner Accounting uses the shared correction form and submits category/priority at ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  let submitted: Record<string, unknown> | undefined;
  let requestKey: string | undefined;
  await page.route('**/api/accounting/contracts/partner/correction-ui-case/internal', route => route.fulfill({ json: { success: true, data: {
    id: 'preparation', preparationOnly: true, caseState: 'COMMITTED', status: 'PREPARATION', commercial: { status: 'FINAL' },
    amount: '100', receivedAmount: '0', remainingAmount: '100', currency: 'IRT', systemInvoiceNumber: null,
    partnerContext: { caseId: 'correction-ui-case', caseNumber: 'case-1', customerContractNumber: '100634', internalRecordNumber: 'internal-1',
      debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری آزمایشی' } },
    actions: { canOpenEdit: true, canCreateInvoice: false, canResolveFlag: false, canFlag: false, canRequestCorrection: true,
      canReviewInvoice: false, canCreateReceivable: false }, items: [], receivables: [], taxRecords: [], flags: [],
  } } }));
  await page.route('**/api/accounting/contracts/partner/correction-ui-case/correction-requests', async route => {
    submitted = route.request().postDataJSON(); requestKey = route.request().headers()['x-idempotency-key'];
    await route.fulfill({ json: { success: true, data: { correction: { id: 'request-1' }, duty: { id: 'manager-duty' } } } });
  });
  await page.goto('/dashboard/accounting/contracts/partner/correction-ui-case');
  await expect(page.getByRole('button', { name: 'درخواست مجوز ویرایش و لغو', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'درخواست اصلاح', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'درخواست اصلاح', exact: true });
  await expect(dialog.getByText('100634 - مشتری آزمایشی')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'دسته اصلاح', exact: true }).click();
  await page.getByRole('option', { name: 'برنامه پرداخت', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'اولویت', exact: true }).click();
  await page.getByRole('option', { name: 'فوری', exact: true }).click();
  await setTheme(page, 'light'); await assertNoHorizontalOverflow(page);
  await setTheme(page, 'dark'); await assertNoHorizontalOverflow(page);
  await dialog.getByRole('textbox', { name: 'متن درخواست اصلاح', exact: true }).fill('برنامه پرداخت باید اصلاح شود');
  await dialog.getByRole('button', { name: 'ثبت درخواست', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toEqual({ category: 'PAYMENT_PLAN', priority: 'URGENT', reason: 'برنامه پرداخت باید اصلاح شود' });
  expect(requestKey).toMatch(/^[0-9a-f-]{36}$/i);
});
