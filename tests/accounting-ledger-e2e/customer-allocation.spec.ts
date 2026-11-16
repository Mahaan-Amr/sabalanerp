import { test, expect, type Page } from '@playwright/test';
import { installAccountingSessionFixture } from './support/accountingSessionFixture';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, setViewportAndZoom, setTheme } from '../design-system-e2e/support/design-system';

const context = {
  periods: [{ id: 'period', titlePersian: 'دوره باز', startsAt: '2026-01-01', endsAt: '2026-12-31', fiscalYear: { titlePersian: 'سال مالی' } }],
  rules: [{ id: 'rule', code: 'مشتری', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, bankClearingAccountId: 'bank', receivableAccountId: 'ar', customerAdvanceAccountId: 'advance' }],
  accounts: [], financialAccounts: [],
};
const item = (id: string, invoiceNumber: string, remainingRials: string, contractId: string | null, kind = 'RECEIVABLE') => ({
  id, invoiceNumber, remainingRials, originalRials: remainingRials, contractId, kind, sourceKind: 'DEBIT', description: null,
  dueAt: '2026-10-01', postedAt: '2026-10-01', ledgerVoucherId: `v-${id}`, agingDays: 2,
});
const debts = [item('d1', 'فاکتور ۹۸۷', '700000000', 'c1'), item('d2', 'فاکتور ۱۰۱۲', '250000000', 'c1'), item('d3', 'هزینه حمل مستقل', '11', null)];
const credit = item('credit', 'تخفیف توافقی', '100000000', null, 'CREDIT');
const receipt = (id: string, amountRials: string, componentKind: string) => ({
  id, amountRials, effectiveAmountRials: amountRials, remainingRials: amountRials, componentKind,
  allocatedRials: '0', refundedRials: '0', occurredAt: '2026-10-01', postedVoucherId: `v-${id}`, allocations: [],
  ...(componentKind === 'CHECK' ? { checkInstrumentId: 'check' } : {}),
});
const fixture = {
  displayName: 'مشتری تخصیص گروهی', customerId: 'customer', bookId: 'book', profile: { id: 'profile' },
  customer: { trustCategory: 'NORMAL', cardDeletedAt: null }, credit: null,
  receivableRials: '850000011', debitOpenRials: '950000011', unallocatedCreditRials: '800000000', standaloneCreditRials: '100000000', netBalanceRials: '50000011',
  capabilities: { canExport: true, canManageTreasury: true, canManageAccount: true, canRefund: true },
  contracts: [
    { id: 'c1', contractNumber: '۱۰۰۱۸۵', titlePersian: 'سنگ نما', totalAmount: '100000000', currency: 'IRT', status: 'SIGNED', createdAt: '2026-10-01', isInactive: false, customerCreditAmountRials: '0' },
    { id: 'c2', contractNumber: '۱۰۰۱۸۴', titlePersian: 'بدون بدهی قطعی', totalAmount: '900000000', currency: 'IRT', status: 'SIGNED', createdAt: '2026-10-01', isInactive: false, customerCreditAmountRials: '0' },
  ],
  financialRecords: [], receivables: [], payments: [], refunds: [], movements: [], creditAllocations: [],
  activityItems: [...debts, credit], openItems: [...debts, credit],
  receipts: [receipt('cash', '500000000', 'CASH'), receipt('cheque', '300000000', 'CHECK')],
  treasuryChecks: [{ id: 'check', serialNumber: '۱۲۳', bankName: 'بانک آزمون', amountRials: '300000000', dueAt: '2026-12-01', status: 'RECEIVED', direction: 'RECEIVABLE' }],
};
async function openWorkspace(page: Page, transform = (data: typeof fixture) => data, discovery?: Record<string, unknown> | 'CLOSED', accountId = 'profile') {
  await installAccountingSessionFixture(page);
  const commands: any[] = [];
  await page.route('**/api/accounting/ledger/customer-accounts/**', route => {
    const path = new URL(route.request().url()).pathname;
    const serverCommand = typeof discovery === 'object' ? discovery : undefined;
    if (path.endsWith('/treasury/allocation-intent')) {
      const data = route.request().method() === 'GET'
        ? serverCommand?.status === 'BLOCKED' || serverCommand?.status === 'CLOSED' ? serverCommand
          : serverCommand ? { status: 'PENDING', accountId: 'profile', idempotencyKey: serverCommand.idempotencyKey, command: serverCommand } : { status: discovery ?? 'UNKNOWN' }
        : { status: 'PENDING', idempotencyKey: route.request().postDataJSON().idempotencyKey };
      return route.fulfill({ json: { success: true, data } });
    }
    if (path.includes('/treasury/allocation-intent/')) {
      const canceled = path.endsWith('/cancel') && serverCommand &&
        route.request().postDataJSON().idempotencyKey === serverCommand.idempotencyKey;
      return route.fulfill({ json: { success: true, data: { status: canceled ? 'CANCELED' : 'UNKNOWN' } } });
    }
    if (route.request().method() !== 'GET') {
      commands.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, data: { id: 'allocation' } } });
    }
    return route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/context') ? context : transform(fixture) } });
  });
  await page.goto(`/dashboard/accounting/customer-accounts/${encodeURIComponent(accountId)}`);
  if (transform(fixture).capabilities.canManageTreasury) await page.getByRole('button', { name: 'تخصیص به بدهی', exact: true }).click();
  else await page.getByRole('button', { name: 'تخصیص', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'تخصیص به بدهی‌های مشتری', exact: true });
  await expect(workspace).toBeVisible();
  return { workspace, commands };
}

