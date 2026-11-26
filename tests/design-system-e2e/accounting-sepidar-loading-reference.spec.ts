import { expect, test, type Page } from '@playwright/test';

type Invoice = { number: string; amountRial: string | null };
type AuditEntry = {
  id: string; actorId: string; createdAt: string; note?: string;
  beforeState?: { invoices?: Invoice[]; sepidarLoadingReference?: string | null };
  afterState?: { invoices?: Invoice[]; sepidarLoadingReference?: string | null };
};

async function signIn(page: Page) {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
}

const rows = [
  { id: 'driver-a', loadingId: 'loading-1', queueTurnId: 'case-a', status: 'ACCEPTED',
    summary: { loadingNumber: 'L-20261116-10', driverName: 'راننده الف', plate: '۱۲۳', customerName: 'مشتری اول', projectName: 'پروژه یک' },
    waybills: [{ id: 'waybill-a', status: 'ISSUED', number: '16' }], lines: [{ contractNumber: 'C-100' }] },
  { id: 'driver-b', loadingId: 'loading-1', queueTurnId: 'case-b', status: 'ACCEPTED',
    summary: { loadingNumber: 'L-20261116-10', driverName: 'راننده ب', plate: '۴۵۶', customerName: 'مشتری اول', projectName: 'پروژه یک' },
    waybills: [{ id: 'waybill-b', status: 'ISSUED', number: '17' }], lines: [{ contractNumber: 'C-101' }] },
  { id: 'driver-c', loadingId: 'loading-2', queueTurnId: 'case-c', status: 'PENDING',
    summary: { loadingNumber: 'L-20261116-2', driverName: 'راننده ج', plate: '۷۸۹', customerName: 'مشتری دوم', projectName: 'پروژه دو' },
    waybills: [], lines: [{ contractNumber: 'C-200' }] },
];

async function mockAccounting(page: Page, state: {
  invoices: Invoice[]; history: AuditEntry[]; canManage?: boolean; canView?: boolean; cancelled?: boolean; conflict?: boolean;
  totalRial?: string;
}) {
  await page.route('**/api/dispatch-confirmation/capabilities', route => route.fulfill({ json: { success: true,
    data: { canManageAccountingCandidates: true, canManageAccountingConfirmation: true } } }));
  await page.route(url => url.pathname === '/api/accounting/dispatch-candidates', route => route.fulfill(state.canView === false
    ? { status: 403, json: { success: false } }
    : { json: { success: true, data: rows.map(row => {
      const target = row.loadingId === 'loading-1';
      const loadingStatus = state.cancelled && target ? 'CANCELLED' : 'FINALIZED';
      return { ...row, loadingStatus, canManage: state.canManage !== false,
        canManageSepidarLoadingReference: state.canManage !== false && loadingStatus === 'FINALIZED',
        sepidarInvoices: target ? state.invoices : [], sepidarLoadingReferenceHistory: target ? state.history : [] };
    }) } }));
  await page.route(url => url.pathname === '/api/dispatch-cases', route => route.fulfill({ json: {
    success: true, access: { permission: 'edit' }, data: rows.map(row => ({
      id: row.queueTurnId, loadingId: row.loadingId, accountingCandidateId: row.id, status: 'LOADING_FINALIZED',
    })),
  } }));
  await page.route(url => url.pathname === '/api/dispatch-cases/case-b' && url.searchParams.get('loadingId') === 'loading-1', route => route.fulfill({ json: { success: true,
    data: { case: { id: 'case-b', loadingId: 'loading-1' }, currentAction: 'VIEW_TIMELINE', events: [] } } }));
  await page.route('**/api/accounting/loadings/loading-1/sepidar-reference', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { success: true, data: { invoices: state.invoices,
        expectedVersion: state.history[0]?.id ?? null, totalRial: state.totalRial ?? '100000000' } } });
      return;
    }

    const body = route.request().postDataJSON();
    expect(body.expectedVersion).toBe(state.history[0]?.id ?? null);
    if (state.conflict) {
      state.conflict = false;
      state.history.unshift({ ...state.history[0], id: 'concurrent' });
      await route.fulfill({ status: 409, json: { success: false, code: 'SEPIDAR_REFERENCE_STALE', error: 'فاکتورها تغییر کرده‌اند.' } });
      return;
    }
    const entry: AuditEntry = { id: `audit-${state.history.length + 1}`, actorId: 'accountant',
      createdAt: '2026-11-23T10:00:00Z', beforeState: { invoices: state.invoices },
      afterState: { invoices: body.invoices }, note: body.reason };
    state.invoices = body.invoices;
    state.history.unshift(entry);
    await route.fulfill({ json: { success: true, data: { invoices: state.invoices, auditEntry: entry } } });
  });
}

