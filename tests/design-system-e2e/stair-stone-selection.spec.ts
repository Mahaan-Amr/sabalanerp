import { scopeContractNavigationFixture } from './support/contract-navigation-fixture';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, seedContractNavigation, assertNoHorizontalOverflow } from './support/design-system';

const stones = ['گوهره', 'تراورتن'].map((namePersian, index) => ({
  id: `qa-stair-selection-${index}`, code: `QA-STAIR-${index}`, name: namePersian, namePersian,
  currency: 'تومان', isAvailable: true, cuttingDimensionNamePersian: 'طولی',
  stoneTypeNamePersian: 'مرمریت', widthValue: 40, thicknessValue: 2,
  widthName: '40', thicknessName: '2', mineNamePersian: namePersian,
  finishNamePersian: 'صیقل', colorNamePersian: '', qualityNamePersian: '',
  availableInStairContracts: true, availableInLongitudinalContracts: true
}));

async function openStairConfiguration(page: Page) {
  await seedContractNavigation(page, {
    currentStep: 4, wizardData: {
      contractKind: 'standard', contractDate: '1405/07/15', contractNumber: '',
      customerId: '', customer: null, projectId: '', project: null,
      selectedProductTypeForAddition: null, products: [], serviceRows: [], deliveries: [],
      payment: { payments: [], currency: 'تومان', totalContractAmount: 0 }, discount: null, signature: null
    }
  });
  await scopeContractNavigationFixture(page);
  await page.goto('/dashboard/sales/contracts/create?fresh=1&returnTo=contract&step=4');
  await page.getByRole('tab', { name: 'پله', exact: true }).click();
  await page.getByRole('option', { name: /گوهره/ }).first().click();
  return page.getByRole('dialog', { name: 'تنظیمات محصول', exact: true });
}

for (const width of [1280, 390]) {
  test(`stair selection persists across tabs and staging without rewriting summary at ${width}px`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.route('**/api/sales/contract-edit-sessions/**', route => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/acquire') ? { session: { leaseToken: 'qa-stair-selection' }, recovery: null } : null;
      return route.fulfill({ json: { success: true, data } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/products?**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: stones })
    }));
    const dialog = await openStairConfiguration(page);
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

test('both stone selectors offer the same eligible catalog results in the same order', async ({ page }) => {
  await loginAsAdmin(page);
  const direct = { ...stones[0], id: 'qa-catalog-direct', fullName: 'سنگ آزمون پله' };
  const fallback = {
    ...stones[1], id: 'qa-catalog-fallback', code: 'QA-CATALOG-FALLBACK',
    fullName: 'سنگ آزمون طولی', availableInStairContracts: false
  };
  const excluded = {
    ...fallback, id: 'qa-catalog-excluded', fullName: 'سنگ آزمون اسلب',
    cuttingDimensionNamePersian: 'اسلب'
  };
  await page.route('**/api/products?**', route => {
    const query = new URL(route.request().url()).searchParams;
    const products = query.get('search') === 'سنگ آزمون'
      ? query.get('contractType') === 'stair' ? [direct] : [direct, fallback, excluded]
      : stones;
    return route.fulfill({ json: { success: true, data: products } });
  });

  const dialog = await openStairConfiguration(page);
  const primary = dialog.locator('input[name="stone"]');
  const candidates = dialog.getByRole('button', { name: /^سنگ آزمون/ });
  await primary.fill('سنگ آزمون');
  await expect(candidates).toHaveText(['سنگ آزمون پله', 'سنگ آزمون طولی']);
  await primary.fill('');

  const layerCount = dialog.locator('label').filter({ hasText: 'تعداد لایه برای هر پله' })
    .locator('..').locator('input');
  await layerCount.fill('1');
  await dialog.getByRole('radiogroup', { name: 'منبع سنگ لایه' })
    .getByRole('radio', { name: 'سنگ جدید', exact: true }).click();
  await dialog.locator('input[name="layerStone"]').fill('سنگ آزمون');
  await expect(candidates).toHaveText(['سنگ آزمون پله', 'سنگ آزمون طولی']);
  await dialog.getByRole('button', { name: 'سنگ آزمون طولی', exact: true }).click();
  await expect(dialog.getByText('کد: QA-CATALOG-FALLBACK')).toBeVisible();
  await expect(dialog.locator('input[name="layerStone"]')).toHaveCount(0);
});
