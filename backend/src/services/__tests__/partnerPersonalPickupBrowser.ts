import assert from 'node:assert/strict';
import type { Locator, Page } from '@playwright/test';
import { chromium, expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 25_000 });

export async function runPartnerPersonalPickupBrowser(input: {
  apiOrigin: string; logisticsUser: string; accountingUser: string; guardUser: string; password: string;
  contractNumber: string; partnerName: string; customerName: string; customerLookupName: string;
}) {
  const frontend = new URL(process.env.PERSONAL_PICKUP_FRONTEND_URL ?? 'http://localhost:3000');
  assert.ok(['localhost', '127.0.0.1'].includes(frontend.hostname));
  const browser = await chromium.launch({ channel: 'chrome' });
  const diagnostics: string[] = [];
  const open = async (username: string) => {
    const context = await browser.newContext({ baseURL: frontend.origin, locale: 'fa-IR' });
    // Forward the browser's actual API requests to the isolated fixture router.
    // Status, response body, authorization and every write come from the real app.
    await context.route(`${frontend.origin}/api/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;
      const headers = await request.allHeaders();
      delete headers.host;
      delete headers['content-length'];
      const response = await fetch(input.apiOrigin + pathname + url.search, {
        method: request.method(), headers, body: request.postDataBuffer() ? new Uint8Array(request.postDataBuffer()!) : undefined,
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (response.status >= 400) diagnostics.push(`${request.method()} ${pathname}: ${response.status} ${body.toString().slice(0, 240)}`);
      const responseHeaders: Record<string, string> = {};
      for (const name of ['content-type', 'set-cookie']) {
        const value = response.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      await route.fulfill({ status: response.status, headers: responseHeaders, body });

    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(60_000);
    page.on('pageerror', error => diagnostics.push(error.message));
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(username);
    await page.locator('input[type="password"]').fill(input.password);
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await page.waitForURL('**/dashboard');
    return page;
  };
  const clickCommand = async (page: Page, label: string | Locator, target: RegExp, method = 'POST', search?: string) => {
    const [response] = await Promise.all([
      page.waitForResponse(res => target.test(new URL(res.url()).pathname) && res.request().method() === method
        && (search === undefined || new URL(res.url()).searchParams.get('search') === search)),
      (typeof label === 'string' ? page.getByRole('button', { name: label, exact: true }) : label).click(),
    ]);
    assert.ok(response.ok(), `${label}: ${response.status()} ${await response.text()}`);
    return (await response.json()).data;
  };
  try {
    const logistics = await open(input.logisticsUser);
    await logistics.goto('/dashboard/logistics/loadings', { waitUntil: 'domcontentloaded' });
    await expect(logistics.getByRole('link', { name: 'بارگیری فروش همکار', exact: true })).toHaveCount(0);
    await logistics.getByRole('link', { name: 'بارگیری جدید', exact: true }).click();
    const searchCustomer = async (name: string) => {
      await logistics.getByRole('textbox', { name: 'جستجوی مشتری' }).fill(name);
      return clickCommand(logistics, 'جستجو', /\/logistics\/customers$/, 'GET', name);
    };
    const searchedBySeller = await searchCustomer(input.partnerName);
    assert.ok(!searchedBySeller.some((row: { customerName: string }) => row.customerName === input.customerLookupName));
    await searchCustomer(input.customerLookupName);
    await logistics.getByRole('button', { name: new RegExp(input.customerLookupName) }).click();
    const { loadingId } = await clickCommand(logistics,
      logistics.getByRole('button', { name: /محل دوم مشتری/ }), /\/logistics\/loadings$/);
    await expect(logistics.getByText(input.customerName, { exact: false })).toBeVisible();
    const otherDriver = logistics.getByRole('button', { name: /راننده متفرقه/ });
    await clickCommand(logistics, otherDriver, /\/canonical-driver-queue\/[^/]+\/reserve$/);
    await logistics.getByRole('textbox', { name: /^مقدار ردیف/ }).fill('۰٫۲۵۰');
    await clickCommand(logistics, 'ذخیره مقدارها', /\/canonical-allocations\//, 'PUT');
    await clickCommand(logistics, 'راننده شخصی', /\/transport$/, 'PUT');
    await expect(otherDriver).toHaveCount(0);
    await expect(logistics.getByRole('textbox', { name: /^مقدار ردیف/ })).toHaveValue('');
    await logistics.getByRole('textbox', { name: /^مقدار ردیف/ }).fill('۰٫۷۵۰');
    await clickCommand(logistics, 'ذخیره مقدارها', /\/canonical-allocations\//, 'PUT');
    await logistics.reload({ waitUntil: 'domcontentloaded' });
    await expect(logistics.getByRole('textbox', { name: /^مقدار ردیف/ })).toHaveValue('0.750');
    await clickCommand(logistics, 'نهایی‌سازی بارگیری', /\/finalize$/);
    await expect(logistics.getByText('بارگیری نهایی شد.', { exact: true })).toBeVisible();

    const accounting = await open(input.accountingUser);
    await accounting.goto('/dashboard/accounting/dispatch', { waitUntil: 'domcontentloaded' });
    await expect(accounting.getByText(input.contractNumber, { exact: false }).first()).toBeVisible();
    await expect(accounting.getByText(input.partnerName, { exact: false }).first()).toBeVisible();
    await expect(accounting.getByText(input.customerName, { exact: true }).first()).toBeVisible();
    await accounting.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری', exact: true }).first().click();
    await clickCommand(accounting, 'صدور بارنامه‌ها و فاکتور فروش', /\/issue-dispatch-documents$/);
    const dialog = accounting.getByRole('dialog');
    await accounting.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const authorize = accounting.getByRole('button', { name: 'صدور مجوز خروج', exact: true });
    if (!await authorize.isVisible()) await accounting.getByRole('button', { name: 'اقدامات بیشتر', exact: true }).last().click();
    const authorization = await clickCommand(accounting, 'صدور مجوز خروج', /\/waybills\/[^/]+\/sessions$/);
    assert.equal(authorization.method, 'PERSONAL_PICKUP_ACCOUNTING');

    const guard = await open(input.guardUser);
    await guard.goto('/dashboard/security/vehicles?operation=sales-exit', { waitUntil: 'domcontentloaded' });
    for (const name of [input.contractNumber, input.partnerName, input.customerName]) {
      await expect(guard.getByText(name, { exact: false }).first()).toBeVisible();
    }
    await guard.getByRole('button', { name: 'ثبت خروج', exact: true }).click();
    const exit = await clickCommand(guard, 'ثبت خروج فیزیکی', /\/exit-desk\/authorizations\/[^/]+\/exit$/);
    await expect(guard.getByRole('button', { name: 'ثبت خروج', exact: true })).toHaveCount(0);
    await logistics.goto('/dashboard/logistics/loadings/new', { waitUntil: 'domcontentloaded' });
    const customersAfterExit = await searchCustomer(input.customerLookupName);
    assert.ok(customersAfterExit.some((row: { customerName: string }) => row.customerName === input.customerLookupName), JSON.stringify(customersAfterExit));
    await logistics.getByRole('button', { name: new RegExp(input.customerLookupName) }).click();
    await expect(logistics.getByRole('button', { name: /محل نخست مشتری/ })).toBeVisible();
    await expect(logistics.getByRole('button', { name: /محل دوم مشتری/ })).toHaveCount(0);
    return { loadingId, authorization, exit };
  } catch (error) {
    console.error('Browser API diagnostics:', diagnostics.join('\n'));
    throw error;
  } finally { await browser.close(); }
}
