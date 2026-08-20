import { expect, test, type Page, type Route } from '@playwright/test';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
  waitForStableState,
} from './support/design-system';

const contractId = 'e2e-financial-evidence-contract';
const caseId = 'e2e-financial-evidence-case';
const invoiceId = 'e2e-financial-evidence-invoice';
const caseHref = `/dashboard/accounting/contracts/${contractId}/financial-evidence-reviews/${caseId}`;

const json = (route: Route, status: number, body: unknown) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const reviewCase = {
  id: caseId,
  contractId,
  sourceFinancialRecordId: invoiceId,
  status: 'OPEN',
  severity: 'BLOCKER',
  kind: 'QUANTITY',
  remediationKind: 'RESPONSIBLE_SELLER_CORRECTION',
  resolutionMode: 'LEGACY_UNVERIFIED',
  readyForFinancialApproval: false,
  titleFa: 'پرونده بررسی کمیت قرارداد',
  messageFa: 'کمیت قطعات ثبت‌شده با کمیت کل قرارداد سازگار نیست.',
  ruleLabelFa: 'قاعده تاریخی هر ردیف: گردکردن نیم‌به‌بالا با دقت سه رقم، سپس مقایسه قطعی',
  guidance: 'فروشنده مسئول باید از صفحه قرارداد فروش درخواست اصلاح را آغاز کند.',
  primaryAction: {
    kind: 'OPEN_SALES_CONTRACT',
    labelFa: 'رفتن به قرارداد فروش',
    href: `/dashboard/sales/contracts/${contractId}`,
  },
  canRetryReconciliation: true,
  witnesses: [
    { source: 'OPTIMIZER_TOTAL', labelFa: 'کمیت کل optimizer', rawValue: '10.1251', transformedValue: '10.125', unit: 'متر' },
    { source: 'OPTIMIZER_PRODUCTION', labelFa: 'جمع قطعات تولیدی optimizer', rawValue: '10.1244', transformedValue: '10.124', unit: 'متر' },
    { source: 'PRODUCT_GRAPH', labelFa: 'کمیت Product Graph', rawValue: '10.1251', transformedValue: '10.125', unit: 'متر' },
    { source: 'DELIVERY', labelFa: 'تحویل ثبت‌شده ۱', rawValue: '10.125', transformedValue: '10.125', unit: 'متر' },
  ],
  differences: [{ labelFa: 'اختلاف دقیق', value: '-0.0007', unit: 'متر' }],
  checklist: [
    { key: 'SALES_CORRECTION', labelFa: 'فروشنده مسئول از صفحه قرارداد فروش، درخواست اصلاح را ثبت و گردش تأیید را کامل کند', complete: false },
    { key: 'DELETE_STALE_DRAFT', labelFa: 'حسابداری پیش‌فاکتور ناسازگار را با دکمه «حذف پیش‌نویس» حذف کند', complete: false },
    { key: 'CREATE_FRESH_DRAFT', labelFa: 'پس از اعمال اصلاح مبدأ، پیش‌فاکتور تازه ایجاد شود', complete: false },
    { key: 'RECHECK_AND_APPROVE', labelFa: 'شواهد پیش‌فاکتور تازه بازآزمایی و تأیید مالی دوباره اجرا شود', complete: false },
  ],
  audit: {
    createdBy: 'مدیر سیستم',
    createdAt: '2026-08-20T08:00:00.000Z',
    lastRecheckedBy: null,
    lastRecheckedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
  },
};

const contractDetail = (caseOpen: boolean, presentedCase = reviewCase) => ({
  contract: {
    contractId,
    contractNumber: '100285',
    status: 'SIGNED',
    isInactive: false,
    customer: { displayName: 'مشتری آزمون' },
    accounting: {
      totalContractAmount: 380_300_000,
      invoicedAmount: 380_300_000,
      receivedAmount: 0,
      remainingAmount: 380_300_000,
      sourceStatus: 'READY',
      invoiceStatus: 'DRAFT',
      receivableStatus: 'NOT_CREATED',
      taxStatus: 'NOT_READY',
      eligibleForFinancialRecords: true,
      openCorrections: 0,
      openBlockerFlags: caseOpen ? 1 : 0,
    },
  },
  sourceSnapshot: { items: [], deliveries: [], paymentSchedule: [] },
  financialRecords: [{
    id: invoiceId,
    kind: 'INVOICE_CANDIDATE',
    status: 'DRAFT',
    amount: 380_300_000,
    currency: 'IRR',
    createdAt: '2026-08-20T08:00:00.000Z',
  }],
  flags: caseOpen ? [{
    id: caseId,
    contractId,
    trackingCode: `financial-evidence:${invoiceId}`,
    title: 'نیازمند بررسی شواهد مالی',
    status: 'OPEN',
    evidence: { code: 'FINANCIAL_EVIDENCE_CONFLICT', userMessageFa: reviewCase.messageFa },
  }] : [],
  financialEvidenceReviewCases: caseOpen ? [presentedCase] : [],
  correctionRequests: [], lifecycleRequests: [], receivables: [], paymentEvents: [], tax: [],
  replacementWorkflow: null,
});

