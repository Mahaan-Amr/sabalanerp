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

test('Sales landing and the first contract step use the minimal shared workflow language', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/sales');

  await expect(page.getByRole('heading', { name: 'دسترسی سریع', exact: true })).toHaveCount(0);
  for (const description of [
    'لیست قراردادها، وضعیت امضا، چاپ و تایید',
    'شروع ثبت قرارداد با جریان موبایل‌فرست',
    'ثبت مشتری جدید و تکمیل اطلاعات CRM',
    'افزودن سنگ، ابعاد و قیمت پایه فروش',
    'مرور عملکرد و وضعیت قراردادهای فروش',
  ]) {
    await expect(page.getByText(description, { exact: true })).toHaveCount(0);
  }

  await page.evaluate(() => localStorage.removeItem('contractWizardState'));
  await page.goto('/dashboard/sales/contracts/create');

  const workflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(workflow).toBeVisible();
  await expect(workflow.getByText('شماره نهایی هنگام ثبت قرارداد در سرور قطعی می‌شود.')).toBeVisible();

  const progress = workflow.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' });
  await expect(progress.getByRole('button')).toHaveCount(7);
  const progressBox = await progress.boundingBox();
  const stepContentBox = await workflow.locator('.step-content-card').boundingBox();
  expect(progressBox).not.toBeNull();
  expect(stepContentBox).not.toBeNull();
  expect(stepContentBox!.y - (progressBox!.y + progressBox!.height)).toBeGreaterThanOrEqual(16);
  const firstStep = progress.getByRole('button', { name: 'تاریخ قرارداد' });
  const firstStepBox = await firstStep.boundingBox();
  const firstStepIconBox = await firstStep.locator('svg').boundingBox();
  expect(firstStepBox).not.toBeNull();
  expect(firstStepIconBox).not.toBeNull();
  expect(Math.abs(
    firstStepBox!.x + firstStepBox!.width / 2 -
      (firstStepIconBox!.x + firstStepIconBox!.width / 2),
  )).toBeLessThanOrEqual(1);
  expect(Math.abs(
    firstStepBox!.y + firstStepBox!.height / 2 -
      (firstStepIconBox!.y + firstStepIconBox!.height / 2),
  )).toBeLessThanOrEqual(1);

  const next = workflow.getByRole('button', { name: 'بعدی', exact: true });
  const previous = workflow.getByRole('button', { name: 'قبلی', exact: true });
  const nextBox = await next.boundingBox();
  const previousBox = await previous.boundingBox();
  expect(nextBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(nextBox!.x).toBeGreaterThan(previousBox!.x);

  const nextIconBox = await next.locator('svg').boundingBox();
  const nextLabelBox = await next.getByText('بعدی', { exact: true }).boundingBox();
  const previousIconBox = await previous.locator('svg').boundingBox();
  const previousLabelBox = await previous.getByText('قبلی', { exact: true }).boundingBox();
  expect(nextIconBox).not.toBeNull();
  expect(nextLabelBox).not.toBeNull();
  expect(previousIconBox).not.toBeNull();
  expect(previousLabelBox).not.toBeNull();
  expect(nextLabelBox!.x).toBeGreaterThan(nextIconBox!.x);
  expect(previousIconBox!.x).toBeGreaterThan(previousLabelBox!.x);
  expect(Math.abs(
    nextIconBox!.y + nextIconBox!.height / 2 -
      (nextLabelBox!.y + nextLabelBox!.height / 2),
  )).toBeLessThanOrEqual(2);
  expect(Math.abs(
    previousIconBox!.y + previousIconBox!.height / 2 -
      (previousLabelBox!.y + previousLabelBox!.height / 2),
  )).toBeLessThanOrEqual(2);

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  const light = await semanticColors(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const dark = await semanticColors(page);
  expect(dark.primary).not.toBe(light.primary);
  expect(dark.panel).not.toBe(light.panel);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFits = await workflow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(mobileFits).toBe(true);
  await expect(next).toBeVisible();
  await expect(previous).toBeVisible();

  await page.setViewportSize({ width: 780, height: 844 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await workflow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });

  await page.evaluate(() => localStorage.removeItem('contractWizardState'));
  await page.goto('/dashboard/sales/contracts/collaboration/create');
  const collaborationWorkflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(collaborationWorkflow).toBeVisible();
  await expect(collaborationWorkflow.getByRole('heading', { name: 'قرارداد همکاری در فروش', exact: true })).toBeVisible();

  await page.route('**/sales/contracts/e2e-edit', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'e2e-edit',
          status: 'DRAFT',
          contractNumber: 'E2E-EDIT',
          accountingEditLocked: false,
          canOpenCorrectionEdit: false,
          contractData: {
            contractKind: 'standard',
            contractDate: '1405/05/05',
            contractNumber: 'E2E-EDIT',
            creatorSequenceNumber: 1002,
            customerId: 'e2e-customer',
            customer: {
              id: 'e2e-customer',
              firstName: 'مشتری',
              lastName: 'آزمایشی',
              customerType: 'PERSON',
              status: 'ACTIVE',
              projectAddresses: [],
              phoneNumbers: [],
              isBlacklisted: false,
              isLocked: false
            },
            projectId: '',
            project: null,
            selectedProductTypeForAddition: null,
            products: [],
            serviceRows: [],
            deliveries: [],
            payment: { payments: [], currency: 'تومان', totalContractAmount: 0 },
            discount: null,
            signature: null
          },
          productGraphProjection: { revision: 0 }
        }
      })
    });
  });
  await page.goto('/dashboard/sales/contracts/e2e-edit/edit');
  const editWorkflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(editWorkflow.getByRole('heading', { name: 'ویرایش قرارداد', exact: true })).toBeVisible();
  const editProgress = editWorkflow.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' });
  await editProgress.getByRole('button', { name: 'انتخاب مشتری' }).click();
  const createCustomer = editWorkflow.getByRole('button', { name: 'ایجاد مشتری', exact: true }).first();
  const createCustomerIconBox = await createCustomer.locator('svg').boundingBox();
  const createCustomerLabelBox = await createCustomer.getByText('ایجاد مشتری', { exact: true }).boundingBox();
  const createCustomerStyle = await createCustomer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      paddingInlineStart: style.paddingInlineStart,
      paddingInlineEnd: style.paddingInlineEnd,
    };
  });
  expect(createCustomerIconBox).not.toBeNull();
  expect(createCustomerLabelBox).not.toBeNull();
  expect(Math.abs(
    createCustomerIconBox!.y + createCustomerIconBox!.height / 2 -
      (createCustomerLabelBox!.y + createCustomerLabelBox!.height / 2),
  )).toBeLessThanOrEqual(1);
  const customerNames = editWorkflow.locator('button h4');
  if (await customerNames.count()) {
    expect(await customerNames.evaluateAll((names) => names.every((name) => {
      const color = getComputedStyle(name).color;
      return color !== 'rgb(0, 0, 0)' && color !== 'rgba(0, 0, 0, 1)';
    }))).toBe(true);
  }
  await editProgress.getByRole('button', { name: 'مدیریت پروژه' }).click();
  const createProjectActions = editWorkflow.getByRole('button', { name: 'ایجاد پروژه', exact: true });
  expect(await createProjectActions.count()).toBeGreaterThan(0);
  const createProject = createProjectActions.first();
  await expect(createProject).toBeVisible();
  const createProjectIconBox = await createProject.locator('svg').boundingBox();
  const createProjectLabelBox = await createProject.getByText('ایجاد پروژه', { exact: true }).boundingBox();
  const createProjectStyle = await createProject.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      paddingInlineStart: style.paddingInlineStart,
      paddingInlineEnd: style.paddingInlineEnd,
    };
  });
  expect(createProjectStyle).toEqual(createCustomerStyle);
  expect(createProjectIconBox).not.toBeNull();
  expect(createProjectLabelBox).not.toBeNull();
  expect(Math.abs(
    createProjectIconBox!.y + createProjectIconBox!.height / 2 -
      (createProjectLabelBox!.y + createProjectLabelBox!.height / 2),
  )).toBeLessThanOrEqual(1);
  const completedStep = editProgress.getByRole('button', { name: 'تاریخ قرارداد' });
  const completedStepSurface = completedStep.locator('xpath=..');
  const completedBox = await completedStep.boundingBox();
  const completedCheckBox = await completedStep.locator('svg').boundingBox();
  expect(completedBox).not.toBeNull();
  expect(completedCheckBox).not.toBeNull();
  expect(Math.abs(
    completedBox!.x + completedBox!.width / 2 -
      (completedCheckBox!.x + completedCheckBox!.width / 2),
  )).toBeLessThanOrEqual(1);
  expect(Math.abs(
    completedBox!.y + completedBox!.height / 2 -
      (completedCheckBox!.y + completedCheckBox!.height / 2),
  )).toBeLessThanOrEqual(1);
  const connectorBox = await editProgress.locator('li').nth(1).locator('span[aria-hidden="true"]').boundingBox();
  expect(connectorBox).not.toBeNull();
  expect(Math.abs(
    completedBox!.y + completedBox!.height / 2 -
      (connectorBox!.y + connectorBox!.height / 2),
  )).toBeLessThanOrEqual(1);
  expect(await completedStepSurface.evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    const channels = color.match(/[\d.]+/g)?.map(Number) || [];
    return color !== 'transparent' && (channels.length < 4 || channels[3] >= 0.95);
  })).toBe(true);

  const layeredSteps = [
    editProgress.getByRole('button', { name: 'تاریخ قرارداد' }),
    editProgress.getByRole('button', { name: 'انتخاب مشتری' }),
    editProgress.getByRole('button', { name: 'مدیریت پروژه' }),
    editProgress.getByRole('button', { name: 'انتخاب محصولات' }),
  ];
  for (const step of layeredSteps) {
    const presentation = await step.locator('xpath=..').evaluate((surface) => {
      const button = surface.querySelector('button');
      if (!button) return null;
      const surfaceStyle = getComputedStyle(surface);
      const color = surfaceStyle.backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number) || [];
      const box = button.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return {
        opaque: color !== 'transparent' && (channels.length < 4 || channels[3] >= 0.95),
        receivesPointerAtConnectorCrossing: Boolean(topmost && button.contains(topmost)),
      };
    });
    expect(presentation).toEqual({
      opaque: true,
      receivesPointerAtConnectorCrossing: true,
    });
  }
});

