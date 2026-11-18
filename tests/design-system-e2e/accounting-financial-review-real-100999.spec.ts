import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const directory = process.env.ACCOUNTING_REAL_100999_QA_DIR;
const staleRecordId = 'partner-accounting:5a11d03abd0ece495a335b337d94b2b8d9d726b73715abeff6c3e6b3592f2c52:replacement:2d8dadce-7015-40e3-a14d-ed45b0f11fe8';
const caseId = 'partner-recovery-2d9483cb-f2f8-40e2-b3b5-189136c98fe4';
const contractPath = `/dashboard/accounting/contracts/partner/${caseId}`;


test('real copied contract 100999 opens through authenticated APIs without financial mutations', async ({ page }, testInfo) => {
  test.skip(!directory, 'Requires the private restored production copy in the existing local Compose project.');
  test.setTimeout(240_000);
  const expected = JSON.parse(readFileSync(`${directory}/expected-record.json`, 'utf8'));
  const recordId = expected.id;
  const reviewPath = `/dashboard/accounting/invoice-candidates/${encodeURIComponent(recordId)}`;
  const login = JSON.parse(readFileSync(`${directory}/login.private.json`, 'utf8'));
  const reads: Array<{ path: string; id: string | null; status: number; milliseconds: number }> = [];
  const financialWrites: string[] = [];
  const started = new Map<string, number>();
  page.on('request', request => {
    if (request.url().includes('/api/accounting/')) {
      if (request.method() !== 'GET') financialWrites.push(new URL(request.url()).pathname);
      started.set(request.url(), Date.now());
    }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api/accounting/financial-records' || url.pathname === '/api/accounting/audit') {
      reads.push({ path: url.pathname, id: url.searchParams.get('recordId'), status: response.status(), milliseconds: Date.now() - (started.get(response.url()) || Date.now()) });
    }
  });
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(login.identifier);
  await page.locator('input[name="password"]').fill(login.password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  const checkLoaded = async () => {
    await expect(page.getByRole('heading', { name: 'مبلغ و وضعیت', exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('این رکورد مالی پیدا نشد یا دسترسی مشاهده آن فعال نیست.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('شماره فاکتور سیستمی', { exact: true })).toBeVisible();
  };
  await page.goto(`/dashboard/accounting/invoice-candidates/${encodeURIComponent(staleRecordId)}`);
  await expect(page.getByText('این رکورد مالی پیدا نشد یا دسترسی مشاهده آن فعال نیست.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مبلغ و وضعیت', exact: true })).toHaveCount(0);
  const href = `${reviewPath}?returnTo=${encodeURIComponent(contractPath)}`;
  await page.goto(href);
  await checkLoaded();
  await page.reload();
  await checkLoaded();
  await page.goto(contractPath);
  await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
  const link = page.locator(`a[href^="${reviewPath}"]`).first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toContainText('بررسی و تأیید مالی');
  await link.click();
  await checkLoaded();
  const financial = await page.request.get(`/api/accounting/financial-records?kind=INVOICE_CANDIDATE&recordId=${encodeURIComponent(recordId)}&page=1&pageSize=1`);
  expect(financial.status()).toBe(200);
  const body = await financial.json();
  expect(body.data.items).toHaveLength(1);
  expect(body.data.items[0].id).toBe(recordId);
  expect(body.data.items[0].status).toBe('DRAFT');
  expect(Number(body.data.items[0].amount)).toBe(Number(expected.amount));
  expect(body.data.items[0].currency).toBe('IRT');
  expect(body.data.items[0].partnerContext.caseId).toBe(caseId);
  expect(reads.filter(row => row.id !== null && row.id !== staleRecordId).every(row => row.id === recordId && row.status === 200)).toBe(true);
  expect(reads.filter(row => row.id === recordId && row.path.endsWith('/audit')).length).toBeGreaterThanOrEqual(3);
  expect(financialWrites).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('real-contract-100999-review.png'), fullPage: true });
  writeFileSync(`${directory}/browser-result.json`, JSON.stringify({ success: true, mockRoutes: false, staleRecordRefused: true, direct: true, refresh: true, contractLink: true, financialWrites, reads, record: { id: body.data.items[0].id, status: body.data.items[0].status, amount: body.data.items[0].amount, currency: body.data.items[0].currency } }, null, 2), { mode: 0o600 });
});