test('an authorized manager supplies a reason and cancels only the discovered pending intent', async ({ page }) => {
  const discovery = { status: 'BLOCKED', reconciliationId: 'pending-intent' };
  const { workspace, commands } = await openWorkspace(page, data => data, discovery);
  const requests: unknown[] = [];
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury/allocation-intent/reconcile', route => {
    requests.push(route.request().postDataJSON());
    discovery.status = 'CLOSED';
    return route.fulfill({ json: { success: true, data: { status: 'CANCELED' } } });
  });
  await workspace.getByRole('button', { name: 'تعیین تکلیف درخواست معلق', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تعیین تکلیف درخواست معلق', exact: true });
  const submit = dialog.getByRole('button', { name: 'لغو درخواست معلق', exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'دلیل لغو' }).fill('مالک دیگر دسترسی خزانه ندارد.');
  await submit.click();
  await expect(workspace.getByText('درخواست معلق لغو شد.', { exact: true })).toBeVisible();
  expect(requests).toEqual([{ intentId: 'pending-intent', reason: 'مالک دیگر دسترسی خزانه ندارد.' }]);
  expect(commands).toHaveLength(0);
});

test('a closed server capability prevents a new allocation draft', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page, data => data, 'CLOSED');
  await expect(workspace.getByText('ثبت تخصیص گروهی پس از تکمیل به‌روزرسانی در دسترس قرار می‌گیرد.', { exact: true })).toBeVisible();
  await expect(workspace.getByRole('checkbox', { name: /^نقدی/ })).toBeDisabled();
  await expect(workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true })).toBeDisabled();
  expect(commands).toHaveLength(0);
});

test('a lost reservation request can be retried explicitly after reload with the exact original command', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  const reservations: unknown[] = [];
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury/allocation-intent', route => {
    if (route.request().method() === 'GET') return route.fallback();
    const command = route.request().postDataJSON();
    reservations.push(command);
    if (reservations.length === 1) return route.abort('failed');
    return route.fulfill({ json: { success: true, data: { status: 'PENDING', idempotencyKey: command.idempotencyKey } } });
  });
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  expect(commands).toHaveLength(0);
  await page.reload();
  await page.getByRole('button', { name: 'تخصیص به بدهی', exact: true }).click();
  await workspace.getByRole('button', { name: 'ادامه بررسی درخواست قبلی', exact: true }).click();
  expect(reservations).toHaveLength(1);
  await review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(reservations).toEqual([commands[0], commands[0]]);
  expect(commands).toHaveLength(1);
});

test('a fresh browser discovers and cancels the authoritative pending request without posting it', async ({ page }) => {
  const command = {
    kind: 'ALLOCATION', amountRials: '0', allocations: [], sourceAllocations: [{ receiptId: 'cash', allocations: [{ openItemId: 'd1', amountRials: '1' }] }],
    occurredAt: '2026-10-01T00:00:00.000Z', periodId: 'period', postingRuleId: 'rule', reason: 'تخصیص با مدرک مشتری',
    reference: 'نامه تخصیص', confirmed: true, idempotencyKey: '11c890ec-4697-418e-8bd7-08d502cb1100',
  };
  const { workspace, commands } = await openWorkspace(page, data => data, command, 'customer:customer');
  await workspace.getByRole('button', { name: 'ادامه بررسی درخواست قبلی', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'بررسی و تأیید تخصیص', exact: true });
  await expect(review.getByText('۰٫۱ تومان', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: 'لغو درخواست تخصیص', exact: true }).click();
  await expect(workspace.getByText('درخواست تخصیص لغو شد.', { exact: true })).toBeVisible();
  expect(commands).toHaveLength(0);
});

