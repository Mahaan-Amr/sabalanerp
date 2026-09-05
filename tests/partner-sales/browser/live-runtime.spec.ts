import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const namespace = process.env.PARTNER_QA_RUN_ID!;
const fixture = path.join(repositoryRoot, 'tests/partner-sales/harness/live-flow-fixture.ts');
const tsx = path.join(repositoryRoot, 'backend/node_modules/tsx/dist/cli.mjs');
const password = 'PartnerQa!334';
const api = 'http://127.0.0.1:5000/api';

function seedFixture() {
  const mode = 'seed';
  const result = spawnSync(process.execPath, [tsx, fixture, mode, namespace], {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, NODE_PATH: path.join(repositoryRoot, 'backend/node_modules') },
  });
  if (result.error || result.status !== 0) throw new Error(`Partner live fixture ${mode} failed: ${result.stderr || result.stdout || result.error?.message}`);
}

async function logout(page: Page, beginSessionSwitch: () => void) {
  beginSessionSwitch();
  await page.goto('/about');
  const response = await page.request.post(`${api}/auth/logout`);
  expect(response.ok()).toBeTruthy();
  await page.context().clearCookies();
  try { await page.goto('/login', { waitUntil: 'commit' }); }
  catch (error) { if (!/net::ERR_ABORTED/.test(String(error))) throw error; }
  if (!/\/login(?:$|\?)/.test(new URL(page.url()).pathname + new URL(page.url()).search)) {
    await page.goto('/login', { waitUntil: 'commit' });
  }
  await page.waitForURL(/\/login(?:$|\?)/);
}

