import { expect, test } from '@playwright/test';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
} from './support/design-system';

test('public login remains accessible at mobile width and 200% zoom in both themes', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await assertMinimumTargetSize(page.locator('button, a, input'));
  }

  const password = page.getByPlaceholder('رمز عبور خود را وارد کنید');
  await password.fill('admin123');
  await page.getByRole('button', { name: 'نمایش رمز' }).click();
  await expect(password).toHaveAttribute('type', 'text');

  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'ورود', exact: true })).toBeVisible();
});

test('login errors are Persian and successful login starts protected providers without 401 races', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('invalid-e2e-user');
  await page.locator('input[type="password"]').fill('invalid-e2e-password');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  const loginError = page.getByRole('alert').filter({ hasText: 'نام کاربری یا رمز عبور نادرست است.' });
  await expect(loginError).toBeVisible();
  await expect(loginError).not.toContainText('Invalid credentials');

  const protected401s: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 401 && response.url().includes('/api/workspace-permissions')) {
      protected401s.push(response.url());
    }
  });
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(
    process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin',
  );
  await page.locator('input[type="password"]').fill(
    process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123',
  );
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  expect(protected401s).toEqual([]);
});

test('Administration security actions use a pending-safe canonical dialog', async ({ page }) => {
  await loginAsAdmin(page);
  const userId = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me');
    const payload = await response.json();
    return payload.data.id as string;
  });
  await page.goto(`/dashboard/users/${userId}`);
  await setViewportAndZoom(page, { width: 390, height: 844 });

  const opener = page.getByRole('button', { name: 'لغو همه نشست‌ها' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'لغو همه نشست‌ها' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'تأیید و ثبت' })).toBeDisabled();
  await assertNoSeriousAxeViolations(page);
  await assertMinimumTargetSize(dialog.locator('button, input, textarea'));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('HR work schedule and Persian time selection are RTL, keyboard, mobile, and zoom safe', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/hr/personnel');
  const personnel = page.locator('[data-personnel-id]').first();
  await expect(personnel).toBeVisible();
  await personnel.getByRole('button').first().click();
  await personnel.getByRole('button', { name: 'مشاهده برنامه کاری' }).click();
  await expect(page.getByRole('dialog', { name: /^برنامه کاری / })).toBeVisible();

  await setViewportAndZoom(page, { width: 390, height: 844 });
  const saturday = page.getByRole('button', { name: 'شنبه', exact: true });
  if (await saturday.getAttribute('aria-pressed') !== 'true') await saturday.click();
  const opener = page.getByRole('button', { name: 'زمان شروع شنبه' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'انتخاب ساعت' });
  await expect(dialog).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await assertMinimumTargetSize(dialog.locator('button'));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await assertNoHorizontalOverflow(page);

  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'اعمال زمان' })).toBeVisible();
});

