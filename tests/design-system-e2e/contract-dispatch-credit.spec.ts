import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, assertNoHorizontalOverflow } from './support/design-system';
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
  test(`manager request preserves the date on retry and opens dispatch at ${width}px`, async ({ page }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    const id = 'qa-dispatch-credit-browser';
    const contract = { contractId: id, contractNumber: 'QA-CREDIT', status: 'SIGNED', commercialFlowVersion: 1, commercialRevision: 1,
      customer: { displayName: 'مشتری آزمون' }, accounting: { sourceStatus: 'VISIBLE_ONLY', eligibleForFinancialRecords: true,
        invoiceStatus: 'NONE', receivableStatus: 'NONE', taxStatus: 'NOT_READY', totalContractAmount: '1000', receivedAmount: '0', remainingAmount: '1000' },
      capabilities: { canActFinancially: true, canRecordPaperSignature: true }, nextBestActions: [] };
    await page.route(`**/api/accounting/contracts/${id}`, route => reply(route, { contract, sourceSnapshot: { items: [] }, financialRecords: [],
      receivables: [], paymentEvents: [], tax: [], flags: [], correctionRequests: [], voidWorkflows: [], lifecycleRequests: [] }));
    await page.route(`**/api/accounting/contracts/${id}/lifecycle`, route => reply(route, { deleteEligibility: { blockers: [] }, deactivationEligibility: { blockers: [] } }));
    const view: any = { authorities: [], access: { read: true, request: true, manage: true, seller: false }, canRequestManager: true,
      eligible: false, actorId: 'admin', activeManagerId: null, responsibleSeller: { id: 'seller', displayName: 'فروشنده آزمون' },
      balance: { sellerId: 'seller', limitRials: '0', usedRials: '0', availableRials: '0', balanceRials: '0' } };
    await page.route(`**/api/dispatch-credit/contracts/${id}`, route => reply(route, view));
    let requests = 0; let firstDate = '';
    await page.route(`**/api/dispatch-credit/contracts/${id}/requests`, async route => {
      const body = route.request().postDataJSON(); expect(body.kind).toBe('MANAGER'); expect(body.promisedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      requests++;
      if (requests === 1) { firstDate = body.promisedDate; await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'اطلاعات تغییر کرده؛ دوباره تلاش کنید.' }) }); return; }
      expect(body.promisedDate).toBe(firstDate);
      view.eligible = true; view.activeManagerId = 'manager-grant';
      view.authorities = [{ id: 'manager-grant', kind: 'MANAGER', status: 'APPROVED', revision: 1, promisedDate: firstDate,
        requestedBy: 'admin', amountRials: '0' }];
      await reply(route, view.authorities[0]);
    });
    await page.goto(`/dashboard/accounting/contracts/${id}`);
    await expect(page.getByRole('button', { name: 'ثبت امضای کاغذی مشتری', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'درخواست تأیید مدیریتی', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'مجوز مدیریتی', exact: true });
    await dialog.getByRole('button', { name: 'تاریخ وعده پرداخت مشتری', exact: true }).click();
    await page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' }).getByRole('button', { name: 'امروز', exact: true }).click();
    const submit = dialog.getByRole('button', { name: 'ثبت', exact: true });
    await submit.click(); await expect(dialog.getByText('اطلاعات تغییر کرده؛ دوباره تلاش کنید.')).toBeVisible();
    await submit.click(); await expect(dialog).toBeHidden();
    await expect(page.getByText('شرط مالی ارسال برقرار است.', { exact: true })).toBeVisible();
    expect(requests).toBe(2);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`manager-request-${width}.png`), fullPage: true });
  });
}
