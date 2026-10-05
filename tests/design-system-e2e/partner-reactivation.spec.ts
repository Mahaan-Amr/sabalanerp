import { expect, test } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { assertNoHorizontalOverflow, loginAsAdmin, setTheme } from './support/design-system';

for (const width of [1280, 390]) test(`cancelled Partner requires fresh authority and reactivates through the ordinary modal at ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerFixtures();
  let authorized = false, activated = false;
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/sales/contracts/reactivation-ui-case', route => route.fulfill({ json: { success: true, data: {
    id: 'reactivation-ui-case', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: fixture.partner.owner.caseId,
    partnerRevision: fixture.partner.owner.revision, partnerIntegrityHash: fixture.partner.owner.integrityHash,
    partnerCaseView: { ...fixture.partner, state: activated ? 'COMMITTED' : 'VOIDED' },
    status: activated ? 'DRAFT' : 'CANCELLED', commercialFlowVersion: 2, products: [],
  } } }));
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/reactivate')) {
      submitted = route.request().postDataJSON(); activated = true;
      await route.fulfill({ json: { success: true, data: { status: 'NOTE', commercialRevision: 3 } } }); return;
    }
    await route.fulfill({ json: { success: true, data: { cases: [{
      view: { ...fixture.partner, state: activated ? 'COMMITTED' : 'VOIDED' },
      commercial: { version: 1, revision: activated ? 3 : 2, status: activated ? 'NOTE' : 'CANCELLED',
        salesApproved: false, customerAccepted: false, inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null },
      history: [], snapshotId: null, actions: { canContinue: false, canPreview: false, canIssue: false,
        canFinalize: false, canSendConfirmation: false, canRequestCorrection: false, canCancel: false,
        canRequestVoid: false, canReactivate: authorized && !activated },
    }] } } });
  });
  await page.goto('/dashboard/sales/contracts/reactivation-ui-case');
  await expect(page.getByRole('button', { name: 'فعال‌سازی قرارداد', exact: true })).toBeDisabled();
  authorized = true; await page.reload();
  await page.getByRole('button', { name: 'فعال‌سازی قرارداد', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'فعال‌سازی قرارداد', exact: true });
  await expect(dialog).toBeVisible();
  await setTheme(page, 'light'); await assertNoHorizontalOverflow(page);
  await setTheme(page, 'dark'); await assertNoHorizontalOverflow(page);
  await dialog.getByRole('textbox', { name: 'دلیل فعال‌سازی' }).fill('فعال‌سازی با تأیید تازه مدیر');
  await dialog.getByRole('button', { name: 'تأیید فعال‌سازی قرارداد', exact: true }).click();
  await expect.poll(() => submitted?.expectedState).toBe('VOIDED');
  expect(submitted?.commercialRevision).toBe(2);
  expect(submitted?.expected).toEqual(fixture.partner.owner);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('یادداشت', { exact: true }).first()).toBeVisible();
});
