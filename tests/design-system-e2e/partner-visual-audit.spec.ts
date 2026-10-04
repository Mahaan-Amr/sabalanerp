import { test, expect } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin, setTheme, setViewportAndZoom, assertNoSeriousAxeViolations } from './support/design-system';

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`Partner pending case visual audit ${width}px ${theme}`, async ({ page }) => {
    const fixture = createPartnerFixtures();
    await page.setViewportSize({ width, height: 900 });
    await loginAsAdmin(page);
    await page.route('**/api/partner/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/query-v2') ? { cases: [{
        view: { ...fixture.partner, state: 'DRAFT', commercialFlowVersion: 1, pricingState: 'AWAITING_INQUIRY',
          customerConfirmationState: 'NOT_SENT', products: fixture.partner.products.map(({ wholesaleUnitPrice, ...row }) => row),
          sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined },
        commercial: { version: 1, revision: 1, status: 'DRAFT', salesApproved: true, customerAccepted: false,
          inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null },
        history: [], snapshotId: null, actions: { canContinue: false, canPreview: false, canIssue: false,
          canFinalize: false, canSendConfirmation: true, canRequestCorrection: false, canCancel: false,
          canRequestVoid: false, canRejectDraft: true, canApproveSales: false },
      }] } : null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    });
    await page.goto(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(fixture.partner.owner.caseId)}`);
    await expect(page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true })).toBeVisible();
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/case-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
    try { await assertNoSeriousAxeViolations(page); } catch (error) { expect.soft(String(error)).toBe('No accessibility violations'); }
    await expect(page.getByRole('button', { name: 'بازگشت به یادداشت', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ویرایش', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'ویرایش', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('دلیل')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'بازگشت برای اصلاح', exact: true })).toBeVisible();
    await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/dialog-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
    try { await assertNoSeriousAxeViolations(page); } catch (error) { expect.soft(String(error)).toBe('No accessibility violations'); }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    if (width === 1280) {
      await setViewportAndZoom(page, { width, height: 900 }, 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/zoom-200-${theme}.png`, fullPage: true, animations: 'disabled' });
    }
  });
}

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`Customer reads and responds while inquiry pending ${width}px ${theme}`, async ({ page }) => {
    const fixture = createPartnerFixtures();
    let decision = 'PENDING'; let banner: string | null = null; let resend = 0;
    await page.route('**/api/public/contracts/confirm/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/verify')) {
        if (route.request().postDataJSON().code !== '654321') {
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'کد تایید صحیح نیست' }) }); return;
        }
        decision = 'APPROVED';
      } else if (path.endsWith('/reject')) decision = 'REJECTED';
      else if (path.endsWith('/resend')) resend++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
        contract: fixture.customer, verifiedAt: decision === 'APPROVED' ? new Date().toISOString() : null,
        linkExpiresAt: '2027-01-01T00:00:00Z', sellerFinalized: false, decision, readOnly: !!banner, banner,
      } }) });
    });
    await page.goto('/contracts/confirm/visual-qa-fixture');
    await expect(page.getByRole('button', { name: 'تایید قرارداد', exact: true })).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/پذیرش همین نسخه و شرایط آن توسط شما/)).toBeVisible();
    await setTheme(page, theme); await setViewportAndZoom(page, { width, height: 900 });
    await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/customer-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 390) {
      const table = page.getByRole('region', { name: 'کد، نام، نوع، ابعاد، تعداد، متراژ، نرخ، مبلغ کل', exact: true });
      await table.focus();
      const before = await table.evaluate(element => element.scrollLeft);
      for (let key = 0; key < 6; key++) await page.keyboard.press('ArrowLeft');
      await expect.poll(() => table.evaluate(element => element.scrollLeft)).not.toBe(before);
    }
    await page.getByRole('button', { name: 'تایید قرارداد', exact: true }).click();
    await expect(page.getByText('کد تایید را وارد کنید', { exact: true })).toBeVisible();
    await page.getByPlaceholder('کد تایید', { exact: true }).fill('111111');
    await page.getByRole('button', { name: 'تایید قرارداد', exact: true }).click();
    await expect(page.getByText('کد تایید صحیح نیست', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ارسال مجدد کد', exact: true }).click();
    await expect(page.getByText('کد تایید دوباره ارسال شد', { exact: true })).toBeVisible();
    expect(resend).toBe(1);
    await page.getByPlaceholder('کد تایید', { exact: true }).fill('654321');
    await page.getByRole('button', { name: 'تایید قرارداد', exact: true }).click();
    await expect(page.getByRole('button', { name: 'تایید قرارداد', exact: true })).toHaveCount(0);
    decision = 'PENDING'; await page.reload();
    await page.getByRole('button', { name: 'رد این نسخه', exact: true }).click();
    const modal = page.getByRole('dialog'); await expect(modal).toBeVisible();
    await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/customer-reject-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
    await modal.getByRole('button', { name: 'بله، این نسخه رد شود', exact: true }).click();
    await expect(page.getByText('رد این نسخه توسط مشتری ثبت شده است.', { exact: true })).toBeVisible();
    decision = 'PENDING'; banner = 'SUPERSEDED'; await page.reload();
    await expect(page.getByRole('button', { name: 'تایید قرارداد', exact: true })).toHaveCount(0);
    await expect(page.getByText(/نسخه جدید جایگزین شده است/)).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });
}

