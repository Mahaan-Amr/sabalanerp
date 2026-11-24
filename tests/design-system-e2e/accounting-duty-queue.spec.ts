import { expect, test } from '@playwright/test';

const endpoint = '/api/duties/workspaces/accounting';
const duty = {
  id: 'accounting-duty-ready',
  workspace: 'accounting',
  sourceActionCode: 'FINANCE_RECORDING',
  status: 'OPEN',
  access: 'ASSIGNEE',
  fields: { title: 'آزمایش نمایش وظیفه حسابداری' },
  dueAtDisplay: 'بدون مهلت',
  detailAvailable: true,
  updatedAt: '2026-11-23T11:00:00Z',
};
const summary = {
  open: 1, available: 1, availableUnseen: 1, attention: 2, dueSoon: 0,
  overdue: 0, triage: 0, historyUnseen: 0, canManageTriage: true,
};

test('Accounting queue stays actionable while summary and receipt requests are pending', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });

  let releaseSummary = () => {};
  const summaryPending = new Promise<void>(resolve => { releaseSummary = resolve; });
  let releaseReceipt = () => {};
  const receiptPending = new Promise<void>(resolve => { releaseReceipt = resolve; });
  await page.route(url => url.pathname === endpoint + '/summary', async route => {
    await summaryPending;
    await route.fulfill({ json: { success: true, data: summary } });
  });
  await page.route(url => url.pathname === endpoint + '/duties', route => {
    const available = new URL(route.request().url()).searchParams.get('view') === 'available';
    return route.fulfill({ json: { success: true, data: [available ? { ...duty, access: 'AVAILABLE' } : duty] } });
  });
  await page.route(url => url.pathname === endpoint + '/available-seen', async route => {
    await receiptPending;
    expect(route.request().postDataJSON().seenThrough).toBe(duty.updatedAt);
    await route.fulfill({ json: { success: true, data: { lastSeenAt: duty.updatedAt } } });
  });

  try {
    await page.goto('/dashboard/accounting/duties');
    await expect(page.getByRole('link', { name: 'مشاهده وظیفه' })).toBeVisible();
    await expect(page.getByLabel('در حال بارگذاری شمارش وظایف')).toBeVisible();
    releaseSummary();
    await expect(page.getByRole('button', { name: /بدون مسئول/ })).toBeVisible();
    const acknowledgement = page.waitForRequest(request => new URL(request.url()).pathname === endpoint + '/available-seen');
    await page.getByRole('button', { name: /قابل دریافت/ }).click();
    await acknowledgement;
    await expect(page.getByRole('button', { name: 'دریافت وظیفه', exact: true })).toBeEnabled();
  } finally {
    releaseSummary();
    releaseReceipt();
  }
});
