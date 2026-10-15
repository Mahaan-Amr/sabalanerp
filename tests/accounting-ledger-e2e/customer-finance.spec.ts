import { test, expect, type Page } from '@playwright/test';
import { assertNoSeriousAxeViolations } from '../design-system-e2e/support/design-system';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
};
const context = {
  periods: [{ id: 'period', titlePersian: 'دوره باز', startsAt: '2026-01-01', endsAt: '2026-12-31', fiscalYear: { titlePersian: 'سال مالی' } }],
  rules: [{ id: 'rule', code: 'مشتری', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, bankClearingAccountId: 'bank', receivableAccountId: 'ar', customerAdvanceAccountId: 'advance' }],
  accounts: [
    { id: 'revenue', code: '401', titlePersian: 'درآمد', financialAccountRequirement: 'FORBIDDEN', partyRequirement: 'FORBIDDEN', statementRole: 'REVENUE', normalSide: 'CREDIT' },
    { id: 'bank', code: '111', titlePersian: 'بانک', financialAccountRequirement: 'REQUIRED', partyRequirement: 'FORBIDDEN', statementRole: 'ASSET', normalSide: 'DEBIT' },
    { id: 'custody', code: '112', titlePersian: 'اسناد نزد صندوق', financialAccountRequirement: 'FORBIDDEN', partyRequirement: 'REQUIRED', statementRole: 'ASSET', normalSide: 'DEBIT' },
  ], financialAccounts: [{ id: 'financial', titlePersian: 'حساب شرکت', currency: 'IRR' }],
  suppliers: [{ id: 'supplier', displayName: 'تأمین‌کننده آزمون' }], supplierOpenItems: [{ id: 'supplier-debt', supplierPartyId: 'supplier', invoiceNumber: 'S-1', remainingRials: '200' }],
};
const debt = { id: 'debt', kind: 'RECEIVABLE', sourceKind: 'DEBIT', invoiceNumber: 'بدهی آزمون', contractId: null, originalRials: '150', remainingRials: '150', dueAt: '2026-10-01', postedAt: '2026-10-01', ledgerVoucherId: 'v-debt', agingDays: 0 };
const fixture = {
  displayName: 'مشتری مالی آزمون', customerId: 'customer', bookId: 'book', profile: { id: 'profile' },
  customer: { trustCategory: 'NORMAL', cardDeletedAt: null }, credit: null, receivableRials: '150', debitOpenRials: '150', standaloneCreditRials: '0', unallocatedCreditRials: '300', netBalanceRials: '-150', refundableRials: '100',
  capabilities: { canExport: true, canManageTreasury: true, canManageAccount: true, canRefund: true },
  openingSnapshotHash: 'reviewed-snapshot', openingSources: [{ id: 'item:debt', kind: 'RECEIVABLE', description: 'بدهی موجود', amountRials: '30', contractId: null, voucherId: 'v-debt' }],
  openingReview: null, openingAttributions: [], contracts: [], financialRecords: [], receivables: [], payments: [], activityItems: [debt], openItems: [debt], creditAllocations: [],
  treasuryChecks: [{ id: 'check', serialNumber: '123', bankName: 'بانک آزمون', amountRials: '200', clearedRials: '0', unpaidRials: '0', dueAt: '2026-10-14', status: 'RECEIVED', direction: 'RECEIVABLE', events: [{ sequence: 1 }] }],
  receipts: [
    { id: 'cash', amountRials: '100', effectiveAmountRials: '100', remainingRials: '100', refundableRials: '100', componentKind: 'CASH', receiptGroupId: 'group', allocatedRials: '0', refundedRials: '0', occurredAt: '2026-10-01', postedVoucherId: 'v-cash', allocations: [], adjustments: [] },
    { id: 'cheque', amountRials: '200', effectiveAmountRials: '200', remainingRials: '200', refundableRials: '0', componentKind: 'CHECK', receiptGroupId: 'group', checkInstrumentId: 'check', allocatedRials: '0', refundedRials: '0', occurredAt: '2026-10-01', postedVoucherId: 'v-check', allocations: [], adjustments: [] },
  ], refunds: [], movements: [],
};
async function installFixture(page: Page, overrides: Record<string, unknown> = {}) {
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/accounting/ledger/customer-accounts/**', route => {
    if (route.request().method() === 'POST') { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true, data: { id: 'saved' } } }); }
    return route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/context') ? context : { ...fixture, ...overrides } } });
  });
  await page.goto('/dashboard/accounting/customer-accounts/profile');
  await expect(page.getByRole('heading', { name: fixture.displayName })).toBeVisible();
  return commands;
}
async function commonEvidence(page: Page) {
  await page.getByRole('textbox', { name: 'دلیل / شرح عملیات', exact: true }).fill('ثبت با مدرک بررسی حسابدار');
  await page.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('مدرک ۱۴');
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
test('opening uses the confirmed total and matched source; every changed field requires renewed confirmation', async ({ page }) => {
  await login(page); const commands = await installFixture(page);
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click();
  await page.getByRole('button', { name: 'مانده افتتاحیه', exact: true }).click();
  await page.getByRole('textbox', { name: 'مانده کل تأییدشده (ریال)' }).fill('۱۰۰');
  await page.getByRole('textbox', { name: 'مانده باز تأییدشده قلم (ریال)' }).fill('۱۰۰');
  await page.getByRole('textbox', { name: 'مدرک تطبیق و شمول این قلم' }).fill('مانده باز تأییدشده در تاریخ مبنا');
  await choose(page, 'حساب مقابل', '401 · درآمد'); await commonEvidence(page);
  await page.getByRole('checkbox', { name: 'هویت مشتری با منبع افتتاحیه تطبیق دارد.' }).check();
  await page.getByRole('checkbox', { name: 'مانده کل و شمول ریز اقلام با مدرک معتبر تأیید شده‌اند.' }).check();
  const confirmation = page.getByRole('checkbox', { name: 'اطلاعات و اثر مالی را بررسی کردم؛ ثبت قطعی انجام شود.' });
  await confirmation.check(); await page.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('مدرک ۱۵');
  await expect(confirmation).not.toBeChecked(); await expect(page.getByRole('button', { name: 'ثبت قطعی', exact: true })).toBeDisabled();
  await confirmation.check(); await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(commands[0].amountRials).toBe('100');
  expect(commands[0].openingReview).toMatchObject({ expectedSnapshotHash: 'reviewed-snapshot', identityConfirmed: true, totalConfirmed: true, lines: [{ amountRials: '100', existingSourceIds: ['item:debt'] }] });
});
test('accountant confirms the cash and uncleared cheque shares together; refund hides uncollected cheque', async ({ page }) => {
  await login(page); const commands = await installFixture(page);
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click(); await page.getByRole('button', { name: 'تخصیص اعتبار', exact: true }).click();
  await page.getByRole('button', { name: /نقدی.*مانده/ }).click();
  await page.getByRole('textbox', { name: 'بدهی آزمون', exact: true }).fill('100');
  await page.getByRole('button', { name: /نقدی.*مانده/ }).click();
  await page.getByRole('button', { name: /چک.*دریافت‌شده.*مانده/ }).click();
  await page.getByRole('textbox', { name: 'بدهی آزمون', exact: true }).fill('50');
  await commonEvidence(page); await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(commands[0].sourceAllocations).toEqual([{ receiptId: 'cash', allocations: [{ openItemId: 'debt', amountRials: '100' }] }, { receiptId: 'cheque', allocations: [{ openItemId: 'debt', amountRials: '50' }] }]);
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click(); await page.getByRole('button', { name: 'استرداد وجه', exact: true }).click();
  await page.getByRole('combobox', { name: 'منبع وجه' }).click();
  await expect(page.getByRole('option').filter({ hasText: 'نقدی' })).toHaveCount(1);
  await expect(page.getByRole('option').filter({ hasText: 'چک' })).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-finance-mobile.png', fullPage: true });
});

test('mixed receipt form preserves each instrument and protects a pending confirmed command', async ({ page }) => {
  await login(page); const commands = await installFixture(page);
  await page.getByRole('button', { name: 'ثبت دریافت', exact: true }).click();
  await choose(page, 'ابزار دریافت 1', 'نقد');
  await page.getByRole('textbox', { name: 'مبلغ جزء (ریال)', exact: true }).fill('۱۰۰');
  await choose(page, 'حساب مالی جزء 1', 'حساب شرکت'); await choose(page, 'معین جزء 1', '111 · بانک');
  await page.getByRole('button', { name: 'افزودن ابزار دریافت' }).click();
  await choose(page, 'ابزار دریافت 2', 'چک');
  await page.getByRole('textbox', { name: 'مبلغ جزء (ریال)', exact: true }).nth(1).fill('۲۰۰');
  await choose(page, 'حساب مالی جزء 2', 'حساب شرکت'); await choose(page, 'معین جزء 2', '112 · اسناد نزد صندوق');
  await page.getByRole('textbox', { name: 'شماره چک', exact: true }).fill('123');
  await page.getByRole('textbox', { name: 'بانک چک', exact: true }).fill('بانک آزمون');
  await page.getByRole('button', { name: /سررسید چک/ }).click();
  await page.getByRole('button', { name: 'امروز', exact: true }).click();
  await commonEvidence(page); await assertNoSeriousAxeViolations(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/accounting/ledger/customer-accounts/profile/treasury', async route => {
    commands.push(route.request().postDataJSON()); await waiting;
    await route.fulfill({ json: { success: true, data: { id: 'saved' } } });
  });
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
  await expect(page.getByRole('button', { name: 'در حال ثبت…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'ثبت دریافت' })).toBeVisible();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].amountRials).toBe('300'); expect(commands[0].parts).toMatchObject([{ kind: 'CASH', amountRials: '100' }, { kind: 'CHECK', amountRials: '200', check: { serialNumber: '123' } }]);
  release(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('accountant can reconcile an old receipt with explicit source shares and renewed confirmation', async ({ page }) => {
  await login(page); const commands = await installFixture(page);
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click();
  await page.getByRole('button', { name: 'تطبیق ابزار دریافت قدیمی', exact: true }).click();
  await page.getByRole('combobox', { name: 'منبع وجه', exact: true }).click(); await page.getByRole('option').filter({ hasText: 'نقدی' }).click();
  await page.getByRole('textbox', { name: 'مبلغ جزء (ریال)', exact: true }).fill('۱۰۰');
  await choose(page, 'حساب مالی جزء 1', 'حساب شرکت'); await choose(page, 'معین جزء 1', '111 · بانک');
  await commonEvidence(page); await page.getByRole('checkbox').check();
  await page.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill('مدرک تطبیق ۲');
  await expect(page.getByRole('button', { name: 'ثبت قطعی', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check(); await assertNoSeriousAxeViolations(page);
  await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ kind: 'RESOLVE_RECEIPT', receiptId: 'cash', expectedAmountRials: '100', parts: [{ kind: 'BANK', amountRials: '100' }], resolvedShares: [{ partKey: 'first', allocations: [], refunds: [] }] });
});

test('endorsement selects recipient debt separately from customer allocation', async ({ page }) => {
  await login(page); const commands = await installFixture(page);
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click(); await page.getByRole('button', { name: 'خرج‌کردن چک مشتری', exact: true }).click();
  await page.getByRole('combobox', { name: 'منبع وجه', exact: true }).click(); await page.getByRole('option').filter({ hasText: 'چک' }).click();
  await choose(page, 'گیرنده چک', 'تأمین‌کننده آزمون');
  await page.getByRole('textbox', { name: 'تخصیص به فاکتور S-1' }).fill('۱۵۰');
  await commonEvidence(page); await page.getByRole('checkbox').check(); await assertNoSeriousAxeViolations(page);
  await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ kind: 'CHECK_ENDORSE', receiptId: 'cheque', expectedSequence: 1, supplierPartyId: 'supplier', allocations: [{ openItemId: 'supplier-debt', amountRials: '150' }] });
});

test('resolved receipt history retains the original amount and linked correction evidence', async ({ page }) => {
  await login(page); await installFixture(page, { receiptHistory: [{ id: 'legacy', amountRials: '320', effectiveAmountRials: '300', occurredAt: '2026-10-01', resolutionOccurredAt: '2026-10-10', postedVoucherId: 'v-original',
    adjustments: [{ id: 'adjustment', deltaRials: '-20', reason: 'اصلاح مستند قبلی', reference: 'مرجع اصلاح قدیمی', occurredAt: '2026-10-02', ledgerVoucherId: 'v-adjustment' }] }] });
  await page.getByRole('button', { name: 'دریافت‌ها و چک‌ها', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'سابقه دریافت‌های تطبیق‌شده', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'سند دریافت اولیه', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /اصلاح مستند قبلی/ }).click();
  await expect(page.getByText(/مرجع اصلاح قدیمی/)).toBeVisible(); await expect(page.getByRole('button', { name: 'سند اصلاح قبلی', exact: true })).toBeVisible();
});

test('historical partial collection asks for the bank share while retaining the existing instrument identity', async ({ page }) => {
  await login(page); const commands = await installFixture(page, {
    receipts: [{ ...fixture.receipts[0], amountRials: '200', effectiveAmountRials: '200', remainingRials: '200' }],
    treasuryChecks: [{ ...fixture.treasuryChecks[0], id: 'legacy-partial', status: 'DEPOSITED', clearedRials: '60', receipt: null }],
  });
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click(); await page.getByRole('button', { name: 'تطبیق ابزار دریافت قدیمی', exact: true }).click();
  await page.getByRole('combobox', { name: 'منبع وجه', exact: true }).click(); await page.getByRole('option').filter({ hasText: 'نقدی' }).click();
  await choose(page, 'ابزار دریافت 1', 'چک');
  await page.getByRole('button', { name: 'سهم ابزار ۱ نمایش جزئیات', exact: true }).click();
  await choose(page, 'چک موجود ابزار 1', '123 · بانک آزمون · واگذارشده به بانک');
  await choose(page, 'حساب مالی جزء 1', 'حساب شرکت'); await choose(page, 'معین جزء 1', '112 · اسناد نزد صندوق');
  await choose(page, 'معین وصول قبلی جزء 1', '111 · بانک');
  await commonEvidence(page); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ kind: 'RESOLVE_RECEIPT', expectedAmountRials: '200', parts: [{ existingCheckId: 'legacy-partial', amountRials: '200', ledgerAccountId: 'custody', collectedLedgerAccountId: 'bank' }] });
});

test('missing customer rule points to rule setup while an open period is preserved', async ({ page }) => {
  await login(page); await installFixture(page);
  await page.route('**/api/accounting/ledger/customer-accounts/profile/context', route => route.fulfill({ json: { success: true, data: { ...context, rules: [] } } }));
  await page.getByRole('button', { name: 'عملیات حساب', exact: true }).click();
  await page.getByRole('button', { name: 'مانده افتتاحیه', exact: true }).click();
  await expect(page.getByText('قاعده ثبت حسابداری مشتری تعریف نشده است.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'تعریف قاعده مشتری', exact: true })).toHaveAttribute('href', '/dashboard/accounting/ledger/customer-rules');
  await expect(page.getByText('دوره مالی بازی تعریف نشده است.', { exact: true })).toHaveCount(0);
});