async function confirmReview(page: Page) {
  const review = page.getByRole('dialog', { name: 'بررسی و تأیید تخصیص', exact: true });
  await review.getByRole('textbox', { name: 'دلیل / شرح عملیات', exact: true }).fill('تخصیص با مستند معتبر مشتری');
  await review.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('نامه تخصیص');
  await review.getByRole('checkbox', { name: 'مبلغ بدهی‌ها و سهم دقیق منابع را بررسی و تأیید می‌کنم.', exact: true }).check();
  return review;
}

test('accountant reviews several debts and sources in the approved editable table before one confirmed rial command', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await expect(workspace.getByText('بدهی قطعی قابل تخصیص ندارد', { exact: true })).toBeVisible();
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: /^چک/ }).check();
  await workspace.getByRole('checkbox', { name: 'بستانکاری · تخفیف توافقی', exact: true }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب فاکتور ۹۸۷', exact: true }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب فاکتور ۱۰۱۲', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await expect(workspace.getByRole('textbox', { name: 'تخصیص فاکتور ۹۸۷', exact: true })).toHaveValue('70,000,000');
  await expect(workspace.getByRole('textbox', { name: 'تخصیص فاکتور ۱۰۱۲', exact: true })).toHaveValue('20,000,000');
  expect(commands).toHaveLength(0);
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'بررسی و تأیید تخصیص', exact: true });
  await expect(review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true })).toBeDisabled();
  await review.getByRole('textbox', { name: 'دلیل / شرح عملیات', exact: true }).fill('تخصیص گروهی با مدرک مشتری');
  await review.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('نامه ۱۴');
  const confirm = review.getByRole('checkbox', { name: 'مبلغ بدهی‌ها و سهم دقیق منابع را بررسی و تأیید می‌کنم.', exact: true });
  await confirm.check();
  await review.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('نامه ۱۵');
  await expect(confirm).not.toBeChecked();
  await confirm.check();
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ kind: 'ALLOCATION', periodId: 'period', postingRuleId: 'rule', confirmed: true, reference: 'نامه ۱۵', sourceAllocations: [
    { receiptId: 'cash', allocations: [{ openItemId: 'd1', amountRials: '500000000' }] },
    { receiptId: 'cheque', allocations: [{ openItemId: 'd1', amountRials: '200000000' }, { openItemId: 'd2', amountRials: '100000000' }] },
    { creditItemId: 'credit', allocations: [{ openItemId: 'd2', amountRials: '100000000' }] },
  ] });
  expect(commands[0].idempotencyKey).toBeTruthy();
});

test('a conflict without authoritative final status keeps the entered request locked', async ({ page }) => {
  let exhausted = false;
  const { workspace } = await openWorkspace(page, data => exhausted ? { ...data, receipts: [data.receipts[1]] } : data);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب فاکتور ۹۸۷', exact: true }).check();
  await workspace.getByRole('textbox', { name: 'تخصیص فاکتور ۹۸۷', exact: true }).fill('1');
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    exhausted = true;
    return route.fulfill({ status: 409, json: { success: false, message: 'مانده منبع تغییر کرده است.' } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'بازگشت و ویرایش', exact: true }).click();
  await expect(workspace.getByRole('textbox', { name: 'تخصیص فاکتور ۹۸۷', exact: true })).toHaveValue('1');
  await expect(workspace.getByRole('textbox', { name: 'تخصیص فاکتور ۹۸۷', exact: true })).toBeDisabled();
});