for (const width of [1280, 390]) test(`Accounting requires explicit financial registration ${width}px`, async ({ page }) => {
  const fixture = createPartnerFixtures(); let registrations = 0;
  const row = { caseId: fixture.partner.owner.caseId, contractNumber: 'همکار-QA-قطعی', owner: fixture.partner.owner,
    commercial: { version: 1, revision: 1, status: 'FINAL', salesApproved: true, customerAccepted: true,
      inquiry: 'ACCEPTED', expiresAt: null, firstFinancialRecordAt: null }, canRegister: true, canPaper: false };
  await loginAsAdmin(page);
  await page.route('**/api/accounting/contracts?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { items: [], total: 0, page: 1, pageSize: 50 } }) }));
  await page.route('**/api/partner/accounting/commercial-candidates', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: registrations ? [] : [row,
    { ...row, caseId: 'waiting', contractNumber: 'همکار-QA-منتظر', commercial: { ...row.commercial, status: 'CUSTOMER_SIGNED', inquiry: 'WAITING' }, canRegister: false, canPaper: false },
    { ...row, caseId: 'paper', contractNumber: 'همکار-QA-کاغذی', commercial: { ...row.commercial, status: 'DRAFT', customerAccepted: false }, canRegister: false, canPaper: true },
  ] }) }));
  await page.route('**/api/partner/accounting/enqueue', async route => {
    expect(route.request().postDataJSON()).toEqual(fixture.partner.owner); registrations++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });
  await page.goto('/dashboard/accounting/contracts');
  const title = page.getByText('قراردادهای همکار پیش از ثبت مالی', { exact: true });
  await expect(title).toBeVisible(); await title.click();
  await expect(page.getByRole('button', { name: 'ثبت پیش‌نویس مالی', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'ثبت امضای کاغذی مشتری', exact: true })).toHaveCount(1);
  await expect(page.getByText('همکار-QA-منتظر', { exact: true })).toBeVisible();
  expect(registrations).toBe(0);
  await setViewportAndZoom(page, { width, height: 900 });
  await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/accounting-${width}.png`, fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'ثبت پیش‌نویس مالی', exact: true }).click();
  await expect(title).toHaveCount(0); expect(registrations).toBe(1);
});

for (const width of [1280, 390]) test(`All commercial and inquiry statuses remain independent ${width}px`, async ({ page }) => {
  const fixture = createPartnerFixtures(); let inquiry = 'WAITING'; let status = 'DRAFT';
  await loginAsAdmin(page);
  await page.route('**/api/partner/**', async route => {
    const data = new URL(route.request().url()).pathname.endsWith('/query-v2') ? { cases: [{
      view: { ...fixture.partner, state: 'DRAFT', commercialFlowVersion: 1 },
      commercial: { version: 1, revision: 1, status, salesApproved: status !== 'NOTE', customerAccepted: ['CUSTOMER_SIGNED', 'FINAL'].includes(status), inquiry, expiresAt: null, firstFinancialRecordAt: null },
      history: [], snapshotId: null, actions: { canContinue: false, canPreview: false, canIssue: false, canFinalize: false, canSendConfirmation: true, canRequestCorrection: false, canCancel: false, canRequestVoid: false, canRejectDraft: true, canApproveSales: false },
    }] } : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  const url = `/dashboard/sales/partner-cases?caseId=${encodeURIComponent(fixture.partner.owner.caseId)}`;
  for (const [value, label] of [['WAITING', 'در حال انتظار'], ['ACCEPTED', 'تأیید استعلام'], ['REJECTED', 'رد استعلام'], ['CORRECTION_REQUIRED', 'نیازمند اصلاح']]) {
    inquiry = value; await page.goto(url);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true })).toBeVisible();
  }
  for (const [value, label] of [['NOTE', 'یادداشت'], ['CUSTOMER_SIGNED', 'امضا شده'], ['FINAL', 'قطعی']]) {
    status = value; await page.goto(url);
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await setViewportAndZoom(page, { width, height: 900 });
  await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/final-${width}.png`, fullPage: true, animations: 'disabled' });
});

