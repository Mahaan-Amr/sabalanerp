import { expect, test } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin } from './support/design-system';

for (const width of [1280, 390]) test(`Partner Sales contract detail confirms repeated sends without exposing private response secrets ${width}px`, async ({ page, baseURL }, testInfo) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerFixtures();
  let sends = 0;
  const sendRequests: { path: string; method: string; body: string | null }[] = [];
  const publicLink = new URL('/contracts/confirm/local-detail-test', baseURL).href;
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
    if (path.endsWith('/changes-v2')) return route.fulfill({ json: { success: true, data: { version: `sha256-v1:${'4'.repeat(64)}` } } });
    if (path.endsWith('/query-v2')) return route.fulfill({ json: { success: true, data: { cases: [{ view,
      commercial: { version: 1, revision: 1, status: 'DRAFT', salesApproved: true, customerAccepted: false,
        inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null }, history: [], snapshotId: null,
      actions: { canSendConfirmation: true, canContinue: false, canPreview: false, canIssue: false,
        canFinalize: false, canRequestCorrection: false, canCancel: false, canRequestVoid: false } }] }
      } });
    if (path === `/api/partner/cases/${encodeURIComponent(view.owner.caseId)}/confirmation` && route.request().method() === 'POST') {
      sendRequests.push({ path, method: route.request().method(), body: route.request().postData() });
      const data = { ...(++sends < 3 ? { debugOtp: sends === 1 ? '654321' : '765432' } : {}),
        publicLink, otpExpiresAt: new Date(Date.now() + 600000).toISOString() };
      return route.fulfill({ json: { success: true, data } });
    }
    return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
  });
  await page.goto('/dashboard/sales/contracts/local-preview-test');
  const send = page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true });
  for (const attempt of [1, 2, 3]) {
    await send.click();
    await expect.poll(() => sends).toBe(attempt);
    await expect(page.getByText('پیامک با موفقیت ارسال شد ✨', { exact: true })).toBeVisible();
    await expect(send).toBeEnabled();
    await expect(page.getByText('654321', { exact: true })).toHaveCount(0);
    await expect(page.getByText('765432', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'مشاهده قرارداد مشتری', exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="${publicLink}"]`)).toHaveCount(0);
    await expect(page.getByText(publicLink, { exact: true })).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath(`confirmation-private-response-${width}.png`), fullPage: true });
  expect(sendRequests).toEqual(Array.from({ length: 3 }, () => ({
    path: `/api/partner/cases/${encodeURIComponent(view.owner.caseId)}/confirmation`, method: 'POST', body: null,
  })));

});

for (const width of [1280, 390]) test(`Partner confirmation keeps private response secrets hidden before and after approvals reset at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerFixtures();
  let revision = 1;
  let approved = true;
  await loginAsAdmin(page);
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/changes-v2')) return route.fulfill({ json: { success: true, data: { version: `sha256-v1:${String(revision).padStart(64, '0')}` } } });
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
  await expect(page.getByText('پیامک با موفقیت ارسال شد ✨', { exact: true })).toBeVisible();
  await expect(page.getByText('654321', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'مشاهده قرارداد مشتری' })).toHaveCount(0);
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
    if (path.endsWith('/changes-v2')) return route.fulfill({ json: { success: true, data: { version: `sha256-v1:${'4'.repeat(64)}` } } });
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