test('registers several Sepidar invoices for the whole loading and finds all driver rows by them', async ({ page }) => {
  await signIn(page);
  const state = { invoices: [] as Invoice[], history: [] as AuditEntry[], canManage: true, canView: true,
    totalRial: '100000000.1156194219' };
  await mockAccounting(page, state);
  await page.goto('/dashboard/accounting/dispatch');
  const search = page.getByRole('searchbox', { name: 'جست‌وجو در ردیف‌ها' });
  const issuingRow = page.getByRole('row').filter({ hasText: 'راننده الف' });
  await issuingRow.getByRole('button', { name: 'ثبت فاکتور سپیدار' }).click();

  const dialog = page.getByRole('dialog');
  const balance = dialog.getByRole('status');
  await expect(dialog.locator('dl').getByText('100,000,000.116', { exact: true })).toHaveCount(2);
  await expect(balance).toContainText('مبلغ باقی‌مانده');
  await expect(balance).toContainText('100,000,000.116');
  await expect(dialog.getByText('C-100، C-101')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'شماره فاکتور سپیدار' }).fill('۰۰۱۲۳');
  await dialog.getByRole('textbox', { name: 'مبلغ فاکتور (ریال)' }).fill('۶۰٬۰۰۰٬۰۰۰');
  const save = dialog.getByRole('button', { name: 'ذخیره فاکتورها' });
  await expect(save).toBeDisabled();
  await expect(balance).toContainText('40,000,000.116');
  await dialog.getByRole('textbox', { name: 'مبلغ فاکتور (ریال)' }).fill('۶۰٬۰۰۰٬۰۰۰٫');
  await expect(balance).toContainText('40,000,000.116');
  await dialog.getByRole('button', { name: 'افزودن فاکتور' }).click();
  await dialog.getByRole('textbox', { name: 'شماره فاکتور سپیدار' }).nth(1).fill('۰۰۱۲۳');
  const amounts = dialog.getByRole('textbox', { name: 'مبلغ فاکتور (ریال)' });
  await amounts.nth(1).fill('۴۰٬۰۰۰٬۰۰۰٫۱۱۶');
  await expect(save).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'شماره فاکتور سپیدار' }).nth(1).fill('۰۰۵۶۷');
  await expect(save).toBeEnabled();

  await dialog.getByRole('button', { name: 'افزودن فاکتور' }).click();
  await amounts.nth(2).fill('0.001');
  await expect(balance).toContainText('مبلغ مازاد');
  await expect(balance).toContainText('0.001');
  await expect(save).toBeDisabled();
  await dialog.getByRole('button', { name: 'حذف فاکتور 3' }).click();
  await expect(balance).toContainText('مبلغ باقی‌مانده');
  await expect(balance.getByText('0', { exact: true })).toBeVisible();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(state.invoices).toEqual([{ number: '00123', amountRial: '60000000' }, { number: '00567', amountRial: '40000000.116' }]);
  await search.fill('۰۰۵۶۷');
  await expect(page.getByRole('row').filter({ hasText: /راننده [الفب]+/ })).toHaveCount(2);
  await expect(page.getByRole('row').filter({ hasText: 'راننده ج' })).toHaveCount(0);

  await page.getByRole('button', { name: 'پرونده‌های ارسال', exact: true }).click();
  const loading = page.getByRole('row').filter({ hasText: 'راننده الف' });
  await expect(loading).toHaveCount(1);
  await expect(loading).toContainText('راننده ب');
  await expect(loading).toContainText('۴۵۶');
  await expect(loading).toContainText('پروژه یک');
  await expect(loading).toContainText('۱۶');
  await expect(loading).toContainText('۱۷');
  await expect(loading).toContainText('40,000,000');
  await search.fill('راننده ب C-100');
  await expect(loading).toBeVisible();
  await search.clear();

  const invoiceFilter = page.getByRole('combobox', { name: 'فاکتور سپیدار', exact: true });
  await invoiceFilter.click();
  await page.getByRole('option', { name: 'ثبت‌شده', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await invoiceFilter.click();
  await page.getByRole('option', { name: 'همه فاکتورها', exact: true }).click();

  const ascending = page.getByRole('button', { name: 'مرتب‌سازی بارگیری به‌صورت صعودی', exact: true });
  const descending = page.getByRole('button', { name: 'مرتب‌سازی بارگیری به‌صورت نزولی', exact: true });
  await ascending.click();
  await expect(page.locator('tbody tr').first()).toContainText('راننده ج');
  await descending.click();
  await expect(page.locator('tbody tr').first()).toContainText('راننده الف');

  await loading.getByRole('button', { name: 'سایر عملیات' }).click();
  await page.getByRole('button', { name: 'مراحل ارسال · راننده ب', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'مراحل ارسال', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('combobox', { name: 'وضعیت', exact: true }).click();
  await page.getByRole('option', { name: 'در انتظار بررسی', exact: true }).click();
  await expect(loading).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(search).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  state.canManage = false;
  await page.getByRole('button', { name: 'صدور بارنامه', exact: true }).click();
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect(page.getByRole('button', { name: /(?:ثبت فاکتور|اصلاح فاکتورهای) سپیدار/ })).toHaveCount(0);
  await expect(issuingRow).toContainText('00567');
  state.canView = false;
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect(issuingRow).toHaveCount(0);
});

test('edits a migrated number, protects stale edits, and retains the audit trail', async ({ page }) => {
  await signIn(page);
  const state = { invoices: [{ number: '00042', amountRial: null }] as Invoice[], history: [{
    id: 'legacy', actorId: 'accountant', createdAt: '2026-11-18T10:00:00Z', afterState: { sepidarLoadingReference: '00042' },
  }] as AuditEntry[], conflict: true, cancelled: false };
  await mockAccounting(page, state);
  await page.goto('/dashboard/accounting/dispatch');
  const row = page.getByRole('row').filter({ hasText: 'راننده الف' });
  await row.getByRole('button', { name: 'اصلاح فاکتورهای سپیدار' }).click();
  const dialog = page.getByRole('dialog');
  const number = dialog.getByRole('textbox', { name: 'شماره فاکتور سپیدار' });
  const amount = dialog.getByRole('textbox', { name: 'مبلغ فاکتور (ریال)' });
  await expect(number).toHaveValue('00042');
  await expect(amount).toHaveValue('');
  await number.fill('00043');
  await amount.fill('100000000');
  await expect(dialog.getByRole('button', { name: 'ذخیره فاکتورها' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'دلیل اصلاح' }).fill('تطبیق با فاکتور اصلی');
  await dialog.getByRole('button', { name: 'ذخیره فاکتورها' }).click();
  await expect(dialog.getByText('فاکتورها تغییر کرده‌اند.')).toBeVisible();
  await expect(number).toHaveValue('00043');
  await dialog.getByRole('button', { name: 'دریافت دوباره اطلاعات بارگیری' }).click();
  await expect(number).toHaveValue('00042');
  await number.fill('00043');
  await amount.fill('100000000');
  await dialog.getByRole('button', { name: 'ذخیره فاکتورها' }).click();
  await expect(row).toContainText('00043');

  await row.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await page.getByRole('button', { name: 'سابقه فاکتورهای سپیدار' }).click();
  await expect(page.getByText('تطبیق با فاکتور اصلی')).toBeVisible();
  await expect(page.getByText('مبلغ ثبت نشده').first()).toBeVisible();
  await page.keyboard.press('Escape');
  state.cancelled = true;
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect(row).toContainText('بارگیری لغوشده');
  await expect(row).toContainText('00043');
  await expect(row.getByRole('button', { name: 'اصلاح فاکتورهای سپیدار' })).toHaveCount(0);
});