test('one rial precision, pending protection and an unknown result retry keep exactly the same confirmed command', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  const amount = workspace.getByRole('textbox', { name: 'تخصیص هزینه حمل مستقل', exact: true });
  await amount.fill('۱٫۱۲');
  await expect(workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true })).toBeDisabled();
  await amount.fill('۱٫۲');
  await expect(workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true })).toBeDisabled();
  await amount.fill('۱٫۱');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', async route => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) { await held; return route.fulfill({ status: 503, json: { success: false, message: 'ارتباط قطع شد.' } }); }
    return route.fulfill({ json: { success: true, data: { id: 'saved' } } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByRole('button', { name: 'در حال ثبت…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(review).toBeVisible();
  expect(commands).toHaveLength(1);
  release();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  await expect(review.getByRole('textbox', { name: 'مرجع مستندات', exact: true })).toHaveCount(0);
  await expect(review.getByText('جمع درخواست محفوظ', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'بازگشت و ویرایش', exact: true }).click();
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  const resume = workspace.getByRole('button', { name: 'ادامه بررسی درخواست قبلی', exact: true });
  await expect(resume).toBeVisible();
  await resume.click();
  await review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0].sourceAllocations).toEqual([{ receiptId: 'cash', allocations: [{ openItemId: 'd3', amountRials: '11' }] }]);
});

test('a rejection after an unknown result keeps the original request locked', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    commands.push(route.request().postDataJSON());
    return commands.length === 1 ? route.fulfill({ status: 503, json: { success: false, message: 'نتیجه نامشخص' } })
      : route.fulfill({ status: 409, json: { success: false, message: 'مانده تغییر کرده است.' } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  await expect(review.getByRole('textbox', { name: 'مرجع مستندات', exact: true })).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});

test('a closed compatibility guard does not discard a previously uncertain command', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    commands.push(route.request().postDataJSON());
    return commands.length === 1 ? route.fulfill({ status: 503, json: { success: false } })
      : route.fulfill({ status: 409, json: { success: false, code: 'CUSTOMER_SOURCE_SHARES_CLOSED' } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  await expect(review.getByRole('textbox', { name: 'مرجع مستندات', exact: true })).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});

test('a lost response survives reload and only a proven committed status releases the same request', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { success: false } });
  });
  let statusAvailable = false;
  const statusCommands: any[] = [];
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury/status', route => {
    statusCommands.push(route.request().postDataJSON());
    return statusAvailable ? route.fulfill({ json: { success: true, data: { status: 'COMMITTED', result: { id: 'saved' } } } })
      : route.fulfill({ status: 404, json: { success: false } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'تخصیص', exact: true }).click();
  const restored = page.getByRole('region', { name: 'تخصیص به بدهی‌های مشتری', exact: true });
  await restored.getByRole('button', { name: 'ادامه بررسی درخواست قبلی', exact: true }).click();
  const restoredReview = page.getByRole('dialog', { name: 'بررسی و تأیید تخصیص', exact: true });
  await restoredReview.getByRole('button', { name: 'بررسی وضعیت درخواست', exact: true }).click();
  await expect(restoredReview.getByRole('button', { name: 'بررسی وضعیت درخواست', exact: true })).toBeEnabled();
  expect(commands).toHaveLength(1);
  expect(statusCommands[0]).toEqual(commands[0]);
  statusAvailable = true;
  await restoredReview.getByRole('button', { name: 'بررسی وضعیت درخواست', exact: true }).click();
  await expect(restoredReview).toHaveCount(0);
  expect(commands).toHaveLength(1);
  expect(statusCommands[1]).toEqual(commands[0]);
});

test('unavailable browser storage refuses a new allocation before any command is sent', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('storage unavailable'); } }); });
  const { workspace, commands } = await openWorkspace(page);
  await expect(workspace.getByText('دسترسی به وضعیت محفوظ درخواست تأیید نشد؛ ثبت جدید ممکن نیست.')).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true })).toBeDisabled();
  expect(commands).toHaveLength(0);
});

test('a storage write failure refuses dispatch even after a valid review', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await page.evaluate(() => { Object.defineProperty(IDBObjectStore.prototype, 'add', { value() { throw new Error('quota'); } }); });
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByText('حفظ درخواست تأیید نشد؛ برای جلوگیری از ثبت تکراری، این صفحه را بازبینی کنید.')).toBeVisible();
  expect(commands).toHaveLength(0);
});

test('a second tab cannot start another command while an earlier request is unresolved', async ({ page, context }) => {
  const first = await openWorkspace(page);
  await first.workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await first.workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await first.workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    first.commands.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { success: false } });
  });
  await first.workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  const secondPage = await context.newPage();
  const second = await openWorkspace(secondPage);
  await expect(second.workspace.getByRole('button', { name: 'ادامه بررسی درخواست قبلی', exact: true })).toBeVisible();
  await expect(second.workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true })).toBeDisabled();
  expect(first.commands).toHaveLength(1);
  expect(second.commands).toHaveLength(0);
});