test('authenticated Partner case reads and persists correction state @live-runtime', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'One isolated mutation run is sufficient; responsive shell is covered separately.');
  test.setTimeout(1_200_000);
  // This external footer image is not Partner behavior; keep local UI/API traffic fully real.
  await page.route('https://trustseal.enamad.ir/logo.aspx?*', route => route.fulfill({
    status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>',
  }));
  seedFixture();
  const unexpected: string[] = [];
  let expectingInvalidOtp = false;
  let expectingVoidRejection = false;
  let switchingSession = false;
  page.on('pageerror', error => unexpected.push(`uncaught page error: ${error.message.split('\n')[0]}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const pathname = message.location().url ? new URL(message.location().url).pathname : '';
    const safePathname = pathname.replace(/(\/api\/public\/contracts\/confirm\/)[^/]+(\/verify)/, '$1<REDACTED>$2');
    const firstLine = message.text().split('\n')[0];
    if (pathname === '/api/auth/me' && /status of 401/.test(message.text())) return;
    if (switchingSession && /401/.test(message.text())) return;
    if (pathname.endsWith('/node_modules/next/dist/client/app-index.js')
      && /^Failed to fetch RSC payload for http:\/\/127\.0\.0\.1:3000\/dashboard\/(?:sales|accounting|hr)\. Falling back to browser navigation\. TypeError: Failed to fetch$/.test(firstLine)) return;
    if (expectingInvalidOtp && /^\/api\/public\/contracts\/confirm\/[^/]+\/verify$/.test(pathname)
      && /status of 400/.test(message.text())) return;
    if (expectingVoidRejection && pathname === '/api/partner/corrections/commands' && /status of 404/.test(message.text())) return;
    unexpected.push(`console error ${safePathname || '(unknown)'}: ${firstLine}`);
  });
  try {
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(namespace);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750);
    await page.goto('/dashboard/sales/contracts/create');
    await expect(page.getByRole('heading', { name: 'ایجاد فروش همکار' })).toBeVisible();
    const product = page.getByRole('combobox', { name: 'محصول فنی' });
    await expect(product.locator('option', { hasText: 'سنگ آماده آزمون یکپارچه' })).toHaveCount(1);
    await product.selectOption({ label: 'سنگ آماده آزمون یکپارچه' });
    await page.getByRole('button', { name: 'ذخیره مشخصات و ارسال استعلام' }).click();
    await expect(page.getByRole('region', { name: 'استعلام قیمت' })).toBeVisible();
    const inquiryRuntime = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(item => item.startsWith('partner-creation-runtime:'));
      return key ? JSON.parse(localStorage.getItem(key) || 'null') as { inquiryId: string } : null;
    });
    expect(inquiryRuntime?.inquiryId).toBeTruthy();

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(`${namespace}-manager-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    await page.goto('/dashboard/sales/partners');
    await expect(page.getByRole('heading', { name: 'مدیریت فروشندگان همکار' })).toBeVisible();
    await expect(page.getByText('آزمون همکار')).toBeVisible();
    await page.getByRole('button', { name: 'تغییر پاسخ‌دهنده' }).click();
    await page.getByLabel('گزینه جدید').selectOption({ label: 'آزمون پاسخ‌گوی جایگزین' });
    await page.getByLabel('استعلام منتظر پاسخ').selectOption({ label: 'استعلام در انتظار پاسخ' });
    await page.getByLabel('دلیل تصمیم').fill('واگذاری کنترل‌شده برای آزمون مرورگر');
    await page.getByRole('button', { name: 'تأیید و ثبت' }).click();
    await expect(page.getByText('تصمیم ثبت شد.')).toBeVisible();

    for (const responderId of [`${namespace}-responder-user`, `${namespace}-unrelated-responder-user`]) {
      await logout(page, () => { switchingSession = true; });
      await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(responderId);
      await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
      await page.getByRole('button', { name: 'ورود', exact: true }).click();
      await page.waitForURL(/\/dashboard(?:$|\?)/);
      await page.waitForTimeout(750); switchingSession = false;
      await page.goto('/dashboard/sales/partner-inquiries');
      await expect(page.getByRole('heading', { name: 'پاسخ استعلام‌های همکار' })).toBeVisible();
      await expect(page.getByText('استعلام منتسبی در دسترس نیست.')).toBeVisible();
    }

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' })
      .fill(`${namespace}-replacement-responder-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    await page.goto('/dashboard/sales/partner-inquiries');
    await expect(page.getByRole('heading', { name: 'پاسخ استعلام‌های همکار' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'انتخاب ردیف 1' }).check();
    await page.getByLabel('قیمت هر واحد ردیف 1 (تومان)').fill('100');
    await page.getByLabel('یادداشت ردیف 1 (اختیاری)').fill('قیمت مصوب آزمون یکپارچه');
    await page.getByRole('button', { name: 'بررسی پاسخ ردیف‌های انتخاب‌شده' }).click();
    await expect(page.getByRole('heading', { name: 'بررسی پاسخ قیمت' })).toBeVisible();
    await page.getByRole('button', { name: 'ثبت پاسخ‌ها' }).click();
    await expect(page.getByText('1 ردیف ثبت شد؛ 0 ردیف نیازمند بررسی است.')).toBeVisible();

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(namespace);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    await page.goto('/dashboard/sales/contracts/create');
    await expect(page.getByText('تأییدشده').first()).toBeVisible();
    await page.getByRole('button', { name: 'ساخت پرونده و ورود به Wizard' }).click();
    await expect(page.getByRole('region', { name: 'ایجاد پرونده فروش همکار' })).toBeVisible();
    for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'ادامه', exact: true }).click();
    await page.getByRole('button', { name: 'ثبت پرونده', exact: true }).click();
    await expect(page.getByText(/ثبت شد/)).toBeVisible();
    const createdCases = await page.request.post(`${api}/partner/cases/query-v2`, { data: {} });
    expect(createdCases.ok()).toBeTruthy();
    const created = ((await createdCases.json()).data.cases as Array<{ view: { owner: {
      caseId: string; revision: number; integrityHash: string }; state: string; caseNumber: string;
      customerContractNumber: string }; snapshotId: string | null }> )
      .find(item => item.view.owner.caseId !== `${namespace}-case`);
    expect(created?.view.state).toBe('DRAFT');
    const createdOwner = created!.view.owner;
    const confirmation = await page.request.post(`${api}/partner/cases/${createdOwner.caseId}/confirmation`, { data: {} });
    const confirmationBody = await confirmation.json();
    expect(confirmation.ok(), JSON.stringify(confirmationBody)).toBeTruthy();
    const confirmationData = confirmationBody.data as { publicLink: string; debugOtp: string };
    expect(confirmationData.debugOtp).toMatch(/^\d{6}$/);
    await page.goto(confirmationData.publicLink);
    await expect(page.getByRole('heading', { name: 'تایید دیجیتال قرارداد' })).toBeVisible();
    const otp = page.getByPlaceholder('کد تایید');
    expectingInvalidOtp = true;
    try {
      await otp.fill('000000');
      await page.getByRole('button', { name: 'تایید قرارداد' }).click();
      await expect(page.getByText('کد تایید نامعتبر است')).toBeVisible();
    } finally { expectingInvalidOtp = false; }
    await otp.fill(confirmationData.debugOtp);
    await page.getByRole('button', { name: 'تایید قرارداد' }).click();
    await expect(page.getByText(/تایید شده/).last()).toBeVisible();
    const approvedQuery = await page.request.post(`${api}/partner/cases/query-v2`, { data: { caseId: createdOwner.caseId } });
    const approvedCase = (await approvedQuery.json()).data.cases[0] as { view: { state: string }; snapshotId: string };
    expect(approvedCase.view.state).toBe('CUSTOMER_APPROVED');
    const finalOutput = await page.request.post(`${api}/partner/cases/${createdOwner.caseId}/output`, {
      data: { mode: 'FINAL', snapshotId: approvedCase.snapshotId } });
    expect(finalOutput.ok()).toBeTruthy();
    const committedQuery = await page.request.post(`${api}/partner/cases/query-v2`, { data: { caseId: createdOwner.caseId } });
    expect((await committedQuery.json()).data.cases[0].view.state).toBe('COMMITTED');
    expect([403, 404]).toContain((await page.request.post(`${api}/partner/accounting/enqueue`, { data: createdOwner })).status());
    expect([403, 404]).toContain((await page.request.get(`${api}/partner/fulfillment/${createdOwner.caseId}`)).status());

    await page.goto('/dashboard/sales/partner-cases');
    await expect(page.getByRole('heading', { name: `پرونده ${namespace}-number` })).toBeVisible();
    await expect(page.getByText('۱۵۰ تومان', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('۱۰۰ تومان', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('۵۰ تومان', { exact: true })).toBeVisible();
    await expect(page.getByText('مانده مشتری').first()).toBeVisible();

    const reportQuery = { purpose: 'PARTNER', from: '2026-01-01', to: '2026-12-31', offset: 0, limit: 20 };
    const report = await page.request.get(`${api}/partner/reports`, { params: reportQuery });
    expect(report.ok()).toBeTruthy();
    const reportData = (await report.json()).data.rows as Array<{ caseId: string; metrics: unknown }>;
    expect(reportData.find(row => row.caseId === createdOwner.caseId)?.metrics)
      .toMatchObject({ retailSales: '100', wholesalePurchases: '100' });
    const exported = await page.request.post(`${api}/partner/reports/exports`, { data: reportQuery });
    expect(exported.ok()).toBeTruthy();
    const exportId = (await exported.json()).data.exportId as string;
    expect((await page.request.get(`${api}/partner/reports/exports/${exportId}`)).ok()).toBeTruthy();

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(`${namespace}-ordinary-accounting-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    const ordinaryContracts = await page.request.get(`${api}/accounting/contracts`);
    const ordinaryContractsBody = await ordinaryContracts.json();
    expect(ordinaryContracts.ok(), JSON.stringify(ordinaryContractsBody)).toBeTruthy();
    const ordinaryWorkspace = await page.request.get(`${api}/accounting/workspace`);
    const ordinaryWorkspaceBody = await ordinaryWorkspace.json();
    expect(ordinaryWorkspace.ok(), JSON.stringify(ordinaryWorkspaceBody)).toBeTruthy();
    for (const body of [ordinaryContractsBody, ordinaryWorkspaceBody]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(`${namespace}-customer-contract`);
      expect(serialized).not.toContain(created!.view.customerContractNumber);
      expect(serialized).not.toContain(createdOwner.caseId);
    }

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(`${namespace}-accounting-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    const expected = createdOwner;
    const queued = await page.request.post(`${api}/partner/accounting/enqueue`, { data: expected });
    const queuedBody = await queued.json();
    expect(queued.ok(), JSON.stringify(queuedBody)).toBeTruthy();
    const invoiceRecordId = queuedBody.data.queueEvidenceId as string;
    const replayedQueue = await page.request.post(`${api}/partner/accounting/enqueue`, { data: expected });
    expect(replayedQueue.ok()).toBeTruthy();
    expect((await replayedQueue.json()).data.queueEvidenceId).toBe(invoiceRecordId);
    const prepared = await page.request.post(`${api}/partner/accounting/prepare`, { data: expected });
    expect(prepared.ok()).toBeTruthy();
    expect((await prepared.json()).data.amount).toEqual({ amount: '100', currency: 'IRT' });
    await page.goto('/dashboard/accounting/invoice-candidates');
    await expect(page.getByRole('heading', { name: 'پیش‌نویس صورتحساب‌ها' })).toBeVisible();
    const accountingRow = page.getByRole('row').filter({ hasText: `پرونده ${created!.view.caseNumber}` });
    await expect(accountingRow).toBeVisible();
    await accountingRow.getByRole('button', { name: 'تایید مالی' }).click({ timeout: 15_000 });
    await page.getByLabel('شماره فاکتور سیستمی').fill(`${namespace}-invoice`);
    await page.getByLabel('مبلغ سپیدار (تومان)').fill('100');
    await page.getByRole('button', { name: 'تایید مالی' }).last().click();
    await expect(page.getByText('عملیات حسابداری با موفقیت ثبت شد')).toBeVisible();
    expect([403, 404]).toContain((await page.request.get(`${api}/partner/fulfillment/${createdOwner.caseId}`)).status());

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(`${namespace}-fulfillment-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    expect([403, 404]).toContain((await page.request.post(`${api}/partner/accounting/prepare`, { data: expected })).status());
    const fulfillmentSource = await page.request.get(`${api}/partner/fulfillment/${createdOwner.caseId}`);
    expect(fulfillmentSource.ok()).toBeTruthy();
    const fulfillmentView = (await fulfillmentSource.json()).data;
    const fulfillment = await page.request.post(`${api}/partner/fulfillment/materialize`, { data: {
      view: fulfillmentView, expected, commandId: `${namespace}-fulfillment-command`,
      idempotencyKey: `${namespace}-fulfillment-key` } });
    expect(fulfillment.ok()).toBeTruthy();
    expect((await fulfillment.json()).data.lineageEvidenceIds).toHaveLength(1);

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(namespace);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    await page.goto('/dashboard/sales/partner-cases');
    await expect(page.getByRole('heading', { name: `پرونده ${namespace}-number` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'حساب من با سبلان' })).toBeVisible();

    await page.getByRole('button', { name: 'درخواست اصلاح retail', exact: true }).last().click();
    await expect(page.getByText('در انتظار بررسی دامنه اصلاح')).toBeVisible();
    await page.reload();
    await expect(page.getByText('در انتظار بررسی دامنه اصلاح')).toBeVisible();

    expectingVoidRejection = true;
    const rejectedVoid = page.waitForResponse(response => response.url().endsWith('/api/partner/corrections/commands')
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: /درخواست ابطال پس از/ }).last().click();
    expect((await rejectedVoid).status()).toBe(404);
    await expect(page.getByText('انجام عملیات پرونده ممکن نشد. لطفاً دوباره تلاش کنید.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('partner-case-live.png'), fullPage: true });

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(`${namespace}-hr-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    await page.goto('/dashboard/hr/partners');
    await expect(page.getByRole('heading', { name: 'مدیریت فروشندگان همکار' })).toBeVisible();
    await expect(page.getByText('فعال', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'تعلیق همکاری' }).click();
    await page.getByLabel('دلیل تصمیم').fill('تعلیق کنترل‌شده در پذیرش مرورگر');
    await page.getByRole('button', { name: 'تأیید و ثبت' }).click();
    await expect(page.getByText('تصمیم ثبت شد.')).toBeVisible();
    await expect(page.getByText('معلق', { exact: true })).toBeVisible();

    await logout(page, () => { switchingSession = true; });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(`${namespace}-admin-user`);
    await page.getByRole('textbox', { name: 'رمز عبور' }).fill(password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL(/\/dashboard(?:$|\?)/);
    await page.waitForTimeout(750); switchingSession = false;
    await page.goto('/dashboard/sales/partners');
    await expect(page.getByText('معلق', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'خاتمه همکاری' }).click();
    await page.getByLabel('دلیل تصمیم').fill('خاتمه کنترل‌شده در پذیرش مرورگر');
    await page.getByRole('button', { name: 'تأیید و ثبت' }).click();
    await expect(page.getByText('تصمیم ثبت شد.')).toBeVisible();
    await expect(page.getByText('خاتمه‌یافته', { exact: true })).toBeVisible();
    expect(unexpected).toEqual([]);
  } finally { /* The runner drops the isolated browser database after restoring the normal backend. */ }
});
