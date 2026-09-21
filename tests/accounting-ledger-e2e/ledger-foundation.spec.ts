import { expect, test, type Page, type Route } from '@playwright/test';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
};

const json = (route: Route, status: number, body: unknown) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const context = (accessProfile: 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER', isGlobalAdmin = false) => ({
  success: true,
  data: {
    configured: true, accessProfile, isGlobalAdmin, id: 'entity-1', namePersian: 'شرکت سنگ سبلان', parties: [], financialAccounts: [],
    books: [{
      id: 'book-1', codeSchemes: [{ id: 'scheme-1', version: 1 }], dimensionTypes: [],
      accounts: [
        { id: 'cash', code: '101001', titlePersian: 'صندوق', level: 'MOIN', partyRequirement: 'FORBIDDEN', financialAccountRequirement: 'FORBIDDEN', currencyBehavior: 'BASE_ONLY', dimensionRules: [] },
        { id: 'capital', code: '301001', titlePersian: 'سرمایه', level: 'MOIN', partyRequirement: 'FORBIDDEN', financialAccountRequirement: 'FORBIDDEN', currencyBehavior: 'BASE_ONLY', dimensionRules: [] },
      ],
      fiscalYears: [{ id: 'year-1', titlePersian: 'سال مالی آزمایشی', status: 'ACTIVE', periods: [{ id: 'period-1', titlePersian: 'دوره نخست', status: 'OPEN' }] }],
    }],
  },
});

const mockLedger = async (page: Page, profile: 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER', configured = true, isGlobalAdmin = false, withPosted = false) => {
  let postedBody: any;
  let evidenceRequested = false;
  await page.route('**/api/accounting/ledger/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname.endsWith('/context')) {
      return json(route, 200, configured ? context(profile, isGlobalAdmin) : { success: true, data: { configured: false, accessProfile: profile, isGlobalAdmin } });
    }
    if (request.method() === 'GET' && pathname.endsWith('/vouchers/voucher-posted/evidence')) {
      evidenceRequested = true;
      return json(route, 200, { success: true, data: { id: 'voucher-posted', sourceType: 'سند دستی', sourceId: 'شاهد-سند', sourceVersion: 1, sourceHash: 'الف'.repeat(64), sourcePayload: { kind: 'MANUAL' }, lines: [{ id: 'line-1', sequence: 1, evidenceType: 'پیوست', evidenceId: 'شاهد-یک', evidenceVersion: 1, evidenceHash: 'ب'.repeat(64), evidencePayload: { approved: true } }] } });
    }
    if (request.method() === 'GET' && pathname.endsWith('/journal')) return json(route, 200, { success: true, data: withPosted ? [{ id: 'voucher-posted', statutoryNumber: 1, documentDate: '2026-09-21T00:00:00.000Z', description: 'سند قطعی آزمایشی', status: 'POSTED', debitTotalRials: '1000', creditTotalRials: '1000', lines: [{ id: 'line-1', debitRials: '1000', creditRials: '0', account: { code: '101001', titlePersian: 'صندوق' } }] }] : [] });
    if (request.method() === 'GET') return json(route, 200, { success: true, data: [] });
    if (request.method() === 'POST' && pathname.endsWith('/vouchers')) {
      postedBody = request.postDataJSON();
      return json(route, 201, { success: true, data: { id: 'voucher-1', status: 'DRAFT', description: postedBody.description, debitTotalRials: '1000', creditTotalRials: '1000' } });
    }
    return json(route, 200, { success: true, data: {} });
  });
  return { postedBody: () => postedBody, evidenceRequested: () => evidenceRequested };
};