test('Contract recovery presents takeover as the visible primary action', async ({ page }) => {
  await page.route('**/sales/contract-edit-sessions/*/acquire', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: {
          code: 'edit-session-owned-elsewhere',
          recovery: null,
        },
      }),
    });
  });
  await login(page);
  await page.evaluate(() => {
    localStorage.removeItem('contractWizardState');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sabalan-contract-active-draft:')) localStorage.removeItem(key);
    }
  });
  await page.goto('/dashboard/sales/contracts/create');

  const recovery = page.getByRole('status').filter({
    hasText: 'این قرارداد در محل دیگری در حال ویرایش است',
  });
  await expect(recovery).toBeVisible();
  const takeover = recovery.getByRole('button', { name: 'ادامه ویرایش در اینجا', exact: true });
  const fresh = recovery.getByRole('button', { name: 'ایجاد قرارداد جدید', exact: true });
  await expect(takeover).toBeVisible();
  await expect(fresh).toBeVisible();

  const styles = await Promise.all([takeover, fresh].map((action) => action.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      height: element.getBoundingClientRect().height,
    };
  })));
  expect(styles[0].height).toBeGreaterThanOrEqual(44);
  expect(styles[1].height).toBeGreaterThanOrEqual(44);
  expect(styles[0].background).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles[0].background).not.toBe('transparent');
  expect(styles[0].background).not.toBe(styles[1].background);
  expect(styles[1].border).not.toBe('rgba(0, 0, 0, 0)');
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

  const sourceRow = page.locator('[data-contract-row-id="source-row"]');
  await sourceRow.getByRole('button', { name: 'ویرایش', exact: true }).click();
  const productDialog = page.getByRole('dialog');
  await expect(productDialog).toBeVisible();
  const dimensionFields = [
    productDialog.locator('#longitudinal-length'),
    productDialog.locator('#longitudinal-width'),
    productDialog.locator('#longitudinal-quantity'),
    productDialog.locator('#longitudinal-area')
  ];
  const dimensionBoxes = await Promise.all(dimensionFields.map((field) => field.boundingBox()));
  expect(dimensionBoxes.every(Boolean)).toBe(true);
  const dimensionTops = dimensionBoxes.map((box) => box!.y);
  expect(Math.max(...dimensionTops) - Math.min(...dimensionTops)).toBeLessThanOrEqual(1);
  for (const unitLabel of ['واحد طول', 'واحد عرض']) {
    const unitControl = productDialog.getByRole('radiogroup', { name: unitLabel });
    const unitBox = await unitControl.boundingBox();
    expect(unitBox).not.toBeNull();
    expect(unitBox!.height).toBeGreaterThanOrEqual(44);
    expect(await unitControl.getByRole('radio').evaluateAll((radios) =>
      radios.every((radio) => Number.parseFloat(getComputedStyle(radio).minHeight) >= 44)
    )).toBe(true);
    expect(await unitControl.locator('button span').evaluateAll((labels) =>
      labels.every((label) => Number.parseFloat(getComputedStyle(label).height) <= 24)
    )).toBe(true);
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate((nextTheme) => document.documentElement.setAttribute('data-theme', nextTheme), theme);
    for (const switchLabel of ['حکمی', 'خوراک اره', 'برش کالیبر']) {
      const switchStyle = await productDialog.getByRole('switch', { name: switchLabel }).evaluate((element) => {
        const target = getComputedStyle(element);
        const track = getComputedStyle(element.querySelector<HTMLElement>('[data-switch-track]')!);
        const thumb = getComputedStyle(element.querySelector<HTMLElement>('[data-switch-thumb]')!);
        return {
          targetHeight: target.height,
          width: track.width,
          height: track.height,
          track: track.backgroundColor,
          border: track.borderColor,
          thumb: thumb.backgroundColor
        };
      });
      expect(Number.parseFloat(switchStyle.targetHeight)).toBeGreaterThanOrEqual(44);
      expect(switchStyle.width).toBe('51px');
      expect(switchStyle.height).toBe('31px');
      expect(switchStyle.track).not.toBe(switchStyle.thumb);
      expect(switchStyle.border).not.toBe('rgba(0, 0, 0, 0)');
    }
  }
  const behaviorSwitch = productDialog.getByRole('switch', { name: 'خوراک اره' });
  const initialSwitchState = await behaviorSwitch.getAttribute('aria-checked');
  const initialThumbTransform = await behaviorSwitch.locator('[data-switch-thumb]').evaluate((element) =>
    getComputedStyle(element).transform
  );
  await behaviorSwitch.click();
  await expect(behaviorSwitch).toHaveAttribute('aria-checked', initialSwitchState === 'true' ? 'false' : 'true');
  const toggledThumbTransform = await behaviorSwitch.locator('[data-switch-thumb]').evaluate((element) =>
    getComputedStyle(element).transform
  );
  expect(toggledThumbTransform).not.toBe(initialThumbTransform);
  await behaviorSwitch.click();
  await expect(behaviorSwitch).toHaveAttribute('aria-checked', initialSwitchState ?? 'false');
  const addFinishing = productDialog.getByRole('button', { name: 'افزودن پرداخت', exact: true });
  const addFinishingStyle = await addFinishing.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      minHeight: Number.parseFloat(style.minHeight),
      paddingInlineStart: Number.parseFloat(style.paddingInlineStart),
      paddingInlineEnd: Number.parseFloat(style.paddingInlineEnd),
    };
  });
  expect(addFinishingStyle.minHeight).toBeGreaterThanOrEqual(44);
  expect(addFinishingStyle.paddingInlineStart).toBeGreaterThanOrEqual(16);
  expect(addFinishingStyle.paddingInlineEnd).toBeGreaterThanOrEqual(16);
  await addFinishing.click();
  const finishingSearch = productDialog.getByLabel('جستجوی پرداخت');
  await expect(finishingSearch).toBeFocused();
  const finishingResults = productDialog.locator('#contract-product-finishing-search + div button');
  if (await finishingResults.count()) {
    const finishingResultStyle = await finishingResults.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        minHeight: Number.parseFloat(style.minHeight),
        paddingInlineStart: Number.parseFloat(style.paddingInlineStart),
        paddingInlineEnd: Number.parseFloat(style.paddingInlineEnd),
      };
    });
    expect(finishingResultStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(finishingResultStyle.paddingInlineStart).toBeGreaterThanOrEqual(12);
    expect(finishingResultStyle.paddingInlineEnd).toBeGreaterThanOrEqual(12);
  }
  expect(await productDialog.locator('h2, h3, h4, label, strong').evaluateAll((elements) =>
    elements.every((element) => {
      const color = getComputedStyle(element).color;
      return color !== 'rgb(0, 0, 0)' && color !== 'rgba(0, 0, 0, 1)';
    })
  )).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const productStepFits = await page.locator('main.sds-workspace').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  });
  expect(productStepFits).toBe(true);

  const modalFooterActions = productDialog.locator('footer button');
  expect(await modalFooterActions.count()).toBeGreaterThanOrEqual(2);
  expect(await modalFooterActions.evaluateAll((actions) => actions.every((action) => {
    const rect = action.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      Boolean(topmost && action.contains(topmost));
  }))).toBe(true);

  const salesBottomNavigation = page.getByRole('navigation', { name: 'ناوبری فروش' });
  await expect(salesBottomNavigation).toBeVisible();
  expect(await salesBottomNavigation.evaluate((navigation) => {
    const rect = navigation.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return Boolean(topmost && !navigation.contains(topmost));
  })).toBe(true);

  await page.setViewportSize({ width: 390, height: 422 });
  const zoomedFooterPresentation = await modalFooterActions.evaluateAll((actions) => actions.map((action) => {
    const rect = action.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      label: action.textContent?.trim(),
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      topmost: Boolean(topmost && action.contains(topmost)),
    };
  }));
  for (const action of zoomedFooterPresentation) {
    expect(action.withinViewport, JSON.stringify(action)).toBe(true);
    expect(action.topmost, JSON.stringify(action)).toBe(true);
  }
  expect(await salesBottomNavigation.evaluate((navigation) => {
    const rect = navigation.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return Boolean(topmost && !navigation.contains(topmost));
  })).toBe(true);
});

