import { expect, test, type Page } from '@playwright/test';
import { dispatchCaseReference } from '../../frontend/src/features/dispatch-case/dispatchCasePresentation';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
} from './support/design-system';

const loading = {
  id: 'hr-parity-loading', loadingNumber: 'L-20260929-9001', status: 'DRAFT',
  customerName: 'مشتری آزمون', projectName: 'پروژه آزمون',
  loadingDate: '2026-09-29T08:00:00.000Z', lineCount: 1, correctionCount: 0,
  customer: { firstName: 'مشتری', lastName: 'آزمون' },
  project: { projectName: 'پروژه آزمون' }, driverAssignments: [],
  lines: [{ id: 'parity-line', sourceContractItemId: 'parity-source', quantity: 12.5,
    unit: 'meter', productSnapshot: { name: 'سنگ آزمون' }, sourceContract: { contractNumber: '9001' } }],
};
const loadingReference = dispatchCaseReference(loading.loadingNumber);

const mockAvailability = (page: Page) => page.route('**/api/dashboard/action-availability**', route => route.fulfill({
  json: { success: true, data: Object.fromEntries(
    ['FINALIZE_LOADING', 'EDIT_LOADING', 'CANCEL_LOADING', 'CREATE_CORRECTION'].map(key => [key, { enabled: true }]),
  ) },
}));

