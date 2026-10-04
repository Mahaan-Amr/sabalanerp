import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

test('Partner management separates seller settings, transfer decisions and retained history across themes and mobile', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/partner/workspaces/query-v2', async route => {
    const query = route.request().postDataJSON();
    const profile = { profile: { schemaVersion: 1, purpose: 'ONBOARDING', profileId: 'transfer-ui-profile', partnerSellerId: 'transfer-ui-seller', revision: 1,
      status: 'ACTIVE', identityVerified: true, commercialTermsReady: true, creditTermsReady: true, responderReady: true, conversionCleared: true, cohortReady: true },
      displayName: query.history ? 'Deleted User' : 'فروشنده آزمون', accountActive: !query.history,
      actions: [{ action: 'PROFILE_SUSPEND', enabled: true }], lifecycleBlockers: [],
      responder: { displayName: 'پاسخ‌دهنده آزمون', eligibleOptions: [], pendingInquiries: [] } };
    const transfer = { transferId: 'transfer-ui-request', revision: 1, customerId: 'transfer-ui-customer',
      match: { schemaVersion: 1, purpose: 'DUPLICATE_MATCH', matchReference: 'transfer-ui-match', displayName: 'مشتری آزمون', personType: 'NATURAL', city: 'تهران', maskedWitness: '********1234' },
      actions: query.transferStatus === 'PENDING' ? [{ action: 'CUSTOMER_TRANSFER_DECIDE', enabled: true }] : [],
      status: query.transferStatus, currentOwner: 'مالک فعلی آزمون', requester: 'فروشنده مقصد آزمون', requestReason: 'درخواست همکاری جدید', requestedAt: '2026-10-03T08:00:00.000Z',
      approvalBlockers: query.transferStatus === 'PENDING' ? [{ label: 'پرونده فروش ناتمام باید تعیین تکلیف شود.', owner: 'فروشنده قبلی', href: '/dashboard/sales/partner-cases?caseId=transfer-ui-case' }] : [] };
    await route.fulfill({ json: { success: true, data: { schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId: 'transfer-ui-admin', personaLabel: 'مدیریت فروش همکار', actions: [],
      profiles: query.section === 'PROFILES' ? [profile] : [], transfers: query.section === 'TRANSFERS' ? [transfer] : [] } } });
  });
  await page.goto('/dashboard/sales/partners');
  await expect(page.getByRole('heading', { name: 'مدیریت همکاران', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'مدیریت همکاران', exact: true }).first()).toBeVisible();
  await expect(page.getByText('فروشنده آزمون', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تعلیق همکاری', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'مشاهده جزئیات', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تعلیق همکاری', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'سوابق', exact: true }).click();
  await expect(page.getByText('حساب حذف‌شده', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'مشاهده جزئیات', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تعلیق همکاری', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'درخواست‌های انتقال مشتری', exact: true }).click();
  await expect(page.getByText('مالک فعلی آزمون', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تأیید انتقال', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'رد انتقال', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'رد انتقال', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'دلیل تصمیم' })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const [width, zoom] of [[1440, 1], [390, 1], [780, 2]] as const) {
      await setViewportAndZoom(page, { width, height: 900 }, zoom);
      await assertNoHorizontalOverflow(page);
      await assertNoSeriousAxeViolations(page);
    }
  }
});

test('Partner sidebar opens a separate transfer page with all tracking information inline', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/dashboard/profile', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: { ...body.data, role: 'USER' } } });
  });
  await page.route('**/api/dashboard/route-availability?*', route => route.fulfill({ json: { success: true, data: { allowed: true } } }));
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true, data: { items: [], total: 0 } } }));
  let trackingReads = 0;
  await page.route('**/api/crm/partner/customer-transfers/mine*', route => {
    trackingReads++;
    return route.fulfill({ json: { success: true, data: { items: [{ id: 'inline-transfer', status: 'APPROVED',
      match: { displayName: 'مشتری انتقال‌یافته' }, requestReason: 'همکاری در پروژه جدید', decisionReason: 'مالکیت بررسی و تأیید شد', requestedAt: '2026-10-03T08:00:00Z' }, { id: 'second-inline-transfer', status: 'PENDING', match: { displayName: 'مشتری دوم' }, requestReason: 'درخواست مستقل دوم', requestedAt: '2026-10-03T09:00:00Z' }] } } });
  });
  await page.goto('/dashboard/sales/partner-customers');
  await expect(page.getByRole('heading', { name: 'مدیریت مشتریان', exact: true })).toBeVisible();
  expect(trackingReads).toBe(0);
  await expect(page.getByRole('heading', { name: 'درخواست‌های انتقال مشتری من', exact: true })).toHaveCount(0);
  const expandSidebar = page.getByRole('button', { name: 'بازکردن منو', exact: true });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  const navigation = page.getByRole('navigation', { name: 'ناوبری فضای کاری' });
  await navigation.getByRole('button', { name: 'مشتریان', exact: true }).click();
  await expect(navigation.getByRole('link', { name: 'مشتریان من', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'درخواست‌های انتقال مشتری من', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/partner-customers\/transfers$/);
  const firstRequest = page.getByRole('button', { name: /مشتری انتقال‌یافته/ });
  const secondRequest = page.getByRole('button', { name: /مشتری دوم/ });
  await expect(firstRequest).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('مالکیت بررسی و تأیید شد', { exact: true })).toBeHidden();
  await firstRequest.click();
  await expect(firstRequest).toHaveAttribute('aria-expanded', 'true');
  await expect(secondRequest).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('همکاری در پروژه جدید', { exact: true })).toBeVisible();
  await expect(page.getByText('مالکیت بررسی و تأیید شد', { exact: true })).toBeVisible();
  await expect(page.getByText('تأییدشده', { exact: true })).toBeVisible();
  await expect(page.getByText('زمان درخواست', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/مشتری باید صریحاً در قرارداد انتخاب شود/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'پیگیری درخواست', exact: true })).toHaveCount(0);
  await secondRequest.click();
  await firstRequest.click();
  await expect(page.getByText('مالکیت بررسی و تأیید شد', { exact: true })).toBeHidden();
  await expect(page.getByText('درخواست مستقل دوم', { exact: true })).toBeVisible();
  await secondRequest.focus();
  await page.keyboard.press('Enter');
  await expect(secondRequest).toHaveAttribute('aria-expanded', 'false');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
  }
});
