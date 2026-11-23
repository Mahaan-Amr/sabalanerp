import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('dispatch reads one list for 66 cases and isolates an unavailable case detail', async ({ page }) => {
  await loginAsAdmin(page);
  let lists = 0;
  const details: string[] = [];
  await page.route('**/api/accounting/dispatch-candidates**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/dispatch-candidates')) {
      lists++;
      return route.fulfill({ json: { success: true, capabilities: {
        canManageAccountingCandidates: false, canManageAccountingConfirmation: false,
      }, data: Array.from({ length: 66 }, (_, i) => ({
        id: `case-${i}`, loadingId: `loading-${Math.floor(i / 2)}`, status: 'PENDING',
        summary: { driverName: `راننده نمونه ${i}`, loadingNumber: String(1000 + i) },
        waybills: [], canManage: false,
      })) } });
    }
    if (path.endsWith('/document-read-model')) {
      const id = path.split('/').at(-2)!;
      details.push(id);
      if (id === 'case-0') return route.fulfill({ status: 503, json: { success: false } });
      return route.fulfill({ json: { success: true, data: { id, status: 'PENDING', allocationRevision: {
        lines: [{ id: 'item', sourceContractId: 'contract', sourceContractItemId: 'stone', quantity: '1',
          unit: 'count', snapshot: { contractNumber: '100341', productName: 'سنگ نمونه' } }],
        pricedAllocationEvents: [{ allocationRevisionLineId: 'item', netAmount: '300' }],
      } } } });
    }
    return route.fallback();
  });
  await page.route('**/api/accounting/loadings/*/sales-invoices', route => route.fulfill({
    json: { success: true, data: { invoices: [], canIssue: false } },
  }));
  await page.goto('/dashboard/accounting/dispatch');
  const row = (n: number) => page.getByRole('row').filter({ has: page.getByText(`راننده نمونه ${n}`, { exact: true }) });
  await expect(row(0)).toBeVisible();
  expect(lists).toBe(1);
  expect(details).toEqual([]);
  const open = (n: number) => row(n).getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await open(0);
  await expect(page.getByText('جزئیات قیمت این پرونده در دسترس نیست', { exact: false })).toBeVisible();
  expect(details).toEqual(['case-0']);
  await page.keyboard.press('Escape');
  await open(1);
  await expect(page.getByText('سنگ نمونه', { exact: false })).toBeVisible();
  expect(details).toEqual(['case-0', 'case-1']);
  expect(lists).toBe(1);
});
