import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, setTheme, setViewportAndZoom } from './support/design-system';

test('revision refresh first preserves the original draft; storage failure keeps the form open', async ({ page }, testInfo) => {
  const user = { id: 'draft_owner_qa', username: 'draft-owner', firstName: 'آزمون', lastName: 'پیش‌نویس',
    role: 'ADMIN', isActive: true, permissions: { features: [], workspaces: [{ workspace: 'sales', permissionLevel: 'admin' }] } };
  const id = 'qa-draft-handoff', state = { revision: 7, conflict: false, loads: 0, checkpoints: 0, saves: 0 };
  const contractData = { contractKind: 'standard', contractDate: '1405/07/25', contractNumber: 'QA-DRAFT',
    customerId: '', projectId: '', products: [], serviceRows: [], deliveries: [],
    discount: { enabled: false, amount: 0, percent: 0, currency: 'تومان' },
    payment: { payments: [], currency: 'تومان', totalContractAmount: 0 }, signature: null };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const send = (data: unknown, extra = {}) => route.fulfill({ json: { success: true, data, ...extra } });
    if (path === '/api/auth/me') return send(user, { session: { id: 'draft_session_qa' } });
    if (path === '/api/dashboard/profile') return send(user);
    if (path === '/api/dashboard/route-availability') return send({ allowed: true });
    if (path === '/api/workspace-permissions/user-workspaces') return send([]);
    if (path === '/api/system-recovery/environment') return send({ sanitizedEnvironment: true });
    if (path.includes('/personnel-performance/badge/me')) return send(null, { badge: null });
    if (path.endsWith('/notifications/unread-count')) return send({ count: 0 });
    if (path.includes('/sales/contract-edit-sessions/')) {
      if (path.endsWith('/acquire')) return send({ session: { leaseToken: 'qa-draft-lease' }, recovery: null });
      if (path.endsWith('/recovery')) {
        state.checkpoints++;
        if (state.conflict) {
          state.revision = 8;
          return route.fulfill({ status: 409, json: { success: false, data: { code: 'revision-conflict', currentBaseRevision: 8 } } });
        }
      }
      return send({});
    }
    if (path === `/api/sales/contracts/${id}`) {
      if (request.method() !== 'GET') { state.saves++; throw Error('This acceptance must not save a contract'); }
      state.loads++;
      return send({ id, contractNumber: 'QA-DRAFT', status: 'DRAFT', commercialFlowVersion: 1,
        commercialRevision: state.revision, commercialActions: { canEdit: true }, isInactive: false,
        accountingEditLocked: false, createdByUser: { id: user.id }, payments: [],
        productGraphProjection: { revision: state.revision }, contractData });
    }
    if (path.endsWith('/confirmation-status')) return send({ contractStatus: 'DRAFT', commercialFlowVersion: 1 });
    return send([]);
  });
  await page.goto(`/dashboard/sales/contracts/${id}/edit`);
  const calendar = page.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last();
  await expect(calendar).toBeVisible();
  await expect.poll(() => state.checkpoints).toBeGreaterThan(0);
  state.conflict = true;
  await calendar.click();
  const day = page.locator('[data-date]:not([disabled])').last();
  const changedDate = await day.getAttribute('data-date');
  expect(changedDate).toBeTruthy(); expect(changedDate).not.toBe(contractData.contractDate);
  await day.click();
  const refresh = page.getByRole('button', { name: 'بارگذاری آخرین نسخه', exact: true });
  await expect(refresh).toBeVisible();
  const before = state.loads;
  // Native Chromium quota denial: the same production handler must retain the
  // page when IndexedDB cannot commit, then succeed after capacity returns.
  const protocol = await page.context().newCDPSession(page);
  await protocol.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin, quotaSize: 1 });
  await refresh.click();
  await expect(page.getByText('ذخیرهٔ بازیابی محلی محدود شده است؛ تا برقراری ذخیرهٔ امن سرور این صفحه را نبندید.')).toBeVisible();
  await expect(refresh).toBeEnabled(); expect(state.loads).toBe(before);
  await protocol.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin });
  state.conflict = false;
  await refresh.click();
  await expect.poll(() => state.loads).toBeGreaterThan(before);
  const saved = page.getByRole('button', { name: 'دریافت نوشتهٔ محفوظ', exact: true });
  await expect(saved).toBeVisible();
  const downloading = page.waitForEvent('download'); await saved.click(); const download = await downloading;
  const archive = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'));
  expect(archive.userId).toBe(user.id); expect(archive.draftId).toBe(`contract-${id}`);
  expect(archive.baseRevision).toBe(7); expect(archive.schemaVersion).toBe(2);
  expect(archive.buildId).toBe('erp_draft_handoff_20261017');
  expect(JSON.parse(archive.payloadJson).wizardData.contractDate).toBe(changedDate);
  const preserved = await page.evaluate(() => Object.keys(localStorage).some(key => key === 'contract-recovery:v2:draft_owner_qa:contract-qa-draft-handoff:7'));
  expect(preserved).toBe(true);
  expect(state.saves).toBe(0); expect(errors).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme); await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
    await assertNoHorizontalOverflow(page); await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`draft-archive-${theme}-mobile-200.png`), fullPage: true });
  }
});
