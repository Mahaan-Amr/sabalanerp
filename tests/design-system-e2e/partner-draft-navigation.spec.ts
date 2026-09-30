import { expect, test } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom } from './support/design-system';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';

for (const allowed of [true, false]) {
  test(`Sales dashboard exposes Partner drafts only when route access is ${allowed}`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.route('**/api/dashboard/route-availability?*', route => {
      const path = new URL(route.request().url()).searchParams.get('path');
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { allowed: path !== '/dashboard/sales/partner-cases' || allowed } }) });
    });
    await page.goto('/dashboard/sales');
    const drafts = page.getByRole('link', { name: 'پیش‌نویس‌ها و پرونده‌های من', exact: true });
    if (!allowed) {
      await expect(page.getByRole('link', { name: 'مشاهده قراردادها', exact: true }).first()).toBeVisible();
      await expect(drafts).toHaveCount(0);
      return;
    }
    await expect(drafts).toBeVisible();
    await expect(drafts).toHaveAttribute('href', '/dashboard/sales/partner-cases');
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await expect(drafts).toBeVisible();
    await page.route('**/api/partner/cases/query-v2', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { cases: [] } }),
    }));
    await drafts.click();
    await expect(page).toHaveURL(/\/dashboard\/sales\/partner-cases$/);
    await expect(page.getByRole('heading', { name: 'پیش نویس ها و پرونده ها', exact: true })).toBeVisible();
  });
}

test('Partner Sales menu keeps contract browsing and exposes saved drafts', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/dashboard/profile', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: { ...body.data, role: 'USER' } } });
  });
  await page.route('**/api/dashboard/route-availability?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { allowed: true } }),
  }));
  await page.goto('/dashboard/sales');
  const drafts = page.getByRole('link', { name: 'پیش‌نویس‌ها و پرونده‌های من', exact: true });
  await expect(drafts).toHaveCount(2);
  for (const link of await drafts.all()) await expect(link).toHaveAttribute('href', '/dashboard/sales/partner-cases');
  await expect(page.getByRole('link', { name: 'مشاهده قراردادها', exact: true })).toHaveCount(2);
});

test('Partner global account is reachable from reports and stays outside individual cases', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerFixtures();
  let accountReads = 0;
  await page.route('**/api/partner/accounting/account', route => {
    accountReads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: fixture.account }) });
  });
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: { cases: [] } }) }));
  await page.goto('/dashboard/sales/partner-cases?caseId=account-separation-test');
  await expect(page.getByText('پرونده‌ای ثبت نشده است', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'حساب من با سبلان', exact: true })).toHaveCount(0);
  expect(accountReads).toBe(0);
  await page.route('**/api/partner/reports?*', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      scope: { kind: 'OWN', from: '2026-01-01', effectiveThrough: '2026-09-29' }, rows: [], totals: [],
    } }) }));
  await page.goto('/dashboard/sales/partner-reports');
  await page.getByRole('button', { name: 'حساب من با سبلان', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'حساب من با سبلان', exact: true })).toBeVisible();
  expect(accountReads).toBeGreaterThanOrEqual(1);
});

test('saved draft destination requests and displays only the newly saved Case details', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  const requestedIds: string[] = [];
  await page.route('**/api/partner/cases/query-v2', route => {
    requestedIds.push(route.request().postDataJSON().caseId);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: { cases: [{ view: fixture.partner, snapshotId: null, history: [],
        actions: { canContinue: false, canPreview: false, canIssue: false, canFinalize: false,
          canSendConfirmation: false, canRequestCorrection: false, canCancel: true, canRequestVoid: false },
      }] },
    }) });
  });
  await page.route('**/api/partner/corrections/query', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) }));
  await page.goto(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(caseId)}`);
  await expect(page.getByRole('heading', { name: 'پرونده‌های فروش همکار', exact: true })).toBeVisible();
  await expect(page.getByText('اطلاعات قرارداد', { exact: true }).first()).toBeVisible();
  expect(requestedIds.length).toBeGreaterThan(0);
  expect(requestedIds.every(id => id === caseId)).toBe(true);
});

test('Partner draft list tags filter all records before ten-item pagination and search resets the page', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerFixtures();
  const cases = Array.from({ length: 23 }, (_, index) => {
    const view = { ...fixture.partner, state: 'DRAFT', caseNumber: `draft-page-${index}`,
      owner: { ...fixture.partner.owner, caseId: `draft-page-${index}` } };
    const { sabalanTotals, sabalanPaymentPlan, resaleDifference, ...unpriced } = view;
    return { view: index % 2 ? { ...unpriced, pricingState: 'AWAITING_INQUIRY',
      products: view.products.map(({ wholesaleUnitPrice, ...product }) => product) } : view,
      snapshotId: null, actions: { canContinue: false, canPreview: false, canIssue: false, canFinalize: false,
        canSendConfirmation: false, canRequestCorrection: false, canCancel: true, canRequestVoid: false } };
  });
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: { cases } }) }));
  await page.route('**/api/partner/corrections/query', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) }));
  await page.goto('/dashboard/sales/partner-cases');
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(11);
  await expect(table.getByText('آماده تکمیل', { exact: true })).toHaveCount(5);
  await expect(table.getByText('در انتظار پاسخ سبلان', { exact: true })).toHaveCount(5);
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(11);
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(4);
  await page.getByLabel('وضعیت پرونده', { exact: true }).click();
  await page.getByRole('option', { name: 'آماده تکمیل', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(11);
  await expect(table.getByText('در انتظار پاسخ سبلان', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'قبلی', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await page.getByPlaceholder('شماره قرارداد، پرونده یا محصول...').fill('draft-page-22');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'قبلی', exact: true })).toBeDisabled();
  await page.getByLabel('وضعیت پرونده', { exact: true }).click();
  await page.getByRole('option', { name: 'در انتظار پاسخ سبلان', exact: true }).click();
  await expect(page.getByText('پرونده‌ای یافت نشد', { exact: true })).toBeVisible();
});
