import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow } from './support/design-system';

test('an open correction editor blocks at its deadline and retains unsaved local recovery', async ({ page }, testInfo) => {

  await loginAsAdmin(page);
  const id = 'qa-expiry-open-form';
  const project = { id: 'qa-project', customerId: 'qa-customer', address: 'آدرس آزمون', city: 'شیراز', isActive: true };
  const product = { rowId: 'qa-piece-row', productId: 'qa-piece', productType: 'prepared', preparedKind: 'readyPiece',
    preparedUnit: 'count', preparedQuantity: 1, quantity: 1, squareMeters: 0, unitPrice: 100, pricePerSquareMeter: 100,
    totalPrice: 100, originalTotalPrice: 100, stoneName: 'سنگ آزمون لغو', stoneCode: 'QA', currency: 'تومان',
    appliedSubServices: [], finishings: [], remainingStones: [], usedRemainingStones: [], cutDetails: [],
    length: 0, width: 0, lengthUnit: 'm', widthUnit: 'cm', isMandatory: false, mandatoryPercentage: 0,
    isCut: false, cutType: null, cuttingCost: 0, physicalCuttingCost: 0, totalSubServiceCost: 0, meta: { isLayer: false } };
  const contract = { id, contractNumber: 'QA-CANCEL', status: 'DRAFT', commercialFlowVersion: 1,
    commercialRevision: 1, activeCorrectionRequest: { id: 'qa-correction', dueAt: new Date(Date.now() + 120_000).toISOString() }, commercialActions: { canEdit: true }, totalAmount: 100, currency: 'تومان',
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

  let saves = 0;
  await page.route('**/sales/contract-edit-sessions/**', route => route.fulfill({ json: { success: true,
    data: route.request().url().endsWith('/acquire') ? { session: { leaseToken: 'qa-expiry-lease' }, recovery: null } : {} } }));
  await page.route(`**/sales/contracts/${id}/confirmation-status`, route => route.fulfill({ json: {
    success: true, data: { contractStatus: 'DRAFT', commercialFlowVersion: 1 } } }));
  await page.route(`**/sales/contracts/${id}`, route => {
    if (route.request().method() === 'PUT') saves++;
    return route.fulfill({ json: { success: true, data: contract } });
  });
  await page.goto(`/dashboard/sales/contracts/${id}/edit`);
  await page.getByRole('button', { name: /تایید دیجیتال/ }).click();
  await page.getByRole('button', { name: 'لغو قرارداد', exact: true }).click();
  const localDraft = () => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('contract-recovery:v2:'))
    .some(key => JSON.parse(localStorage.getItem(key) || '{}').payload?.wizardData?.signature?.cancellationPending === true));
  await expect.poll(localDraft).toBe(true);
  await page.clock.setFixedTime(new Date(Date.now() + 121_000));
  await expect(page.getByText('مهلت اصلاح پایان یافته؛ درخواست به حسابداری ارجاع شد. تغییرات ذخیره‌نشده برای بازیابی حفظ شده است.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'مشاهده وظایف فروش' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ادامه ویرایش در اینجا' })).toHaveCount(0);
  const save = page.getByRole('button', { name: 'ذخیره تغییرات', exact: true });
  await expect(save.locator('xpath=ancestor::div[@inert]')).toHaveAttribute('aria-disabled', 'true');
  await save.evaluate(element => (element as HTMLButtonElement).click());
  await expect.poll(localDraft).toBe(true);
  expect(saves).toBe(0);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('expired-open-editor.png'), fullPage: true });
});
