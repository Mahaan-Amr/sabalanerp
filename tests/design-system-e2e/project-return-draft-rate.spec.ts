import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Accounting prices healthy allocated linear stone by square meter at 390px', async ({ page }) => {
  const caseId = 'project-return-516';
  const date = '2026-11-25T08:00:00.000Z';
  const projectId = 'project-516';
  const versionId = 'version-516';
  const item = {
    id: 'item-516', productId: 'product-516', productName: 'سنگ طولی', productCode: 'RETURN-516',
    unit: 'meter', healthyQuantity: '15', damagedQuantity: '2', effectiveWidthMeters: '0.4',
    healthyAreaSquareMeters: '6', damagedAreaSquareMeters: '0.8',
  };
  const firstSource = { originalInvoiceId: 'invoice-1', originalLineId: 'line-1', dispatchEvidenceId: 'dispatch-1' };
  const secondSource = { originalInvoiceId: 'invoice-1', originalLineId: 'line-1', dispatchEvidenceId: 'dispatch-2' };
  const source = (number: string, row: typeof firstSource) => ({
    ...row, originalInvoiceNumber: 'SALE-' + number, contractNumber: 'CONTRACT-' + number,
    projectId, deliveredAt: date, originalNetRateRials: '10000000',
    remainingQuantity: '9', draftRemainingQuantity: '4', lineRemainingQuantity: '13.5', dispatchRemainingQuantity: '9',
  });
  const rows = [
    { ...source('1', firstSource), quantity: '5' },
    { ...source('2', secondSource), quantity: '8.5' },
  ];
  let saved = false;
  await page.route('**/api/accounting/project-returns/' + caseId + '**', route => {
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON()).toMatchObject({
        expectedVersionId: versionId, expectedDraftNumber: 1,
        items: [{
          itemId: item.id, agreedUnitRateRials: '24000000', agreedRateBasis: 'HEALTHY_SQUARE_METER',
          rows: [{ ...firstSource, quantity: '5' }, { ...secondSource, quantity: '8.5' }],
        }],
      });
      saved = true;
    }
    return route.fulfill({ json: { success: true, data: {
      receipt: {
        id: caseId, customerName: 'مشتری آزمون مرجوعی', operationStatus: 'ACTIVE', createdAt: date,
        version: { id: versionId, submittedAt: date, projects: [{ projectId, projectName: 'پروژه سپید' }], items: [item] },
      },
      items: [{
        ...item, candidates: [source('1', firstSource), source('2', secondSource)], rows,
        agreedUnitRateRials: saved ? '24000000' : null, agreedRateBasis: saved ? 'HEALTHY_SQUARE_METER' : null,
        draftAmountRials: saved ? '129600000' : null, legacyRateNeedsReview: !saved,
        allocatedQuantity: '13.5', unallocatedQuantity: '1.5',
      }],
      prior: null, draft: { number: saved ? 2 : 1, createdAt: date }, canAllocate: true, allocationStatus: 'DRAFT',
      correctionBlocks: [], postingBlock: saved
        ? { code: 'FINANCE_CONNECTION_UNAVAILABLE', message: 'اتصال ثبت مالی مرجوعی پروژه هنوز فعال نیست.' }
        : { code: 'RATE_REQUIRED', message: 'نرخ توافقی هر محصول تخصیص‌یافته را وارد کنید.' },
    } } });
  });

  await loginAsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/accounting/returns/project/' + caseId);
  const rate = page.getByRole('textbox', { name: 'نرخ توافقی هر مترمربع سالم (ریال)', exact: true });
  await expect(rate).toHaveValue('');
  await expect(page.getByText(/نرخ قبلی بر مبنای متر طول/)).toBeVisible();
  await rate.fill('۲۴۰۰۰۰۰۰');
  await expect(page.getByText('۱۲۹٬۶۰۰٬۰۰۰ ریال', { exact: true })).toBeVisible();
  const secondQuantity = page.getByRole('textbox', { name: /مقدار تخصیص.*SALE-2/ });
  await secondQuantity.fill('۹٫۵');
  await expect(page.getByText('۱۳۹٬۲۰۰٬۰۰۰ ریال', { exact: true })).toHaveCount(0);
  await secondQuantity.fill('۹');
  await expect(page.getByText('۱۳۴٬۴۰۰٬۰۰۰ ریال', { exact: true })).toHaveCount(0);
  await secondQuantity.fill('۷٫۵');
  await expect(page.getByText('۱۲۰٬۰۰۰٬۰۰۰ ریال', { exact: true })).toBeVisible();
  await secondQuantity.fill('۸٫۵');
  await page.getByRole('button', { name: 'ذخیره پیش‌نویس', exact: true }).click();
  await expect(page.getByText('پیش‌نویس تخصیص ذخیره شد.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('۱۲۹٬۶۰۰٬۰۰۰ ریال', { exact: true })).toBeVisible();
  await expect(page.getByText('اتصال ثبت مالی مرجوعی پروژه هنوز فعال نیست.')).toBeVisible();
});
