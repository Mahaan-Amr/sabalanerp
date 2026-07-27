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
  await page.getByRole('button', { name: 'بازکردن منوی اصلی' }).click();
  await expect(page.locator('[data-dashboard-overlay]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'بستن منوی اصلی' }).last()).toBeVisible();
  await expect(page.locator('button[aria-haspopup="listbox"]')).toBeVisible();
  await page.getByRole('button', { name: 'بستن منوی اصلی' }).last().click();
  await expect(page.locator('[data-dashboard-overlay]')).toHaveCount(0);
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
        products: [
          {
            rowId: 'source-row',
            productId: 'catalog-source',
            product: {},
            productType: 'longitudinal',
            stoneCode: 'S-01',
            stoneName: 'سنگ مادر',
            diameterOrWidth: 40,
            length: 2,
            width: 40,
            quantity: 1,
            squareMeters: 0.8,
            pricePerSquareMeter: 100000,
            totalPrice: 80000,
            description: '',
            currency: 'تومان',
            lengthUnit: 'm',
            widthUnit: 'cm',
            isMandatory: false,
            mandatoryPercentage: 25,
            originalTotalPrice: 80000,
            isCut: false,
            cutType: null,
            originalWidth: 40,
            originalLength: 2,
            cuttingCost: 0,
            cuttingCostPerMeter: 0,
            cutDescription: '',
            remainingStones: [],
            cutDetails: [],
            usedRemainingStones: [],
            totalUsedRemainingWidth: 0,
            totalUsedRemainingLength: 0,
            appliedSubServices: [],
            totalSubServiceCost: 0,
            usedLengthForSubServices: 0,
            usedSquareMetersForSubServices: 0
          },
          {
            rowId: 'child-row',
            parentProductRowId: 'source-row',
            productId: 'catalog-child',
            product: {},
            productType: 'longitudinal',
            stoneCode: 'S-01-R',
            stoneName: 'باقی‌مانده سنگ مادر',
            diameterOrWidth: 20,
            length: 1,
            width: 20,
            quantity: 1,
            squareMeters: 0.2,
            pricePerSquareMeter: 100000,
            totalPrice: 20000,
            description: '',
            currency: 'تومان',
            lengthUnit: 'm',
            widthUnit: 'cm',
            isMandatory: false,
            mandatoryPercentage: 25,
            originalTotalPrice: 20000,
            isCut: false,
            cutType: null,
            originalWidth: 20,
            originalLength: 1,
            cuttingCost: 0,
            cuttingCostPerMeter: 0,
            cutDescription: '',
            remainingStones: [],
            cutDetails: [],
            usedRemainingStones: [],
            totalUsedRemainingWidth: 0,
            totalUsedRemainingLength: 0,
            appliedSubServices: [],
            totalSubServiceCost: 0,
            usedLengthForSubServices: 0,
            usedSquareMetersForSubServices: 0
          }
        ],
        serviceRows: [{
          id: 'service-row',
          sourceType: 'tool',
          sourceId: 'tool-1',
          title: 'خدمت مستقل',
          description: '',
          unit: 'meter',
          quantity: 2,
          unitPrice: 10000,
          totalPrice: 20000,
          currency: 'تومان',
          images: []
        }],
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
  await expect(page.locator('main.sds-workspace')).toHaveCount(1);
  expect(await page.locator('main.sds-workspace .sds-workspace-surface').count())
    .toBeGreaterThanOrEqual(3);
  await expect(page.locator('[data-contract-row-id="source-row"]')).toBeVisible();
  await expect(page.locator('[data-contract-row-id="child-row"]')).toBeVisible();
  await expect(page.getByText('خدمت مستقل', { exact: true })).toBeVisible();
  expect(await page.locator('[data-contract-row-id]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-contract-row-id'))
  )).toEqual(['source-row', 'child-row']);
  await expect(page.getByRole('button', { name: 'تکثیر', exact: true }).first()).toHaveClass(/sds-action/);

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
  const productStepFits = await page.locator('main.sds-workspace').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(productStepFits).toBe(true);
});

