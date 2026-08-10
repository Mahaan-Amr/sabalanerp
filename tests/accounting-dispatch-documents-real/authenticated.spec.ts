import { expect, test, type Page } from '@playwright/test';

const credentials = {
  manage: { identifier: 'issue256-dispatch-manage', password: 'admin123' },
  view: { identifier: 'issue256-dispatch-view', password: 'admin123' },
  unauthorized: { identifier: 'issue256-dispatch-unauthorized', password: 'admin123' },
} as const;

const login = async (page: Page, role: keyof typeof credentials) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(credentials[role].identifier);
  await page.getByRole('textbox', { name: 'رمز عبور خود را وارد کنید' }).fill(credentials[role].password);
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'ورود', exact: true }).click(),
  ]);
};

const openWorkspace = async (page: Page) => {
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === 'GET'
      && new URL(candidate.url()).pathname === '/api/accounting/dispatch-candidates');
  await page.goto('/dashboard/accounting/dispatch-documents');
  return response;
};

test('MANAGE authority is projected by the mounted backend and exposes decision work', async ({ page }) => {
  await login(page, 'manage');
  const response = await openWorkspace(page);

  expect(response.status()).toBe(200);
  expect(response.headers()['x-dispatch-documents-permission']).toBe('MANAGE');
  await expect(page.getByRole('heading', { name: 'اسناد ارسال مشتری' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'پذیرش و صدور هر دو سند' })).toBeVisible();
});

test('VIEW authority is projected by the mounted backend without mutation controls', async ({ page }) => {
  await login(page, 'view');
  const response = await openWorkspace(page);

  expect(response.status()).toBe(200);
  expect(response.headers()['x-dispatch-documents-permission']).toBe('VIEW');
  await expect(page.getByText(/فقط برای مشاهده و دریافت اسناد صادرشده/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'پذیرش و صدور هر دو سند' })).toHaveCount(0);
});

test('unauthorized authority receives a real 403 without case disclosure', async ({ page }) => {
  await login(page, 'unauthorized');
  const response = await openWorkspace(page);

  expect(response.status()).toBe(403);
  await expect(page.getByText('دسترسی به اسناد ارسال حسابداری برای این نقش مجاز نیست.')).toBeVisible();
  await expect(page.getByLabel('صف پرونده‌های اسناد ارسال')).toHaveCount(0);
});