const installAccountingFixture = async (page: Page, initialCaseOpen = false, presentedCase = reviewCase) => {
  let caseOpen = initialCaseOpen;
  let detailReads = 0;
  await page.route(`**/api/accounting/contracts/${contractId}/lifecycle`, route => json(route, 200, {
    success: true,
    data: { deactivationEligibility: { blockers: [] }, deleteEligibility: { blockers: [] } },
  }));
  await page.route(`**/api/accounting/contracts/${contractId}`, route => {
    detailReads += 1;
    return json(route, 200, { success: true, data: contractDetail(caseOpen, presentedCase) });
  });
  await page.route('**/api/accounting/actions', async route => {
    const body = route.request().postDataJSON() as { kind?: string };
    if (body.kind !== 'APPROVE_FINANCIAL_INVOICE') return json(route, 400, { success: false, error: 'فرمان آزمایشی ناشناخته است.' });
    caseOpen = true;
    return json(route, 409, {
      success: false,
      code: 'FINANCIAL_EVIDENCE_CONFLICT',
      error: 'تأیید مالی متوقف شد. کمیت قطعات ثبت‌شده با کمیت کل قرارداد سازگار نیست. پرونده بررسی ایجاد شد.',
      reviewCase: { id: caseId, contractId, actionUrl: caseHref },
      actionUrl: caseHref,
    });
  });
  return { detailReads: () => detailReads };
};

test('approval conflict reloads the contract and opens the exact dedicated review case', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = await installAccountingFixture(page);
  await page.goto(`/dashboard/accounting/contracts/${contractId}`);
  await waitForStableState(page);

  await page.getByText('شماره فاکتور سیستمی', { exact: true }).locator('..').locator('input').fill('1168');
  await page.getByText('مبلغ سپیدار (ریال)', { exact: true }).locator('..').locator('input').fill('380300000');
  const readsBeforeApproval = fixture.detailReads();
  await page.getByRole('button', { name: 'تایید مالی', exact: true }).click();

  const reviewLink = page.getByRole('link', { name: 'رفتن به پرونده بررسی', exact: true });
  await expect(reviewLink).toHaveAttribute('href', caseHref);
  expect(fixture.detailReads()).toBeGreaterThan(readsBeforeApproval);
  await expect(page.getByRole('button', { name: 'بستن پرچم' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'لغو پرچم' })).toHaveCount(0);

  await reviewLink.click();
  await expect(page).toHaveURL(new RegExp(`${caseHref}$`));
  await expect(page.getByTestId('financial-evidence-review-case')).toBeVisible();
  await expect(page.getByText('اختلاف دقیق', { exact: true })).toBeVisible();
  await expect(page.getByText('مقدار قابل‌مقایسه طبق قاعده منبع').first()).toBeVisible();
  await expect(page.getByText('ایجاد پرونده توسط', { exact: true }).locator('..').getByText('مدیر سیستم', { exact: true })).toBeVisible();
  await expect(page.getByText(/حذف پیش‌نویس/).first()).toBeVisible();
});