test('Contract Creation keeps early and consequential steps accessible and responsive', async ({ page }) => {
  await login(page);
  await page.evaluate(() => localStorage.removeItem('contractWizardState'));
  await page.goto('/dashboard/sales/contracts/create');

  const earlyWorkspace = page.locator('main.sds-workspace');
  await expect(earlyWorkspace).toBeVisible();
  await expect(earlyWorkspace.locator('nav[aria-label]')).toBeVisible();
  await expect(earlyWorkspace.locator('button[aria-current="step"]')).toHaveCount(1);
  expect(await earlyWorkspace.evaluate((element) =>
    Array.from(element.querySelectorAll('input:not([type="checkbox"]), select, textarea'))
      .every((field) => field.classList.contains('sds-field'))
  )).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await earlyWorkspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);

  await page.evaluate(() => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep: 7,
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
          currency: 'ØªÙˆÙ…Ø§Ù†',
          totalContractAmount: 0
        },
        discount: null,
        signature: null
      }
    }));
  });
  await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=7');

  const consequentialWorkspace = page.locator('main.sds-workspace');
  await expect(consequentialWorkspace.locator('button[aria-current="step"]')).toHaveCount(1);
  const consequentialFields = consequentialWorkspace.locator(
    'input:not([type="checkbox"]), select, textarea'
  );
  expect(await consequentialFields.count()).toBeGreaterThan(0);
  expect(await consequentialFields.evaluateAll((fields) =>
    fields.every((field) => field.classList.contains('sds-field'))
  )).toBe(true);
  expect(await consequentialWorkspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);
});

test('Contract submission preserves input across an invalid response and succeeds on retry', async ({ page }) => {
  let submissionAttempts = 0;
  await page.route('**/sales/contracts', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    submissionAttempts += 1;
    if (submissionAttempts === 1) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'E2E_VALIDATION_RETRY' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'e2e-contract',
          contractNumber: 'E2E-1001',
          creatorSequenceNumber: 1001,
          status: 'DRAFT'
        }
      })
    });
  });

  await login(page);
  await page.evaluate(() => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep: 8,
      wizardData: {
        contractKind: 'standard',
        contractDate: '1405/05/05',
        contractNumber: 'E2E-DRAFT',
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
  await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=8');

  const submit = page.getByRole('button', { name: 'ثبت قرارداد', exact: true });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await expect(page.getByText('E2E_VALIDATION_RETRY', { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page.getByRole('button', { name: 'اتمام و بازگشت به قراردادها', exact: true }))
    .toBeVisible();
  expect(submissionAttempts).toBe(2);
});

test('CRM registry and pipeline routes share focused responsive canonical surfaces', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const routes = [
    '/dashboard/crm',
    '/dashboard/crm/customers',
    '/dashboard/crm/customers/create',
    '/dashboard/crm/potential-projects',
    '/dashboard/crm/potential-projects/create',
    '/dashboard/crm/follow-ups',
    '/dashboard/crm/follow-ups/create'
  ];

  for (const route of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole('button', { name: 'راهنما', exact: true })).toHaveCount(0);
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
          || field.getAttribute('type') === 'range'
          || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
        ))
    )).toBe(true);
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
  }
});

test('Sales management routes share focused responsive canonical surfaces', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const routes = [
    '/dashboard/sales',
    '/dashboard/sales/contracts',
    '/dashboard/sales/products',
    '/dashboard/sales/products/create',
    '/dashboard/sales/reports',
    '/dashboard/contract-templates',
    '/dashboard/contract-templates/create'
  ];

  for (const route of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
          || field.getAttribute('type') === 'range'
          || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
        ))
    )).toBe(true);
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
  }
});

test('Inventory and Logistics routes share focused responsive canonical surfaces', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const routes = [
    '/dashboard/inventory',
    '/dashboard/inventory/master-data',
    '/dashboard/inventory/services',
    '/dashboard/inventory/services/cutting-types/create',
    '/dashboard/inventory/services/services/create',
    '/dashboard/inventory/services/stone-finishings/create',
    '/dashboard/inventory/services/sub-services/create',
    '/dashboard/logistics',
    '/dashboard/logistics/loadings',
    '/dashboard/logistics/loadings/new'
  ];

  for (const route of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
          || field.getAttribute('type') === 'range'
          || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
        ))
    )).toBe(true);
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
  }
});

test('Accounting routes share focused responsive canonical surfaces', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const routes = [
    '/dashboard/accounting',
    '/dashboard/accounting/contracts',
    '/dashboard/accounting/invoice-candidates',
    '/dashboard/accounting/receivables',
    '/dashboard/accounting/payments',
    '/dashboard/accounting/tax',
    '/dashboard/accounting/correction-requests',
    '/dashboard/accounting/audit',
    '/dashboard/accounting/performance',
    '/dashboard/accounting/settings'
  ];

  for (const route of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
          || field.getAttribute('type') === 'range'
          || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
        ))
    )).toBe(true);
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
  }
});

