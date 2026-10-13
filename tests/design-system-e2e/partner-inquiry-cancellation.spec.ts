import { test, expect } from '@playwright/test';
import { createPartnerWorkspaceFixturesV2 } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin, setTheme, assertNoSeriousAxeViolations } from './support/design-system';

for (const width of [1280, 390]) {
  test(`responder list waits for manual refresh and retains cancelled history ${width}px`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 900 });
    const fixture = createPartnerWorkspaceFixturesV2();
    let cancelled = false;
    const summary = { id: 'cancellation-case', customer: 'مشتری آزمون لغو', partnerDisplayName: 'همکار آزمون',
      label: 'کد پیگیری ۱۱۳۰', pending: true, requestedAt: fixture.responder.submittedAt,
      answeredRows: 0, currentRows: 1, cancelled: false };
    await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true,
      data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
    await page.route('**/api/partner/workspaces/query-v2', route => {
      const query = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, data: { ...fixture.responderWorkspace, inquiries: [],
        contracts: cancelled ? query.view === 'history' ? [{ ...summary, pending: false, cancelled: true }] : [] : [summary],
        contractCounts: { pending: cancelled ? 0 : 1, answered: 0, history: cancelled ? 1 : 0 } } } });
    });
    await page.clock.install();
    await page.goto('/dashboard/sales/partner-inquiries?view=pending');
    await expect(page.locator('p:visible').filter({ hasText: summary.customer })).toBeVisible();
    cancelled = true;
    await page.clock.fastForward(45_000);
    await expect(page.locator('p:visible').filter({ hasText: summary.customer })).toBeVisible();
    await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
    await expect(page.getByText(summary.customer, { exact: true })).toHaveCount(0);
    await page.goto('/dashboard/sales/partner-inquiries?view=history');
    await expect(page.locator('p:visible').filter({ hasText: summary.customer })).toBeVisible();
    await expect(page.locator('span:visible').filter({ hasText: /^لغوشده$/ })).toBeVisible();
    await page.screenshot({ path: `tmp/qa/partner-inquiry-cancellation/list-history-${width}.png`, fullPage: true });
  });

  test(`cancellation closes an open price review and preserves prior prices ${width}px`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 900 });
    const fixture = createPartnerWorkspaceFixturesV2();
    let cancelled = false, commands = 0;
    const pending = fixture.responder.rows.find(row => row.state === 'PENDING')!;
    const approved = fixture.responder.rows.find(row => row.state === 'APPROVED')!;
    await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true,
      data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
    await page.route('**/api/partner/inquiries/commands', route => { commands++; return route.abort(); });
    await page.route('**/api/partner/workspaces/query-v2', route => route.fulfill({ json: { success: true,
      data: { ...fixture.responderWorkspace, inquiries: [{ ...fixture.responder, caseId: 'cancellation-case', cancelled,
        actions: cancelled ? [] : [{ action: 'INQUIRY_RESPOND', enabled: true }], rows: [approved, cancelled
          ? { ...pending, state: 'CANCELLED', actions: [], noteOrReason: 'لغو قرارداد به درخواست همکار' } : pending] }],
        contractCounts: { pending: cancelled ? 0 : 1, answered: 0, history: cancelled ? 1 : 0 } } } }));
    await page.goto('/dashboard/sales/partner-inquiries/cancellation-case');
    const input = page.getByRole('textbox', { name: /قیمت هر/ }).first();
    await expect(input).toBeVisible();
    await input.fill('1750000');
    await page.getByRole('button', { name: 'مرور و ثبت قیمت', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    cancelled = true;
    await expect(page.getByText('این قرارداد لغو شده و امکان پاسخ به استعلام وجود ندارد.', { exact: true })).toBeVisible({ timeout: 22_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /قیمت هر/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'مرور و ثبت قیمت', exact: true })).toHaveCount(0);
    await expect(page.getByText('قیمت مصوب هر واحد:', { exact: false }).first()).toBeVisible();
    expect(commands).toBe(0);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await assertNoSeriousAxeViolations(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `tmp/qa/partner-inquiry-cancellation/detail-${width}-${theme}.png`, fullPage: true });
    }
  });
}