test('Hiring lifecycle journey remains keyboard, reduced-motion, mobile, zoom, and theme safe', async ({ page }) => {
  await loginAsAdmin(page);
  let finalRejectionPayload: Record<string, unknown> | undefined;
  await page.route('**/api/hr-hiring/applications/*/final-rejection', async (route) => {
    finalRejectionPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard/hr/hiring');
  await expect(page.getByRole('heading', { name: 'جذب و پرونده‌های متقاضیان' })).toBeVisible({ timeout: 15_000 });
  const firstCase = page.locator('[id^="hiring-case-"] a').first();
  await expect(firstCase).toBeVisible();
  const [caseResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && /\/api\/hr-hiring\/applications\/[^/?]+(?:\?.*)?$/.test(response.url()),
    ),
    firstCase.click(),
  ]);
  const casePayload = await caseResponse.json();
  const expectedPhaseCount = Number(casePayload?.data?.lifecycle?.totalPhases);
  expect(expectedPhaseCount).toBeGreaterThanOrEqual(8);
  await expect(page.getByText('مسیر جذب و شروع همکاری')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'رد نهایی پرونده', exact: true }).click();
  const rejectionDialog = page.getByRole('dialog', { name: 'رد نهایی پرونده' });
  await expect(rejectionDialog).toBeVisible();
  await rejectionDialog.getByRole('textbox', { name: 'دلیل رد نهایی پرونده' }).fill('آزمون گذار کامل چرخه جذب');
  await rejectionDialog.getByRole('button', { name: 'بستن پرونده و دسترسی' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'رد نهایی ثبت و پرونده بسته شد.' })).toBeVisible();
  expect(finalRejectionPayload?.reason).toBe('آزمون گذار کامل چرخه جذب');
  const phases = page.getByRole('list', { name: 'مراحل جذب' }).first().getByRole('button');
  await expect(phases).toHaveCount(expectedPhaseCount);
  await phases.first().focus();
  await page.keyboard.press('Enter');
  await expect(phases.first()).toHaveAttribute('aria-pressed', 'true');
  for (let index = 1; index < expectedPhaseCount; index += 1) {
    await phases.nth(index).click();
    await expect(phases.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await setViewportAndZoom(page, { width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoSeriousAxeViolations(page);
  }
  await assertMinimumTargetSize(page.getByRole('list', { name: 'مراحل جذب' }).last().getByRole('button'));
  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});

test('User creation exposes canonical non-color permission state and responsive validation', async ({ page }) => {
  await loginAsAdmin(page);
  let releaseCreate: (() => void) | undefined;
  await page.route('**/api/users', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise<void>((resolve) => { releaseCreate = resolve; });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { id: 'created-user-1', permissionSummary: { workspacePermissions: 3 } } }),
    });
  });
  await page.goto('/dashboard/users/create');
  await expect(page.getByRole('heading', { name: 'ایجاد کاربر جدید' })).toBeVisible({ timeout: 15_000 });
  await page.locator('form').evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  const submit = page.locator('form button[type="submit"]');
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: 'نام الزامی است' })).toBeVisible();
  const preset = page.getByRole('button', { name: 'کارشناس فروش · نقش SALES' });
  await preset.focus();
  await page.keyboard.press('Enter');
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('وضعیت: ویرایش').first()).toBeVisible();
  await page.locator('input[name="firstName"]').fill('کاربر');
  await page.locator('input[name="lastName"]').fill('آزمایشی');
  await page.locator('input[name="email"]').fill('design-system@example.test');
  await page.locator('input[name="username"]').fill('design-system-user');
  await page.locator('input[name="password"]').fill('password123');
  await page.locator('input[name="confirmPassword"]').fill('password123');
  await submit.click();
  await expect(submit).toBeDisabled();
  expect(releaseCreate).toBeDefined();
  releaseCreate?.();
  await expect(page.getByRole('status').filter({ hasText: 'کاربر با موفقیت ایجاد شد' })).toBeVisible();
  await setViewportAndZoom(page, { width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoSeriousAxeViolations(page);
  }
  await assertMinimumTargetSize(page.locator('button, input, select'));
  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});

test('Logistics Loading create and detail routes retain canonical responsive interaction', async ({ page }) => {
  await loginAsAdmin(page);
  const loadingFixture = {
    id: 'loading-1', loadingNumber: 'LD-TEST-1', status: 'DRAFT', customerId: 'customer-1', projectId: 'project-1',
    loadingDate: new Date().toISOString(), notes: '', lines: [], driverAssignments: [],
    customer: { firstName: 'مشتری', lastName: 'نمونه', companyName: 'شرکت نمونه' },
    project: { id: 'project-1', projectName: 'پروژه نمونه', address: 'تهران' },
  };
  await page.route('**/api/logistics/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const reply = (data: unknown, extra: Record<string, unknown> = {}) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) });
    if (pathname.endsWith('/logistics/customers')) return reply([{ id: 'customer-1', customerName: 'مشتری نمونه', companyName: 'شرکت نمونه', loadableProjectCount: 1 }]);
    if (pathname.endsWith('/logistics/drivers')) return reply([]);
    if (pathname.endsWith('/logistics/customers/customer-1/projects')) return reply([{ id: 'project-1', projectName: 'پروژه نمونه', address: 'تهران', city: 'تهران', remainingCount: 1 }]);
    if (pathname.endsWith('/logistics/projects/project-1/draft')) return reply(loadingFixture, { resumed: false });
    if (pathname.endsWith('/logistics/projects/project-1/remaining')) return reply({ groups: [] });
    if (pathname.endsWith('/logistics/loadings/loading-1')) return reply(loadingFixture);
    return route.continue();
  });
  await page.goto('/dashboard/logistics/loadings/new');
  await expect(page.getByRole('heading', { name: 'بارگیری جدید' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /مشتری نمونه/ }).click();
  await expect(page.getByRole('heading', { name: 'انتخاب پروژه' })).toBeVisible();
  await page.getByRole('button', { name: 'انتخاب', exact: true }).click();
  await expect(page.getByText('پیش‌نویس بارگیری ساخته شد.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'انتخاب ردیف‌های قرارداد' })).toBeVisible();
  await setViewportAndZoom(page, { width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoSeriousAxeViolations(page);
  }
  await assertMinimumTargetSize(page.locator('button, input, textarea'));
  await assertNoHorizontalOverflow(page);

  await page.goto('/dashboard/logistics/loadings/loading-1');
  await expect(page.getByRole('heading', { name: 'بارگیری LD-TEST-1' })).toBeVisible({ timeout: 15_000 });
  await assertNoSeriousAxeViolations(page);
  await assertNoHorizontalOverflow(page);
  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});
