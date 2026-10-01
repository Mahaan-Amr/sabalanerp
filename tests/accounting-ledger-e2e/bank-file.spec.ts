import { expect, test } from '@playwright/test';

test('bank file upload preserves bytes, prevents duplicate submission and reaches older reconciliation rows', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  let submitted: any;
  let finishImport: (() => void) | undefined;
  await page.route('**/api/accounting/ledger/**', async (route) => {
    const url = new URL(route.request().url());
    let data: any = [];
    if (url.pathname.endsWith('/context')) data = { books: [], financialAccounts: [{ id: 'bank-1', titlePersian: 'بانک آزمایشی' }] };
    if (url.pathname.endsWith('/treasury/overview')) {
      const current = Number(url.searchParams.get('bankLinePage') || 1);
      data = { transactions: [], checks: [], cashCounts: [], pettyCash: [], bankExceptions: [], bankFileImports: [], bankFileChoices: [],
        bankLineCount: 101, bankLinePage: current, bankLinesHasMore: current === 1,
        bankMappings: [{ id: 'mapping-1', financialAccountId: 'bank-1', adapterType: 'CSV', version: 1 }],
        capabilities: { canManage: true, canConfigure: true }, bankLines: [{ id: `line-${current}`, description: current === 1 ? 'ردیف نخست بانک' : 'ردیف قدیمی بانک',
          amountRials: '1200', direction: 'INBOUND', bookedAt: '2026-09-25T08:00:00Z', matches: [] }] };
    }
    if (url.pathname.endsWith('/bank-lines/import-file')) {
      submitted = route.request().postDataJSON();
      await new Promise<void>((resolve) => { finishImport = resolve; });
      data = { id: 'run-1', imported: 1, rejected: 0 };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto('/dashboard/accounting/treasury');
  const form = page.getByRole('heading', { name: 'ورود صورتحساب بانک', exact: true }).locator('..');
  await form.getByRole('combobox').nth(0).click();
  await page.getByRole('option', { name: 'بانک آزمایشی', exact: true }).click();
  await expect(form.getByRole('combobox').nth(0)).toContainText('بانک آزمایشی');
  await form.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'فایل CSV', exact: true }).click();
  await expect(form.getByRole('combobox').nth(1)).toContainText('فایل CSV');
  await form.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: 'نسخه ۱', exact: true }).click();
  const bytes = Buffer.from('reference,date,amount,direction,description\nR-1,2026-09-25T08:00:00Z,1200,credit,واریز\n');
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: bytes });
  const submit = page.getByRole('button', { name: 'ورود فایل بانکی', exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect.poll(() => submitted?.fileBase64).toBe(bytes.toString('base64'));
  expect(submitted.financialAccountId).toBe('bank-1');
  finishImport!();
  await expect(submit).toBeEnabled();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(page.getByText('ردیف قدیمی بانک', { exact: true })).toBeVisible();
  await expect(page.getByText('ردیف نخست بانک', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'قبلی', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = await form.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('bank-file-mobile.png'), fullPage: true });
});