test('People and administration routes share focused responsive canonical surfaces', async ({ page }) => {
  test.setTimeout(210_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const routes = [
    '/dashboard/hr',
    '/dashboard/hr/hiring',
    '/dashboard/hr/hiring/authorities',
    '/dashboard/hr/hiring/collateral-templates',
    '/dashboard/hr/migration',
    '/dashboard/hr/personnel',
    '/dashboard/hr/structure',
    '/dashboard/users',
    '/dashboard/users/create',
    '/dashboard/departments',
    '/dashboard/departments/create',
    '/dashboard/admin/permissions',
    '/dashboard/admin/discount-settings',
    '/dashboard/admin/reports',
    '/dashboard/admin/sabalan-calendar',
    '/dashboard/admin/security',
    '/dashboard/admin/settings',
    '/apply'
  ];

  for (const route of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
          || field.getAttribute('type') === 'range'
          || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
        ))
    )).toBe(true);
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
  }
});

test('Guard attendance and vehicle operations use canonical fields and responsive surfaces', async ({ page }) => {
  await login(page);

  await page.goto('/dashboard/security/attendance');
  const attendance = page.locator('main.sds-workspace');
  await expect(attendance.getByRole('heading', { name: 'حضور و غیاب', exact: true })).toBeVisible();
  const attendanceSearch = attendance.getByRole('textbox', { name: 'جستجو در حضور و غیاب' });
  await expect(attendanceSearch).toBeVisible();
  const attendanceFields = await attendance.evaluate((element) => {
    const fields = Array.from(element.querySelectorAll('input:not([type="checkbox"]), select, textarea'));
    return {
      count: fields.length,
      canonical: fields.every((field) => (
        field.classList.contains('sds-field')
        || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
      ))
    };
  });
  expect(attendanceFields.count).toBeGreaterThan(0);
  expect(attendanceFields.canonical).toBe(true);
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
      canonical: fields.every((field) => (
        field.classList.contains('sds-field')
        || (field.getAttribute('type') === 'file' && field.classList.contains('sds-file-input'))
      ))
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

test('remaining Guard management routes share one responsive semantic frame', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  const routes = [
    ['/dashboard/security/exceptions', 'استثناها و مأموریت‌ها'],
    ['/dashboard/security/personnel', 'کارکنان گارد'],
    ['/dashboard/security/reports', 'گزارش‌ها'],
    ['/dashboard/security/settings', 'تنظیمات گارد'],
    ['/dashboard/security/settings/attendance-roster', 'فهرست حضور و غیاب'],
    ['/dashboard/security/settings/report-structure', 'ساختار گزارش شیفت'],
    ['/dashboard/security/shifts', 'شیفت‌ها'],
    ['/dashboard/security/supervisor-reports', 'گزارش شیفت']
  ] as const;

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, title] of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(await workspace.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input:not([type="checkbox"]), select, textarea'))
        .every((field) => field.classList.contains('sds-field'))
    )).toBe(true);
  }
});

test('Guard exception dialog uses canonical dropdown and calendar interactions', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/security/exceptions');

  const workspace = page.locator('main.sds-workspace');
  await workspace.getByRole('button', { name: 'ثبت مورد', exact: true }).click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByRole('heading', { name: 'نوع مورد جدید', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'استثنای حضور و غیاب', exact: true }).click();

  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('heading', { name: 'ثبت استثنا', exact: true })).toBeVisible();
  const comboboxes = editor.getByRole('combobox');
  expect(await comboboxes.count()).toBeGreaterThanOrEqual(2);
  await expect(comboboxes.nth(1)).toHaveClass(/sds-field/);
  await comboboxes.nth(1).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: 'مرخصی ساعتی', exact: true }).click();

  const dateTriggers = editor.locator('button[aria-haspopup="dialog"]');
  expect(await dateTriggers.count()).toBeGreaterThanOrEqual(2);
  await dateTriggers.first().click();
  const calendar = page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole('gridcell').first()).toHaveClass(/sds-action/);
});

test('public, identity, and confirmation routes share the responsive semantic foundation', async ({ page }) => {
  const routes = [
    '/',
    '/about',
    '/contact',
    '/login',
    '/register',
    '/change-password',
    '/contracts/confirm'
  ];

  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of routes) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
        ))
    )).toBe(true);
  }
});

test('dashboard overview, BI, and personal workflows use one responsive semantic frame', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of ['/dashboard', '/dashboard/bi', '/dashboard/personal']) {
    await page.goto(route);
    const workspace = page.locator('main.sds-workspace');
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
    expect(await workspace.evaluate((element) =>
      Array.from(element.querySelectorAll('input, select, textarea'))
        .every((field) => (
          field.getAttribute('type') === 'hidden'
          || field.classList.contains('sds-field')
          || field.getAttribute('type') === 'checkbox'
          || field.getAttribute('type') === 'radio'
          || field.getAttribute('type') === 'range'
        ))
    )).toBe(true);
  }
});
