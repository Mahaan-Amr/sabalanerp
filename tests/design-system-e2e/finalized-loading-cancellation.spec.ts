import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('finalized loading previews both documents and cancels them with one confirmation', async ({ page }) => {
  await loginAsAdmin(page);
  const id = 'unified-cancellation-fixture';
  const url = `/dashboard/logistics/loadings/${id}`;
  let status = 'FINALIZED';
  let canVoidDocuments = false;
  const documents = [
    { id: 'invoice', number: '3', kind: 'INVOICE' },
    { id: 'waybill', number: '0', kind: 'WAYBILL' },
  ];
  await page.route('**/api/dashboard/action-availability**', route =>
    route.fulfill({ json: { success: true, data: { CANCEL_LOADING: { enabled: true } } } }));
  await page.route(`**/api/logistics/loadings/${id}`, route => route.fulfill({ json: {
    success: true, data: {
      id, status, loadingNumber: '1', loadingDate: '2026-11-15T08:00:00.000Z',
      lines: [], corrections: [], canonicalAllocationRevisions: [{ id: 'revision' }],
    },
  } }));
  await page.route(`**/api/logistics/loadings/${id}/cancellation-documents`, route =>
    route.fulfill({ json: { success: true, data: { documents, canVoidDocuments } } }));
  await page.route(`**/api/logistics/loadings/${id}/sales-invoices`, route =>
    route.fulfill({ json: { success: true, data: { invoices: [], ready: false } } }));
  let commands = 0;
  await page.route(`**/api/logistics/loadings/${id}/cancel`, route => {
    commands++;
    expect(route.request().postDataJSON()).toEqual({ reason: 'لغو بارگیری آزمایشی', expectedDocumentIds: ['invoice', 'waybill'] });
    status = 'CANCELLED';
    return route.fulfill({ json: { success: true, data: { id, status } } });
  });

  await page.goto(`${url}?action=cancel`);
  const dialog = page.getByRole('dialog', { name: 'لغو بارگیری نهایی‌شده پیش از خروج' });
  await expect(dialog.getByText('فاکتور فروش شمارهٔ ۳')).toBeVisible();
  await expect(dialog.getByText('بارنامه شمارهٔ ۰')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'دلیل لغو' }).fill('لغو بارگیری آزمایشی');
  const confirm = dialog.getByRole('button', { name: 'ابطال اسناد و تأیید لغو' });
  await expect(confirm).toBeDisabled();
  canVoidDocuments = true;
  await dialog.getByRole('button', { name: 'بازبینی اسناد' }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('لغوشده', { exact: true })).toBeVisible();
  expect(commands).toBe(1);
});