test('list approval conflict reloads the affected summary before showing its case link', async ({ page }) => {
  await loginAsAdmin(page);
  let listReads = 0;
  let caseOpen = false;
  await page.route('**/api/accounting/contracts?**', route => {
    listReads += 1;
    return json(route, 200, {
      success: true,
      data: {
        items: [{
          contractId,
          contractNumber: '100285',
          titlePersian: 'قرارداد آزمون شواهد مالی',
          createdAt: '2026-08-20T08:00:00.000Z',
          contractDate: '2026-08-20T08:00:00.000Z',
          customer: { id: 'customer-1', displayName: 'مشتری آزمون' },
          status: 'SIGNED',
          isInactive: false,
          accounting: {
            sourceStatus: 'READY', eligibleForFinancialRecords: true,
            invoiceStatus: 'DRAFT', receivableStatus: 'NONE', taxStatus: 'NOT_READY',
            openFlags: caseOpen ? 1 : 0, openBlockerFlags: caseOpen ? 1 : 0, openCorrections: 0,
            totalContractAmount: '380300000', invoicedAmount: '380300000', receivedAmount: '0', remainingAmount: '380300000',
          },
          financialRecords: [{
            id: invoiceId, kind: 'INVOICE_CANDIDATE', status: 'DRAFT', amount: '380300000', currency: 'IRR',
            createdAt: '2026-08-20T08:00:00.000Z',
          }],
        }],
        page: 1,
        pageSize: 50,
        total: 1,
      },
    });
  });
  await page.route('**/api/accounting/actions', route => {
    caseOpen = true;
    return json(route, 409, {
      success: false,
      code: 'FINANCIAL_EVIDENCE_CONFLICT',
      error: 'تأیید مالی متوقف شد و پرونده بررسی ایجاد شد.',
      reviewCase: { id: caseId, contractId, actionUrl: caseHref },
      actionUrl: caseHref,
    });
  });
  await page.goto('/dashboard/accounting/contracts');
  await waitForStableState(page);

  await page.getByRole('button', { name: 'تایید مالی', exact: true }).first().click();
  await page.getByText('شماره فاکتور سیستمی', { exact: true }).locator('..').locator('input').fill('1168');
  await page.getByText('مبلغ سپیدار (ریال)', { exact: true }).locator('..').locator('input').fill('380300000');
  const readsBeforeApproval = listReads;
  await page.locator('div.fixed.inset-0.z-50').getByRole('button', { name: 'تایید مالی', exact: true }).click();

  await expect(page.getByRole('link', { name: 'رفتن به پرونده بررسی', exact: true })).toHaveAttribute('href', caseHref);
  expect(listReads).toBeGreaterThan(readsBeforeApproval);
});

test('dedicated review remains usable in dark mobile layout', async ({ page }) => {
  await loginAsAdmin(page);
  await installAccountingFixture(page, true);
  await page.goto(caseHref);
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await setTheme(page, 'dark');
  await waitForStableState(page);

  const caseSurface = page.getByTestId('financial-evidence-review-case');
  await expect(caseSurface).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertMinimumTargetSize(page.getByRole('link', { name: 'رفتن به قرارداد فروش', exact: true }).last());
  await assertMinimumTargetSize(page.getByRole('button', { name: 'بازآزمایی شواهد', exact: true }));
  await assertNoSeriousAxeViolations(page);
});

test('evidence recovery carries the exact case route into support origin', async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithSupportOriginProbe(key: string, value: string) {
      if (key === 'support-ticket-origin') window.name = value;
      return originalSetItem.call(this, key, value);
    };
  });
  await loginAsAdmin(page);
  await installAccountingFixture(page, true, {
    ...reviewCase,
    remediationKind: 'EVIDENCE_RECOVERY',
    guidance: 'نسخه تولیدکننده و قاعده تاریخی باید با سند حسابرسی بازیابی شود.',
    primaryAction: {
      kind: 'OPEN_SUPPORT',
      labelFa: 'گزارش مشکل فنی',
      href: '/dashboard/support/new',
    },
  });
  await page.route('**/dashboard/support/new', route => route.abort());
  await page.goto(caseHref);
  await waitForStableState(page);

  await page.getByRole('button', { name: 'گزارش مشکل فنی', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.name)).toContain(caseHref);
});

test('captures the release QA views', async ({ page }) => {
  await loginAsAdmin(page);
  await installAccountingFixture(page, true);
  await page.goto(caseHref);
  await waitForStableState(page);

  const output = process.env.RELEASE_QA_ARTIFACT_DIR || 'tmp/qa';
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await setViewportAndZoom(page, { width: viewport.width, height: viewport.height });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await waitForStableState(page);
      await expect(page.getByTestId('financial-evidence-review-case')).toBeVisible();
      await page.screenshot({
        path: `${output}/financial-evidence-review-${viewport.name}-${theme}.png`,
        fullPage: true,
      });
    }
  }
});
