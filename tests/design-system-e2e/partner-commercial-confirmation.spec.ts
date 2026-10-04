import { expect, test } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin } from './support/design-system';

for (const width of [1280, 390]) test(`Partner Sales contract detail shows the actual local confirmation response ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerFixtures();
  let sends = 0;
  const view = { ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY', customerConfirmationState: 'SENT',
    products: fixture.partner.products.map(({ wholesaleUnitPrice, ...row }) => row),
    sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined };
  await page.route('**/api/sales/contracts/local-preview-test', route => route.fulfill({ json: { success: true, data: {
    id: 'local-preview-test', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: view.owner.caseId,
    partnerRevision: view.owner.revision, partnerIntegrityHash: view.owner.integrityHash, partnerCaseView: view,
    status: 'PENDING_APPROVAL', commercialFlowVersion: 2, products: [],
  } } }));
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/query-v2') ? { cases: [{ view,
      commercial: { version: 1, revision: 1, status: 'DRAFT', salesApproved: true, customerAccepted: false,
        inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null }, history: [], snapshotId: null,
      actions: { canSendConfirmation: true, canContinue: false, canPreview: false, canIssue: false,
        canFinalize: false, canRequestCorrection: false, canCancel: false, canRequestVoid: false } }] }
      : { ...(++sends < 3 ? { debugOtp: sends === 1 ? '654321' : '765432' } : {}),
        publicLink: 'http://127.0.0.1:3000/contracts/confirm/local-detail-test', otpExpiresAt: new Date(Date.now() + 600000).toISOString() };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/dashboard/sales/contracts/local-preview-test');
  await page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true }).click();
  await expect(page.getByText('654321', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'مشاهده قرارداد مشتری', exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'مشاهده قرارداد مشتری', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/contracts\/confirm\/local-detail-test$/);
  await popup.close();
  await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/detail-code-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true }).click();
  await expect(page.getByText('765432', { exact: true })).toBeVisible();
  await expect(page.getByText('654321', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true }).click();
  await expect(page.getByText('765432', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'مشاهده قرارداد مشتری', exact: true })).toHaveCount(0);
});

for (const width of [1280, 390]) test(`Partner local sent-code preview stays beside its contract and disappears when approvals reset at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerFixtures();
  let revision = 1;
  let approved = true;
  await loginAsAdmin(page);
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith('/query-v2')) data = { cases: [{
      view: { ...fixture.partner, state: 'DRAFT', commercialFlowVersion: 1, pricingState: 'AWAITING_INQUIRY', customerConfirmationState: 'NOT_SENT', products: fixture.partner.products.map(({ wholesaleUnitPrice, ...row }) => row), sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined },
      commercial: { version: 1, revision, status: approved ? 'DRAFT' : 'NOTE', salesApproved: approved,
        customerAccepted: false, inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null },
      history: [], snapshotId: null, actions: { canContinue: false, canPreview: false, canIssue: false,
        canFinalize: false, canSendConfirmation: true, canRequestCorrection: false, canCancel: false,
        canRequestVoid: false, canRejectDraft: approved, canApproveSales: !approved },
    }] };
    else if (path.endsWith('/confirmation')) data = { debugOtp: '654321', publicLink: 'http://localhost:3000/contracts/confirm/ui-fixture-token', otpExpiresAt: new Date(Date.now() + 600000).toISOString() };
    else if (path.endsWith('/commercial')) { revision++; approved = false; data = {}; }
    else if (path.includes('/corrections/')) data = null;
    else data = null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(fixture.partner.owner.caseId)}`);
  await page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true }).click();
  await expect(page.getByText('654321', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'مشاهده قرارداد مشتری' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'بازگشت به یادداشت', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ویرایش', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'ویرایش', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('دلیل').fill('اصلاح اطلاعات قرارداد مشتری');
  await modal.getByRole('button', { name: 'بازگشت برای اصلاح', exact: true }).click();
  await expect(page.getByText('654321', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تایید', exact: true })).toBeVisible();
});

for (const width of [1280, 390]) test(`Partner approval creates draft and rejection cancels by cancellation ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await loginAsAdmin(page);
  const fixture = createPartnerFixtures();
  let approved = false, cancelled = false;
  const commands: string[] = [];
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const input = route.request().postData() ? route.request().postDataJSON() : {};
    let data: unknown = null;
    if (path.endsWith('/query-v2')) data = { cases: [{
      view: { ...fixture.partner, state: cancelled ? 'CANCELLED' : 'DRAFT', commercialFlowVersion: 1,
        pricingState: 'AWAITING_INQUIRY', customerConfirmationState: 'NOT_SENT',
        products: fixture.partner.products.map(({ wholesaleUnitPrice, ...row }) => row),
        sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined },
      commercial: { version: 1, revision: 1, status: cancelled ? 'CANCELLED' : approved ? 'DRAFT' : 'NOTE',
        salesApproved: approved, customerAccepted: false, inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null },
      history: [],
      snapshotId: null, actions: { canContinue: false, canPreview: false, canIssue: false, canFinalize: false,
        canSendConfirmation: !cancelled, canRequestCorrection: false, canCancel: !cancelled, canRequestVoid: false,
        canRejectDraft: approved && !cancelled, canApproveSales: !approved && !cancelled,
      },
    }] };
    else if (path.endsWith('/commercial')) {
      commands.push(input.action);
      if (input.action === 'APPROVE_SALES') approved = true;
    } else if (path.endsWith('/lifecycle/commands')) {
      commands.push(input.type); expect(input.reason).toBe('لغو قرارداد به درخواست فروشنده'); cancelled = true;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(fixture.partner.owner.caseId)}`);
  await expect(page.getByRole('button', { name: 'امضا', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'رد', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'تایید', exact: true }).click();
  await expect(page.getByRole('button', { name: 'امضا', exact: true })).toHaveCount(0);
  await expect(page.getByText('پیش‌نویس', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/seller-approved-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'رد', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'لغو پیش از قطعیت', exact: true });
  await modal.getByLabel('دلیل لغو').fill('لغو قرارداد به درخواست فروشنده');
  await modal.getByRole('button', { name: 'ثبت لغو', exact: true }).click();
  await expect(page.getByText('لغو شده', { exact: true }).first()).toBeVisible();
  expect(commands).toEqual(['APPROVE_SALES', 'CASE_CANCEL']);
  await expect(page.getByRole('button', { name: 'تایید', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'رد', exact: true })).toHaveCount(0);
});
