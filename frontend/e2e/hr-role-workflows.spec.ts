import { expect, request, test } from '@playwright/test';

const env = (name: string) => process.env[name] || '';
const apiBase = () => `${env('HR_E2E_API_URL').replace(/\/$/, '')}/api`;
const futureDate = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const roleRequest = (token: string) => request.newContext({
  baseURL: apiBase(),
  extraHTTPHeaders: { Authorization: `Bearer ${token}` },
});

test.describe('cross-role HR operational journeys', () => {
  test.skip(
    !env('HR_E2E_API_URL') || !env('HR_E2E_APPLICATION_ID'),
    'Set the HR_E2E_* environment variables to run against the seeded HR acceptance environment.',
  );

  test('Finance Recorder submission is required before separate Finance Manager review', async () => {
    test.skip(!env('HR_E2E_FINANCE_RECORDER_TOKEN') || !env('HR_E2E_FINANCE_MANAGER_TOKEN'));
    const applicationId = env('HR_E2E_APPLICATION_ID');
    const recorder = await roleRequest(env('HR_E2E_FINANCE_RECORDER_TOKEN'));
    const manager = await roleRequest(env('HR_E2E_FINANCE_MANAGER_TOKEN'));
    const upload = await recorder.post(`/hr-hiring/applications/${applicationId}/contracts`, {
      multipart: {
        contractNumber: `E2E-${Date.now()}`,
        effectiveFrom: env('HR_E2E_CONTRACT_START') || '2026-07-01',
        effectiveTo: env('HR_E2E_CONTRACT_END') || '2026-12-31',
        file: { name: 'employment-contract.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const contract = (await upload.json()).data;
    const premature = await manager.post(`/hr-hiring/applications/${applicationId}/contracts/${contract.id}/approve`);
    expect(premature.ok()).toBeFalsy();
    expect((await recorder.post(`/hr-hiring/applications/${applicationId}/contracts/${contract.id}/submit`)).ok()).toBeTruthy();
    expect((await manager.post(`/hr-hiring/applications/${applicationId}/contracts/${contract.id}/return`, { data: { reason: 'E2E correction required' } })).ok()).toBeTruthy();
    const replacementUpload = await recorder.post(`/hr-hiring/applications/${applicationId}/contracts`, {
      multipart: {
        contractNumber: `E2E-REPLACEMENT-${Date.now()}`,
        effectiveFrom: env('HR_E2E_CONTRACT_START') || '2026-07-01',
        effectiveTo: env('HR_E2E_CONTRACT_END') || '2026-12-31',
        file: { name: 'employment-contract-replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') },
      },
    });
    expect(replacementUpload.ok()).toBeTruthy();
    const replacement = (await replacementUpload.json()).data;
    expect((await recorder.post(`/hr-hiring/applications/${applicationId}/contracts/${replacement.id}/submit`)).ok()).toBeTruthy();
    expect((await manager.post(`/hr-hiring/applications/${applicationId}/contracts/${replacement.id}/approve`)).ok()).toBeTruthy();
    await recorder.dispose();
    await manager.dispose();
  });

  test('HR Processor insurance, Payroll Manager participation, then HR Manager activation', async () => {
    test.skip(!env('HR_E2E_HR_PROCESSOR_TOKEN') || !env('HR_E2E_PAYROLL_MANAGER_TOKEN') || !env('HR_E2E_HR_MANAGER_TOKEN'));
    const applicationId = env('HR_E2E_APPLICATION_ID');
    const processor = await roleRequest(env('HR_E2E_HR_PROCESSOR_TOKEN'));
    const payroll = await roleRequest(env('HR_E2E_PAYROLL_MANAGER_TOKEN'));
    const manager = await roleRequest(env('HR_E2E_HR_MANAGER_TOKEN'));
    expect((await processor.put(`/hr-hiring/applications/${applicationId}/insurance`, { data: {
      registrationPath: 'INDEPENDENT_REQUEST', communicationMethod: 'PHONE', communicatedAt: new Date().toISOString(),
    } })).ok()).toBeTruthy();
    expect((await payroll.post(`/hr-hiring/applications/${applicationId}/payroll-participation`, { data: {
      effectiveFrom: env('HR_E2E_PLANNED_START'), reviewConfirmed: true,
    } })).ok()).toBeTruthy();
    const detail = await manager.get(`/hr-hiring/applications/${applicationId}`);
    const detailData = (await detail.json()).data;
    const readiness = detailData.activationReadiness;
    expect(readiness.insurance.blocking).toBe(false);
    expect(readiness.blockers).toEqual([]);
    const restrictedContract = detailData.documentIndex?.find((item: any) => item.category === 'FINANCE_CONTRACT');
    if (restrictedContract) {
      expect(restrictedContract.restricted).toBe(true);
      expect((await manager.get(`/hr-hiring/applications/${applicationId}/contracts/${restrictedContract.id}/download`)).status()).toBe(403);
    }
    expect((await manager.post(`/hr-hiring/applications/${applicationId}/activate`)).ok()).toBeTruthy();
    await Promise.all([processor.dispose(), payroll.dispose(), manager.dispose()]);
  });

  test('responsible supervisor proposal reaches canonical schedule only after HR approval', async () => {
    test.skip(!env('HR_E2E_PERSONNEL_ID') || !env('HR_E2E_SUPERVISOR_TOKEN') || !env('HR_E2E_HR_PROCESSOR_TOKEN') || !env('HR_E2E_HR_MANAGER_TOKEN'));
    const personnelId = env('HR_E2E_PERSONNEL_ID');
    const supervisor = await roleRequest(env('HR_E2E_SUPERVISOR_TOKEN'));
    const processor = await roleRequest(env('HR_E2E_HR_PROCESSOR_TOKEN'));
    const manager = await roleRequest(env('HR_E2E_HR_MANAGER_TOKEN'));
    const payload = { effectiveDate: env('HR_E2E_SCHEDULE_DATE') || futureDate(), days: [{ weekday: 0, startTime: '08:00', endTime: '17:00' }] };
    const proposalResponse = await supervisor.post(`/hr/personnel/${personnelId}/work-schedule/proposals`, { data: { ...payload, proposalNote: 'E2E schedule change' } });
    expect(proposalResponse.ok()).toBeTruthy();
    const change = (await proposalResponse.json()).data;
    expect((await processor.put(`/hr/personnel/${personnelId}/work-schedule/changes/${change.id}/prepare`, { data: payload })).ok()).toBeTruthy();
    const beforeApproval = await processor.get('/hr/personnel');
    const personnelBeforeApproval = (await beforeApproval.json()).data.find((item: any) => item.id === personnelId);
    expect(personnelBeforeApproval.workSchedules.some((item: any) => String(item.effectiveFrom).startsWith(payload.effectiveDate))).toBe(false);
    expect((await processor.post(`/hr/personnel/${personnelId}/work-schedule/changes/${change.id}/submit`)).ok()).toBeTruthy();
    expect((await manager.post(`/hr/personnel/${personnelId}/work-schedule/changes/${change.id}/approve`)).ok()).toBeTruthy();
    await Promise.all([supervisor.dispose(), processor.dispose(), manager.dispose()]);
  });

  test('generic workspace access cannot substitute for HR business authority', async () => {
    test.skip(!env('HR_E2E_GENERIC_HR_WORKSPACE_TOKEN'));
    const generic = await roleRequest(env('HR_E2E_GENERIC_HR_WORKSPACE_TOKEN'));
    const response = await generic.put(`/hr-hiring/applications/${env('HR_E2E_APPLICATION_ID')}/insurance`, { data: { registrationPath: 'COMPANY', status: 'IN_PROGRESS' } });
    expect(response.status()).toBe(403);
    await generic.dispose();
  });
});

test.describe('HR browser scope', () => {
  test.skip(!env('HR_E2E_MANAGER_STORAGE') || !env('HR_E2E_APPLICATION_ID'), 'Set manager storage state and application id.');
  test('exposes year selection and permission-aware document index', async ({ browser }) => {
    const context = await browser.newContext({ storageState: env('HR_E2E_MANAGER_STORAGE') });
    const page = await context.newPage();
    await page.goto(`/dashboard/hr/hiring/${env('HR_E2E_APPLICATION_ID')}?phase=CONVERSION`);
    await expect(page.getByText('فهرست اسناد و فایل‌های پرونده')).toBeVisible();
    await page.getByText('انتخاب تاریخ').first().click();
    await expect(page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' }).locator('button[aria-expanded]')).toBeVisible();
    await context.close();
  });
});

test.describe('HR archive and permanent-erasure acceptance', () => {
  test.skip(!env('HR_E2E_API_URL'), 'Set HR_E2E_API_URL and disposable archive/erasure fixtures.');

  test('HR Manager archives and restores one application while HR Processor is rejected', async () => {
    test.skip(!env('HR_E2E_ARCHIVE_APPLICATION_ID') || !env('HR_E2E_HR_MANAGER_TOKEN') || !env('HR_E2E_HR_PROCESSOR_TOKEN'));
    const id = env('HR_E2E_ARCHIVE_APPLICATION_ID');
    const manager = await roleRequest(env('HR_E2E_HR_MANAGER_TOKEN'));
    const processor = await roleRequest(env('HR_E2E_HR_PROCESSOR_TOKEN'));
    expect((await processor.post(`/hr-hiring/applications/${id}/archive`, { data: { reason: 'E2E unauthorized archive' } })).status()).toBe(403);
    expect((await manager.post(`/hr-hiring/applications/${id}/archive`, { data: { reason: 'E2E reversible application archive' } })).ok()).toBeTruthy();
    const archived = await manager.get('/hr-hiring/applications', { params: { archived: 'true' } });
    expect((await archived.json()).data.some((item: any) => item.id === id)).toBe(true);
    const detail = await manager.get(`/hr-hiring/applications/${id}`);
    expect((await detail.json()).data.readOnlyArchived).toBe(true);
    expect((await manager.post(`/hr-hiring/applications/${id}/restore`, { data: { reason: 'E2E restore exact workflow state' } })).ok()).toBeTruthy();
    await Promise.all([manager.dispose(), processor.dispose()]);
  });

  test('Personnel archive offboards atomically and restore does not reactivate', async () => {
    test.skip(!env('HR_E2E_ARCHIVE_PERSONNEL_ID') || !env('HR_E2E_HR_MANAGER_TOKEN'));
    const id = env('HR_E2E_ARCHIVE_PERSONNEL_ID');
    const manager = await roleRequest(env('HR_E2E_HR_MANAGER_TOKEN'));
    const effectiveDate = env('HR_E2E_ARCHIVE_EFFECTIVE_DATE') || new Date().toISOString().slice(0, 10);
    expect((await manager.post(`/hr/personnel/${id}/archive`, { data: { reason: 'E2E controlled Personnel offboarding', effectiveDate } })).ok()).toBeTruthy();
    const archived = await manager.get('/hr/personnel', { params: { archived: 'true', pageSize: '100' } });
    const archivedPerson = (await archived.json()).data.find((item: any) => item.id === id);
    expect(archivedPerson).toBeTruthy();
    expect(archivedPerson.user?.isActive).toBe(false);
    expect((await manager.post(`/hr/personnel/${id}/restore`, { data: { reason: 'E2E restore list visibility only' } })).ok()).toBeTruthy();
    const active = await manager.get('/hr/personnel', { params: { pageSize: '100' } });
    const restored = (await active.json()).data.find((item: any) => item.id === id);
    expect(restored.user?.isActive).toBe(false);
    expect(restored.hrEmploymentRelationships.every((item: any) => item.status === 'ENDED')).toBe(true);
    await manager.dispose();
  });

  test('ADMIN permanently deletes only a disposable application after exact preview confirmation', async () => {
    test.skip(!env('HR_E2E_DELETE_APPLICATION_ID') || !env('HR_E2E_ADMIN_TOKEN') || !env('HR_E2E_ADMIN_PASSWORD'));
    const id = env('HR_E2E_DELETE_APPLICATION_ID');
    const admin = await roleRequest(env('HR_E2E_ADMIN_TOKEN'));
    const previewResponse = await admin.get(`/hr-hiring/applications/${id}/deletion-preview`);
    expect(previewResponse.ok()).toBeTruthy();
    const preview = (await previewResponse.json()).data;
    const deletion = await admin.post(`/hr-hiring/applications/${id}/permanent-delete`, { data: {
      reason: 'E2E permanent deletion of disposable application', fullName: preview.displayName,
      adminPassword: env('HR_E2E_ADMIN_PASSWORD'), fingerprint: preview.fingerprint, confirmed: true,
    } });
    expect([200, 202]).toContain(deletion.status());
    expect((await admin.get(`/hr-hiring/applications/${id}`)).status()).toBe(404);
    await admin.dispose();
  });

  test('ADMIN erasure rejects a stale Personnel preview before any deletion', async () => {
    test.skip(!env('HR_E2E_STALE_PERSONNEL_ID') || !env('HR_E2E_ADMIN_TOKEN') || !env('HR_E2E_ADMIN_PASSWORD'));
    const id = env('HR_E2E_STALE_PERSONNEL_ID');
    const admin = await roleRequest(env('HR_E2E_ADMIN_TOKEN'));
    const preview = (await (await admin.get(`/hr/personnel/${id}/deletion-preview`)).json()).data;
    expect((await admin.post(`/hr/personnel/${id}/archive`, { data: {
      reason: 'E2E fingerprint invalidation', effectiveDate: new Date().toISOString().slice(0, 10),
    } })).ok()).toBeTruthy();
    const deletion = await admin.post(`/hr/personnel/${id}/permanent-delete`, { data: {
      reason: 'E2E stale preview rejection', fullName: preview.displayName,
      adminPassword: env('HR_E2E_ADMIN_PASSWORD'), fingerprint: preview.fingerprint, confirmed: true,
    } });
    expect(deletion.ok()).toBe(false);
    expect(JSON.stringify(await deletion.json())).toContain('منقضی');
    await admin.dispose();
  });

  test('ADMIN permanently erases one disposable Personnel graph after exact preview confirmation', async () => {
    test.skip(!env('HR_E2E_DELETE_PERSONNEL_ID') || !env('HR_E2E_ADMIN_TOKEN') || !env('HR_E2E_ADMIN_PASSWORD'));
    const id = env('HR_E2E_DELETE_PERSONNEL_ID');
    const admin = await roleRequest(env('HR_E2E_ADMIN_TOKEN'));
    const previewResponse = await admin.get(`/hr/personnel/${id}/deletion-preview`);
    expect(previewResponse.ok()).toBeTruthy();
    const preview = (await previewResponse.json()).data;
    const deletion = await admin.post(`/hr/personnel/${id}/permanent-delete`, { data: {
      reason: 'E2E permanent Personnel erasure fixture', fullName: preview.displayName,
      adminPassword: env('HR_E2E_ADMIN_PASSWORD'), fingerprint: preview.fingerprint, confirmed: true,
    } });
    expect([200, 202]).toContain(deletion.status());
    expect((await admin.get(`/hr/personnel/${id}/deletion-preview`)).status()).toBe(404);
    await admin.dispose();
  });
});

test.describe('browser-visible cross-role workflow controls', () => {
  test.skip(
    !env('HR_E2E_APPLICATION_ID') ||
      !env('HR_E2E_FINANCE_RECORDER_STORAGE') ||
      !env('HR_E2E_FINANCE_MANAGER_STORAGE') ||
      !env('HR_E2E_HR_PROCESSOR_STORAGE') ||
      !env('HR_E2E_PAYROLL_MANAGER_STORAGE') ||
      !env('HR_E2E_HR_MANAGER_STORAGE') ||
      !env('HR_E2E_SUPERVISOR_STORAGE') ||
      !env('HR_E2E_PERSONNEL_ID'),
    'Set role storage states and seeded HR records for browser journeys.',
  );

  test('paper-contract controls transfer from recorder to manager', async ({ browser }) => {
    const recorder = await browser.newContext({ storageState: env('HR_E2E_FINANCE_RECORDER_STORAGE') });
    const recorderPage = await recorder.newPage();
    await recorderPage.goto(`/dashboard/hr/hiring/${env('HR_E2E_APPLICATION_ID')}?phase=ONBOARDING`);
    await expect(recorderPage.getByRole('button', { name: /ثبت نسخه قرارداد|ارسال برای بررسی مدیر مالی/ })).toBeVisible();
    await recorder.close();

    const manager = await browser.newContext({ storageState: env('HR_E2E_FINANCE_MANAGER_STORAGE') });
    const managerPage = await manager.newPage();
    await managerPage.goto(`/dashboard/hr/hiring/${env('HR_E2E_APPLICATION_ID')}?phase=ONBOARDING`);
    await expect(managerPage.getByRole('button', { name: /تأیید قرارداد|بازگرداندن برای اصلاح/ })).toBeVisible();
    await expect(managerPage.getByRole('button', { name: 'ثبت نسخه قرارداد' })).toHaveCount(0);
    await manager.close();
  });

  test('insurance, payroll, and activation controls are isolated by role', async ({ browser }) => {
    const processor = await browser.newContext({ storageState: env('HR_E2E_HR_PROCESSOR_STORAGE') });
    const processorPage = await processor.newPage();
    await processorPage.goto(`/dashboard/hr/hiring/${env('HR_E2E_APPLICATION_ID')}?phase=ONBOARDING`);
    await expect(processorPage.getByRole('button', { name: 'ذخیره وضعیت بیمه' })).toBeVisible();
    await expect(processorPage.getByRole('button', { name: 'تنظیم مشارکت حقوق و دستمزد' })).toHaveCount(0);
    await processor.close();

    const payroll = await browser.newContext({ storageState: env('HR_E2E_PAYROLL_MANAGER_STORAGE') });
    const payrollPage = await payroll.newPage();
    await payrollPage.goto(`/dashboard/hr/hiring/${env('HR_E2E_APPLICATION_ID')}?phase=ONBOARDING`);
    await expect(payrollPage.getByRole('button', { name: 'تنظیم مشارکت حقوق و دستمزد' })).toBeVisible();
    await payroll.close();

    const manager = await browser.newContext({ storageState: env('HR_E2E_HR_MANAGER_STORAGE') });
    const managerPage = await manager.newPage();
    await managerPage.goto(`/dashboard/hr/hiring/${env('HR_E2E_APPLICATION_ID')}?phase=ACTIVATION`);
    await expect(managerPage.getByText('آمادگی فعال‌سازی رابطه استخدامی')).toBeVisible();
    await expect(managerPage.getByRole('button', { name: 'ذخیره وضعیت بیمه' })).toHaveCount(0);
    await manager.close();
  });

  test('schedule journey exposes only the projected action for each actor', async ({ browser }) => {
    const supervisor = await browser.newContext({ storageState: env('HR_E2E_SUPERVISOR_STORAGE') });
    const supervisorPage = await supervisor.newPage();
    await supervisorPage.goto(`/dashboard/hr/personnel?focus=${env('HR_E2E_PERSONNEL_ID')}`);
    await expect(supervisorPage.getByRole('button', { name: 'ثبت پیشنهاد توسط سرپرست مسئول' })).toBeVisible();
    await supervisor.close();

    const processor = await browser.newContext({ storageState: env('HR_E2E_HR_PROCESSOR_STORAGE') });
    const processorPage = await processor.newPage();
    await processorPage.goto(`/dashboard/hr/personnel?focus=${env('HR_E2E_PERSONNEL_ID')}`);
    await expect(processorPage.getByRole('button', { name: /ذخیره پیش‌نویس|ارسال برای تأیید/ })).toBeVisible();
    await processor.close();

    const manager = await browser.newContext({ storageState: env('HR_E2E_HR_MANAGER_STORAGE') });
    const managerPage = await manager.newPage();
    await managerPage.goto(`/dashboard/hr/personnel?focus=${env('HR_E2E_PERSONNEL_ID')}`);
    await expect(managerPage.getByRole('button', { name: /تأیید و ایجاد نسخه اجرایی|بازگرداندن/ })).toBeVisible();
    await manager.close();
  });
});

test.describe('task-scoped HR duty surfaces', () => {
  test.skip(
      !env('HR_E2E_DUTY_ID') ||
      !env('HR_E2E_DUTY_ASSIGNEE_STORAGE') ||
      !env('HR_E2E_DUTY_UNAUTHORIZED_STORAGE') ||
      !env('HR_E2E_DUTY_PROTECTED_MARKERS'),
    'Set a live duty, assigned/unauthorized storage states, and comma-separated protected fixture markers.',
  );

  test('assigned actor can use the destination deep link without entering HR', async ({ browser }) => {
    const workspace = env('HR_E2E_DUTY_WORKSPACE') || 'accounting';
    const context = await browser.newContext({ storageState: env('HR_E2E_DUTY_ASSIGNEE_STORAGE') });
    const page = await context.newPage();
    await page.goto(`/dashboard/${workspace}/duties/${env('HR_E2E_DUTY_ID')}`);
    await expect(page.getByText('دسترسی محدود به همین وظیفه')).toBeVisible();
    await expect(page.getByRole('button', { name: /تأیید|رد|بازگرداندن|درخواست توضیح/ }).first()).toBeVisible();
    await expect(page.locator('main a[href^="/dashboard/hr/"]')).toHaveCount(0);
    const visibleText = await page.locator('main').innerText();
    for (const marker of env('HR_E2E_DUTY_PROTECTED_MARKERS').split(',').map((item) => item.trim()).filter(Boolean)) {
      expect(visibleText).not.toContain(marker);
    }
    await context.close();
  });

  test('unrelated actor receives a useful fail-closed deep-link state', async ({ browser }) => {
    const workspace = env('HR_E2E_DUTY_WORKSPACE') || 'accounting';
    const context = await browser.newContext({ storageState: env('HR_E2E_DUTY_UNAUTHORIZED_STORAGE') });
    const page = await context.newPage();
    await page.goto(`/dashboard/${workspace}/duties/${env('HR_E2E_DUTY_ID')}`);
    await expect(page.getByText(/دسترسی.*معتبر نیست|در دسترس نیست|دیگر.*محول نیست/)).toBeVisible();
    await expect(page.getByRole('button', { name: /تأیید|رد|بازگرداندن|درخواست توضیح/ })).toHaveCount(0);
    const visibleText = await page.locator('main').innerText();
    for (const marker of env('HR_E2E_DUTY_PROTECTED_MARKERS').split(',').map((item) => item.trim()).filter(Boolean)) {
      expect(visibleText).not.toContain(marker);
    }
    await context.close();
  });

  test('destination manager sees only the bounded triage queue', async ({ browser }) => {
    test.skip(
      !env('HR_E2E_DUTY_MANAGER_STORAGE') || !env('HR_E2E_DUTY_TRIAGE_ID'),
      'Set a destination manager storage state and an unassigned triage duty id.',
    );
    const workspace = env('HR_E2E_DUTY_WORKSPACE') || 'accounting';
    const context = await browser.newContext({ storageState: env('HR_E2E_DUTY_MANAGER_STORAGE') });
    const page = await context.newPage();
    await page.goto(`/dashboard/${workspace}/duties`);
    await page.getByText('نیازمند تعیین مسئول').click();
    const triageLink = page.locator(`main a[href="/dashboard/${workspace}/duties/${env('HR_E2E_DUTY_TRIAGE_ID')}"]`);
    await expect(triageLink).toBeVisible();
    await triageLink.click();
    await expect(page.getByText('دسترسی محدود به همین وظیفه')).toBeVisible();
    await expect(page.getByRole('button', { name: /تأیید|رد|بازگرداندن|درخواست توضیح/ })).toHaveCount(0);
    await expect(page.locator('main a[href^="/dashboard/hr/"]')).toHaveCount(0);
    const visibleText = await page.locator('main').innerText();
    for (const marker of env('HR_E2E_DUTY_PROTECTED_MARKERS').split(',').map((item) => item.trim()).filter(Boolean)) {
      expect(visibleText).not.toContain(marker);
    }
    await context.close();
  });
});
