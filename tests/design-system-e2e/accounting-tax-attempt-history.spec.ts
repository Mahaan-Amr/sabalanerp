import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const taxApi = '**/api/accounting/ledger/tax';
const attemptedAt = '2026-09-01T21:30:00Z';

test('tax invoice history is requested on opening one invoice and can be retried locally', async ({ page }) => {
  await loginAsAdmin(page);
  const historyReads: string[] = [];
  let overviewReads = 0;
  await page.route(`${taxApi}/overview`, route => {
    overviewReads++;
    return route.fulfill({ json: { success: true, data: {
      capabilities: { canManage: false, canConfigure: false },
      invoices: [
        { id: 'invoice-a', internalSerial: 'TAX-A', status: 'SUBMITTED', netRials: '1000',
          taxRials: '100', issuedAt: attemptedAt, latestAttemptAt: attemptedAt,
          latestErrorCode: 'TAX_PROVIDER_REJECTED', outboxMessages: [{ id: 'message-a', status: 'SENT' }] },
        { id: 'invoice-b', internalSerial: 'TAX-B', status: 'NEEDS_CHANNEL', netRials: '3000',
          taxRials: '300', issuedAt: attemptedAt, latestAttemptAt: null, latestErrorCode: null, outboxMessages: [] },
      ], channels: [], reconciliations: [], rules: [],
    } } });
  });
  let failFirst = true;
  await page.route(`${taxApi}/invoices/*/attempts`, route => {
    const invoiceId = new URL(route.request().url()).pathname.split('/').at(-2)!;
    historyReads.push(invoiceId);
    if (failFirst) {
      failFirst = false;
      return route.fulfill({ status: 503, json: { success: false, error: 'تاریخچه تلاش‌ها بارگیری نشد.' } });
    }
    if (invoiceId === 'invoice-b') {
      return route.fulfill({ status: 403, json: { success: false, error: 'دسترسی حسابداری لغو شد.' } });
    }
    return route.fulfill({ json: { success: true, data: {
      id: invoiceId, internalSerial: 'TAX-A',
      outboxMessages: [{ id: 'message-a', requestIdentity: 'request-a', protocolVersion: '1',
        payloadHash: 'payload-a', status: 'SENT', attempts: [
          { id: 'attempt-2', attemptNumber: 2, status: 'SUCCEEDED', requestHash: 'hash-2',
            attemptedAt, completedAt: attemptedAt, receiptNumber: 'receipt-2', safeResponse: { reason: 'accepted' } },
          { id: 'attempt-1', attemptNumber: 1, status: 'FAILED', requestHash: 'hash-1',
            attemptedAt, completedAt: attemptedAt, errorCode: 'TAX_PROVIDER_REJECTED' },
        ],
      }],
    } } });
  });

  await page.goto('/dashboard/accounting/tax-center');
  await expect(page.getByText('ارسال و پذیرش‌شده', { exact: true })).toBeVisible();
  await expect(page.getByText(/آخرین تلاش.*۱:۰۰/)).toBeVisible();
  await expect(page.getByText(/آخرین خطا.*TAX_PROVIDER_REJECTED/)).toBeVisible();
  expect(historyReads).toEqual([]);

  const trigger = page.getByRole('button', { name: 'تاریخچه ارسال TAX-A' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('تاریخچه تلاش‌ها بارگیری نشد.')).toBeVisible();
  await dialog.getByRole('button', { name: 'تلاش دوباره' }).click();
  await expect(dialog.getByText('receipt-2')).toBeVisible();
  await expect(dialog.getByText(/accepted/)).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^تلاش/ })).toHaveText(['تلاش ۲', 'تلاش ۱']);
  expect(overviewReads).toBe(1);
  expect(historyReads).toEqual(['invoice-a', 'invoice-a']);

  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'تاریخچه ارسال TAX-B' }).click();
  await expect(page.getByText('دسترسی حسابداری لغو شد.')).toBeVisible();
  await expect(page.getByText('TAX-A', { exact: true })).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(historyReads).toEqual(['invoice-a', 'invoice-a', 'invoice-b']);
});
