import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const product = ({
  rowId,
  parentProductRowId,
  stoneName,
  inventory = []
}: {
  rowId: string;
  parentProductRowId?: string;
  stoneName: string;
  inventory?: Array<Record<string, unknown>>;
}) => ({
  rowId,
  parentProductRowId,
  productId: `catalog-${rowId}`,
  product: {},
  productType: 'stair',
  stoneCode: rowId,
  stoneName,
  diameterOrWidth: 40,
  length: 5,
  width: 40,
  quantity: 50,
  squareMeters: 100,
  pricePerSquareMeter: parentProductRowId ? 0 : 100_000,
  totalPrice: parentProductRowId ? 0 : 10_000_000,
  originalTotalPrice: parentProductRowId ? 0 : 10_000_000,
  description: '',
  currency: 'تومان',
  lengthUnit: 'm',
  widthUnit: 'cm',
  isMandatory: false,
  mandatoryPercentage: 0,
  isCut: false,
  cutType: null,
  originalWidth: 40,
  originalLength: 5,
  cuttingCost: 0,
  cuttingCostPerMeter: 0,
  cutDescription: '',
  remainingStoneSourceInventory: inventory.length ? inventory : undefined,
  remainingStones: inventory,
  cutDetails: [],
  usedRemainingStones: [],
  totalUsedRemainingWidth: 0,
  totalUsedRemainingLength: 0,
  appliedSubServices: [],
  totalSubServiceCost: 0,
  usedLengthForSubServices: 0,
  usedSquareMetersForSubServices: 0,
  remainingStoneAllocationOrder: parentProductRowId ? 0 : undefined,
  meta: parentProductRowId
    ? {
        remainingSource: {
          sourceProductRowId: parentProductRowId,
          allocationId: 'live-allocation',
          allocationOrder: 0,
          allocatedQuantity: 50
        }
      }
    : undefined
});

test('Sales reports an invalid remaining-stone length while the user is editing', async ({ page }) => {
  await loginAsAdmin(page);
  const inventory = [{
    id: 'five-meter-stock',
    width: 40,
    length: 5,
    quantity: 50,
    squareMeters: 100,
    isAvailable: true,
    sourceCutId: 'five-meter-cut'
  }];
  await page.evaluate(({ source, child }) => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep: 4,
      wizardData: {
        contractKind: 'standard',
        contractDate: '1405/06/22',
        contractNumber: '',
        creatorSequenceNumber: null,
        customerId: '',
        customer: null,
        projectId: '',
        project: null,
        selectedProductTypeForAddition: null,
        products: [source, child],
        serviceRows: [],
        deliveries: [],
        payment: { payments: [], currency: 'تومان', totalContractAmount: 0 },
        discount: null,
        signature: null
      }
    }));
  }, {
    source: product({ rowId: 'live-source-row', stoneName: 'سنگ مادر پنج‌متری', inventory }),
    child: product({
      rowId: 'live-child-row',
      parentProductRowId: 'live-source-row',
      stoneName: 'محصول باقی‌مانده'
    })
  });

  await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=4');
  const childRow = page.locator('[data-contract-row-id="live-child-row"]');
  await expect(childRow).toBeVisible();
  await childRow.getByRole('button', { name: 'ویرایش', exact: true }).click();

  const dialog = page.getByRole('dialog');
  const length = dialog.locator('#longitudinal-length');
  await expect(length).toHaveValue('5');
  await length.fill('5.001');

  const message = 'طول واردشده از ظرفیت سنگ باقی‌مانده بیشتر است؛ طول را کاهش دهید.';
  await expect(length).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();

  await length.fill('5');
  await expect(dialog.getByText(message, { exact: true })).toBeHidden();
  const invalidEntries = [
    { field: dialog.locator('#longitudinal-width'), value: '40..1', message: 'عدد معتبر وارد کنید' },
    { field: dialog.locator('#longitudinal-quantity'), value: '50.5', message: 'تعداد صحیح وارد کنید' },
    { field: dialog.locator('#longitudinal-area'), value: '100..1', message: 'عدد معتبر وارد کنید' }
  ];
  for (const invalid of invalidEntries) {
    const previousValue = await invalid.field.inputValue();
    await invalid.field.fill(invalid.value);
    await expect(invalid.field).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByText(invalid.message, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
    await expect(dialog).toBeVisible();
    await invalid.field.fill(previousValue);
    await expect(invalid.field).toHaveAttribute('aria-invalid', 'false');
  }
});
