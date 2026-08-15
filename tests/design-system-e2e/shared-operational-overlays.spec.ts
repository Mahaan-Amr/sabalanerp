import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  assertSemanticSurfaceVisuals,
  isolatedTestNamespace,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
  waitForStableState,
} from './support/design-system';

test('Catalog Excel Sync is responsive, accessible, and cannot dismiss or repeat actions while pending', async ({ page }, testInfo) => {
  const namespace = isolatedTestNamespace(testInfo);
  await loginAsAdmin(page);
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await setTheme(page, 'dark');

  let releaseExport!: () => void;
  const exportGate = new Promise<void>((resolve) => { releaseExport = resolve; });
  await page.route('**/api/catalog-excel/services/export*', async (route) => {
    await exportGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: namespace,
    });
  });

  await page.goto('/dashboard/inventory/services');
  await page.getByRole('button', { name: 'وارد/صادر کردن' }).click();
  const dialog = page.getByRole('dialog', { name: /ورود و خروج اکسل/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await assertNoSeriousAxeViolations(page);
  await assertSemanticSurfaceVisuals(dialog);

  await dialog.getByRole('button', { name: 'خروج اطلاعات' }).click();
  await dialog.getByRole('button', { name: 'دانلود خروجی' }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'در حال آماده‌سازی...' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'بستن' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  releaseExport();
  await expect(dialog).not.toHaveAttribute('aria-busy', 'true');
  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await setViewportAndZoom(page, { width: 1280, height: 900 });
  await page.route('**/api/accounting/receivables**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [{
            id: `${namespace}-receivable`,
            contractId: `${namespace}-contract`,
            originalAmount: 1000,
            paidAmount: 0,
            remainingAmount: 1000,
            currency: 'IRR',
            dueDate: '2026-01-01T00:00:00.000Z',
            status: 'OPEN',
            contract: { contractNumber: namespace, customer: { displayName: 'پذیرنده آزمون' } },
          }],
          page: 1,
          pageSize: 50,
          total: 1,
        },
      }),
    });
  });
  await page.goto('/dashboard/accounting/receivables');
  await waitForStableState(page);
  await page.getByRole('button', { name: 'ثبت دریافت' }).click();
  const receiptDialog = page.getByRole('dialog', { name: 'ثبت دریافت' });
  const method = receiptDialog.getByRole('combobox', { name: 'روش دریافت' });
  await method.click();
  const search = receiptDialog.getByRole('textbox', { name: 'جستجو...' });
  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(receiptDialog).toContainText('روش دریافت');
  expect(await receiptDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(method).toBeFocused();
  await expect(receiptDialog).toBeVisible();
});

test('Accounting action fields retain accessible errors and nested overlays close topmost-first', async ({ page }, testInfo) => {
  const namespace = isolatedTestNamespace(testInfo);
  await loginAsAdmin(page);
  await page.route('**/api/accounting/tax**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [{
            id: `${namespace}-tax`,
            invoiceRecordId: `${namespace}-invoice`,
            submissionStatus: 'READY',
            taxableAmount: 0,
            vatAmount: 0,
            missingFields: [],
            updatedAt: '2026-01-01T00:00:00.000Z',
            contract: { contractNumber: namespace, customer: { displayName: 'پذیرنده آزمون' } },
          }],
          page: 1,
          pageSize: 50,
          total: 1,
        },
      }),
    });
  });

  await page.goto('/dashboard/accounting/tax');
  await waitForStableState(page);
  await page.getByRole('button', { name: 'ثبت دستی' }).click();
  const dialog = page.getByRole('dialog', { name: 'پیگیری وضعیت سامانه مودیان' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ثبت پیگیری' }).click();

  const tracking = dialog.getByRole('textbox', { name: /کد پیگیری/ });
  const date = dialog.getByRole('button', { name: /تاریخ ارسال/ });
  await expect(tracking).toHaveAttribute('aria-invalid', 'true');
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await expect(tracking).toHaveAttribute('aria-describedby', /-error/);
  await expect(date).toHaveAttribute('aria-describedby', /-error/);

  await date.click();
  const calendar = dialog.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' });
  await expect(calendar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(dialog).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoSeriousAxeViolations(page);
    await assertSemanticSurfaceVisuals(dialog);
  }
  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});
