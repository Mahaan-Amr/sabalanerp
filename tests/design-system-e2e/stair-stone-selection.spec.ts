import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow } from './support/design-system';

const stones = ['گوهره', 'تراورتن'].map((namePersian, index) => ({
  id: `qa-stair-selection-${index}`, code: `QA-STAIR-${index}`, name: namePersian, namePersian,
  currency: 'تومان', isAvailable: true, cuttingDimensionNamePersian: 'طولی',
  stoneTypeNamePersian: 'مرمریت', widthValue: 40, thicknessValue: 2,
  widthName: '40', thicknessName: '2', mineNamePersian: namePersian,
  finishNamePersian: 'صیقل', colorNamePersian: '', qualityNamePersian: '',
  availableInStairContracts: true, availableInLongitudinalContracts: true
}));

for (const width of [1280, 390]) {
  test(`stair selection persists across tabs and staging without rewriting summary at ${width}px`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/products?**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: stones })
    }));
    await page.evaluate(() => localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep: 4, wizardData: {
        contractKind: 'standard', contractDate: '1405/07/15', contractNumber: '',
        customerId: '', customer: null, projectId: '', project: null,
        selectedProductTypeForAddition: null, products: [], serviceRows: [], deliveries: [],
        payment: { payments: [], currency: 'تومان', totalContractAmount: 0 }, discount: null, signature: null
      }
    })));
    await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=4');
    await page.getByRole('tab', { name: 'پله', exact: true }).click();
    await page.getByRole('option', { name: /گوهره/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'تنظیمات محصول', exact: true });
    const parts = dialog.getByRole('radiogroup', { name: 'انتخاب بخش پله', exact: true });
    const title = dialog.getByLabel('عنوان محصول', { exact: true });
    const stone = dialog.locator('input[name="stone"]');
    for (const name of ['کف پله', 'خیز', 'پاگرد']) {
      await parts.getByRole('radio', { name, exact: true }).click();
      await expect(title).toHaveValue(/گوهره/);
      await expect(stone).toHaveValue(/گوهره/);
    }
    await parts.getByRole('radio', { name: 'کف پله', exact: true }).click();
    await dialog.locator('input[name="length"]').fill('1.35');
    await dialog.locator('input[name="width"]').fill('40');
    await dialog.locator('input[name="quantity"]').fill('2');
    await dialog.locator('input[name="pricePerSquareMeter"]').fill('1000000');
    await dialog.getByRole('button', { name: 'افزودن این بخش', exact: true }).click();
    await expect(dialog.locator('table tbody tr:has(td:nth-child(3))')).toHaveCount(1);
    const summary = await dialog.locator('table').innerText();
    await expect(stone).toHaveValue(/گوهره/);
    await expect(title).toHaveValue(/گوهره/);
    await expect(dialog.locator('input[name="length"]')).toHaveValue('');
    await expect(dialog.locator('input[name="pricePerSquareMeter"]')).toHaveValue('');
    await parts.getByRole('radio', { name: 'خیز', exact: true }).click();
    await dialog.locator('input[name="length"]').fill('1.2');
    await dialog.locator('input[name="pricePerSquareMeter"]').fill('900000');
    await stone.fill('تراورتن');
    await dialog.getByRole('button', { name: /تراورتن/ }).click();
    for (const name of ['خیز', 'کف پله', 'پاگرد']) {
      await parts.getByRole('radio', { name, exact: true }).click();
      await expect(stone).toHaveValue(/تراورتن/);
      await expect(title).toHaveValue(/تراورتن/);
      await expect(dialog.locator('input[name="length"]')).toHaveValue('');
      await expect(dialog.locator('input[name="pricePerSquareMeter"]')).toHaveValue('');
    }
    expect(await dialog.locator('table').innerText()).toBe(summary);
    await assertNoHorizontalOverflow(page);
    await dialog.getByRole('button', { name: 'اتمام و افزودن به قرارداد', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-contract-row-id]')).toHaveCount(1);
    await expect(page.locator('[data-contract-row-id]')).toContainText('گوهره');
  });
}
