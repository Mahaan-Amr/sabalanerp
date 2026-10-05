import { test, expect, type Page } from '@playwright/test';
const login = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
};
const fixture = {
  displayName: 'مشتری ویژه آزمون', customerId: 'customer-1', bookId: 'book-1', profile: { id: 'profile-1' },
  customer: { trustCategory: 'SPECIAL', cardDeletedAt: null }, credit: { limitRials: '10000', usedRials: '1000', availableRials: '9000' },
  receivableRials: '1000', unallocatedCreditRials: '200', netBalanceRials: '800',
  capabilities: { canExport: true, canManageTreasury: true, canManageAccount: true, canRefund: true },
  treasuryChecks: [{ id: 'treasury-check-1', serialNumber: '۷۸۹', bankName: 'بانک خزانه', amountRials: '500', dueAt: '2026-02-02', status: 'DEPOSITED', direction: 'INBOUND' }],
  movements: [{ id: 'debt-1', label: 'صورتحساب ۱', at: '2026-01-01', debit: '1000', credit: '0', balance: '1000', voucherId: 'voucher-1', contractId: 'contract-1' }],
  contracts: [{ id: 'contract-1', contractNumber: '۱۴۰۵-۱', titlePersian: 'قرارداد سنگ', totalAmount: '100', currency: 'تومان', status: 'DRAFT', commercialFlowVersion: 1, customerCreditAmountRials: '0', createdAt: '2026-01-01', isInactive: false }],
  financialRecords: [{ id: 'record-1', contractId: 'contract-1', kind: 'INVOICE_CANDIDATE', status: 'DRAFT', amount: '1000', currency: 'IRR', createdAt: '2026-01-02' }],
  receivables: [], payments: [{ id: 'check-1', contractId: 'contract-1', method: 'CHECK', amount: '300', currency: 'IRR', status: 'EXPECTED', checkStatus: 'BOUNCED', checkNumber: '۱۲۳', checkDueDate: '2026-02-01' }],
  activityItems: [{ id: 'debt-1', kind: 'RECEIVABLE', sourceKind: 'SALE', invoiceNumber: 'صورتحساب ۱', contractId: 'contract-1', originalRials: '1000', remainingRials: '1000', postedAt: '2026-01-01', dueAt: '2026-01-02', ledgerVoucherId: 'voucher-1', agingDays: 10 }],
  openItems: [{ id: 'debt-1', kind: 'RECEIVABLE', invoiceNumber: 'صورتحساب ۱', contractId: 'contract-1', originalRials: '1000', remainingRials: '1000', dueAt: '2026-01-02', agingDays: 10 }],
  receipts: [{ id: 'receipt-1', amountRials: '200', allocatedRials: '0', refundedRials: '0', occurredAt: '2026-01-03', postedVoucherId: 'voucher-2', allocations: [] }], refunds: [],
};
test('eye action opens readable customer workspace and carries the selected customer into a confirmed accounting command', async ({ page }) => {
  await login(page);
  let command: any;
  await page.route('**/api/accounting/ledger/customer-accounts**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/operations')) { command = route.request().postDataJSON(); return route.fulfill({ json: { success: true, data: { voucherId: 'new' } } }); }
    if (pathname.endsWith('/context')) return route.fulfill({ json: { success: true, data: {
      periods: [{ id: 'period-1', titlePersian: 'دوره سال', startsAt: '2026-01-01', endsAt: '2026-12-31', fiscalYear: { titlePersian: 'سال مالی' } }],
      rules: [{ id: 'rule-1', code: 'قاعده مشتری', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, bankClearingAccountId: 'bank' }],
      accounts: [{ id: 'revenue', code: '401', titlePersian: 'درآمد', financialAccountRequirement: 'FORBIDDEN' }], financialAccounts: [],
    } } });
    if (pathname.endsWith('/customer-accounts')) return route.fulfill({ json: { success: true, data: { items: [{ id: 'profile-1', displayName: fixture.displayName, trustCategory: 'SPECIAL', receivableRials: '1000', unallocatedCreditRials: '200', netBalanceRials: '800', openItemCount: 1, hasActivity: true }], total: 1, page: 1, pageSize: 25 } } });
    return route.fulfill({ json: { success: true, data: fixture } });
  });
  await page.goto('/dashboard/accounting/customer-accounts');
  await expect(page.getByRole('link', { name: 'مشاهده حساب مشتری' })).toBeVisible();
  await expect(page.getByText('صورتحساب و ریزگردش', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'مشاهده حساب مشتری' }).click();
  await expect(page.getByRole('heading', { name: fixture.displayName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'قراردادها', exact: false }).click();
  await expect(page.getByText('یادداشت', { exact: true })).toBeVisible();
  await expect(page.getByRole('strong').filter({ hasText: '۱۰۰ تومان' })).toBeVisible();
  await page.getByRole('button', { name: 'دریافت‌ها و چک‌ها', exact: true }).click();
  await expect(page.getByText('برگشت‌خورده', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'پیگیری در خزانه' })).toHaveAttribute('href', '/dashboard/accounting/treasury?checkId=treasury-check-1');
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click();
  await expect(page.getByText('انتقال بین مشتری‌ها', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ثبت بدهکاری', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox', { name: 'مبلغ (ریال)', exact: true }).fill('۵۰۰');
  await page.getByRole('combobox', { name: 'حساب مقابل' }).click();
  await page.getByRole('option', { name: '401 · درآمد' }).click();
  await page.getByRole('textbox', { name: 'دلیل / شرح عملیات', exact: true }).fill('هزینه حمل خارج از قرارداد');
  await page.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('رسید شماره ۱');
  await expect(page.getByRole('button', { name: 'ثبت قطعی', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
  await expect(page.getByText('ثبت بدهکاری با موفقیت ثبت شد.')).toBeVisible();
  expect(command.amountRials).toBe('500'); expect(command.confirmed).toBe(true); expect(command.idempotencyKey).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('strong').filter({ hasText: fixture.displayName })).toBeVisible();
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-account-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('real local API includes CRM-only customers and loads customer detail without creating financial rows', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/accounting/customer-accounts');
  await expect(page.getByRole('heading', { name: 'حساب‌های مالی مشتریان', exact: true })).toBeVisible();
  const action = page.getByRole('link', { name: 'مشاهده حساب مشتری' }).first();
  await expect(action).toBeVisible(); await action.click();
  await expect(page.getByRole('button', { name: 'نمای کلی', exact: true })).toBeVisible();
  await expect(page.getByText('پرونده مالی مشتری بارگیری نشد.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-account-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-account-real-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
