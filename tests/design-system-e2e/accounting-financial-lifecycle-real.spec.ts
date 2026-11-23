import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Response } from '@playwright/test';

const directory = process.env.ACCOUNTING_REAL_LIFECYCLE_QA_DIR;

test('register and financially approve a new draft for a copied contract', async ({ page, baseURL }) => {
  test.skip(!directory, 'Requires an isolated local restore with the affected contract.');
  test.setTimeout(180_000);
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const { database } = JSON.parse(readFileSync(`${directory}/database.json`, 'utf8'));
  const expected = JSON.parse(readFileSync(`${directory}/expected-record.json`, 'utf8'));
  const { caseId, customerContractNumber: contractNumber } = expected;
  expect(typeof caseId === 'string' && caseId.length > 0).toBe(true);
  expect(typeof contractNumber).toBe('string');
  expect(contractNumber).toMatch(/^\d+$/);
  expect(database).toMatch(new RegExp(`^contract${contractNumber}_qa_[a-f0-9]{10}$`));
  const contractPath = `/dashboard/accounting/contracts/partner/${encodeURIComponent(caseId)}`;
  const services = execFileSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  expect(services.length).toBeGreaterThan(0);
  expect(services.every(service => service.Project === 'sabalanerp-local')).toBe(true);
  const owner = JSON.parse(execFileSync('docker', ['exec', 'sabalanerp-local-inquiry-1', 'cat',
    '/app/recovery-coordination/deployment-runtime-native.json'], { encoding: 'utf8' }));
  expect(owner.phase).toBe('ACTIVE');
  expect(owner.initialDatabase.name).toBe(database);
  const login = JSON.parse(readFileSync(`${directory}/login.private.json`, 'utf8'));
  const evidence: Record<string, unknown> = {};
  async function mutation(path: string, action: string, trigger: () => Promise<unknown>) {
    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === path && response.request().method() === 'POST');
    await trigger();
    const response = await responsePromise;
    const body = await response.json();
    evidence[action] = { httpStatus: response.status(), code: body.code ?? body.error?.code, error: !response.ok() ? body.message ?? body.error : undefined };
    writeFileSync(`${directory}/lifecycle-result.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    expect(response.ok(), `${action}: ${JSON.stringify(evidence[action])}`).toBe(true);
    expect(body.success ?? body.ok ?? true).toBe(true);
  }
  const internal = (response: Response) => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/api/accounting/contracts/partner/${encodeURIComponent(caseId)}/internal`;

  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(login.identifier);
  await page.locator('input[name="password"]').fill(login.password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  const initial = page.waitForResponse(internal);
  await page.goto(contractPath);
  const original = (await (await initial).json()).data;
  expect(original.partnerContext.customerContractNumber).toBe(contractNumber);
  const previousDraftId = expected.id;
  expect(original.id).toBe(previousDraftId);
  expect(original.status).toBe('DRAFT');
  await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
  await page.getByRole('button', { name: 'حذف پیش‌نویس', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'حذف پیش‌نویس رکورد مالی' });
  await dialog.getByRole('textbox', { name: 'دلیل' }).fill('آزمون چرخه ثبت قرارداد در پایگاه داده ایزوله');
  await mutation('/api/accounting/actions', 'deleteExistingDraft', () =>
    dialog.getByRole('button', { name: 'حذف پیش‌نویس', exact: true }).click());
  await page.getByRole('button', { name: 'خلاصه', exact: true }).click();

  const register = page.getByRole('button', { name: 'ثبت رکورد مالی', exact: true });
  await expect(register).toBeEnabled({ timeout: 15_000 });
  await mutation('/api/partner/accounting/enqueue', 'registerNewDraft', () => register.click());
  const review = page.getByRole('link', { name: 'بررسی و تأیید مالی', exact: true });
  await expect(review).toBeVisible();
  const href = (await review.getAttribute('href'))!;
  const recordId = decodeURIComponent(new URL(href, baseURL).pathname.split('/').at(-1)!);
  expect(recordId).not.toBe(previousDraftId);
  const getRecord = async () => {
    const query = new URLSearchParams({ kind: 'INVOICE_CANDIDATE', recordId, page: '1', pageSize: '1' });
    const response = await page.request.get(`/api/accounting/financial-records?${query}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].id).toBe(recordId);
    return body.data.items[0];
  };
  const draft = await getRecord();
  expect(draft.status).toBe('DRAFT');
  expect(draft.partnerContext.caseId).toBe(caseId);
  expect(String(draft.amount)).toBe(String(original.amount));
  expect(draft.currency).toBe(original.currency);

  await review.click();
  const invoiceNumber = `QA-${randomUUID().slice(0, 8)}`;
  await page.getByRole('textbox', { name: 'شماره فاکتور سیستمی', exact: true }).fill(invoiceNumber);
  expect(String(draft.amount)).toMatch(/^\d+$/);
  expect(['IRT', 'IRR']).toContain(draft.currency);
  await page.getByPlaceholder('مبلغ سپیدار').fill(String(BigInt(draft.amount) * (draft.currency === 'IRT' ? 10n : 1n)));
  const external = page.getByRole('textbox', { name: 'مرجع ابطال صورتحساب قبلی' });
  if (await external.isVisible()) {
    await external.fill(`QA-VOID-${invoiceNumber}`);
    await page.getByRole('textbox', { name: 'مستند تسویه و اصلاح سوابق پایین‌دستی' }).fill('مدرک آزمایشی مخصوص کپی ایزوله');
  }
  await mutation('/api/accounting/actions', 'approveDraft', () =>
    page.getByRole('button', { name: 'تایید مالی', exact: true }).click());
  await expect(page.getByRole('button', { name: 'تایید مالی', exact: true })).toHaveCount(0);
  const issued = await getRecord();
  expect(issued.status).toBe('ISSUED');
  expect(issued.systemInvoiceNumber).toBe(invoiceNumber);
  expect(issued.financiallyApprovedAt).toBeTruthy();
  expect(String(issued.amount)).toBe(String(draft.amount));
  expect(issued.currency).toBe(draft.currency);
  expect(String(issued.sepidarAmount)).toBe(String(draft.amount));
  const audit = await page.request.get(`/api/accounting/audit?${new URLSearchParams({ recordId, page: '1', pageSize: '100' })}`);
  expect(audit.status()).toBe(200);
  const { data } = await audit.json();
  expect(data.items.filter((row: { action: string }) => row.action === 'APPROVE_FINANCIAL_INVOICE')).toHaveLength(1);
  writeFileSync(`${directory}/lifecycle-result.json`, JSON.stringify({
    ...evidence, success: true, contractNumber, recordId, previousDraftId,
    status: issued.status, systemInvoiceNumber: issued.systemInvoiceNumber, amount: issued.amount,
    currency: issued.currency, approvalAuditCount: 1,
  }, null, 2), { mode: 0o600 });
});
