import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const contractId = 'contract-read-recovery-qa';
const dossierUrl = `/dashboard/accounting/contracts/${contractId}`;
const contractApi = `**/api/accounting/contracts/${contractId}`;
const dossierTitle = 'پرونده حسابداری قرارداد QA-482';
const detail = { success: true, data: {
  contract: {
    contractId, contractNumber: 'QA-482', status: 'DRAFT', isInactive: false,
    customer: { displayName: 'مشتری آزمون پرونده' },
    nextBestActions: [{ kind: 'CREATE_INVOICE', visible: true, enabled: true }],
    accounting: { totalContractAmount: 100, invoicedAmount: 0, receivedAmount: 0, remainingAmount: 100,
      sourceStatus: 'READY', invoiceStatus: 'DRAFT', receivableStatus: 'NOT_CREATED', taxStatus: 'NOT_READY',
      eligibleForFinancialRecords: true, openCorrections: 0, openBlockerFlags: 0 },
  },
  sourceSnapshot: { items: [], deliveries: [], paymentSchedule: [] },
  financialRecords: [], flags: [], correctionRequests: [], financialEvidenceReviewCases: [],
  lifecycleRequests: [{ id: 'pending-qa', kind: 'DELETE', status: 'PENDING', reason: 'درخواست آزمون' }],
  receivables: [], paymentEvents: [], tax: [],
} };
const lifecycle = { success: true, data: {
  deactivationEligibility: { blockers: [] }, deleteEligibility: { blockers: [] },
} };
const failure = { success: false };

test('an unavailable lifecycle panel leaves the dossier visible and can be retried locally', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route(contractApi, route => route.fulfill({ json: detail }));
  let finishLifecycleRead!: () => void;
  const lifecycleRead = new Promise<void>(resolve => { finishLifecycleRead = resolve; });
  let failed = true;
  await page.route(`${contractApi}/lifecycle`, async route => {
    await lifecycleRead;
    await route.fulfill(failed ? { status: 503, json: failure } : { json: lifecycle });
  });

  await page.goto(dossierUrl);
  const heading = page.getByRole('heading', { name: dossierTitle });
  try {
    await expect(heading).toBeVisible();
    await expect(page.getByRole('button', { name: 'غیرفعال‌سازی', exact: true })).toBeDisabled();
  } finally {
    finishLifecycleRead();
  }
  await expect(page.getByText('وضعیت مدیریت قرارداد دریافت نشد.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تأیید', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'حذف دائمی', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'دانلود PDF', exact: true })).toBeEnabled();

  failed = false;
  await page.getByRole('button', { name: 'تلاش دوباره برای وضعیت قرارداد' }).click();
  await expect(page.getByRole('button', { name: 'غیرفعال‌سازی', exact: true })).toBeEnabled();
  await expect(heading).toBeVisible();
});

test('a failed profile refresh removes previously known lifecycle authority', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route(contractApi, route => route.fulfill({ json: detail }));
  await page.route(`${contractApi}/lifecycle`, route => route.fulfill({ json: lifecycle }));
  await page.goto(dossierUrl);
  await expect(page.getByRole('button', { name: 'حذف دائمی', exact: true })).toBeEnabled();

  // The dashboard shell has already completed its real authentication check.
  await page.route('**/api/dashboard/profile', route => route.fulfill({ status: 503, json: failure }));
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();

  await expect(page.getByRole('heading', { name: dossierTitle })).toBeVisible();
  await expect(page.getByText('نقش شما برای مدیریت وضعیت قرارداد دریافت نشد.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'غیرفعال‌سازی', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'حذف دائمی', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'تأیید', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'درخواست حذف دائمی', exact: true })).toHaveCount(0);

  await page.unroute('**/api/dashboard/profile');
  await page.getByRole('button', { name: 'تلاش دوباره برای بررسی نقش' }).click();
  await expect(page.getByRole('button', { name: 'حذف دائمی', exact: true })).toBeEnabled();
});

test('contract read distinguishes temporary failure, grant denial, and definitive absence', async ({ page }) => {
  await loginAsAdmin(page);
  let status = 503;
  await page.route(contractApi, route => route.fulfill(status === 200 ? { json: detail } : { status, json: failure }));
  await page.route(`${contractApi}/lifecycle`, route => route.fulfill({ json: lifecycle }));
  await page.goto(dossierUrl);
  await expect(page.getByRole('alert').filter({ hasText: 'دریافت پرونده حسابداری قرارداد انجام نشد.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'قرارداد یافت نشد' })).toHaveCount(0);

  status = 200;
  await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(page.getByRole('heading', { name: dossierTitle })).toBeVisible();

  status = 403;
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'دسترسی به قرارداد مجاز نیست' })).toBeVisible();
  await expect(page.getByText('مشتری آزمون پرونده')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تلاش دوباره', exact: true })).toHaveCount(0);

  status = 404;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'قرارداد یافت نشد' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'دسترسی به قرارداد مجاز نیست' })).toHaveCount(0);
});