for (const width of [1280, 390]) test(`New stone customer price remains empty ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  let failCatalogOnce = true;
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const input = route.request().postData() ? route.request().postDataJSON() : {};
    if (path.endsWith('/catalog/query') && input.kind === 'PRODUCT' && failCatalogOnce) {
      failCatalogOnce = false;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'INTEGRITY_CONFLICT' }) }); return;
    }
    let data: unknown = null;
    if (path.endsWith('/creation-context')) data = { schemaVersion: 1, kind: 'PARTNER', actorId: 'visual-qa', actorDisplayName: 'همکار آزمایشی', profileId: 'visual-qa-profile', writable: true, inquiryIds: [], recoverableDrafts: [], customers: [{ id: 'qa-customer', displayName: 'مشتری قیمت خالی', address: 'تهران' }], projects: [{ id: 'qa-project', customerId: 'qa-customer', title: 'پروژه قیمت خالی' }] };
    else if (path.endsWith('/catalog/query')) data = { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: input.kind, items: input.kind === 'PRODUCT' ? [{
      catalogItemId: 'qa-stone', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z', code: '1010610930100', name: 'سنگ قیمت خالی آزمون', families: ['longitudinal'], salesUnits: { prepared: 'count', volumetric: 'count' },
      dimensions: { motherLengthMeters: '2', motherWidthCentimeters: '35', thicknessCentimeters: '2' }, attributes: { stoneType: 'مرمریت', mine: 'آباد', finish: 'صیقل', color: 'سفید', quality: '1', cuttingDimension: '30' }, isAvailable: true,
      suggestedRetailUnitPrice: { amount: '10000000', currency: 'IRT' },
    }] : [] };
    else if (path.endsWith('/recoveries/acquire')) data = { schemaVersion: 1, recoveryId: input.recoveryId, browserSessionId: input.browserSessionId, leaseToken: 'qa-lease', baseRevision: 0, updatedAt: new Date().toISOString(), takenOver: false };
    else if (path.endsWith('/recoveries/read')) data = { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: 0, updatedAt: new Date().toISOString(), draft: null };
    else if (path.endsWith('/recoveries/checkpoint')) data = { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: input.expectedRecoveryRevision + 1, inputRevision: input.draft.inputRevision, updatedAt: new Date().toISOString(), replayed: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto('/dashboard/sales/contracts/create?entry=new-contract');
  const workflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await workflow.getByRole('button', { name: /مشتری قیمت خالی/ }).click();
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await workflow.getByRole('button', { name: /پروژه قیمت خالی/ }).click();
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(page.getByText('دریافت کاتالوگ فنی انجام نشد؛ محصولات قرارداد حفظ شده‌اند.', { exact: true })).toBeVisible();
  await expect(page.getByText(/این محصول دیگر در کاتالوگ فعال نیست/)).toHaveCount(0);
  await page.getByRole('button', { name: 'تلاش مجدد دریافت کاتالوگ', exact: true }).click();
  await page.getByRole('option', { name: /سنگ قیمت خالی آزمون/ }).click();
  const modal = page.getByRole('dialog', { name: 'تنظیمات محصول', exact: true });
  await expect(modal.getByRole('textbox', { name: /قیمت فروش به مشتری/ })).toHaveValue('');
  await setViewportAndZoom(page, { width, height: 900 });
  await modal.getByRole('textbox', { name: /قیمت فروش به مشتری/ }).scrollIntoViewIfNeeded();
  await modal.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/empty-price-${width}.png`, animations: 'disabled' });
  await modal.getByRole('button', { name: 'انصراف', exact: true }).click();
  await expect(modal).toHaveCount(0);
});
