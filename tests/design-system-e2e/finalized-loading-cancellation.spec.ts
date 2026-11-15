import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const id = 'unified-cancellation-fixture';
const loadingUrl = `/dashboard/logistics/loadings/${id}`;
const reason = 'لغو بارگیری آزمایشی';
const rejection = 'بارگیری باید پس از بررسی دوباره ارسال شود';
const documents = [
  { id: 'invoice', number: '3', kind: 'INVOICE' },
  { id: 'waybill', number: '0', kind: 'WAYBILL' },
];

for (const outcome of ['APPROVE', 'DECLINE', 'DIRECT'] as const) {
  test(`finalized loading cancellation: ${outcome}`, async ({ page }) => {
    await loginAsAdmin(page);
    let cancelled = false;
    let requestStatus: string | undefined;
    await page.route('**/api/dashboard/action-availability**', route =>
      route.fulfill({ json: { success: true, data: { CANCEL_LOADING: { enabled: true } } } }));
    await page.route(`**/api/logistics/loadings/${id}`, route => route.fulfill({ json: {
      success: true, data: {
        id, status: cancelled ? 'CANCELLED' : 'FINALIZED', loadingNumber: '1', loadingDate: '2026-11-15T08:00:00.000Z',
        lines: [], corrections: [], canonicalAllocationRevisions: [{ id: 'revision' }],
        cancellationRequest: requestStatus && { status: requestStatus, reason: requestStatus === 'REJECTED' ? rejection : null },
      },
    } }));
    await page.route(`**/api/logistics/loadings/${id}/cancellation-documents`, route =>
      route.fulfill({ json: { success: true, data: { documents, canVoidDocuments: outcome === 'DIRECT' } } }));
    await page.route(`**/api/logistics/loadings/${id}/sales-invoices`, route =>
      route.fulfill({ json: { success: true, data: { invoices: [], ready: false } } }));
    let directCommands = 0;
    await page.route(`**/api/logistics/loadings/${id}/cancel`, route => {
      directCommands++;
      expect(route.request().postDataJSON()).toEqual({ reason, expectedDocumentIds: ['invoice', 'waybill'] });
      cancelled = true;
      return route.fulfill({ json: { success: true } });
    });
    let requests = 0;
    await page.route(`**/api/logistics/loadings/${id}/cancellation-request`, route => {
      requests++;
      expect(route.request().postDataJSON()).toEqual({ reason });
      requestStatus = 'PENDING';
      return route.fulfill({ json: { success: true } });
    });

    await page.goto(`${loadingUrl}?action=cancel`);
    const dialog = page.getByRole('dialog', { name: 'لغو بارگیری نهایی‌شده پیش از خروج' });
    await expect(dialog.getByText('فاکتور فروش شمارهٔ ۳')).toBeVisible();
    await expect(dialog.getByText('بارنامه شمارهٔ ۰')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'دلیل لغو' }).fill(reason);
    if (outcome === 'DIRECT') {
      await dialog.getByRole('button', { name: 'ابطال اسناد و تأیید لغو' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText('لغوشده', { exact: true })).toBeVisible();
      expect(directCommands).toBe(1);
      expect(requests).toBe(0);
      return;
    }

    await expect(dialog.getByText(/حساب کاربری شما مجوز لازم برای ابطال این اسناد را ندارد/)).toBeVisible();
    await expect(dialog.getByText(/وظایف بین‌واحدی/)).toBeVisible();
    await dialog.getByRole('button', { name: 'ارسال درخواست به حسابداری' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('درخواست لغو در انتظار تصمیم حسابداری است.')).toBeVisible();
    expect(requests).toBe(1);
    expect(directCommands).toBe(0);

    const dutyId = 'request-fixture';
    const dutyTitle = 'درخواست لغو بارگیری — ۱';
    const duty = () => ({
      id: dutyId, status: requestStatus === 'PENDING' ? 'OPEN' : 'COMPLETED', access: 'SHARED',
      canReassign: false, responseRequiresReason: false, accessProvenance: [], history: [],
      sourceActionCode: 'LOADING_CANCELLATION_REVIEW', sourceVersion: 1, envelopeVersion: 1,
      dueAtDisplay: 'بدون مهلت', overdue: false, detailAvailable: true, evidence: [],
      fields: { title: dutyTitle, description: `دلیل لغو ${reason}، فاکتور فروش شمارهٔ ۳، بارنامه شمارهٔ ۰` },
      allowedActionCodes: requestStatus === 'PENDING' ? ['APPROVE', 'DECLINE'] : [],
      result: requestStatus === 'PENDING' ? null : { actionCode: outcome, reason: outcome === 'DECLINE' ? rejection : null },
    });
    await page.route('**/api/duties/workspaces/accounting/summary', route =>
      route.fulfill({ json: { success: true, data: { open: 1, dueSoon: 0, overdue: 0, available: 0, history: 0 } } }));
    await page.route('**/api/duties/workspaces/accounting/duties?*', route =>
      route.fulfill({ json: { success: true, data: [duty()] } }));
    await page.route(`**/api/duties/workspaces/accounting/duties/${dutyId}`, route =>
      route.fulfill({ json: { success: true, data: duty() } }));
    let decisions = 0;
    await page.route(`**/api/duties/${dutyId}/respond`, route => {
      decisions++;
      expect(route.request().postDataJSON()).toEqual({ actionCode: outcome,
        expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: outcome === 'DECLINE' ? rejection : null });
      cancelled = outcome === 'APPROVE';
      requestStatus = cancelled ? 'APPROVED' : 'REJECTED';
      return route.fulfill({ json: { success: true, data: duty() } });
    });

    await page.goto('/dashboard/accounting/duties');
    await expect(page.getByRole('heading', { name: dutyTitle })).toBeVisible();
    await page.getByRole('link', { name: 'مشاهده وظیفه' }).click();
    await expect(page.getByText(/فاکتور فروش شمارهٔ ۳، بارنامه شمارهٔ ۰/)).toBeVisible();
    if (outcome === 'APPROVE') {
      await page.getByRole('button', { name: 'تأیید درخواست لغو' }).click();
      const confirmation = page.getByRole('dialog', { name: 'تأیید ابطال اسناد و لغو بارگیری' });
      await expect(confirmation.getByText(/پذیرش راننده و خودرو در گارد باز می‌ماند/)).toBeVisible();
      expect(decisions).toBe(0);
      await confirmation.getByRole('button', { name: 'ابطال اسناد و لغو بارگیری' }).click();
    } else {
      await page.getByRole('button', { name: 'رد درخواست' }).click();
      await page.getByRole('textbox', { name: 'دلیل اقدام' }).fill(rejection);
      await page.getByRole('button', { name: 'ثبت تصمیم' }).click();
    }
    await expect(page.getByRole('heading', { name: 'نتیجه ثبت‌شده' })).toBeVisible();
    await page.goto(loadingUrl);
    if (cancelled) await expect(page.getByText('لغوشده', { exact: true })).toBeVisible();
    else await expect(page.getByText(`حسابداری درخواست لغو را رد کرد. دلیل رد: ${rejection}`)).toBeVisible();
    expect(decisions).toBe(1);
  });
}
