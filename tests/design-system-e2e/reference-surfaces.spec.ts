import { expect, test, type Page } from '@playwright/test';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.getByRole('textbox', { name: 'رمز عبور خود را وارد کنید' }).fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
};

const semanticColors = async (page: Page) =>
  page.locator('.sds-workspace').evaluate((element) => {
    const style = getComputedStyle(element);
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      foreground: style.color,
      primary: rootStyle.getPropertyValue('--sds-text-primary').trim(),
      panel: rootStyle.getPropertyValue('--sds-surface-panel').trim(),
      focus: rootStyle.getPropertyValue('--sds-focus-ring').trim()
    };
  });

test('Guard renders through the semantic interface in both themes and mobile width', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/security');

  const workspace = page.locator('main.sds-workspace');
  await expect(workspace).toHaveCount(1);
  await expect(workspace.getByRole('heading', { name: 'گارد', exact: true })).toBeVisible();

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  const light = await semanticColors(page);
  expect(light.primary).not.toBe('');
  expect(light.panel).not.toBe('');
  expect(light.focus).not.toBe('');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const dark = await semanticColors(page);
  expect(dark.primary).not.toBe(light.primary);
  expect(dark.panel).not.toBe(light.panel);

  await page.setViewportSize({ width: 390, height: 844 });
  const workspaceFits = await page.locator('main.sds-workspace').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(workspaceFits).toBe(true);
});

test('Product Selection restores into the shared interface without changing persisted meaning', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep: 4,
      wizardData: {
        contractKind: 'standard',
        contractDate: '1405/05/05',
        contractNumber: '',
        creatorSequenceNumber: null,
        customerId: '',
        customer: null,
        projectId: '',
        project: null,
        selectedProductTypeForAddition: null,
        products: [],
        serviceRows: [],
        deliveries: [],
        payment: {
          payments: [],
          currency: 'تومان',
          totalContractAmount: 0
        },
        discount: null,
        signature: null
      }
    }));
  });

  await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=4');
  await expect(page.getByRole('region', { name: 'کاتالوگ محصولات' })).toBeVisible();
  await expect(page.locator('.sds-workspace')).toHaveCount(1);
  await expect(page.locator('.sds-workspace-surface')).toHaveCount(3);

  const search = page.getByRole('searchbox', { name: 'جستجوی محصول' });
  await search.focus();
  const focusStyle = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor
    };
  });
  expect(focusStyle.outlineStyle).toBe('solid');
  expect(focusStyle.outlineColor).not.toBe('');

  await page.setViewportSize({ width: 390, height: 844 });
  const productStepFits = await page.locator('.sds-workspace').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(productStepFits).toBe(true);
});

test('Guard attendance and vehicle operations use canonical fields and responsive surfaces', async ({ page }) => {
  await login(page);

  await page.goto('/dashboard/security/attendance');
  const attendance = page.locator('main.sds-workspace');
  await expect(attendance.getByRole('heading', { name: 'حضور و غیاب', exact: true })).toBeVisible();
  const attendanceFields = await attendance.evaluate((element) => {
    const fields = Array.from(element.querySelectorAll('input:not([type="checkbox"]), select, textarea'));
    return {
      count: fields.length,
      canonical: fields.every((field) => field.classList.contains('sds-field'))
    };
  });
  expect(attendanceFields.count).toBeGreaterThan(0);
  expect(attendanceFields.canonical).toBe(true);
  const attendanceSearch = attendance.getByRole('textbox', { name: 'جستجو در حضور و غیاب' });
  await attendanceSearch.focus();
  await expect(attendanceSearch).toBeFocused();
  expect(await attendance.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');

  await page.setViewportSize({ width: 390, height: 844 });
  const attendanceFits = await attendance.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(attendanceFits).toBe(true);

  await page.goto('/dashboard/security/vehicles');
  const vehicles = page.locator('main.sds-workspace');
  await expect(vehicles.getByRole('heading', { name: 'تردد خودروها', exact: true })).toBeVisible();

  await vehicles.getByRole('button', { name: 'رانندگان و خودروها', exact: true }).click();
  await expect(vehicles.getByRole('heading', { name: 'ثبت راننده و خودرو', exact: true })).toBeVisible();
  const vehicleFields = await vehicles.evaluate((element) => {
    const fields = Array.from(element.querySelectorAll('input:not([type="checkbox"]), select, textarea'));
    return {
      count: fields.length,
      canonical: fields.every((field) => field.classList.contains('sds-field'))
    };
  });
  expect(vehicleFields.count).toBeGreaterThan(0);
  expect(vehicleFields.canonical).toBe(true);
  await expect(vehicles.getByRole('checkbox', { name: 'پلاک ویژه' })).toBeVisible();

  const vehiclesFit = await vehicles.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(vehiclesFit).toBe(true);
});