test('Logistics dashboard preserves counts and HR surfaces across themes, mobile, and zoom', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await page.route('**/api/logistics/dashboard', route => route.fulfill({ json: {
    success: true, data: { metrics: { drafts: 3, finalized: 2, cancelled: 1, drivers: 4 }, recent: [loading] },
  } }));
  await page.goto('/dashboard/logistics');
  const main = page.locator('main.sds-workspace');
  const metrics = main.getByRole('region', { name: 'شاخص‌های کلیدی' });
  await expect(metrics).toContainText('۳');
  await expect(metrics).toContainText('۲');
  await expect(metrics).toContainText('۱');
  await expect(metrics).toContainText('۴');
  await expect(main.getByRole('link', { name: loadingReference })).toHaveAttribute('href', `/dashboard/logistics/loadings/${loading.id}`);
  for (const width of [1440, 390]) {
    await setViewportAndZoom(page, { width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await assertNoHorizontalOverflow(page);
      await assertNoSeriousAxeViolations(page);
      await assertMinimumTargetSize(main.locator('button, a'));
      expect(await metrics.locator('a').first().evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
      await main.screenshot({ path: testInfo.outputPath(`dashboard-${width}-${theme}.png`) });
    }
  }
  await setViewportAndZoom(page, { width: 780, height: 900 }, 2);
  await assertNoHorizontalOverflow(page);
});

test('Logistics cancellation keeps its required reason, focus, and pending protection in the workspace modal', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await mockAvailability(page);
  await page.route('**/api/logistics/loadings', route => route.fulfill({ json: { success: true, data: [loading] } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let submissions = 0;
  await page.route(`**/api/logistics/loadings/${loading.id}/cancel`, async route => {
    submissions += 1;
    expect(route.request().postDataJSON()).toEqual({ reason: 'دلیل آزمون لغو' });
    await gate;
    await route.fulfill({ json: { success: true, data: loading } });
  });
  await page.goto('/dashboard/logistics/loadings');
  await page.getByRole('checkbox', { name: `انتخاب ${loadingReference}` }).check();
  const opener = page.getByRole('button', { name: 'لغو گروهی' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: `لغو ${loadingReference}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'تأیید و اجرا' })).toBeDisabled();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await assertMinimumTargetSize(dialog.locator('button, textarea'));
    const palette = await dialog.evaluate(element => {
      const style = getComputedStyle(element);
      const workspace = getComputedStyle(document.querySelector('main.sds-workspace')!);
      return [style.getPropertyValue('--sds-accent').trim(), workspace.getPropertyValue('--sds-accent').trim()];
    });
    expect(palette[0]).toBe(palette[1]);
    await dialog.screenshot({ path: testInfo.outputPath(`cancel-mobile-${theme}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('textbox', { name: 'دلیل لغو' }).fill('دلیل آزمون لغو');
  await dialog.getByRole('button', { name: 'تأیید و اجرا' }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'تأیید و اجرا' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toBeHidden();
  expect(submissions).toBe(1);
});

test('Logistics detail preserves lifecycle warnings, item quantities, and print content', async ({ page }) => {
  await loginAsAdmin(page);
  await mockAvailability(page);
  await page.route(`**/api/logistics/loadings/${loading.id}`, route => route.fulfill({ json: { success: true, data: loading } }));
  await page.goto(`/dashboard/logistics/loadings/${loading.id}`);
  await expect(page.getByText('این بارگیری هنوز پیش‌نویس است و مانده قرارداد را کاهش نمی‌دهد.')).toBeVisible();
  await page.getByRole('button', { name: 'عملیات بارگیری' }).click();
  await page.getByRole('button', { name: 'نهایی‌سازی بارگیری' }).click();
  const dialog = page.getByRole('dialog', { name: 'نهایی‌سازی بارگیری' });
  await expect(dialog).toContainText('این اقدام هنوز به معنی خروج فیزیکی بار نیست.');
  await expect(dialog.locator('xpath=..')).toHaveClass(/sds-neumorphic-scope/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'اقلام بارگیری', exact: true }).click();
  await expect(page.getByText('سنگ آزمون', { exact: true })).toBeVisible();
  await expect(page.getByText('۱۲٫۵ متر طول', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'برگه چاپی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'برگه بارگیری سبلان', exact: true })).toBeVisible();
  await expect(page.getByText('سنگ آزمون · قرارداد 9001', { exact: true })).toBeVisible();
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
});

test('Logistics duties use HR metrics while maintaining task data and reassignment confirmation', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  const duty = {
    id: 'parity-duty', workspace: 'logistics', status: 'OPEN', access: 'ASSIGNEE',
    fields: { title: 'پیگیری بارگیری آزمون' }, sourceActionCode: 'LOGISTICS_REVIEW',
    dueAtDisplay: '۸ مهر ۱۴۰۵', overdue: false, detailAvailable: true,
    currentAssigneeUserId: 'current', currentAssignee: { id: 'current', displayName: 'مسئول فعلی', username: 'current' },
    sourceVersion: 1, envelopeVersion: 1, allowedActionCodes: [], evidence: [], history: [], accessProvenance: [],
    canReassign: true, claimRequiresReason: false, responseRequiresReason: false, destinationHref: null,
  };
  await page.route('**/api/duties/workspaces/logistics/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/summary')
      ? { open: 1, available: 0, availableUnseen: 0, attention: 0, dueSoon: 0, overdue: 0, triage: 0, historyUnseen: 0, canManageTriage: false }
      : path.endsWith('/eligible-assignees') ? [{ id: 'next', displayName: 'مسئول جدید آزمون', username: 'next' }]
        : path.endsWith(`/${duty.id}`) ? duty : [duty];
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/dashboard/logistics/duties');
  await expect(page.getByRole('region', { name: 'شاخص‌های کلیدی' })).toBeVisible();
  await page.getByRole('link', { name: 'مشاهده وظیفه' }).click();
  await expect(page.getByRole('heading', { name: duty.fields.title, exact: true })).toBeVisible();
  await page.getByLabel('مسئول جدید', { exact: true }).selectOption('next');
  await page.getByLabel('دلیل واگذاری', { exact: true }).fill('دلیل آزمون واگذاری');
  await page.getByRole('button', { name: 'واگذاری مجدد', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تأیید انتقال مسئولیت' });
  await expect(dialog).toContainText('مسئول جدید آزمون');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await dialog.screenshot({ path: testInfo.outputPath(`reassignment-mobile-${theme}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Logistics metric links select the matching register filter and keep Guard destination', async ({ page }) => {
  await loginAsAdmin(page);
  await mockAvailability(page);
  await page.route('**/api/duties/workspaces/logistics/duties**', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/logistics/dashboard', route => route.fulfill({ json: { success: true, data: { metrics: { drafts: 1, finalized: 1, cancelled: 1, drivers: 1 }, recent: [loading] } } }));
  const rows = [loading, { ...loading, id: 'finalized', loadingNumber: 'L-20260929-9002', status: 'FINALIZED' }, { ...loading, id: 'cancelled', loadingNumber: 'L-20260929-9003', status: 'CANCELLED' }];
  await page.route('**/api/logistics/loadings', route => route.fulfill({ json: { success: true, data: rows } }));
  for (const [label, status, reference] of [['پیش‌نویس‌ها', 'DRAFT', loadingReference], ['نهایی‌شده', 'FINALIZED', dispatchCaseReference(rows[1].loadingNumber)], ['لغوشده', 'CANCELLED', dispatchCaseReference(rows[2].loadingNumber)]]) {
    await page.goto('/dashboard/logistics');
    const metrics = page.getByRole('region', { name: 'شاخص‌های کلیدی' });
    await expect(metrics.getByRole('link', { name: /راننده فعال/ })).toHaveAttribute('href', '/dashboard/security/vehicles?operation=queue');
    await metrics.getByRole('link', { name: new RegExp(label) }).click();
    await expect(page).toHaveURL(new RegExp(`status=${status}`));
    const table = page.locator('main.sds-workspace table');
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table).toContainText(reference);
  }
});

test('Logistics ellipsis is centered and its menu escapes a scrolled table, with keyboard and mobile focus', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await mockAvailability(page);
  await page.route('**/api/logistics/loadings', route => route.fulfill({ json: { success: true, data: Array.from({ length: 8 }, (_, i) => ({ ...loading, id: `menu-${i}`, loadingNumber: `L-20260929-${9001 + i}` })) } }));
  await page.goto('/dashboard/logistics/loadings');
  await setViewportAndZoom(page, { width: 1440, height: 900 });
  const trigger = page.getByRole('button', { name: 'اقدامات بیشتر', exact: true }).last();
  await page.locator('main.sds-workspace table').evaluate(table => {
    const container = table.parentElement!;
    container.style.maxHeight = '250px'; container.style.overflow = 'auto';
    container.scrollTop = container.scrollHeight;
  });
  await trigger.scrollIntoViewIfNeeded();
  const alignment = await trigger.evaluate(button => {
    const b = button.getBoundingClientRect(), i = button.querySelector('svg')!.getBoundingClientRect();
    return [Math.abs((b.left + b.right - i.left - i.right) / 2), Math.abs((b.top + b.bottom - i.top - i.bottom) / 2)];
  });
  expect(alignment[0]).toBeLessThan(1); expect(alignment[1]).toBeLessThan(1);
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'اقدامات بیشتر', exact: true });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true);
  const box = await menu.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  await expect(menu.getByRole('button', { name: 'نهایی‌سازی', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: 'چاپ', exact: true })).toBeFocused();
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('menu-outside-scroll.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
  await setViewportAndZoom(page, { width: 780, height: 900 }, 2);
  await trigger.click();
  await expect(menu).toBeVisible();
  const zoomBox = await menu.boundingBox();
  expect(zoomBox!.x).toBeGreaterThanOrEqual(0);
  expect(zoomBox!.x + zoomBox!.width).toBeLessThanOrEqual(780);
  expect(zoomBox!.y + zoomBox!.height).toBeLessThanOrEqual(900);
  await page.keyboard.press('Escape');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await trigger.click();
  await expect(menu).toBeVisible();
  await assertMinimumTargetSize(menu.locator('button, a'));
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
});

test('Logistics Sales-style stepper retains prerequisites and circles cover the connector', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await page.route('**/api/logistics/customers**', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/logistics/drivers**', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.goto('/dashboard/logistics/loadings/new');
  await setViewportAndZoom(page, { width: 1440, height: 900 });
  const nav = page.getByRole('navigation', { name: 'مراحل بارگیری' });
  await expect(nav.locator('ol button')).toHaveCount(6);
  await expect(nav.getByRole('button', { name: 'مشتری', exact: true })).toHaveAttribute('aria-current', 'step');
  await expect(nav.getByRole('button', { name: 'پروژه', exact: true })).toBeDisabled();
  await expect(nav.getByRole('button', { name: 'بازبینی', exact: true })).toBeDisabled();
  const layers = await nav.locator('ol li').nth(1).evaluate(li => {
    const connector = li.querySelector('span[aria-hidden="true"]')!;
    const circle = li.querySelector('button')!.parentElement!;
    return [Number(getComputedStyle(connector).zIndex), Number(getComputedStyle(circle).zIndex), getComputedStyle(circle).backgroundColor];
  });
  const radius = await nav.locator('ol button').first().evaluate(button => Number.parseFloat(getComputedStyle(button).borderRadius));
  expect(radius).toBeGreaterThanOrEqual(22);
  expect(layers[1]).toBeGreaterThan(layers[0]); expect(layers[2]).not.toBe('rgba(0, 0, 0, 0)');
  await nav.screenshot({ path: testInfo.outputPath('sales-stepper.png') });
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await nav.getByRole('button', { name: /انتخاب مرحله ویرایش/ }).click();
  const picker = page.getByRole('dialog', { name: 'انتخاب مرحله ویرایش' });
  await expect(picker.getByRole('button', { name: /بازبینی/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await assertNoHorizontalOverflow(page);
});

test('Logistics driver tabs retain both allocations across a draft save and review', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  const drivers = [
    { id: 'turn-a', firstName: 'علی', lastName: 'رضایی', queueStatus: 'RESERVED', reservedLoading: { id: loading.id } },
    { id: 'turn-b', firstName: 'رضا', lastName: 'محمدی', queueStatus: 'RESERVED', reservedLoading: { id: loading.id } },
  ];
  const draft = { ...loading, customerId: 'customer', projectId: 'project',
    lines: [{ ...loading.lines[0], sourceContractId: 'contract', quantity: 30, sourceSnapshot: { contractNumber: '9001', contractedQuantity: 100, remainingQuantity: 100 } }],
    guardQueueTurns: drivers.map(driver => ({ id: driver.id, status: 'RESERVED_FOR_LOADING', loadingId: loading.id })),
    canonicalAllocationDrafts: drivers.map((driver, i) => ({ queueTurnId: driver.id, lines: [{ sourceContractItemId: 'parity-source', quantity: (i + 1) * 10 }] })),
  };
  const savedAllocations: Record<string, any> = {};
  let savedLoading: any = null;
  await page.route('**/api/logistics/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/canonical-allocations/')) {
      savedAllocations[path.split('/').pop()!] = route.request().postDataJSON();
      return route.fulfill({ json: { success: true } });
    }
    if (path.endsWith(`/loadings/${loading.id}`)) {
      if (route.request().method() === 'PUT') savedLoading = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, data: draft } });
    }
    if (path.endsWith('/drivers')) return route.fulfill({ json: { success: true, data: drivers } });
    if (path.endsWith('/customers')) return route.fulfill({ json: { success: true, data: [] } });
    if (path.endsWith('/remaining')) return route.fulfill({ json: { success: true, data: { groups: [] } } });
    return route.continue();
  });
  await page.goto(`/dashboard/logistics/loadings/new?draftId=${loading.id}`);
  const input = page.getByRole('textbox', { name: 'مقدار مستقیم', exact: true });
  await expect(input).toHaveValue('10');
  await input.fill('15');
  await page.getByRole('button', { name: 'رضا محمدی', exact: true }).click();
  await expect(input).toHaveValue('20');
  await input.fill('25');
  await page.getByRole('button', { name: 'علی رضایی', exact: true }).click();
  await expect(input).toHaveValue('15');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'بازبینی و نهایی‌سازی' })).toBeVisible();
  expect(savedLoading.lines[0]).toMatchObject({ sourceContractItemId: 'parity-source', quantity: 40, unit: 'meter' });
  expect(savedAllocations['turn-a'].lines[0]).toMatchObject({ sourceContractItemId: 'parity-source', quantity: 15, unit: 'meter' });
  expect(savedAllocations['turn-b'].lines[0]).toMatchObject({ sourceContractItemId: 'parity-source', quantity: 25, unit: 'meter' });
  await expect(page.locator('main.sds-workspace table')).toContainText('۴۰');
  for (const width of [1440, 390]) {
    await setViewportAndZoom(page, { width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await assertNoHorizontalOverflow(page);
      await assertNoSeriousAxeViolations(page);
      await page.locator('main.sds-workspace').screenshot({ path: testInfo.outputPath(`review-${width}-${theme}.png`) });
    }
  }
});


test('Logistics customer names stay readable on narrow phones and tablets', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await mockAvailability(page);
  const rows = [
    { ...loading, customerName: 'اسماعیل نژاد مقدم', projectName: 'صنوبر', loadingNumber: 'L-20260929-0002' },
    { ...loading, id: 'second-readable', customerName: 'محمد حسن رنجبر', projectName: 'رنجبر اداره گاز', loadingNumber: 'L-20260929-0001' },
  ];
  await page.route('**/api/logistics/loadings', route => route.fulfill({ json: { success: true, data: rows } }));
  await page.route('**/api/logistics/dashboard', route => route.fulfill({ json: { success: true, data: { metrics: {}, recent: rows } } }));
  for (const route of ['/dashboard/logistics/loadings', '/dashboard/logistics']) {
    await page.goto(route);
    const main = page.locator('main.sds-workspace');
    await expect(main.getByText(rows[0].customerName, { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: dispatchCaseReference(rows[0].loadingNumber), exact: true })).toBeVisible();
    await expect(main).not.toContainText(rows[0].loadingNumber);
    for (const width of [347, 453, 525, 910, 1440]) {
      await setViewportAndZoom(page, { width, height: 793 });
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page);
        for (const row of rows) {
          const name = main.getByText(row.customerName, { exact: true });
          const geometry = await name.evaluate(element => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { width: box.width, height: box.height, lineHeight: parseFloat(style.lineHeight), weight: Number(style.fontWeight) };
          });
          expect(geometry.width).toBeGreaterThan(145);
          expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1);
          expect(geometry.weight).toBeGreaterThanOrEqual(700);
        }
        await assertMinimumTargetSize(main.locator('tbody button, tbody a'));
        if ([347, 910].includes(width)) await main.screenshot({ path: testInfo.outputPath(`${route.endsWith('loadings') ? 'register' : 'dashboard'}-${width}-${theme}.png`) });
      }
    }
    await assertNoSeriousAxeViolations(page);
    if (route.endsWith('loadings')) {
      const checkbox = main.getByRole('checkbox', { name: `انتخاب ${dispatchCaseReference(rows[0].loadingNumber)}`, exact: true });
      await checkbox.check();
      await expect(main.getByRole('button', { name: 'لغو گروهی' })).toBeVisible();
      await checkbox.uncheck();
    }
  }
});
