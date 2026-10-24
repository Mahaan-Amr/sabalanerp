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
    let refreshHeld = false;
    let releaseRefresh: (() => void) | undefined;
    // Intercept every Partner command: these browser assertions never submit customer SMS.
    await page.route('**/api/partner/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/confirmation') && route.request().method() === 'POST') {
        attempts++;
        return route.fulfill({ json: attempts === 1
          ? { success: false, error: 'ارسال پیامک تأیید انجام نشد.' }
          : { success: true, data: { messageId: 'qa-provider-accepted' } } });
      }
      if (path.endsWith('/changes-v2')) return route.fulfill({ json: { success: true, data: { version: `sha256-v1:${'4'.repeat(64)}` } } });
      if (path.endsWith('/query-v2')) {
        if (surface === 'list' && attempts === 2 && !refreshHeld) {
          refreshHeld = true;
          await new Promise<void>(resolve => { releaseRefresh = resolve; });
        }
        return route.fulfill({ json: { success: true, data: { cases: [row] } } });
      }
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
    // Keep the authenticated browser's current epoch. Fix time while the
    // install/pause commands cross IPC, then restore advancing Date semantics
    // while paused so only explicit runFor calls consume the success lifetime.
    const confirmationClockStart = await page.evaluate(() => Date.now());
    await page.clock.install({ time: confirmationClockStart });
    await page.clock.setFixedTime(confirmationClockStart);
    await page.clock.pauseAt(confirmationClockStart);
    await page.clock.setSystemTime(confirmationClockStart);
    await send.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(success).toBeVisible();
    if (surface === 'list') await expect.poll(() => refreshHeld).toBe(true);
    // Start the paused browser clock before the successful response, so UI polling
    // and the held refresh cannot subtract time from the four-second contract.
    await page.clock.runFor(3_999);
    await expect(success).toBeVisible();
    await page.clock.runFor(1);
    await expect(success).toHaveCount(0);
    await page.clock.resume();
    releaseRefresh?.();
    await expect(send).toBeEnabled();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await send.click();
      await expect(success).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`feedback-${surface}-${width}-${theme}.png`), fullPage: true });
    }
  });
}