test('two already-open tabs reserve at most one command for the same customer', async ({ page, context }) => {
  const first = await openWorkspace(page);
  const secondPage = await context.newPage();
  const second = await openWorkspace(secondPage);
  for (const workspace of [first.workspace, second.workspace]) {
    await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
    await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
    await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
    await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  }
  const firstReview = await confirmReview(page), secondReview = await confirmReview(secondPage);
  for (const [target, commands] of [[page, first.commands], [secondPage, second.commands]] as const) {
    await target.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
      commands.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { success: false } });
    });
  }
  await Promise.all([firstReview.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click(),
    secondReview.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click()]);
  await expect.poll(() => first.commands.length + second.commands.length).toBe(1);
  await expect.poll(async () => (await firstReview.getByText('حفظ درخواست تأیید نشد؛ برای جلوگیری از ثبت تکراری، این صفحه را بازبینی کنید.').count())
    + (await secondReview.getByText('حفظ درخواست تأیید نشد؛ برای جلوگیری از ثبت تکراری، این صفحه را بازبینی کنید.').count())).toBe(1);
});

test('a non-authoritative timeout keeps the same command locked', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    commands.push(route.request().postDataJSON());
    return route.fulfill({ status: 408, json: { success: false } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
  expect(commands).toHaveLength(1);
});

test('a failed refresh after a successful allocation retries only the read, never the financial command', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  let refreshing = false;
  let reads = 0;
  await page.route('**/api/accounting/ledger/customer-accounts/profile', route => {
    if (refreshing && ++reads === 1) return route.fulfill({ status: 503, json: { success: false, message: 'بازخوانی موقتاً در دسترس نیست.' } });
    return route.fulfill({ json: { success: true, data: fixture } });
  });
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', route => {
    refreshing = true; commands.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, data: { id: 'saved' } } });
  });
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true }).click();
  const refresh = review.getByRole('button', { name: 'به‌روزرسانی مانده‌ها', exact: true });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(review).toHaveCount(0);
  expect(commands).toHaveLength(1);
  expect(reads).toBe(2);
});

test('an unavailable cheque cannot fund a plan and removing treasury authority disables every allocation control', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page, data => ({ ...data, treasuryChecks: [{ ...data.treasuryChecks[0], status: 'BOUNCED' }], receipts: [...data.receipts, { ...receipt('legacy', '200', 'CHECK'), checkInstrumentId: undefined }] }));
  for (const checkbox of await workspace.getByRole('checkbox', { name: /^چک/ }).all()) await expect(checkbox).toBeDisabled();
  expect(commands).toHaveLength(0);
  await page.route('**/api/accounting/ledger/customer-accounts/profile', route => route.fulfill({ json: { success: true, data: { ...fixture, capabilities: { ...fixture.capabilities, canManageTreasury: false } } } }));
  await page.reload();
  await page.getByRole('button', { name: 'تخصیص', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true })).toBeDisabled();
  for (const checkbox of await workspace.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
  expect(commands).toHaveLength(0);
});

test('the approved table keeps hidden selections explicit and remains usable in both themes, mobile and 200 percent zoom', async ({ page }) => {
  const { workspace, commands } = await openWorkspace(page);
  await workspace.getByRole('checkbox', { name: 'انتخاب هزینه حمل مستقل', exact: true }).check();
  await workspace.getByRole('searchbox').fill('۱۰۰۱۸۵');
  await workspace.getByRole('button', { name: 'انتخاب همه بدهی‌ها', exact: true }).click();
  await expect(workspace.getByText(/بدهی منتخب خارج از نتیجه جستجو/)).toBeVisible();
  await workspace.getByRole('searchbox').fill('');
  for (const checkbox of await workspace.getByRole('checkbox', { name: /^انتخاب / }).all()) await expect(checkbox).toBeChecked();
  await setTheme(page, 'light');
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-allocation-A-desktop.png', fullPage: true });
  await setTheme(page, 'dark');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-allocation-A-mobile.png', fullPage: true });
  await setViewportAndZoom(page, { width: 1440, height: 900 }, 2);
  await assertNoHorizontalOverflow(page);
  await workspace.getByRole('checkbox', { name: /^نقدی/ }).check();
  await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
  await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
  const review = await confirmReview(page);
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  expect(commands).toHaveLength(0);
});
