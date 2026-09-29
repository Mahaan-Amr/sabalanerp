import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, setTheme, setViewportAndZoom, assertNoHorizontalOverflow, assertNoSeriousAxeViolations } from './support/design-system';

const master = ['cut-types', 'stone-materials', 'cut-widths', 'thicknesses', 'mines', 'finish-types', 'colors'];
const catalogs = ['services', 'cutting-types', 'sub-services', 'stair-standard-lengths', 'layer-types', 'stone-finishings'];
const sample = { id: 'inventory-design-fixture', code: 'DS-01', name: 'Sample', namePersian: 'نمونه انبار', description: 'شرح نمونه', isActive: true, value: 40, unit: 'cm', images: [], pricePerMeter: 1000, pricePerSquareMeter: 2000, pricePerLayer: 3000, calculationBase: 'length', calculationUnit: 'squareMeter', label: 'طول نمونه' };

async function fixtures(page: Page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').filter(Boolean);
    const resource = parts.at(-1)!;
    if (route.request().method() !== 'GET') return route.continue();
    if ((master.includes(resource) && parts.includes('inventory')) || catalogs.includes(resource)) {
      return route.fulfill({ json: { success: true, data: [{ ...sample, namePersian: `نمونه ${resource}`, name: resource === 'layer-types' ? 'نوع لایه نمونه' : sample.name }] } });
    }
    if (catalogs.includes(parts.at(-2)!) && resource === sample.id) return route.fulfill({ json: { success: true, data: sample } });
    if (resource === 'products' || parts.at(-2) === 'products') {
      const product = { ...sample, namePersian: 'محصول نمونه', basePrice: 8500000, currency: 'IRR', isAvailable: true, stoneTypeNamePersian: 'تراورتن', mineNamePersian: 'عباس‌آباد', finishNamePersian: 'صیقلی', widthValue: 40, thicknessValue: 2, motherLengthValue: 2, preparedSalesUnit: 'count', volumetricSalesUnit: 'ton' };
      return route.fulfill({ json: { success: true, data: resource === 'products' ? [product] : product, pagination: { total: 1, pages: 1 } } });
    }
    return route.continue();
  });
}

test.beforeEach(async ({ page }) => { await loginAsAdmin(page); await fixtures(page); });

test('inventory entry points and catalog lists adapt to compact phones and both themes', async ({ page }, testInfo) => {
  for (const route of ['/dashboard/inventory', '/dashboard/inventory/master-data?section=thicknesses', '/dashboard/inventory/services', '/dashboard/sales/products', '/dashboard/inventory/duties']) {
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await setViewportAndZoom(page, { width: 320, height: 568 });
      await assertNoHorizontalOverflow(page);
    }
    await page.screenshot({ path: testInfo.outputPath(`${route.split('/').at(-1)?.split('?')[0]}-320-dark.png`), fullPage: true });
    for (const width of [768, 1440]) {
      await setViewportAndZoom(page, { width, height: 1000 });
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${route.split('/').at(-1)?.split('?')[0]}-1440-dark.png`), fullPage: true });
  }
});

for (const family of ['services', 'cutting-types', 'sub-services', 'stone-finishings']) {
  test(`${family} create and edit preserve the canonical fields at small sizes`, async ({ page }) => {
    for (const suffix of ['create', `edit/${sample.id}`]) {
      await page.goto(`/dashboard/inventory/services/${family}/${suffix}`);
      const form = page.locator('[data-inventory-master-data-kind]');
      await expect(form).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await setViewportAndZoom(page, { width: 320, height: 568 });
        await assertNoHorizontalOverflow(page);
      }
      await assertNoSeriousAxeViolations(page);
      await expect(form.getByRole('button', { name: /ایجاد|ذخیره|به‌روزرسانی/ })).toBeVisible();
    }
  });
}

test('master-data navigation selects the requested category and a pending edit cannot be dismissed', async ({ page }) => {
  let release!: () => void;
  let submitted: unknown;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/inventory/thicknesses/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    submitted = route.request().postDataJSON();
    await gate;
    await route.fulfill({ json: { success: true, data: sample } });
  });
  await page.goto('/dashboard/inventory/master-data?section=thicknesses');
  await setViewportAndZoom(page, { width: 320, height: 568 });
  await page.getByRole('button', { name: 'ویرایش', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ویرایش ضخامت' });
  await expect(dialog).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await dialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
  await expect(dialog.getByRole('button', { name: 'در حال ذخیره…' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(submitted).toMatchObject({ code: sample.code, namePersian: 'نمونه thicknesses', isActive: true, value: 40, unit: 'cm' });
  release();
  await expect(dialog).toBeHidden();
});

test('catalog actions use an accessible focused menu and inline layer validation keeps the draft', async ({ page }) => {
  await page.goto('/dashboard/inventory/services');
  await setViewportAndZoom(page, { width: 320, height: 568 });
  await page.getByRole('button', { name: /^نوع لایه/ }).click();
  await page.getByRole('button', { name: 'سایر عملیات' }).click();
  await expect(page.getByRole('dialog', { name: 'سایر عملیات' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'غیرفعال کردن', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'افزودن نوع لایه' }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن نوع لایه' });
  await dialog.getByRole('textbox', { name: 'نام نوع لایه' }).fill('لایه آزمایشی');
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('قیمت هر لایه را وارد کنید');
  await expect(dialog.getByRole('textbox', { name: 'نام نوع لایه' })).toHaveValue('لایه آزمایشی');
  await assertNoHorizontalOverflow(page);
});

test('product creation keeps all seven prerequisites while using the Sales step presentation', async ({ page }) => {
  await page.goto('/dashboard/sales/products/create');
  const progress = page.getByRole('navigation', { name: 'مراحل ایجاد محصول' });
  await expect(progress).toBeVisible();
  for (let index = 0; index < master.length; index++) {
    await setViewportAndZoom(page, { width: 320, height: 568 });
    await expect(progress).toContainText(`مرحله ${(index + 1).toLocaleString('fa-IR')} از ۷`);
    await page.getByRole('button', { name: new RegExp(`نمونه ${master[index]}`) }).click();
    await assertNoHorizontalOverflow(page);
    if (index < 6) await page.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'ایجاد محصول', exact: true })).toBeVisible();
  await setTheme(page, 'dark');
  await assertNoSeriousAxeViolations(page);
  await setViewportAndZoom(page, { width: 1440, height: 1000 });
  await expect(progress.locator('[aria-current="step"]')).toHaveCount(1);
  await assertNoHorizontalOverflow(page);
});

test('shared product detail and editing retain rial prices and sales units on compact phones', async ({ page }) => {
  await page.goto(`/dashboard/sales/products/${sample.id}`);
  await expect(page.getByRole('heading', { name: 'جزئیات محصول', exact: true })).toBeVisible();
  await setViewportAndZoom(page, { width: 320, height: 568 });
  await page.getByRole('button', { name: 'ویرایش', exact: true }).click();
  await expect(page.getByText('قیمت پایه (ریال)', { exact: true })).toBeVisible();
  await expect(page.getByText('واحد فروش محصول آماده', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) { await setTheme(page, theme); await assertNoHorizontalOverflow(page); }
  await assertNoSeriousAxeViolations(page);
});