test('Stair layer summary keeps its established values visible while recalculating', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    if (!NativeWorker) return;
    window.Worker = class DelayedWorker extends NativeWorker {
      private delayedHandler: ((this: Worker, event: MessageEvent) => unknown) | null = null;

      override set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        this.delayedHandler = handler;
        super.onmessage = handler
          ? (event: MessageEvent) => window.setTimeout(() => handler.call(this, event), 350)
          : null;
      }

      override get onmessage() {
        return this.delayedHandler;
      }
    };
  });
  await login(page);
  await page.evaluate(() => {
    const product = {
      id: 'stair-stone',
      code: 'ST-01',
      name: 'Stair stone',
      namePersian: 'سنگ پله آزمایشی',
      basePrice: 100000,
      widthValue: 40,
      thicknessValue: 2,
      motherLengthValue: 1,
    };
    const common = {
      productId: product.id,
      product,
      productType: 'stair',
      stairSystemId: 'stair-system-e2e',
      stairPartType: 'tread',
      stoneCode: product.code,
      diameterOrWidth: 2,
      length: 1,
      lengthUnit: 'm',
      widthUnit: 'cm',
      pricePerSquareMeter: 100000,
      currency: 'تومان',
      isMandatory: false,
      mandatoryPercentage: 20,
      description: '',
      appliedSubServices: [],
      remainingStones: [],
      cuttingBreakdown: [],
      usedRemainingStones: [],
    };
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
            ...common,
            rowId: 'stair-parent-e2e',
            stoneName: 'سنگ پله آزمایشی',
            width: 30,
            quantity: 2,
            squareMeters: 0.6,
            totalPrice: 60000,
            numberOfSteps: 2,
            quantityType: 'steps',
            sawKerfEnabled: false,
            sawKerfCm: null,
            standardLengthValue: 1,
            standardLengthUnit: 'm',
            meta: {
              stair: {
                motherLengthMode: 'explicit',
                motherLengthMeters: 1,
                motherLengthDisplayUnit: 'm',
              },
            },
          },
          {
            ...common,
            rowId: 'stair-layer-e2e',
            parentProductRowId: 'stair-parent-e2e',
            stoneName: 'لایه پله آزمایشی',
            width: 5,
            quantity: 2,
            squareMeters: 0.1,
            totalPrice: 12000,
            layerTypeId: 'layer-type-e2e',
            layerTypeName: 'لبه آزمایشی',
            layerTypePrice: 1000,
            layerUseDifferentStone: true,
            layerStoneProductId: product.id,
            layerStoneName: product.namePersian,
            layerStoneBasePricePerSquareMeter: 100000,
            layerStonePricePerSquareMeter: 100000,
            meta: {
              isLayer: true,
              layerInfo: {
                parentPartType: 'tread',
                parentProductIndexInSession: 0,
                numberOfLayersPerStair: 1,
                layerConfigurationId: 'layer-configuration-e2e',
                sourceKind: 'newMaterial',
                calculationUnit: 'set',
              },
              layerType: {
                id: 'layer-type-e2e',
                name: 'لبه آزمایشی',
                pricePerLayer: 1000,
                calculationUnit: 'set',
              },
              layerAltStone: {
                id: product.id,
                name: product.namePersian,
                basePricePerSquareMeter: 100000,
                mandatoryPercentage: 0,
              },
              layerEdges: { front: true },
            },
          },
        ],
        serviceRows: [],
        deliveries: [],
        payment: { payments: [], currency: 'تومان', totalContractAmount: 0 },
        discount: null,
        signature: null,
      },
    }));
  });

  await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=4');
  const parentRow = page.locator('[data-contract-row-id="stair-parent-e2e"]');
  await expect(parentRow).toBeVisible();
  await parentRow.getByRole('button', { name: 'ویرایش', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const summary = dialog.locator('#stair-layer-calculation-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  await expect(summary.getByRole('status', { name: 'در حال بارگذاری' })).toHaveCount(0);
  const establishedValues = summary.locator(':scope > div strong');
  expect(await establishedValues.count()).toBeGreaterThan(0);
  const establishedValueCount = await establishedValues.count();
  const establishedValueTexts = await establishedValues.allInnerTexts();
  const firstEstablishedValue = await establishedValues.first().innerText();

  await dialog.getByRole('switch', { name: 'خوراک اره' }).click();
  await expect(summary).toHaveAttribute('aria-busy', 'true');
  await expect(summary).toContainText('خلاصه محاسبه لایه');
  await expect(summary.getByRole('status', { name: 'در حال بارگذاری' })).toHaveCount(0);
  await expect(establishedValues).toHaveCount(establishedValueCount);
  await expect(establishedValues.first()).toHaveText(firstEstablishedValue);
  await expect(summary).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  await expect(summary.getByRole('status', { name: 'در حال بارگذاری' })).toHaveCount(0);

  const layerWidth = dialog.getByText('عرض لایه', { exact: true }).locator('..').locator('input');
  await layerWidth.fill('20');
  await expect(summary).toHaveAttribute('aria-busy', 'true');
  await expect(establishedValues).toHaveCount(establishedValueCount);
  await expect(summary.getByRole('status', { name: 'در حال بارگذاری' })).toHaveCount(0);
  await expect(summary).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  expect(await establishedValues.allInnerTexts()).not.toEqual(establishedValueTexts);
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
