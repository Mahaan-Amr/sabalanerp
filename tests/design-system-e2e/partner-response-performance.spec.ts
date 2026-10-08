import { test, expect } from '@playwright/test';
import { createPartnerWorkspaceFixturesV2 } from '../../packages/partner-sales-contracts/dist/testing';
import { partnerError } from '../../packages/partner-sales-contracts/dist';
import { loginAsAdmin, assertNoHorizontalOverflow } from './support/design-system';

for (const width of [1280, 390]) for (const lostAcknowledgement of [false, true]) test(`price receipt is independent of a delayed or failed refresh at ${width}px (lost acknowledgement: ${lostAcknowledgement})`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerWorkspaceFixturesV2();
  const inquiry = { ...fixture.responder, inquiryId: 'performance-inquiry', caseId: 'performance-case',
    actions: [{ action: 'INQUIRY_RESPOND', enabled: true }], rows: [{ ...fixture.responder.rows[1],
      rowId: 'performance-row', state: 'PENDING', actions: [{ action: 'INQUIRY_RESPOND', enabled: true }] }] };
  let submitted = false;
  let refreshRequests = 0;
  let release!: () => void;
  const refreshGate = new Promise<void>(resolve => { release = resolve; });
  const commands: unknown[] = [];
  await page.route('**/api/partner/**', route => route.abort());
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true, data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
  await page.route('**/api/partner/inquiries/query-v2', route => route.fulfill({ json: { success: true, data: inquiry } }));
  await page.route('**/api/partner/workspaces/query-v2', async route => {
    if (submitted && refreshRequests++ === 0) {
      await refreshGate;
      return route.fulfill({ status: 503, json: partnerError('TEMPORARY_FAILURE') });
    }
    const approvedAt = Date.now();
    const current = submitted ? { ...inquiry, rows: inquiry.rows.map(row => ({ ...row, revision: 2, state: 'APPROVED', actions: [],
      approvedPrice: { amount: '2500000', currency: row.identity.currency }, approvedAt: new Date(approvedAt).toISOString(),
      expiresAt: new Date(approvedAt + 2 * 86400000).toISOString() })) } : inquiry;
    return route.fulfill({ json: { success: true, data: { ...fixture.responderWorkspace, inquiries: [current] } } });
  });
  await page.route('**/api/partner/inquiries/commands', async route => {
    const command = route.request().postDataJSON(); commands.push(command); submitted = true;
    if (lostAcknowledgement && commands.length === 1) return route.abort();
    await route.fulfill({ json: { success: true, data: { commandId: command.commandId, replayed: false,
      eventIds: ['performance-event'], batch: { schemaVersion: 1, commandId: command.commandId,
        outcomes: [{ ok: true, rowId: 'performance-row', outcomeId: 'performance-outcome', revision: 2, outcome: 'APPROVED' }] } } } });
  });
  try {
    await page.goto('/dashboard/sales/partner-inquiries?inquiryId=performance-inquiry');
    await page.getByRole('textbox', { name: /قیمت هر/ }).fill('2500000');
    await page.getByRole('button', { name: 'مرور و ثبت قیمت', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ثبت پاسخ‌ها', exact: true }).click();
    if (lostAcknowledgement) {
      const review = page.getByRole('dialog');
      await expect(review.getByText('نتیجه ثبت هنوز مشخص نیست؛ همان درخواست را دوباره بررسی کنید.', { exact: true })).toBeVisible();
      expect(refreshRequests).toBe(0);
      await review.getByRole('button', { name: 'بررسی همان درخواست', exact: true }).click();
      expect(commands[0]).toEqual(commands[1]);
    }
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('1 ردیف ثبت شد؛ 0 ردیف نیازمند بررسی است.', { exact: true })).toBeVisible();
    await expect(page.getByText('پاسخ قیمت ثبت شد؛ در حال دریافت وضعیت تازه…', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /قیمت هر/ })).toBeDisabled();
    release();
    await expect(page.getByText('پاسخ قیمت ثبت شد؛ دریافت وضعیت تازه انجام نشد.', { exact: true })).toBeVisible();
    await expect(page.getByText(partnerError('TEMPORARY_FAILURE').message, { exact: true })).toHaveCount(0);
    expect(commands).toHaveLength(lostAcknowledgement ? 2 : 1);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `reports/qa/partner-response-performance/refresh-failed-${width}-${lostAcknowledgement}.png`, fullPage: true });
    await page.getByRole('button', { name: 'دریافت وضعیت تازه', exact: true }).last().click();
    await expect(page.getByText('پاسخ قیمت ثبت شد؛ دریافت وضعیت تازه انجام نشد.', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /قیمت هر/ })).toHaveCount(0);
    expect(commands).toHaveLength(lostAcknowledgement ? 2 : 1);
  } finally { release(); }
});
