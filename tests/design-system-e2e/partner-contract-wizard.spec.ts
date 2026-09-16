import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

test('Partner creation consumes the shared seven-step date, customer, and project presentation', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      schemaVersion: 1,
      kind: 'PARTNER',
      actorId: 'partner-e2e',
      actorDisplayName: 'فروشنده همکار آزمایشی',
      profileId: 'partner-profile-e2e',
      writable: true,
      inquiryIds: [],
      recoverableDrafts: [],
      customers: [{ id: 'partner-customer-e2e', displayName: 'مشتری همکار آزمایشی', address: 'تهران', phone: '09120000000' }],
      projects: [{ id: 'partner-project-e2e', customerId: 'partner-customer-e2e', title: 'پروژه همکار آزمایشی' }],
    } }),
  }));
  await page.route('**/api/partner/technical/catalog/query', async route => {
    const kind = (route.request().postDataJSON() as { kind: 'PRODUCT' | 'TOOL' | 'FINISHING' | 'LAYER' }).kind;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [],
    } }) });
  });

  await page.goto('/dashboard/sales/contracts/create?newInquiry=1');
  const workflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(workflow.getByRole('heading', { name: 'ایجاد فروش همکار', exact: true })).toBeVisible();
  const progress = workflow.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' });
  await expect(progress.getByRole('button')).toHaveCount(7);
  await expect(workflow.getByText('فروشنده همکار آزمایشی', { exact: true })).toBeVisible();
  await expect(workflow.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last()).toBeVisible();
  await expect(workflow.getByText('شماره پس از ثبت موفق قرارداد تخصیص داده می‌شود.', { exact: true })).toBeVisible();

  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(workflow.getByRole('searchbox', { name: 'جستجوی مشتری' })).toHaveAttribute('placeholder', 'جستجو با نام یا شماره تلفن');
  const customer = workflow.getByRole('button', { name: /مشتری همکار آزمایشی/ });
  await expect(customer).toHaveAttribute('aria-pressed', 'true');

  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  const project = workflow.getByRole('button', { name: /پروژه همکار آزمایشی/ });
  await project.focus();
  await page.keyboard.press('Enter');
  await expect(project).toHaveAttribute('aria-pressed', 'true');

  await setTheme(page, 'dark');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  expect(await workflow.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);
  await assertNoSeriousAxeViolations(page);
});

test('a resumed Partner inquiry stays inside the same seven-step contract wizard', async ({ page }) => {
  await loginAsAdmin(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('partner-creation-runtime:partner-e2e:partner-inquiry-e2e', JSON.stringify({
      actorId: 'partner-e2e',
      inquiryId: 'partner-inquiry-e2e',
      access: { schemaVersion: 1, recoveryId: 'partner-recovery-e2e', browserSessionId: 'partner-browser-e2e',
        leaseToken: 'partner-lease-e2e', baseRevision: 1 },
      saved: { schemaVersion: 1, recoveryId: 'partner-recovery-e2e', recoveryRevision: 1, inputRevision: 1,
        graphHash: 'a'.repeat(64), updatedAt: '2026-09-16T08:00:00.000Z', rows: [], replayed: true },
      configuredRows: [],
      customerId: 'partner-customer-e2e',
      contractDate: '2026-09-16',
      projectId: 'partner-project-e2e',
    }));
  });
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      schemaVersion: 1,
      kind: 'PARTNER',
      actorId: 'partner-e2e',
      actorDisplayName: 'فروشنده همکار آزمایشی',
      profileId: 'partner-profile-e2e',
      writable: true,
      inquiryIds: ['partner-inquiry-e2e'],
      latestInquiryId: 'partner-inquiry-e2e',
      recoverableDrafts: [],
      customers: [{ id: 'partner-customer-e2e', displayName: 'مشتری همکار آزمایشی', address: 'تهران', phone: '09120000000' }],
      projects: [{ id: 'partner-project-e2e', customerId: 'partner-customer-e2e', title: 'پروژه همکار آزمایشی' }],
    } }),
  }));
  await page.route('**/api/partner/inquiries/query-v2', route => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'STATE_CONFLICT', status: 409, message: 'fixture inquiry remains pending' }),
  }));
  await page.route('**/api/crm/partner/customers', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      customer: { customerId: 'partner-customer-created', displayName: 'مشتری تازه همکار' },
    } }),
  }));

  await page.goto('/dashboard/sales/contracts/create');
  await setTheme(page, 'light');
  const workflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(workflow.getByRole('heading', { name: 'ایجاد فروش همکار', exact: true })).toBeVisible();
  await expect(workflow.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' }).getByRole('button')).toHaveCount(7);
  await expect(workflow).toHaveCSS('direction', 'rtl');
  const previous = workflow.getByRole('button', { name: 'قبلی', exact: true });
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(workflow.getByRole('button', { name: /پروژه همکار آزمایشی/ })).toHaveAttribute('aria-pressed', 'true');
  await previous.click();
  await workflow.getByRole('button', { name: 'ایجاد مشتری', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('مشتری');
  await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('تازه');
  await page.getByRole('textbox', { name: 'شماره تماس', exact: true }).fill('09121111111');
  await page.getByRole('textbox', { name: 'نشانی تحویل', exact: true }).fill('تهران');
  await page.getByRole('button', { name: 'ثبت مشتری و ادامه', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage
    .getItem('partner-creation-runtime:partner-e2e:partner-inquiry-e2e') || '{}')))
    .toMatchObject({ customerId: 'partner-customer-created' });
  await workflow.getByRole('button', { name: /مشتری همکار آزمایشی/ }).click();
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await workflow.getByRole('button', { name: /پروژه همکار آزمایشی/ }).click();
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(workflow.getByText('مشخصات فنی ذخیره‌شده برای ۰ ردیف', { exact: true })).toBeVisible();
  await setTheme(page, 'dark');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  expect(await workflow.evaluate(element => element.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('the independent price inquiry remains outside customer and project selection', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      schemaVersion: 1,
      kind: 'PARTNER',
      actorId: 'partner-e2e',
      actorDisplayName: 'فروشنده همکار آزمایشی',
      profileId: 'partner-profile-e2e',
      writable: true,
      inquiryIds: [],
      recoverableDrafts: [],
      customers: [],
      projects: [],
    } }),
  }));
  await page.route('**/api/partner/technical/catalog/query', async route => {
    const kind = (route.request().postDataJSON() as { kind: 'PRODUCT' | 'TOOL' | 'FINISHING' | 'LAYER' }).kind;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [],
    } }) });
  });

  await page.goto('/dashboard/sales/partner-inquiries?newInquiry=1');
  await expect(page.getByRole('heading', { name: 'استعلام قیمت جدید', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'جستجوی مشتری' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /پروژه/ })).toHaveCount(0);
});
