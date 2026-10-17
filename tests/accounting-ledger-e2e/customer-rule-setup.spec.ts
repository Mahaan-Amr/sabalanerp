import { test, expect } from '@playwright/test';
import { assertNoSeriousAxeViolations } from '../design-system-e2e/support/design-system';
const mappings = [
  ['ar', 'دریافتنی مشتری', 'ASSET', 'DEBIT', 'REQUIRED', 'FORBIDDEN'],
  ['advance', 'پیش‌دریافت مشتری', 'LIABILITY', 'CREDIT', 'REQUIRED', 'FORBIDDEN'],
  ['bank', 'بانک / صندوق دریافت', 'ASSET', 'DEBIT', 'FORBIDDEN', 'REQUIRED'],
  ['revenue', 'درآمد فروش', 'REVENUE', 'CREDIT', 'FORBIDDEN', 'FORBIDDEN'],
  ['tax', 'مالیات فروش', 'LIABILITY', 'CREDIT', 'FORBIDDEN', 'FORBIDDEN'],
  ['stock', 'موجودی کالا', 'ASSET', 'DEBIT', 'FORBIDDEN', 'FORBIDDEN'],
  ['cost', 'بهای تمام‌شده فروش', 'EXPENSE', 'DEBIT', 'FORBIDDEN', 'FORBIDDEN'],
];
async function setup(page: import('@playwright/test').Page, profile = 'ACCOUNTING_MANAGER') {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  await page.route('**/api/accounting/ledger/context', route => route.fulfill({ json: { success: true, data: { id: 'entity', configured: true, accessProfile: profile, books: [{ id: 'book', accounts: mappings.map(([id, titlePersian, statementRole, normalSide, partyRequirement, financialAccountRequirement], index) => ({ id, code: String(100 + index), titlePersian, statementRole, normalSide, partyRequirement, financialAccountRequirement, level: 'MOIN', effectiveFrom: '2020-01-01' })) }] } } }));
  await page.route('**/api/accounting/ledger/customer-sales/posting-rules', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.goto('/dashboard/accounting/ledger/customer-rules');
}
test('manager defines a customer rule with explicit account mapping, renewed confirmation and protected submission', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('heading', { name: 'قواعد ثبت حسابداری مشتری' })).toBeVisible();
  await page.getByRole('textbox', { name: 'کد قاعده', exact: true }).fill('customer-default');
  await page.getByRole('button', { name: /تاریخ شروع اثر قاعده/ }).click();
  await page.getByRole('button', { name: 'امروز', exact: true }).click();
  for (const [id, label] of mappings) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option').filter({ hasText: label }).click();
  }
  await page.getByRole('checkbox').check();
  await page.getByRole('textbox', { name: 'کد قاعده', exact: true }).fill('customer-reviewed');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'ذخیره قاعده مشتری', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await assertNoSeriousAxeViolations(page);
  let payload: Record<string, unknown> | undefined;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/accounting/ledger/customer-sales/posting-rules', async route => {
    payload = route.request().postDataJSON(); await waiting;
    await route.fulfill({ json: { success: true, data: { id: 'rule', ...payload } } });
  });
  await page.getByRole('button', { name: 'ذخیره قاعده مشتری', exact: true }).click();
  await expect(page.getByRole('button', { name: 'در حال ذخیره…', exact: true })).toBeDisabled();
  await expect.poll(() => payload).toBeTruthy();
  expect(payload).toMatchObject({ legalEntityId: 'entity', code: 'customer-reviewed', version: 1, receivableAccountId: 'ar', customerAdvanceAccountId: 'advance', bankClearingAccountId: 'bank', revenueAccountId: 'revenue', outputTaxAccountId: 'tax', inventoryAccountId: 'stock', costAccountId: 'cost' });
  release();
  await expect(page.getByText(/قاعده ثبت مشتری ذخیره شد/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('read-only accounting profile cannot define customer rules', async ({ page }) => {
  await setup(page, 'VIEWER');
  await expect(page.getByText('تعریف قاعده فقط برای مدیر حسابداری مجاز است.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ذخیره قاعده مشتری', exact: true })).toHaveCount(0);
});


test('unconfigured ledger requires setup before showing the customer rule form', async ({ page }) => {
  await setup(page);
  await page.route('**/api/accounting/ledger/context', route => route.fulfill({ json: { success: true, data: { configured: false, accessProfile: 'ACCOUNTING_MANAGER' } } }));
  await page.reload();
  await expect(page.getByText('ابتدا دفترکل را راه‌اندازی کنید.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'راه‌اندازی دفترکل', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'کد قاعده', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ذخیره قاعده مشتری', exact: true })).toHaveCount(0);
});

test('real local rule setup reads the existing ledger and rules without financial writes', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  const financialWrites: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/accounting/ledger/')
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) financialWrites.push(request.method());
  });
  const response = page.waitForResponse(row => row.url().endsWith('/api/accounting/ledger/customer-sales/posting-rules') && row.request().method() === 'GET');
  const contextResponse = page.waitForResponse(row => row.url().endsWith('/api/accounting/ledger/context') && row.request().method() === 'GET');
  await page.goto('/dashboard/accounting/ledger/customer-rules');
  expect((await response).status()).toBe(200);
  const receivedContext = await contextResponse;
  expect(receivedContext.status()).toBe(200);
  const context = (await receivedContext.json()).data;
  expect(typeof context.configured).toBe('boolean');
  if (!context.configured) {
    await expect(page.getByText('ابتدا دفترکل را راه‌اندازی کنید.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'راه‌اندازی دفترکل', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'کد قاعده', exact: true })).toHaveCount(0);
  } else if (context.accessProfile === 'ACCOUNTING_MANAGER') {
    await expect(page.getByRole('textbox', { name: 'کد قاعده', exact: true })).toBeVisible();
  } else {
    await expect(page.getByText('تعریف قاعده فقط برای مدیر حسابداری مجاز است.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ذخیره قاعده مشتری', exact: true })).toHaveCount(0);
  }
  await expect(page.getByText('قواعد ثبت مشتری بارگیری نشد.', { exact: true })).toHaveCount(0);
  expect(financialWrites).toEqual([]);
  await page.screenshot({ path: 'test-results/accounting-ledger/customer-rule-setup-desktop.png', fullPage: true });
});
