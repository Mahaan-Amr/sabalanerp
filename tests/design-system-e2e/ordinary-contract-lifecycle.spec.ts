import { expect, test, type Page, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, assertNoHorizontalOverflow } from './support/design-system';

const reply = (route: Route, data: unknown) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }),
});
const contractId = 'ordinary-lifecycle-isolated';
const baseAccounting = {
  sourceStatus: 'VISIBLE_ONLY', eligibleForFinancialRecords: false, invoiceStatus: 'NONE',
  receivableStatus: 'NONE', taxStatus: 'NOT_READY', openFlags: 0, openBlockerFlags: 0,
  openCorrections: 0, totalContractAmount: '100000', invoicedAmount: '0', receivedAmount: '0', remainingAmount: '100000',
};
const salesContract = () => ({
  id: contractId, contractNumber: 'QA-LIFECYCLE', title: 'قرارداد آزمون', titlePersian: 'قرارداد آزمون',
  status: 'EXPIRED', commercialFlowVersion: 1, commercialRevision: 7,
  commercialExpiresAt: '2026-01-10T00:00:00.000Z', firstFinancialRecordAt: null,
  totalAmount: 100000, currency: 'ریال', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  customer: { id: 'customer-isolated', firstName: 'مشتری', lastName: 'آزمون', customerType: 'INDIVIDUAL' },
  department: { id: 'sales', name: 'Sales', namePersian: 'فروش' },
  createdByUser: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
  responsibleSeller: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
  responsibleSellerSource: 'CREATOR', accounting: { ...baseAccounting }, items: [], deliveries: [], payments: [],
  commercialActions: { canRenew: true, canEdit: false, canApproveSales: false, canSendConfirmation: false },
});

for (const width of [1280, 390]) {
  test(`ordinary expired renewal protects pending state and retries with the shown reason at ${width}px`, async ({ page }) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    const contract = salesContract();
    let attempts = 0;
    let releaseRenewal: (() => void) | undefined;
    await page.route(`**/api/sales/contracts/${contractId}`, route => reply(route, contract));
    await page.route('**/api/sales/reports/sellers*', route => reply(route, []));
    await page.route(`**/api/sales/contracts/${contractId}/renew`, async route => {
      expect(route.request().postDataJSON()).toEqual({ reason: 'مشتری برای امضای نسخه جدید مراجعه می‌کند' });
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'اطلاعات قرارداد تغییر کرده است؛ دوباره تلاش کنید.' }) });
        return;
      }
      await new Promise<void>(resolve => { releaseRenewal = resolve; });
      contract.status = 'DRAFT'; contract.commercialRevision = 8;
      contract.commercialActions = { canRenew: false, canEdit: true, canApproveSales: true, canSendConfirmation: true };
      await reply(route, contract);
    });
    await page.route(`**/api/sales/contracts/${contractId}/approve`, async route => {
      expect(route.request().postDataJSON()).toEqual({ commercialRevision: 8 });
      contract.status = 'PENDING_APPROVAL'; contract.commercialActions.canApproveSales = false;
      await reply(route, contract);
    });
    await page.goto(`/dashboard/sales/contracts/${contractId}`);
    await page.getByRole('button', { name: 'تمدید مهلت', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'تمدید مهلت قرارداد', exact: true });
    const submit = dialog.getByRole('button', { name: 'تمدید و بازگشت به یادداشت', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('دلیل تمدید').fill('مشتری برای امضای نسخه جدید مراجعه می‌کند');
    await submit.click();
    await expect(dialog).toContainText('اطلاعات قرارداد تغییر کرده است');
    await expect(dialog.getByLabel('دلیل تمدید')).toHaveValue('مشتری برای امضای نسخه جدید مراجعه می‌کند');
    await submit.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(submit).toBeDisabled();
    await expect(dialog.getByLabel('دلیل تمدید')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await assertNoHorizontalOverflow(page);
    releaseRenewal!();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'تمدید مهلت', exact: true })).toHaveCount(0);
    await expect(page.getByText('یادداشت', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'تایید', exact: true }).click();
    await expect(page.getByText('پیش‌نویس', { exact: true }).first()).toBeVisible();
    expect(attempts).toBe(2);
  });
}

async function stubAccounting(page: Page, status: string) {
  const final = status === 'SIGNED';
  const paperAvailable = ['DRAFT', 'PENDING_APPROVAL'].includes(status);
  const contract = {
    contractId, contractNumber: 'QA-LIFECYCLE', status, commercialFlowVersion: 1, commercialRevision: 4,
    customer: { displayName: 'مشتری آزمون' }, accounting: { ...baseAccounting, eligibleForFinancialRecords: final },
    capabilities: { canActFinancially: final, canRecordPaperSignature: paperAvailable },
    nextBestActions: ['CREATE_INVOICE', 'CREATE_RECEIVABLE', 'FLAG_CONTRACT', 'CREATE_CORRECTION_REQUEST']
      .map(kind => ({ kind, visible: final, enabled: final, labelFa: kind })),
  };
  const detail = { contract, sourceSnapshot: { items: [] }, financialRecords: [], receivables: [], paymentEvents: [],
    tax: [], flags: [], correctionRequests: [], voidWorkflows: [], lifecycleRequests: [] };
  await page.route(`**/api/accounting/contracts/${contractId}`, route => reply(route, detail));
  await page.route(`**/api/accounting/contracts/${contractId}/lifecycle`, route => reply(route, {
    deleteEligibility: { blockers: [] }, deactivationEligibility: { blockers: [] },
  }));
  return contract;
}

for (const status of ['DRAFT', 'APPROVED']) {
  test(`ordinary ${status} keeps printing while financial actions stay hidden`, async ({ page }) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width: 390, height: 844 });
    const contract = await stubAccounting(page, status);
    let signatureWrites = 0;
    await page.route(`**/api/accounting/contracts/${contractId}/customer-paper-signature`, async route => {
      expect(route.request().postDataJSON()).toEqual({ revision: 4 });
      signatureWrites += 1;
      contract.status = 'APPROVED'; contract.capabilities.canRecordPaperSignature = false;
      await reply(route, {});
    });
    await page.goto(`/dashboard/accounting/contracts/${contractId}`);
    await expect(page.getByRole('button', { name: 'دانلود PDF', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'چاپ', exact: true })).toBeEnabled();
    const paper = page.getByRole('button', { name: 'ثبت امضای کاغذی مشتری', exact: true });
    if (status === 'DRAFT') {
      await expect(paper).toBeEnabled();
      await paper.click();
      await expect(paper).toHaveCount(0);
      await expect(page.getByText('امضا شده', { exact: true })).toBeVisible();
      expect(signatureWrites).toBe(1);
    } else await expect(paper).toHaveCount(0);
    await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
    for (const name of ['ایجاد پیش‌نویس صورتحساب', 'ایجاد دریافتنی', 'پرچم حسابداری', 'درخواست اصلاح']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'اقدام سریع', exact: true })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
}

test('ordinary final contract exposes financial actions without another Sales signature', async ({ page }) => {
  await loginAsAdmin(page);
  await stubAccounting(page, 'SIGNED');
  await page.goto(`/dashboard/accounting/contracts/${contractId}`);
  await expect(page.getByText('قطعی', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ثبت امضای کاغذی مشتری', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ایجاد پیش‌نویس صورتحساب', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'پرچم حسابداری', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'درخواست اصلاح', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'ایجاد دریافتنی', exact: true })).toBeVisible();
});
