import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const id = 'partner-accounting:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:replacement:00000000-0000-4000-8000-000000000001';
const href = `/dashboard/accounting/invoice-candidates/${encodeURIComponent(id)}`;
const user = { id: 'historical-admin', username: 'reviewer', firstName: 'حسابدار', lastName: 'آزمون',
  role: 'ADMIN', isActive: true, permissions: { features: [] } };

async function installReview(page: Page, wrongRecord = false, expectedId = id) {
  // Optional real service output comes from the isolated existing-Compose DB test.
  const fixture = process.env.ACCOUNTING_REVIEW_FIXTURE_OUTPUT
    ? JSON.parse(readFileSync(process.env.ACCOUNTING_REVIEW_FIXTURE_OUTPUT, 'utf8'))
    : { financial: { success: true, data: { items: [{ id, sourceKind: 'PARTNER_INTERNAL_RECORD', status: 'DRAFT',
      amount: '200', currency: 'IRR', createdAt: '2026-11-18T05:59:59.172Z',
      partnerContext: { caseId: 'historical-case', caseNumber: '900001', internalRecordNumber: 'test',
        debtor: { displayName: 'طرف حساب آزمون' } }, invoiceItems: [], receivables: [], taxRecords: [] }],
      total: 1, page: 1, pageSize: 1, actionAvailability: { approve: true } } },
      audit: { success: true, data: { items: [], total: 0 } } };
  fixture.financial.data.items[0].id = expectedId;
  const before = JSON.stringify(fixture);
  const requests: Array<{ path: string; recordId: string | null }> = [];
  const writes: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: { success: false } }); }
    let body: unknown = { success: true, data: { items: [], total: 0 }, count: 0, unreadCount: 0 };
    if (url.pathname === '/api/auth/me') body = { success: true, data: user, session: { id: 'review-test-session' } };
    else if (url.pathname === '/api/workspace-permissions/user-workspaces') body = { success: true, data: [{ workspace: 'accounting', permission: 'admin' }] };
    else if (url.pathname === '/api/dashboard/route-availability') body = { success: true, data: { allowed: true } };
    else if (url.pathname.endsWith('/badge/me')) body = { success: true, badge: null };
    else if (url.pathname === '/api/accounting/financial-records' || url.pathname === '/api/accounting/audit') {
      const recordId = url.searchParams.get('recordId');
      requests.push({ path: url.pathname, recordId });
      if (url.pathname.endsWith('/financial-records')) {
        body = recordId && recordId !== expectedId ? { success: true, data: { items: [], total: 0 } } : wrongRecord
          ? { success: true, data: { ...fixture.financial.data, items: [{ ...fixture.financial.data.items[0], id: 'different-record' }] } }
          : fixture.financial;
      } else body = fixture.audit;
    }
    await route.fulfill({ json: body });
  });
  return { fixture, before, requests, writes };
}

test('900001 opens by direct URL, refresh and client navigation with one canonical identity', async ({ page }, testInfo) => {
  const state = await installReview(page);
  const assertLoaded = async () => {
    await expect(page.getByRole('heading', { name: 'مبلغ و وضعیت', exact: true })).toBeVisible();
    await expect(page.getByText('این رکورد مالی پیدا نشد یا دسترسی مشاهده آن فعال نیست.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('شماره فاکتور سیستمی', { exact: true })).toBeVisible();
    expect(state.requests.filter(row => row.recordId !== null).every(row => row.recordId === id)).toBe(true);
    expect(state.requests.some(row => row.path.endsWith('/audit'))).toBe(true);
  };
  await page.goto(href);
  await assertLoaded();
  await page.reload();
  await assertLoaded();
  await page.goto('/dashboard/accounting/invoice-candidates');
  const link = page.locator(`a[href^="${href}"]:visible`).first();
  await expect(link).toBeVisible();
  await link.click();
  await assertLoaded();
  await page.screenshot({ path: testInfo.outputPath('contract-900001-financial-review.png'), fullPage: true });
  expect(state.writes).toEqual([]);
  expect(JSON.stringify(state.fixture)).toBe(state.before);
});

test('a response for a different record cannot display financial details or approval', async ({ page }) => {
  const state = await installReview(page, true);
  await page.goto(href);
  await expect(page.getByText('این رکورد مالی پیدا نشد یا دسترسی مشاهده آن فعال نیست.', { exact: true })).toBeVisible();
  await expect(page.getByText('شماره فاکتور سیستمی', { exact: true })).toHaveCount(0);
  expect(state.requests.some(row => row.path.endsWith('/audit'))).toBe(false);
  expect(state.writes).toEqual([]);
});

test('a literal percent sequence in a stored identity is never decoded into another record', async ({ page }) => {
  const literalId = 'ordinary%3Aidentity';
  const state = await installReview(page, false, literalId);
  await page.goto(`/dashboard/accounting/invoice-candidates/${encodeURIComponent(literalId)}`);
  await expect(page.getByRole('heading', { name: 'مبلغ و وضعیت', exact: true })).toBeVisible();
  expect(state.requests.every(row => row.recordId === literalId)).toBe(true);
  expect(state.writes).toEqual([]);
});
