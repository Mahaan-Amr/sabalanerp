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
