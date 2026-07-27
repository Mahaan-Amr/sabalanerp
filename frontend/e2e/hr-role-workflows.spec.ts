import { expect, request, test } from '@playwright/test';

const env = (name: string) => process.env[name] || '';
const apiBase = () => `${env('HR_E2E_API_URL').replace(/\/$/, '')}/api`;
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
    expect((await manager.post(`/hr-hiring/applications/${applicationId}/contracts/${contract.id}/approve`)).ok()).toBeTruthy();
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
    const readiness = (await detail.json()).data.activationReadiness;
    expect(readiness.insurance.blocking).toBe(false);
    expect(readiness.blockers).toEqual([]);
    expect((await manager.post(`/hr-hiring/applications/${applicationId}/activate`)).ok()).toBeTruthy();
    await Promise.all([processor.dispose(), payroll.dispose(), manager.dispose()]);
  });

  test('responsible supervisor proposal reaches canonical schedule only after HR approval', async () => {
    test.skip(!env('HR_E2E_PERSONNEL_ID') || !env('HR_E2E_SUPERVISOR_TOKEN') || !env('HR_E2E_HR_PROCESSOR_TOKEN') || !env('HR_E2E_HR_MANAGER_TOKEN'));
    const personnelId = env('HR_E2E_PERSONNEL_ID');
    const supervisor = await roleRequest(env('HR_E2E_SUPERVISOR_TOKEN'));
    const processor = await roleRequest(env('HR_E2E_HR_PROCESSOR_TOKEN'));
    const manager = await roleRequest(env('HR_E2E_HR_MANAGER_TOKEN'));
    const proposalResponse = await supervisor.post(`/hr/personnel/${personnelId}/work-schedule/proposals`, { data: { proposalNote: 'E2E schedule change' } });
    expect(proposalResponse.ok()).toBeTruthy();
    const change = (await proposalResponse.json()).data;
    const payload = { effectiveDate: env('HR_E2E_SCHEDULE_DATE'), days: [{ weekday: 0, startTime: '08:00', endTime: '17:00' }] };
    expect((await processor.put(`/hr/personnel/${personnelId}/work-schedule/changes/${change.id}/prepare`, { data: payload })).ok()).toBeTruthy();
    expect((await processor.post(`/hr/personnel/${personnelId}/work-schedule/changes/${change.id}/submit`)).ok()).toBeTruthy();
    expect((await manager.post(`/hr/personnel/${personnelId}/work-schedule/changes/${change.id}/approve`)).ok()).toBeTruthy();
    await Promise.all([supervisor.dispose(), processor.dispose(), manager.dispose()]);
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
