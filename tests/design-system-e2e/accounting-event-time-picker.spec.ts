import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, loginAsAdmin, setViewportAndZoom, waitForStableState } from './support/design-system';

test('Partner receipt time is selected without typing and retains seconds', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/accounting/receivables**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      items: [{ id: 'time-picker-receivable', contractId: 'time-picker-contract',
        originalAmount: 1000, paidAmount: 0, remainingAmount: 1000, currency: 'IRR', status: 'OPEN',
        sourceKind: 'PARTNER_INTERNAL_RECORD', partnerActions: { registerReceipt: true },
        contract: { contractNumber: 'time-picker', customer: { displayName: 'آزمون ساعت' } } }],
      page: 1, pageSize: 50, total: 1,
    } }),
  }));
  await page.goto('/dashboard/accounting/receivables');
  await waitForStableState(page);
  await page.getByRole('button', { name: 'ثبت دریافت', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ثبت دریافت' });
  await dialog.getByRole('combobox', { name: 'زمان رخداد' }).click();
  await page.getByRole('option', { name: 'تاریخ و ساعت مشخص' }).click();
  await expect(dialog.getByRole('textbox', { name: 'ساعت رخداد به وقت تهران' })).toHaveCount(0);
  const trigger = dialog.getByRole('button', { name: 'ساعت رخداد به وقت تهران', exact: true });
  await trigger.click();
  await dialog.getByRole('button', { name: 'ساعت 5', exact: true }).click();
  await dialog.getByRole('button', { name: 'PM · بعدازظهر', exact: true }).click();
  await dialog.getByRole('button', { name: 'دقیقه 7', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'ثانیه', exact: true }).selectOption('42');
  await dialog.getByRole('button', { name: 'ثبت ساعت', exact: true }).click();
  await expect(trigger).toContainText('05:07:42 PM');
  await trigger.click();
  await expect(dialog.getByRole('combobox', { name: 'ثانیه', exact: true })).toHaveValue('42');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await dialog.getByRole('button', { name: 'ثبت ساعت', exact: true }).click();
  await expect(trigger).toContainText('05:07:42 PM');
});
