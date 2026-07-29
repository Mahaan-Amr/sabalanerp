import { expect, test, type Page } from '@playwright/test';

const login = async (page: Page, username = 'admin') => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(username);
  await page.locator('input[name="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const mutate = async (page: Page, path: string, method: string, body?: unknown) => (
  page.evaluate(async ({ requestPath, requestMethod, requestBody, key }) => {
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': key,
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    return { status: response.status, body: await response.json() };
  }, {
    requestPath: path,
    requestMethod: method,
    requestBody: body,
    key: `support-e2e:${crypto.randomUUID()}`,
  })
);

test('support capture consent, ticket lifecycle entry point, and notification center work in RTL', async ({ page, browser }) => {
  const runId = process.env.SUPPORT_QA_RUN_ID!;
  await login(page, `support_qa_${runId}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByRole('button', { name: 'حساب کاربری' }).click();
  await page.getByRole('menuitem', { name: 'ثبت تیکت جدید' }).click();
  const captureSheet = page.getByRole('dialog', { name: 'اطلاعات همراه تیکت' });
  await expect(captureSheet).toBeVisible();

  const rawConsent = captureSheet.getByRole('checkbox', {
    name: 'اطلاعات خام این صفحه را برای انتخاب و پیش‌نمایش جمع‌آوری کن',
  });
  await expect(rawConsent).not.toBeChecked();
  await rawConsent.check();
  await expect(rawConsent).toBeChecked();
  await captureSheet.getByRole('button', { name: 'ادامه به ثبت تیکت' }).click();

  await expect(page).toHaveURL(/\/dashboard\/support\/new$/);
  const title = `QA پشتیبانی ${runId}`;
  await page.getByRole('textbox', { name: 'عنوان' }).fill(title);
  await page.getByRole('textbox', { name: 'شرح مشکل' }).fill('بررسی خودکار مسیر ثبت، تاریخچه و اعلان‌ها روی Docker محلی موجود.');
  await page.getByRole('button', { name: 'ثبت تیکت', exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/support\/tickets\/[^/]+$/);
  await expect(page.getByText(title)).toBeVisible();
  const ticketId = page.url().split('/').at(-1)!;
  const referenceCode = (await page.getByText(/SUP-\d{8}-[A-F0-9]+/).first().innerText()).match(/SUP-\d{8}-[A-F0-9]+/)?.[0];
  expect(referenceCode).toBeTruthy();

  const replay = await page.evaluate(async ({ id }) => {
    const key = `support-e2e:${Date.now()}`;
    const send = () => fetch(`/api/support-tickets/${id}/entries`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': key },
      body: JSON.stringify({ body: 'پاسخ idempotency کمپین QA' }),
    });
    const first = await send();
    const firstBody = await first.json();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await send();
    const secondBody = await second.json();
    return {
      firstStatus: first.status,
      secondStatus: second.status,
      firstId: firstBody.data?.id,
      secondId: secondBody.data?.id,
      replayHeader: second.headers.get('x-idempotent-replay'),
    };
  }, { id: ticketId });
  expect(replay).toMatchObject({
    firstStatus: 201,
    secondStatus: 201,
    replayHeader: 'true',
  });
  expect(replay.secondId).toBe(replay.firstId);

  const outsiderPage = await browser.newPage();
  await login(outsiderPage, `support_qa_outsider_${runId}`);
  const deniedTicket = await outsiderPage.evaluate(async (id) => {
    const response = await fetch(`/api/support-tickets/${id}`, { credentials: 'include' });
    return response.status;
  }, ticketId);
  expect(deniedTicket).toBe(404);
  const missingIdempotencyKey = await outsiderPage.evaluate(async () => {
    const response = await fetch('/api/notifications/settings/preferences', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        webPushEnabled: false,
        mutedCategories: [],
        lowPriorityDelivery: 'IMMEDIATE',
      }),
    });
    return response.status;
  });
  expect(missingIdempotencyKey).toBe(428);
  await outsiderPage.close();

  await page.goto('/dashboard/support/history');
  await expect(page.getByText(title)).toBeVisible();

  const adminPage = await browser.newPage();
  await login(adminPage);
  await adminPage.getByRole('button', { name: /اعلان/ }).click();
  const notificationCenter = adminPage.getByRole('dialog', { name: 'مرکز اعلان‌ها' });
  await expect(notificationCenter.getByText(referenceCode!)).toBeVisible({ timeout: 15_000 });
  await adminPage.close();
});

test('support entry points remain usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'حساب کاربری' }).click();
  await expect(page.getByRole('menuitem', { name: 'ثبت تیکت جدید' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'تاریخچه' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'تاریخچه' }).click();
  await expect(page).toHaveURL(/\/dashboard\/support\/history$/);
  await expect(page.locator('[data-dashboard-main]')).toBeVisible();
});

test('role scopes, participant capabilities, lifecycle, and restricted incident isolation are enforced', async ({ browser }) => {
  const runId = process.env.SUPPORT_QA_RUN_ID!;
  const reporter = await browser.newPage();
  await login(reporter, `support_qa_${runId}`);
  const ordinary = await mutate(reporter, '/api/support-tickets', 'POST', {
    title: `QA پشتیبانی ${runId} نقش‌ها`,
    type: 'TECHNICAL_ERROR',
    impact: 'SINGLE_TASK',
    workaroundExists: false,
    reportedWorkspace: 'sales',
    reportedFeature: 'sales_contracts_view',
    originRoute: '/dashboard/sales/contracts',
    description: 'آزمون دسترسی نقش‌ها و چرخه رسیدگی',
    sensitiveEvidenceConsent: true,
    sensitiveEvidenceSnapshot: { formValues: { customerName: 'مشتری آزمایشی' } },
    diagnosticSnapshot: { route: '/dashboard/sales/contracts', buildCommit: 'qa-local' },
  });
  expect(ordinary.status).toBe(201);
  const ordinaryId = ordinary.body.data.id as string;
  const ordinaryReference = ordinary.body.data.referenceCode as string;

  const admin = await browser.newPage();
  await login(admin);
  for (const [suffix, role] of [['handler', 'HANDLER'], ['watcher', 'WATCHER']] as const) {
    const assignment = await mutate(admin, `/api/support-tickets/${ordinaryId}/participants`, 'POST', {
      userId: `support-qa-${suffix}-${runId}`,
      role,
      reason: 'تخصیص برای آزمون کنترل دسترسی',
    });
    expect(assignment.status).toBe(201);
  }

  const manager = await browser.newPage();
  await login(manager, `support_qa_manager_${runId}`);
  const managerQueue = await manager.evaluate(async () => {
    const response = await fetch('/api/support-tickets?workspace=sales', { credentials: 'include' });
    return response.json();
  });
  expect(managerQueue.data.some((ticket: { id: string }) => ticket.id === ordinaryId)).toBe(true);
  expect((await mutate(manager, `/api/support-tickets/${ordinaryId}/priority`, 'PUT', {
    priority: 'HIGH',
    reason: 'اثر مستقیم بر فرایند فروش',
  })).status).toBe(200);
  expect((await mutate(manager, `/api/support-tickets/${ordinaryId}/status`, 'PUT', {
    status: 'TRIAGED',
    reason: 'بررسی اولیه انجام شد',
  })).status).toBe(200);

  const handler = await browser.newPage();
  await login(handler, `support_qa_handler_${runId}`);
  const handlerDetail = await handler.evaluate(async (id) => {
    const response = await fetch(`/api/support-tickets/${id}`, { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  }, ordinaryId);
  expect(handlerDetail.status).toBe(200);
  expect(handlerDetail.body.data.sensitiveEvidenceSnapshot.formValues.customerName).toBe('مشتری آزمایشی');
  expect((await mutate(handler, `/api/support-tickets/${ordinaryId}/entries`, 'POST', {
    body: 'پاسخ مسئول رسیدگی در خط زمانی',
  })).status).toBe(201);
  const reporterNotification = async () => reporter.evaluate(async ({ id, referenceCode }) => {
    const response = await fetch('/api/notifications?limit=100', { credentials: 'include' });
    const payload = await response.json();
    return payload.data.find((item: { referenceId?: string; actionUrl?: string }) => (
      item.referenceId === referenceCode
      && item.actionUrl === `/dashboard/support/tickets/${id}`
    )) || null;
  }, { id: ordinaryId, referenceCode: ordinaryReference });
  await expect.poll(reporterNotification, { timeout: 15_000 }).not.toBeNull();
  await reporter.reload();
  await expect.poll(reporterNotification, { timeout: 15_000 }).not.toBeNull();

  const watcher = await browser.newPage();
  await login(watcher, `support_qa_watcher_${runId}`);
  const watcherDetail = await watcher.evaluate(async (id) => {
    const response = await fetch(`/api/support-tickets/${id}`, { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  }, ordinaryId);
  expect(watcherDetail.status).toBe(200);
  expect(watcherDetail.body.data.sensitiveEvidenceSnapshot).toBeUndefined();
  expect((await mutate(watcher, `/api/support-tickets/${ordinaryId}/entries`, 'POST', {
    body: 'ناظر نباید بتواند پاسخ ثبت کند',
  })).status).toBe(403);

  expect((await mutate(manager, `/api/support-tickets/${ordinaryId}/status`, 'PUT', {
    status: 'RESOLVED',
    reason: 'راه‌حل نهایی برای گزارشگر ثبت شد',
  })).status).toBe(200);
  expect((await mutate(reporter, `/api/support-tickets/${ordinaryId}/status`, 'PUT', {
    status: 'CLOSED',
    reason: 'گزارشگر رفع مشکل را تأیید کرد',
  })).status).toBe(200);
  expect((await mutate(reporter, `/api/support-tickets/${ordinaryId}/reopen`, 'POST', {
    reason: 'مشکل در بازه مجاز دوباره رخ داد',
  })).status).toBe(200);

  const incident = await mutate(reporter, '/api/support-tickets', 'POST', {
    title: `QA پشتیبانی ${runId} رخداد محرمانه`,
    type: 'SECURITY_PRIVACY',
    impact: 'MINOR',
    workaroundExists: true,
    originRoute: '/dashboard',
    description: 'شرح محرمانه رخداد آزمون',
    sensitiveEvidenceConsent: true,
    sensitiveEvidenceSnapshot: { pageText: 'شاهد محرمانه بدون اطلاعات ورود' },
    diagnosticSnapshot: { route: '/dashboard', buildCommit: 'qa-local' },
  });
  expect(incident.status).toBe(201);
  const incidentId = incident.body.data.id as string;

  const managerIncident = await manager.evaluate(async (id) => {
    const response = await fetch(`/api/support-tickets/${id}`, { credentials: 'include' });
    return response.status;
  }, incidentId);
  expect(managerIncident).toBe(404);
  const designated = await browser.newPage();
  await login(designated, `support_qa_incident_${runId}`);
  const designatedDetail = await designated.evaluate(async (id) => {
    const response = await fetch(`/api/support-tickets/${id}`, { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  }, incidentId);
  expect(designatedDetail.status).toBe(200);
  expect(designatedDetail.body.data.reporter.username).toBe('protected');
  expect(designatedDetail.body.data.sensitiveEvidenceSnapshot).toBeUndefined();
  expect((await mutate(designated, `/api/support-tickets/${incidentId}/participants`, 'POST', {
    userId: `support-qa-outsider-${runId}`,
    role: 'COLLABORATOR',
    reason: 'تفویض بدون تأیید مدیر سیستم',
  })).status).toBe(403);
  expect((await mutate(admin, `/api/support-tickets/${incidentId}/participants`, 'POST', {
    userId: `support-qa-incident-${runId}`,
    role: 'HANDLER',
    reason: 'تأیید صریح مدیر سیستم برای رسیدگی',
  })).status).toBe(201);

  await Promise.all([
    reporter.close(),
    admin.close(),
    manager.close(),
    handler.close(),
    watcher.close(),
    designated.close(),
  ]);
});
