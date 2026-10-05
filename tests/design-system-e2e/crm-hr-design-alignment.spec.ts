import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

test('live CRM dashboard loads through the existing local backend', async ({ page }) => {
  const dashboardResponse = page.waitForResponse(response => response.url().endsWith('/api/crm/dashboard') && response.request().method() === 'GET');
  await page.goto('/dashboard/crm');
  const response = await dashboardResponse;
  expect(response.ok()).toBe(true);
  expect((await response.json()).success).toBe(true);
  await expect(page.getByRole('heading', { name: 'مدیریت ارتباط و پیگیری مشتری' })).toBeVisible();
  await expect(page.locator('main.sds-workspace').getByRole('region', { name: 'شاخص‌های کلیدی' }).locator('.sds-neumorphic-card')).toHaveCount(4);
});

test('CRM dashboard prioritizes follow-ups and preserves HR card presentation across themes and mobile', async ({ page }, testInfo) => {
  await page.route('**/api/crm/dashboard', route => route.fulfill({ json: { success: true, data: {
    permissions: { canManage: true }, customers: { total: 289, active: 280 },
    projects: { total: 1, byStatus: [{ status: 'در حال پیگیری', count: 1 }], bySeller: [], won: 0, lost: 0, dormant: 0, estimatedPipelineValue: 0 },
    nextActions: { overdue: [{ id: 'overdue', title: 'تماس با مشتری', dueAt: '2026-09-01', status: 'PENDING', communicationType: 'تماس', customer: { id: 'crm-parity', firstName: 'مینا', lastName: 'آزمایشی' } }], today: [], upcoming: [] },
    recentCustomers: [], recentProjects: [], recentTimeline: [],
  } } }));
  await page.goto('/dashboard/crm');
  const main = page.locator('main.sds-workspace');
  const metrics = main.getByRole('region', { name: 'شاخص‌های کلیدی' });
  await expect(metrics).toContainText('۲۸۹');
  await expect(metrics.locator('.sds-neumorphic-card')).toHaveCount(4);
  await expect(main.getByRole('link', { name: /تماس با مشتری/ })).toHaveAttribute('href', '/dashboard/crm/customers/crm-parity');
  expect(await main.getByRole('heading', { name: 'صف پیگیری تیم' }).evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('[aria-label="شاخص‌های کلیدی"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    await setViewportAndZoom(page, { width: 1440, height: 1000 });
    await setTheme(page, theme);
    const screenshot = testInfo.outputPath(`crm-dashboard-${theme}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`crm-dashboard-${theme}`, { path: screenshot, contentType: 'image/png' });
    await assertNoSeriousAxeViolations(page);
    await setViewportAndZoom(page, { width: 390, height: 844 });
    const navigation = page.getByRole('navigation', { name: 'ناوبری مدیریت ارتباط با مشتری' });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link')).toHaveCount(5);
    await expect(navigation.getByRole('link', { name: 'داشبورد', exact: true })).toHaveAttribute('aria-current', 'page');
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
  }
  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});

test('CRM forms propagate HR presentation into body portals while Sales retains its presentation', async ({ page }) => {
  await page.goto('/dashboard/crm/customers/create');
  await expect(page.getByRole('heading', { name: 'ایجاد مشتری جدید' })).toBeVisible();
  await expect(page.locator('.sds-neumorphic-workflow-scope').first()).toBeVisible();
  await expect(page.locator('.dashboard-shell')).toHaveAttribute('data-erp-presentation', 'workspace');
  await page.getByRole('button', { name: 'بعدی' }).click();
  await page.getByRole('button', { name: 'اطلاعات تکمیلی' }).click();
  const date = page.getByRole('button', { name: /تاریخ تولد|تاریخ تولد را انتخاب کنید/ }).first();
  await date.click();
  const calendar = page.locator('.persian-calendar-portal');
  await expect(calendar).toHaveClass(/sds-neumorphic-scope/);
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await page.goto('/dashboard/crm/customers?workspace=sales');
  await expect(page.getByRole('navigation', { name: 'ناوبری مدیریت ارتباط با مشتری' })).toHaveCount(0);
  await expect(page.locator('.sds-neumorphic-workflow-scope')).toHaveCount(0);
  await expect(page.locator('.dashboard-shell')).not.toHaveAttribute('data-erp-presentation', 'workspace');
  await expect(page.getByRole('link', { name: 'پروژه‌های احتمالی', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'پیگیری‌ها', exact: true })).toHaveCount(0);
});

test('CRM customer modal retains focus and pending protection through failed save', async ({ page }) => {
  const customer = { id: 'crm-parity', firstName: 'مینا', lastName: 'آزمایشی', customerType: 'Individual', status: 'Lead',
    isBlacklisted: false, isLocked: false, phoneNumbers: [], contacts: [], projectAddresses: [], contracts: [], leads: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ownerUser: null };
  let releaseSave: (() => void) | undefined;
  await page.route('**/api/crm/customers/crm-parity', route => route.fulfill({ json: { success: true, data: customer } }));
  await page.route('**/api/crm/customers/crm-parity/**', async route => {
    if (route.request().method() === 'POST') {
      await new Promise<void>(resolve => { releaseSave = resolve; });
      return route.fulfill({ status: 500, json: { success: false, error: 'failed' } });
    }
    return route.fulfill({ json: { success: true, data: route.request().url().endsWith('/credit') ? { trustCategory: 'NORMAL', policyVersion: 1, limitRials: null, usedRials: '0', availableRials: null, deficitRials: '0', canManage: false } : {} } });
  });
  await page.goto('/dashboard/crm/customers/crm-parity');
  await expect(page.getByRole('heading', { name: 'مخاطبین', exact: true })).toBeVisible();
  const add = page.getByRole('button', { name: 'افزودن مخاطب', exact: true });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'افزودن مخاطب' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-erp-sheet-root]')).toHaveClass(/sds-neumorphic-scope/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await dialog.getByRole('textbox', { name: 'نام', exact: true }).fill('مخاطب');
  await dialog.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('آزمایشی');
  await dialog.getByRole('button', { name: 'افزودن', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'انصراف' })).toBeDisabled();
  await expect.poll(() => Boolean(releaseSave)).toBe(true);
  releaseSave?.();
  await expect(dialog.getByRole('alert')).toContainText('ذخیره مخاطب ناموفق بود');
  await expect(dialog.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('مخاطب');
  await expect(dialog).not.toHaveAttribute('aria-busy', 'true');
});

test('CRM removal confirmations preserve cancellation, failure recovery, and the last-active-project warning', async ({ page }) => {
  const customer = { id: 'crm-removal', firstName: 'مینا', lastName: 'آزمایشی', customerType: 'Individual', status: 'Lead',
    isBlacklisted: false, isLocked: false, phoneNumbers: [{ id: 'phone', number: '09121234567', type: 'Mobile', isPrimary: true, isActive: true }],
    contacts: [{ id: 'contact', firstName: 'کامران', lastName: 'نمونه', isPrimary: false }],
    projectAddresses: [{ id: 'project', projectName: 'پروژه نمونه', address: 'تهران', isActive: true }], contracts: [], leads: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ownerUser: null };
  let deleteCount = 0;
  let releaseDelete: (() => void) | undefined;
  await page.route('**/api/crm/customers/crm-removal', route => route.fulfill({ json: { success: true, data: customer } }));
  await page.route('**/api/crm/customers/crm-removal/**', async route => {
    if (route.request().method() === 'DELETE') {
      deleteCount += 1;
      await new Promise<void>(resolve => { releaseDelete = resolve; });
      return route.fulfill({ status: 500, json: { success: false } });
    }
    return route.fulfill({ json: { success: true, data: route.request().url().endsWith('/credit') ? { trustCategory: 'NORMAL', policyVersion: 1, limitRials: null, usedRials: '0', availableRials: null, deficitRials: '0', canManage: false } : {} } });
  });
  await page.goto('/dashboard/crm/customers/crm-removal');
  await expect(page.getByRole('heading', { name: 'مخاطبین', exact: true })).toBeVisible();
  const remove = page.getByRole('button', { name: 'حذف مخاطب', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'حذف مخاطب', exact: true });
  await dialog.getByRole('button', { name: 'انصراف' }).click();
  expect(deleteCount).toBe(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await dialog.getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect.poll(() => Boolean(releaseDelete)).toBe(true);
  releaseDelete?.();
  await expect(dialog.getByRole('alert')).toContainText('حذف ناموفق بود');
  expect(deleteCount).toBe(1);
  await page.goto('/dashboard/crm/customers/crm-removal/edit');
  const removeProject = page.getByRole('button', { name: /حذف پروژه/ });
  await removeProject.click();
  const warning = page.getByRole('dialog', { name: 'حذف آخرین پروژه فعال' });
  await expect(warning).toContainText('این آخرین پروژه فعال مشتری است');
  await warning.getByRole('button', { name: 'انصراف' }).click();
  await expect(removeProject).toBeVisible();
  await removeProject.click();
  await warning.getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(removeProject).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'تغییرات ذخیره‌نشده' })).toBeVisible();
});


test('CRM Sales-style wizard preserves validation, supplementary draft fields and submission payload', async ({ page }, testInfo) => {
  let submitted: any;
  await page.route('**/api/crm/customers', async route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 500, json: { success: false, error: 'خطای آزمایشی ذخیره' } });
    }
    return route.continue();
  });
  await page.route('**/api/crm/**duplicate**', route => route.fulfill({ json: { success: true, data: { matches: [] } } }));
  await page.goto('/dashboard/crm/customers/create');
  const progress = page.getByRole('navigation', { name: 'مراحل ثبت مشتری' });
  await expect(progress.locator('ol li')).toHaveCount(3);
  await expect(progress.locator('[aria-current="step"]')).toHaveAccessibleName('نوع مشتری');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'نام الزامی است' })).toBeVisible();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('مینا');
  await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('آزمایشی');
  await page.getByRole('textbox', { name: 'شماره تماس اول', exact: true }).fill('09129876543');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام پروژه', exact: true }).fill('پروژه نمونه');
  await page.getByRole('textbox', { name: 'آدرس پروژه', exact: true }).fill('تهران');
  const additional = page.getByRole('button', { name: /مدیر پروژه و بازاریاب/ });
  await additional.click();
  await page.getByRole('textbox', { name: 'نام مدیر پروژه', exact: true }).fill('حسین رضایی');
  await additional.click();
  await expect(page.getByRole('textbox', { name: 'نام مدیر پروژه', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'قبلی', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('مینا');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت مشتری', exact: true }).click();
  await expect.poll(() => submitted?.projectAddresses?.[0]?.projectManagerName).toBe('حسین رضایی');
  expect(submitted.phoneNumbers[0].number).toBe('09129876543');
  expect(submitted.projectAddresses[0].projectName).toBe('پروژه نمونه');
  await expect(page.getByRole('alert').filter({ hasText: 'خطای آزمایشی ذخیره' })).toBeVisible();
  await additional.click();
  await expect(page.getByRole('textbox', { name: 'نام مدیر پروژه', exact: true })).toHaveValue('حسین رضایی');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 1440, height: 1000 });
    await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`crm-wizard-${theme}.png`), fullPage: true });
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`crm-wizard-mobile-${theme}.png`), fullPage: true });
  }
});

test('CRM collaborative wizard retains two steps while Sales keeps the original customer flow', async ({ page }) => {
  await page.goto('/dashboard/crm/customers/create?customerType=Collaborative');
  await expect(page.getByRole('navigation', { name: 'مراحل ثبت مشتری' }).locator('ol li')).toHaveCount(2);
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ثبت مشتری', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'نام پروژه', exact: true })).toHaveCount(0);
  await page.goto('/dashboard/crm/customers/create?returnTo=contract&step=3');
  await expect(page.getByRole('progressbar', { name: 'نوع مشتری' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'مراحل ثبت مشتری' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'لغو و بازگشت به قرارداد' })).toBeVisible();
});
