import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow } from './support/design-system';

for (const width of [1280, 390]) test(`ordinary editor stages cancellation and preserves it after a failed save at ${width}px`, async ({ page }, testInfo) => {
  const id = 'qa-atomic-cancellation';
  const project = { id: 'qa-project', customerId: 'qa-customer', address: 'آدرس آزمون', city: 'شیراز', isActive: true };
  const product = { rowId: 'qa-piece-row', productId: 'qa-piece', productType: 'prepared', preparedKind: 'readyPiece',
    preparedUnit: 'count', preparedQuantity: 1, quantity: 1, squareMeters: 0, unitPrice: 100, pricePerSquareMeter: 100,
    totalPrice: 100, originalTotalPrice: 100, stoneName: 'سنگ آزمون لغو', stoneCode: 'QA', currency: 'تومان',
    appliedSubServices: [], finishings: [], remainingStones: [], usedRemainingStones: [], cutDetails: [],
    length: 0, width: 0, lengthUnit: 'm', widthUnit: 'cm', isMandatory: false, mandatoryPercentage: 0,
    isCut: false, cutType: null, cuttingCost: 0, physicalCuttingCost: 0, totalSubServiceCost: 0, meta: { isLayer: false } };
  const contract = { id, contractNumber: 'QA-CANCEL', status: 'DRAFT', commercialFlowVersion: 1,
    commercialRevision: 1, commercialActions: { canEdit: true }, totalAmount: 100, currency: 'تومان',
    isInactive: false, accountingEditLocked: false, payments: [],
    contractData: { contractKind: 'standard', contractDate: '1405/07/16', contractNumber: 'QA-CANCEL',
      customerId: 'qa-customer', customer: { id: 'qa-customer', firstName: 'مشتری', lastName: 'آزمون',
        customerType: 'Individual', status: 'Active', projectAddresses: [project], phoneNumbers: [], isBlacklisted: false, isLocked: false },
      projectId: project.id, project, products: [product], serviceRows: [], discount: null,
      deliveries: [{ id: 'qa-delivery', deliveryDate: '1405/07/20', deliveryAddress: project.address,
        projectManagerName: 'مدیر پروژه آزمون', receiverName: 'تحویل‌گیرنده آزمون',
        products: [{ productIndex: 0, productId: product.productId, productRowId: product.rowId,
          rowType: 'product', quantity: 1, amount: 1, unit: 'count' }] }],
      payment: { payments: [{ id: 'qa-payment', method: 'CASH_CARD', amount: 100,
        paymentDate: '1405/07/20', status: 'WILL_BE_PAID' }], currency: 'تومان', totalContractAmount: 100 },
      signature: null },
  };
  let immediateCancellations = 0;
  const saves: any[] = [];
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/sales/contract-edit-sessions/**', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: route.request().url().endsWith('/acquire')
      ? { session: { leaseToken: 'qa-cancellation-lease' }, recovery: null } : {} }) }));
  await page.route(`**/sales/contracts/${id}/confirmation-status`, route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: { contractStatus: 'DRAFT', commercialFlowVersion: 1 } }) }));
  await page.route(`**/sales/contracts/${id}/cancel`, route => {
    immediateCancellations += 1;
    return route.fulfill({ status: 500, body: '{}' });
  });
  await page.route(`**/sales/contracts/${id}`, async route => {
    if (route.request().method() !== 'PUT') return route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ success: true, data: contract }) });
    saves.push(route.request().postDataJSON());
    if (saves.length === 1) return route.fulfill({ status: 422, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'ذخیره آزمایشی انجام نشد؛ دوباره تلاش کنید.' }) });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { ...contract, status: 'CANCELLED' } }) });
  });
  await page.goto(`/dashboard/sales/contracts/${id}/edit`);
  if (width < 768) await page.getByRole('button', { name: /انتخاب مرحله ویرایش/ }).click();
  await page.getByRole('button', { name: /تایید دیجیتال/ }).click();
  const cancel = page.getByRole('button', { name: 'لغو قرارداد', exact: true });
  await cancel.click();
  const pending = page.getByText('لغو قرارداد با «ذخیره تغییرات» ثبت می‌شود.', { exact: true });
  await expect(pending).toBeVisible();
  await expect(page.getByRole('button', { name: 'ارسال برای تایید', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'انصراف از لغو', exact: true }).click();
  await expect(pending).toBeHidden();
  await cancel.click();
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].cancelContract).toBe(true);
  expect(saves[0].contractData.signature.cancellationPending).toBeUndefined();
  expect(saves[0].contractData.products[0].rowId).toBe(product.rowId);
  await expect(page.getByText(/ذخیره آزمایشی انجام نشد/)).toBeVisible();
  await expect(pending).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('contract-recovery:v2:'))
    .some(key => JSON.parse(localStorage.getItem(key) || '{}').payload?.wizardData?.signature?.cancellationPending === true)
  )).toBe(true);
  expect(immediateCancellations).toBe(0);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`pending-cancellation-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sales/contracts/${id}$`));
  expect(saves).toHaveLength(2);
  expect(saves[1].cancelContract).toBe(true);
  expect(immediateCancellations).toBe(0);
});
