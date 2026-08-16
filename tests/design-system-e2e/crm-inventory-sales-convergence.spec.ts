import { expect, test } from '@playwright/test';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  assertVisibleFocus,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
} from './support/design-system';

test.describe('CRM, Inventory, and Sales convergence journeys', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('CRM customer creation exposes canonical validation and dirty states', async ({ page }) => {
    await page.goto('/dashboard/crm/customers/create');
    await expect(page.getByRole('heading', { name: 'ایجاد مشتری جدید' })).toBeVisible();
    const next = page.getByRole('button', { name: 'بعدی' });
    await assertVisibleFocus(next);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'بعدی' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'نام الزامی است' })).toBeVisible();
    await page.getByRole('textbox', { name: 'نام', exact: true }).fill('مشتری آزمون');
    await expect(page.getByRole('status').filter({ hasText: 'اطلاعات واردشده تا زمان ثبت نهایی ذخیره نمی‌شوند' })).toBeVisible();

    await setViewportAndZoom(page, { width: 390, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await assertNoSeriousAxeViolations(page);
    }
    await assertMinimumTargetSize(page.locator('button, input:not([type="file"]), select, textarea, label:has(input[type="file"])'));
    await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
    await assertNoHorizontalOverflow(page);
  });

  test('CRM customer detail and edit preserve status meaning, dirty state, and pending save', async ({ page }) => {
    const customer = {
      id: 'customer-e2e', firstName: 'مینا', lastName: 'آزمایشی', customerType: 'Individual', status: 'Lead',
      isBlacklisted: false, isLocked: false,
      phoneNumbers: [{ id: 'phone-e2e', number: '09121234567', type: 'Mobile', isPrimary: true, isActive: true }],
      contacts: [], projectAddresses: [], contracts: [], leads: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ownerUser: null,
    };
    let releaseSave: (() => void) | undefined;
    await page.route('**/api/crm/customers/customer-e2e', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: customer }) });
      }
      if (route.request().method() === 'PUT') {
        await new Promise<void>((resolve) => { releaseSave = resolve; });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: customer }) });
      }
      return route.continue();
    });
    await page.route('**/api/crm/customers/customer-e2e/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });
    await page.goto('/dashboard/crm/customers/customer-e2e');
    await expect(page.getByRole('heading', { name: 'مینا آزمایشی' })).toBeVisible();
    await expect(page.locator('.sds-tone-warning').filter({ hasText: 'سرنخ' }).first()).toBeVisible();
    await assertNoSeriousAxeViolations(page);

    await page.goto('/dashboard/crm/customers/customer-e2e/edit');
    await expect(page.getByRole('heading', { name: 'ویرایش مشتری' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'تغییرات ذخیره‌نشده' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'نام', exact: true }).fill('مینای ویرایش‌شده');
    await expect(page.getByRole('status').filter({ hasText: 'تغییرات ذخیره‌نشده' })).toBeVisible();
    const save = page.getByRole('button', { name: /ذخیره تغییرات|در حال ذخیره/ }).first();
    await save.click();
    await expect(save).toBeDisabled();
    expect(releaseSave).toBeDefined();
    releaseSave?.();
    await expect(page).toHaveURL('/dashboard/crm/customers/customer-e2e');
  });

  const inventoryJourneys = [
    { path: 'services', endpoint: 'services', heading: 'ایجاد خدمت جدید', code: 'کد خدمت', name: 'نام فارسی خدمت', submit: 'ایجاد خدمت' },
    { path: 'cutting-types', endpoint: 'cutting-types', heading: 'ایجاد نوع ابزار جدید', code: 'کد نوع ابزار', name: 'نام فارسی نوع ابزار', submit: 'ایجاد نوع ابزار' },
    { path: 'stone-finishings', endpoint: 'stone-finishings', heading: 'ایجاد فرآوری سنگ', code: 'کد فرآوری سنگ', name: 'نام فارسی فرآوری سنگ', submit: 'ایجاد فرآوری سنگ' },
    { path: 'sub-services', endpoint: 'sub-services', heading: 'ایجاد ابزار جدید', code: 'کد ابزار', name: 'نام فارسی ابزار', submit: 'ایجاد ابزار' },
  ] as const;

  for (const [index, journey] of inventoryJourneys.entries()) {
    test(`Inventory ${journey.endpoint} creation is independently pending-safe and accessible`, async ({ page }) => {
      let releaseCreate: (() => void) | undefined;
      await page.route(`**/api/${journey.endpoint}`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await new Promise<void>((resolve) => { releaseCreate = resolve; });
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { id: `${journey.endpoint}-e2e` } }),
        });
      });
      await page.goto(`/dashboard/inventory/services/${journey.path}/create`);
      await expect(page.getByRole('heading', { name: journey.heading })).toBeVisible();
      if (journey.endpoint === 'stone-finishings') {
        await page.locator('[data-inventory-master-data-kind] button[type="submit"]').click();
        await expect(page.getByRole('alert').filter({ hasText: 'کد فرآوری سنگ الزامی است' })).toBeVisible();
      }
      const code = page.getByRole('textbox', { name: journey.code, exact: true });
      await assertVisibleFocus(code);
      await code.fill(`DS-${index + 1}`);
      await page.getByRole('textbox', { name: journey.name, exact: true }).fill(`نمونه ${index + 1}`);
      const submit = page.locator('[data-inventory-master-data-kind] button[type="submit"]');
      await expect(submit).toHaveText(journey.submit);
      await submit.click();
      await expect(submit).toBeDisabled();
      expect(releaseCreate).toBeDefined();

      await setViewportAndZoom(page, { width: 390, height: 844 });
      await setTheme(page, index % 2 === 0 ? 'light' : 'dark');
      await assertNoSeriousAxeViolations(page);
      await assertMinimumTargetSize(page.locator('button, input:not([type="file"]), select, textarea, label:has(input[type="file"])'));
      releaseCreate?.();
      await expect(page).toHaveURL(/\/dashboard\/inventory\/services$/);
      await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
      await assertNoHorizontalOverflow(page);
    });
  }

  test('Inventory list uses the same canonical status and actions for all four families', async ({ page }) => {
    const fixtures: Record<string, Record<string, unknown>> = {
      services: { id: 'service-e2e', code: 'S-1', name: 'Service', namePersian: 'خدمت نمونه', description: '', isActive: true },
      'cutting-types': { id: 'cut-e2e', code: 'C-1', name: 'Cut', namePersian: 'نوع ابزار نمونه', description: '', pricePerMeter: 1000, isActive: true },
      'sub-services': { id: 'tool-e2e', code: 'T-1', name: 'Tool', namePersian: 'ابزار نمونه', description: '', pricePerMeter: 1000, calculationBase: 'length', isActive: true },
      'stone-finishings': { id: 'finish-e2e', code: 'F-1', name: 'Finish', namePersian: 'فرآوری نمونه', description: '', pricePerSquareMeter: 1000, calculationBase: 'squareMeters', isActive: true },
    };
    await page.route('**/api/**', async (route) => {
      const resource = new URL(route.request().url()).pathname.split('/').at(-1) || '';
      if (resource in fixtures) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [fixtures[resource]] }) });
      }
      if (resource === 'stair-standard-lengths' || resource === 'layer-types') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      }
      return route.continue();
    });
    await page.goto('/dashboard/inventory/services');
    const tabs = [
      { label: 'خدمات', action: 'غیرفعال کردن خدمت' },
      { label: 'انواع ابزار', action: 'غیرفعال کردن نوع ابزار' },
      { label: 'ابزارها', action: 'غیرفعال کردن ابزار' },
      { label: 'فرآوری سنگ', action: 'غیرفعال کردن فرآوری' },
    ];
    for (const tab of tabs) {
      await page.getByRole('button', { name: new RegExp(tab.label) }).first().click();
      await expect(page.getByText('فعال', { exact: true }).last()).toBeVisible();
      await expect(page.getByRole('button', { name: tab.action })).toBeVisible();
    }
    await assertNoSeriousAxeViolations(page);
  });

  test('Sales product detail only becomes dirty after an edit and protects pending save', async ({ page }) => {
    const product = {
      id: 'product-e2e', code: 'P-E2E', name: 'Test stone', namePersian: 'سنگ آزمون',
      cuttingDimensionCode: 'CUT', cuttingDimensionName: 'Cut', cuttingDimensionNamePersian: 'برش',
      stoneTypeCode: 'TYPE', stoneTypeName: 'Type', stoneTypeNamePersian: 'طولی',
      widthCode: 'W', widthValue: 40, widthName: '40', motherLengthValue: 2,
      thicknessCode: 'T', thicknessValue: 2, thicknessName: '2',
      mineCode: 'M', mineName: 'Mine', mineNamePersian: 'معدن', finishCode: 'F', finishName: 'Finish', finishNamePersian: 'صیقلی',
      colorCode: 'C', colorName: 'White', colorNamePersian: 'سفید', qualityCode: 'Q', qualityName: 'Premium', qualityNamePersian: 'ممتاز',
      basePrice: 100000, currency: 'IRR', isAvailable: true, leadTime: 3, description: 'نمونه', images: [], isActive: true,
      availableInLongitudinalContracts: true, availableInStairContracts: true, availableInSlabContracts: true, availableInVolumetricContracts: true,
      deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    let releaseSave: (() => void) | undefined;
    await page.route('**/api/products/product-e2e', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: product }) });
      }
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: product }) });
    });
    await page.goto('/dashboard/sales/products/product-e2e');
    await page.getByRole('button', { name: 'ویرایش', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تغییرات این فرم' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'توضیحات' }).fill('توضیح ویرایش‌شده');
    await expect(page.getByRole('status').filter({ hasText: 'تغییرات این فرم' })).toBeVisible();
    const save = page.getByRole('button', { name: /ذخیره تغییرات|در حال ذخیره/ });
    await save.click();
    await expect(save).toBeDisabled();
    expect(releaseSave).toBeDefined();
    releaseSave?.();
    await expect(page.getByRole('status').filter({ hasText: 'محصول با موفقیت به‌روزرسانی شد' })).toBeVisible();
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoSeriousAxeViolations(page);
    await assertMinimumTargetSize(page.locator('button, input:not([type="file"]), select, textarea, label:has(input[type="file"])'));
  });

  test('CRM and Sales detail routes distinguish load errors from empty records', async ({ page }) => {
    await page.route('**/api/crm/customers/customer-error', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false }) });
    });
    await page.goto('/dashboard/crm/customers/customer-error');
    await expect(page.getByRole('alert').filter({ hasText: 'خطا در دریافت اطلاعات مشتری' })).toBeVisible();

    await page.route('**/api/products/product-error', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false }) });
    });
    await page.goto('/dashboard/sales/products/product-error');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'تلاش دوباره' })).toBeVisible();

    await page.route('**/api/products/product-empty', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
    });
    await page.goto('/dashboard/sales/products/product-empty');
    await expect(page.getByText('محصول یافت نشد')).toBeVisible();
  });

  test('Sales product creation exposes load failure without hiding the empty step', async ({ page }) => {
    await page.route('**/api/inventory/**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'fixture failure' }) });
    });
    await page.goto('/dashboard/sales/products/create');
    await expect(page.getByRole('heading', { name: 'ایجاد محصول سنگ' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'دریافت داده‌های پایه محصول ناموفق بود' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تلاش دوباره' })).toBeVisible();
    await expect(page.getByText('هیچ آیتمی موجود نیست')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
    await assertNoHorizontalOverflow(page);
  });

  test('Sales product creation completes all canonical steps and protects pending submit', async ({ page }) => {
    await page.route('**/api/inventory/**', async (route) => {
      const resource = new URL(route.request().url()).pathname.split('/').at(-1) || 'item';
      const isCutType = resource === 'cut-types';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ id: `${resource}-e2e`, code: resource.toUpperCase(), name: resource, namePersian: isCutType ? 'سنگ طولی نمونه' : 'نمونه پایه', value: 40, unit: 'cm' }],
        }),
      });
    });
    let releaseCreate: (() => void) | undefined;
    let submittedProduct: Record<string, unknown> | undefined;
    await page.route('**/api/products', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      submittedProduct = route.request().postDataJSON();
      await new Promise<void>((resolve) => { releaseCreate = resolve; });
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'created-product-e2e' } }) });
    });
    await page.goto('/dashboard/sales/products/create');
    for (let step = 1; step <= 7; step += 1) {
      const choice = page.locator('button[aria-pressed]').filter({ hasText: step === 1 ? 'سنگ طولی نمونه' : 'نمونه پایه' }).first();
      await expect(choice).toBeVisible();
      if (step === 1) {
        await assertVisibleFocus(choice);
        await page.keyboard.press('Enter');
      } else {
        await choice.click();
      }
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
      if (step < 7) await page.getByRole('button', { name: 'مرحله بعد' }).click();
    }
    await expect(page.getByRole('status').filter({ hasText: 'اطلاعات این محصول تا ثبت نهایی ذخیره نمی‌شوند' })).toBeVisible();
    const submit = page.getByRole('button', { name: /ایجاد محصول|در حال ایجاد/ });
    await submit.click();
    await expect(submit).toBeDisabled();
    expect(submittedProduct?.cuttingDimensionCode).toBe('CUT-TYPES');
    expect(releaseCreate).toBeDefined();
    releaseCreate?.();
    await expect(page.getByRole('dialog').filter({ hasText: 'محصول ایجاد شد' })).toBeVisible();
  });

  test('Contract template authoring tracks every branch and associates validation errors', async ({ page }) => {
    let releaseTemplate: (() => void) | undefined;
    await page.route('**/api/contract-templates', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise<void>((resolve) => { releaseTemplate = resolve; });
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'template-e2e' } }) });
    });
    await page.goto('/dashboard/contract-templates/create');
    const structureTab = page.getByRole('button', { name: 'ساختار' });
    await assertVisibleFocus(structureTab);
    await page.keyboard.press('Enter');
    await page.getByRole('checkbox', { name: 'سربرگ' }).check();
    await expect(page.getByRole('status').filter({ hasText: 'تغییرات قالب' })).toBeVisible();
    await page.getByRole('button', { name: 'ایجاد قالب' }).click();
    await page.getByRole('button', { name: 'اطلاعات پایه' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'نام قالب الزامی است' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'نام قالب (انگلیسی)', exact: true })).toHaveAttribute('aria-invalid', 'true');
    await setViewportAndZoom(page, { width: 390, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await assertNoSeriousAxeViolations(page);
    }
    await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
    await assertNoHorizontalOverflow(page);
    await page.getByRole('textbox', { name: 'نام قالب (انگلیسی)', exact: true }).fill('E2E template');
    await page.getByRole('textbox', { name: 'نام قالب (فارسی)', exact: true }).fill('قالب آزمون');
    await page.getByRole('button', { name: 'محتوای قالب' }).click();
    await page.getByRole('textbox', { name: 'محتوای HTML قالب', exact: true }).fill('<p>نمونه</p>');
    const submit = page.locator('form button[type="submit"]');
    await submit.click();
    await expect(submit).toBeDisabled();
    expect(releaseTemplate).toBeDefined();
    releaseTemplate?.();
    await expect(page).toHaveURL(/\/dashboard\/contract-templates$/);
  });
});
