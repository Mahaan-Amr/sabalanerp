import { test, expect } from '@playwright/test';
import { loginAsAdmin, setTheme, assertNoHorizontalOverflow } from './support/design-system';

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`Partner Sales list displays canonical lifecycle labels ${width}px ${theme}`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 900 });
    const states = [['NOTE', 'DRAFT', 'یادداشت'], ['DRAFT', 'PENDING_APPROVAL', 'پیش‌نویس'],
      ['CUSTOMER_SIGNED', 'APPROVED', 'امضا شده'], ['QUOTED', 'QUOTED', 'استعلام شده'], ['FINAL', 'SIGNED', 'قطعی']];
    await page.route('**/api/sales/contracts?**', async route => {
      const selected = new URL(route.request().url()).searchParams.get('status');
      const shown = states.filter(([, key]) => !selected || key === selected);
      const data = shown.map(([partnerCommercialStatus, storedStatus]) => ({ id: `status-${partnerCommercialStatus}`, contractNumber: `QA-${partnerCommercialStatus}`,
        title: 'Partner contract', titlePersian: `قرارداد ${partnerCommercialStatus}`, status: storedStatus === 'QUOTED' ? 'PENDING_APPROVAL' : storedStatus, commercialFlowVersion: 2, partnerCommercialStatus,
        totalAmount: '100000', currency: 'IRT', createdAt: '2026-10-03T00:00:00.000Z',
        customer: { id: 'qa', firstName: 'مشتری', lastName: 'آزمون' },
        createdByUser: { id: 'qa', firstName: 'فروشنده', lastName: 'همکار' },
        commercialActions: { canApproveSales: false, canSendConfirmation: false, canEdit: false, canRenew: false },
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, scope: 'PARTNER_CASES', data,
        pagination: { page: 1, limit: 20, total: data.length, pages: 1 } }) });
    });
    await page.goto('/dashboard/sales/contracts');
    await expect(page.getByText('عمومی: QA-NOTE', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'امضای قرارداد', exact: true })).toHaveCount(0);
    await setTheme(page, theme);
    const filter = page.getByRole('combobox', { name: 'وضعیت', exact: true });
    await filter.click();
    for (const [, , label] of states) await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: 'قدیمی' })).toHaveCount(0);
    await page.getByRole('option', { name: 'استعلام شده', exact: true }).click();
    await expect(page.getByText('عمومی: QA-QUOTED', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('عمومی: QA-NOTE', { exact: true })).toHaveCount(0);
    await expect(page.getByText('استعلام شده', { exact: true }).filter({ visible: true }).last()).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/list-status-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('live local Sales status filters project Partner states before pagination', async ({ page }) => {
  await loginAsAdmin(page);
  const allResponse = await page.request.get('/api/sales/contracts?limit=100&page=1');
  expect(allResponse.status()).toBe(200);
  const all = await allResponse.json();
  const codes: Record<string, string> = { NOTE: 'DRAFT', DRAFT: 'PENDING_APPROVAL', CUSTOMER_SIGNED: 'APPROVED', QUOTED: 'QUOTED', FINAL: 'SIGNED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED' };
  for (const [filter, expected] of [['DRAFT', 'NOTE'], ['PENDING_APPROVAL', 'DRAFT'], ['APPROVED', 'CUSTOMER_SIGNED'], ['QUOTED', 'QUOTED'], ['SIGNED', 'FINAL']]) {
    const response = await page.request.get(`/api/sales/contracts?status=${filter}&limit=1&page=1`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.success).toBe(true);
    for (const contract of result.data) {
      if (contract.partnerCommercialStatus) expect(contract.partnerCommercialStatus).toBe(expected);
      else { expect(filter).not.toBe('QUOTED'); expect(contract.status).toBe(filter); }
    }
    expect(result.data.length).toBeLessThanOrEqual(1);
    if (all.pagination.total <= 100) expect(result.pagination.total).toBe(all.data.filter((contract: { partnerCommercialStatus?: string; status: string }) => (codes[contract.partnerCommercialStatus || ''] || contract.status) === filter).length);
  }
});
