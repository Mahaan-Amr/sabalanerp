import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';
const reply = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
test('Sales credit settings read the live authorized local API', async ({ page }) => {
  await loginAsAdmin(page);
  const response = page.waitForResponse(value => value.url().includes('/api/dispatch-credit/sellers') && value.request().method() === 'GET');
  await page.goto('/dashboard/sales/settings');
  const result = await (await response).json();
  expect(result.success).toBe(true);
  expect(Array.isArray(result.data)).toBe(true);
  await expect(page.getByText('اعتبار فروشندگان', { exact: true })).toBeVisible();
  expect(result.data.some((row: any) => !/^\d+$/.test(row.availableRials))).toBe(false);
});
for (const width of [1280, 390]) {
  test(`Seller credit settings save an explicit Rial limit at ${width}px`, async ({ page }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    await page.route('**/api/sales/commercial-settings', route => reply(route, { canManage: true, expiryDays: 10 }));
    const row = { id: 'qa-credit-seller', sellerId: 'qa-credit-seller', firstName: 'فروشنده', lastName: 'آزمون', username: 'credit-qa',
      limitRials: '1000000', usedRials: '300000', availableRials: '700000', balanceRials: '700000' };
    await page.route('**/api/dispatch-credit/sellers', route => reply(route, [row]));
    let saves = 0;
    await page.route('**/api/dispatch-credit/sellers/qa-credit-seller', async route => {
      expect(route.request().postDataJSON()).toEqual({ limitRials: '2000000' }); saves++;
      await reply(route, { ...row, limitRials: '2000000', availableRials: '1700000', balanceRials: '1700000' });
    });
    await page.goto('/dashboard/sales/settings');
    await page.getByRole('textbox', { name: 'سقف اعتبار فروشنده آزمون' }).fill('2000000');
    await page.getByRole('button', { name: 'ذخیره اعتبار', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ذخیره شد', exact: true })).toBeVisible();
    expect(saves).toBe(1);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`credit-settings-${width}.png`), fullPage: true });
  });
  for (const theme of ['light', 'dark'] as const) test(`manager request waits for an independent dated decision at ${width}px ${theme}`, async ({ page }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    await setTheme(page, theme);
    const id = 'qa-dispatch-credit-browser';
    const contract = { contractId: id, contractNumber: 'QA-CREDIT', status: 'SIGNED', commercialFlowVersion: 1, commercialRevision: 1,
      customer: { displayName: 'مشتری آزمون' }, accounting: { sourceStatus: 'VISIBLE_ONLY', eligibleForFinancialRecords: true,
        invoiceStatus: 'NONE', receivableStatus: 'NONE', taxStatus: 'NOT_READY', totalContractAmount: '1000', receivedAmount: '0', remainingAmount: '1000' },
      capabilities: { canActFinancially: true, canRecordPaperSignature: true }, nextBestActions: [] };
    await page.route(`**/api/accounting/contracts/${id}`, route => reply(route, { contract, sourceSnapshot: { items: [] }, financialRecords: [],
      receivables: [], paymentEvents: [], tax: [], flags: [], correctionRequests: [], voidWorkflows: [], lifecycleRequests: [] }));
    await page.route(`**/api/accounting/contracts/${id}/lifecycle`, route => reply(route, { deleteEligibility: { blockers: [] }, deactivationEligibility: { blockers: [] } }));
    const view: any = { authorities: [], access: { read: true, request: true, manage: true, managerDecision: true, seller: false }, canRequestManager: true,
      eligible: false, actorId: 'admin', activeManagerId: null, responsibleSeller: { id: 'seller', displayName: 'فروشنده آزمون' },
      balance: { sellerId: 'seller', limitRials: '0', usedRials: '0', availableRials: '0', balanceRials: '0' } };
    await page.route(`**/api/dispatch-credit/contracts/${id}`, route => reply(route, view));
    let requests = 0; let decisions = 0; let approvedDate = '';
    await page.route(`**/api/dispatch-credit/contracts/${id}/requests`, async route => {
      const body = route.request().postDataJSON(); expect(body.kind).toBe('MANAGER'); expect(body.promisedDate).toBeUndefined();
      requests++;
      view.authorities = [{ id: 'manager-grant', kind: 'MANAGER', status: 'PENDING', revision: 1, promisedDate: null,
        requestedBy: 'admin', amountRials: '0', canDecide: false }];
      await reply(route, view.authorities[0]);
    });
    await page.route('**/api/dispatch-credit/authorities/manager-grant/actions', async route => {
      const body = route.request().postDataJSON(); expect(body.action).toBe('APPROVE');
      expect(body.promisedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); decisions++;
      if (decisions === 1) {
        approvedDate = body.promisedDate;
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'اطلاعات تغییر کرده؛ دوباره تلاش کنید.' }) });
      }
      expect(body.promisedDate).toBe(approvedDate);
      view.eligible = true; view.activeManagerId = 'manager-grant';
      Object.assign(view.authorities[0], { status: 'APPROVED', promisedDate: approvedDate, canDecide: false,
        decidedBy: 'reviewing-manager', deciderName: 'مدیر تأییدکننده آزمون', decidedAt: '2026-10-11T08:30:00Z' });
      await reply(route, { id: 'manager-grant' });
    });
    await page.goto(`/dashboard/accounting/contracts/${id}`);
    await expect(page.getByRole('button', { name: 'ثبت امضای کاغذی مشتری', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'درخواست تأیید مدیریتی', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'مجوز مدیریتی', exact: true });
    await expect(dialog.getByRole('button', { name: 'تاریخ وعده پرداخت مشتری', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'ارسال درخواست', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('مجوز مدیریتی — در انتظار تصمیم', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تأیید', exact: true })).toHaveCount(0);
    await expect(page.getByText('شرط مالی ارسال برقرار است.', { exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
    view.actorId = 'reviewing-manager'; view.authorities[0].canDecide = true;
    await page.reload();
    await page.getByRole('button', { name: 'رد درخواست', exact: true }).click();
    const rejection = page.getByRole('dialog', { name: 'رد درخواست', exact: true });
    await expect(rejection.getByRole('button', { name: 'ثبت', exact: true })).toBeDisabled();
    await expect(rejection.getByRole('button', { name: 'تاریخ وعده پرداخت مشتری', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'تأیید', exact: true }).click();
    const approval = page.getByRole('dialog', { name: 'تأیید درخواست', exact: true });
    const submit = approval.getByRole('button', { name: 'تأیید درخواست', exact: true });
    await expect(submit).toBeDisabled();
    await approval.getByRole('button', { name: 'تاریخ وعده پرداخت مشتری', exact: true }).click();
    await page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' }).getByRole('button', { name: 'امروز', exact: true }).click();
    await submit.click(); await expect(approval.getByText('اطلاعات تغییر کرده؛ دوباره تلاش کنید.')).toBeVisible();
    await submit.click(); await expect(approval).toBeHidden();
    await expect(page.getByText('شرط مالی ارسال برقرار است.', { exact: true })).toBeVisible();
    await expect(page.getByText(/تأییدکننده: مدیر تأییدکننده آزمون/)).toBeVisible();
    await expect(page.getByText(/زمان تصمیم:/)).toBeVisible();
    expect(decisions).toBe(2);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`manager-decision-${width}-${theme}.png`), fullPage: true });
  });
}
