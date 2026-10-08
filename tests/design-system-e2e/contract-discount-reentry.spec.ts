import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, setTheme } from './support/design-system';

for (const width of [1280, 390]) test(`discount correction requires explicit valid reentry at ${width}px`, async ({ page }, testInfo) => {
  const id = 'qa-discount-reentry';
  const project = { id: 'qa-project', customerId: 'qa-customer', address: 'آدرس آزمون', city: 'شیراز', isActive: true };
  const product = { rowId: 'qa-piece-row', productId: 'qa-piece', productType: 'prepared', preparedKind: 'readyPiece',
    preparedUnit: 'count', preparedQuantity: 1, quantity: 1, squareMeters: 0, unitPrice: 1000, pricePerSquareMeter: 1000,
    totalPrice: 1000, originalTotalPrice: 1000, stoneName: 'سنگ آزمون تخفیف', stoneCode: 'QA', currency: 'تومان',
    appliedSubServices: [], finishings: [], remainingStones: [], usedRemainingStones: [], cutDetails: [],
    length: 0, width: 0, lengthUnit: 'm', widthUnit: 'cm', isMandatory: false, mandatoryPercentage: 0,
    isCut: false, cutType: null, cuttingCost: 0, physicalCuttingCost: 0, totalSubServiceCost: 0, meta: { isLayer: false } };
  const contract = { id, contractNumber: 'QA-DISCOUNT', status: 'DRAFT', commercialFlowVersion: 1,
    commercialRevision: 1, commercialActions: { canEdit: true }, totalAmount: 990, currency: 'تومان',
    isInactive: false, accountingEditLocked: false, payments: [],
    contractData: { contractKind: 'standard', contractDate: '1405/07/16', contractNumber: 'QA-DISCOUNT',
      customerId: 'qa-customer', customer: { id: 'qa-customer', firstName: 'مشتری', lastName: 'آزمون',
        customerType: 'Individual', status: 'Active', projectAddresses: [project], phoneNumbers: [], isBlacklisted: false, isLocked: false },
      projectId: project.id, project, products: [product], serviceRows: [], discount: { enabled: true, inputMode: 'AMOUNT_TOMAN', entryMode: 'AMOUNT_TOMAN', amount: 10, percent: 0.909090909091, baseSubtotal: 1100, maxDiscountPercent: 3, currency: 'تومان' },
      deliveries: [{ id: 'qa-delivery', deliveryDate: '1405/07/20', deliveryAddress: project.address,
        projectManagerName: 'مدیر پروژه آزمون', receiverName: 'تحویل‌گیرنده آزمون',
        products: [{ productIndex: 0, productId: product.productId, productRowId: product.rowId,
          rowType: 'product', quantity: 1, amount: 1, unit: 'count' }] }],
      payment: { payments: [{ id: 'qa-payment', method: 'CASH_CARD', amount: 990,
        paymentDate: '1405/07/20', status: 'WILL_BE_PAID' }], currency: 'تومان', totalContractAmount: 990 },
      signature: null },
  };
  const saves: any[] = [];
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  await setTheme(page, width === 390 ? 'dark' : 'light');
  await page.route('**/sales/discount-ranges**', route => route.fulfill({ json: { success: true, data: [
    { id: 'qa-discount-range', minAmount: 0, maxAmount: null, maxDiscountPercent: 3, isActive: true }
  ] } }));
  await page.route('**/sales/contract-edit-sessions/**', route => route.fulfill({ json: { success: true,
    data: route.request().url().endsWith('/acquire') ? { session: { leaseToken: 'qa-discount-lease' }, recovery: null } : {} } }));
  await page.route(`**/sales/contracts/${id}/confirmation-status`, route => route.fulfill({ json: {
    success: true, data: { contractStatus: 'DRAFT', commercialFlowVersion: 1 } } }));
  await page.route(`**/sales/contracts/${id}`, async route => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: { success: true, data: contract } });
    saves.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { success: false, error: 'پایان آزمون ذخیره تخفیف' } });
  });
  await page.goto(`/dashboard/sales/contracts/${id}/edit`);
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  const stale = page.getByText(/مبلغ اقلام مشمول تخفیف تغییر کرده است/);
  await expect(stale).toBeVisible();
  expect(saves).toHaveLength(0);
  await page.getByRole('button', { name: 'درصد', exact: true }).click();
  await expect(stale).toBeVisible();
  const percent = page.getByRole('textbox', { name: 'درصد تخفیف', exact: true });
  await percent.click();
  await expect(percent).toBeFocused();
  await expect(percent).toHaveValue('0.91');
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(stale).toBeVisible();
  expect(saves).toHaveLength(0);
  await percent.click();
  await percent.fill('4');
  await expect(percent).toHaveValue('4');
  await expect(page.getByText(/تخفیف واردشده بیشتر از سقف مجاز است/)).toBeVisible();
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  expect(saves).toHaveLength(0);
  await page.getByRole('button', { name: 'تومان', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'مبلغ تخفیف (تومان)', exact: true });
  await expect(input).toHaveValue('40');
  await input.fill('40');
  await expect(input).toHaveValue('40');
  await expect(page.getByText(/تخفیف واردشده بیشتر از سقف مجاز است/)).toBeVisible();
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  expect(saves).toHaveLength(0);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`discount-error-${width}.png`), fullPage: true });
  await input.fill('10');
  await expect(stale).toHaveCount(0);
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].contractData.discount.amount).toBe(10);
  expect(saves[0].contractData.discount.baseSubtotal).toBe(1000);
  expect(saves[0].contractData.discount.percent).toBe(1);
});
