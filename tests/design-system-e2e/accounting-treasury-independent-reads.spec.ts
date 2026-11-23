import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const treasuryUrl = '/dashboard/accounting/treasury';
const treasuryApi = '**/api/accounting/ledger/treasury';
const summary = {
  capabilities: { canManage: true, canConfigure: false },
  transactions: [], checks: [], cashCounts: [], pettyCash: [],
  bankMappings: [], bankFileImports: [], bankFileChoices: [], bankExceptions: [],
};
const bankRow = (page: string) => ({
  id: `row-${page}`, description: `صفحه بانک آزمون ${page}`, amountRials: '101',
  bookedAt: '2026-09-01T00:00:00Z', adapterType: 'MANUAL', mappingVersion: 1, matches: [],
});

test('bank pagination reads only bank rows and remains available when the ledger read fails', async ({ page }) => {
  await loginAsAdmin(page);
  let ledgerReads = 0;
  let summaryReads = 0;
  let customerReads = 0;
  const bankReads: string[] = [];
  await page.route('**/api/accounting/ledger/context', route => {
    ledgerReads++;
    return route.fulfill({ status: 503, json: { success: false, error: 'اطلاعات دفترکل بارگیری نشد.' } });
  });
  await page.route(`${treasuryApi}/summary`, route => {
    summaryReads++;
    return route.fulfill({ json: { success: true, data: summary } });
  });
  await page.route('**/api/accounting/ledger/**/customer-profiles**', route => {
    customerReads++;
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.route(`${treasuryApi}/bank-lines?*`, route => {
    const currentPage = new URL(route.request().url()).searchParams.get('page')!;
    bankReads.push(currentPage);
    return route.fulfill({ json: { success: true, data: {
      bankLines: [bankRow(currentPage)], bankLinePage: Number(currentPage), bankLineCount: 101,
    } } });
  });
  await page.goto(treasuryUrl);
  await expect(page.getByText('صفحه بانک آزمون 1')).toBeVisible();
  await expect(page.getByText('اطلاعات دفترکل بارگیری نشد.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ثبت ردیف بانکی', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '۲', exact: true }).click();
  await expect(page.getByText('صفحه بانک آزمون 2')).toBeVisible();
  await expect(page.getByText('صفحه بانک آزمون 1')).toHaveCount(0);
  expect(bankReads).toEqual(['1', '2']);
  expect(summaryReads).toBe(1);
  expect(customerReads).toBe(0);
  expect(ledgerReads).toBe(1);
});

test('customer search defers balance reads until selection and recovers a failed balance locally', async ({ page }) => {
  await loginAsAdmin(page);
  const customer = { id: 'profile-match', displayName: 'مشتری آزمون خزانه' };
  const balanceReads: string[] = [];
  let balanceFailed = true;
  await page.route(`${treasuryApi}/summary`, route => route.fulfill({ json: { success: true, data: summary } }));
  await page.route(`${treasuryApi}/bank-lines?*`, route => route.fulfill({ status: 503, json: { success: false } }));
  await page.route('**/api/accounting/ledger/context', route => route.fulfill({ json: { success: true, data: { configured: true } } }));
  await page.route(`${treasuryApi}/customer-profiles?*`, route => {
    const search = new URL(route.request().url()).searchParams.get('search');
    return route.fulfill({ json: { success: true, data: search === 'آزمون خزانه' ? [customer] : [] } });
  });
  await page.route(`${treasuryApi}/customer-profiles/*/balance`, route => {
    balanceReads.push(new URL(route.request().url()).pathname.split('/').at(-2)!);
    return route.fulfill(balanceFailed
      ? { status: 503, json: { success: false, error: 'مانده حساب مشتری بارگیری نشد.' } }
      : { json: { success: true, data: { asOf: '2026-09-02T00:00:00Z', netBalanceRials: '9007199254740993', openItems: [] } } });
  });
  await page.goto(treasuryUrl);
  await page.getByRole('button', { name: 'دریافت و تخصیص', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'مشتری', exact: true });
  await picker.click();
  await page.getByRole('textbox', { name: 'جستجوی گزینه‌ها' }).fill('آزمون خزانه');
  const match = page.getByRole('option', { name: customer.displayName });
  await expect(match).toBeVisible();
  expect(balanceReads).toEqual([]);
  await match.click();
  await expect(page.getByText('مانده حساب مشتری بارگیری نشد.')).toBeVisible();
  await expect(picker).toHaveText(customer.displayName);
  balanceFailed = false;
  await page.getByRole('button', { name: 'تلاش دوباره برای مانده حساب' }).click();
  await expect(page.getByText(/مانده خالص ۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ ریال · تاریخ مبنا/)).toBeVisible();
  expect(balanceReads).toEqual([customer.id, customer.id]);
});
