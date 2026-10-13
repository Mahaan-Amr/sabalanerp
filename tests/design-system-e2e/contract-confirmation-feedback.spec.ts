import { expect, test } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';

for (const surface of ['detail', 'list'] as const) for (const width of [1280, 390]) {
  test(`Partner ${surface} confirmation rejects failed sends and expires success at four seconds (${width}px)`, async ({ page }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    const fixture = createPartnerFixtures();
    const view = { ...fixture.partner, state: 'COMMITTED' as const };
    const row = { view, snapshotId: null, customerOutput: fixture.customer, history: [],
      actions: { canContinue: false, canPreview: false, canIssue: false, canFinalize: false,
        canSendConfirmation: true, canRequestCorrection: false, canCancel: false, canRequestVoid: false } };
    let attempts = 0;
    // Intercept every Partner command: these browser assertions never submit customer SMS.
    await page.route('**/api/partner/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/confirmation') && route.request().method() === 'POST') {
        attempts++;
        return route.fulfill({ json: attempts === 1
          ? { success: false, error: 'ارسال پیامک تأیید انجام نشد.' }
          : { success: true, data: { messageId: 'qa-provider-accepted' } } });
      }
      if (path.endsWith('/query-v2')) return route.fulfill({ json: { success: true, data: { cases: [row] } } });
      if (path.endsWith('/creation-context')) return route.fulfill({ json: { success: true, data: {
        schemaVersion: 1, kind: 'PARTNER', actorId: 'qa-partner-actor', profileId: 'qa-partner-profile',
        writable: true, inquiryIds: [], customers: [], projects: [], recoverableDrafts: [],
      } } });
      return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
    });
    await page.route('**/api/sales/contracts/qa-partner-feedback', route => route.fulfill({ json: { success: true, data: {
      id: 'qa-partner-feedback', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: view.owner.caseId,
      partnerRevision: view.owner.revision, partnerIntegrityHash: view.owner.integrityHash,
      partnerCaseView: view, products: [], status: 'DRAFT',
    } } }));
    await page.goto(surface === 'detail' ? '/dashboard/sales/contracts/qa-partner-feedback'
      : `/dashboard/sales/contracts?caseId=${encodeURIComponent(view.owner.caseId)}`);
    const send = page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true });
    await expect(send).toBeVisible();
    const success = page.getByText('پیامک با موفقیت ارسال شد ✨', { exact: true });
    await send.click();
    await expect.poll(() => attempts).toBe(1);
    await expect(send).toBeEnabled();
    await expect(success).toHaveCount(0);
    await send.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(success).toBeVisible();
    const appearedAt = Date.now();
    await page.waitForTimeout(3_000);
    await expect(success).toBeVisible();
    await expect(success).toHaveCount(0, { timeout: 2_000 });
    expect(Date.now() - appearedAt).toBeGreaterThanOrEqual(3_800);
    expect(Date.now() - appearedAt).toBeLessThan(5_000);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await send.click();
      await expect(success).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`feedback-${surface}-${width}-${theme}.png`), fullPage: true });
    }
  });
}