test('حسابدار سند متوازن با شاهد واقعی ثبت می‌کند و پیش‌نویس وارد گزارش رسمی نمی‌شود', async ({ page }) => {
  await login(page);
  const capture = await mockLedger(page, 'ACCOUNTANT');
  await page.goto('/dashboard/accounting/ledger');
  await expect(page.getByRole('heading', { name: 'دفترکل و کدینگ' })).toBeVisible();
  await page.getByLabel('شرح سند').fill('ثبت آزمایشی سرمایه');
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-09-21');
  const accountSelects = page.getByLabel(/حساب آرتیکل/);
  await accountSelects.nth(0).selectOption('cash');
  await accountSelects.nth(1).selectOption('capital');
  await page.getByLabel('بدهکار ریال').nth(0).fill('1000');
  await page.getByLabel('بستانکار ریال').nth(1).fill('1000');
  await page.getByLabel('مبلغ خام پیش از گردکردن').nth(0).fill('1000.00');
  await page.getByLabel('مبلغ خام پیش از گردکردن').nth(1).fill('1000.00');
  await page.getByRole('button', { name: 'ثبت پیش‌نویس' }).click();
  await expect(page.getByText('پیش‌نویس متوازن ثبت شد.')).toBeVisible();
  const body = capture.postedBody();
  expect(body.source.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(body.source.payload.kind).toBe('MANUAL_LEDGER_VOUCHER');
  expect(body.lines).toHaveLength(2);
  expect(body.lines.every((line: any) => /^[a-f0-9]{64}$/.test(line.evidence.hash) && line.evidence.payload)).toBe(true);
  await expect(page.getByText('پیش‌نویس تعیین‌تکلیف‌نشده‌ای وجود ندارد.')).toHaveCount(0);
  await expect(page.getByText('سند قطعی در این محدوده وجود ندارد.')).toBeVisible();
});

test('کنترل‌های سه سطح صریح برای مدیر سراسری نیز از سطح حسابداری تبعیت می‌کنند', async ({ page }) => {
  await login(page);
  await mockLedger(page, 'VIEWER', true, true);
  await page.goto('/dashboard/accounting/ledger');
  await expect(page.getByText('ثبت سند دستی')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'برگشت سند' })).toHaveCount(0);

  await page.unroute('**/api/accounting/ledger/**');
  await mockLedger(page, 'ACCOUNTANT', true, true);
  await page.reload();
  await expect(page.getByText('ثبت سند دستی')).toBeVisible();
  await expect(page.getByRole('button', { name: 'کدینگ حساب‌ها' })).toHaveCount(0);

  await page.unroute('**/api/accounting/ledger/**');
  await mockLedger(page, 'VIEWER', false, true);
  await page.reload();
  await expect(page.getByText('راه‌اندازی دفترکل فقط برای مدیر حسابداری مجاز است.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ایجاد دفترکل ریالی' })).toHaveCount(0);

  await page.unroute('**/api/accounting/ledger/**');
  await mockLedger(page, 'ACCOUNTING_MANAGER', false, true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'ایجاد دفترکل ریالی' })).toBeVisible();
});

test('شواهد حساس برای مشاهده‌گر پنهان و برای مدیر با مسیر حسابرسی‌شده قابل بازبینی است', async ({ page }) => {
  await login(page);
  await mockLedger(page, 'VIEWER', true, false, true);
  await page.goto('/dashboard/accounting/ledger');
  await expect(page.getByRole('button', { name: 'مشاهده شواهد' })).toHaveCount(0);

  await page.unroute('**/api/accounting/ledger/**');
  const manager = await mockLedger(page, 'ACCOUNTING_MANAGER', true, false, true);
  await page.reload();
  await page.getByRole('button', { name: 'مشاهده شواهد' }).click();
  await expect(page.getByText('شواهد و منشأ سند')).toBeVisible();
  await expect(page.getByText('مشاهده این شواهد در سابقه حسابرسی ثبت شد.')).toBeVisible();
  expect(manager.evidenceRequested()).toBe(true);
});

test('صفحه فارسی و راست‌به‌چپ در عرض باریک و بزرگ‌نمایی دویست درصد دسترس‌پذیر می‌ماند', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await mockLedger(page, 'ACCOUNTING_MANAGER');
  await page.goto('/dashboard/accounting/ledger');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(page.locator('html')).toHaveAttribute('lang', /fa/i);
  expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const firstControl = page.getByLabel('سال مالی');
  await firstControl.focus();
  await expect(firstControl).toBeFocused();
  const unnamedControls = await page.locator('button, input, select, textarea').evaluateAll((controls) => controls.filter((control) => {
    const element = control as HTMLElement;
    const label = element.getAttribute('aria-label') || element.getAttribute('title')
      || (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : '')
      || element.closest('label')?.textContent || element.textContent;
    return element.getBoundingClientRect().width > 0 && !label?.trim();
  }).length);
  expect(unnamedControls).toBe(0);
});
