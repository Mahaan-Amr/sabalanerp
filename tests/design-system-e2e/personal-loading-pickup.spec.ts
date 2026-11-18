import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, setTheme } from './support/design-system';

// UI-only fixtures; real authorization/financial/exit behavior is covered by the PostgreSQL integration suite.
async function mockUiIdentity(page: Page) {
  let loggedIn = false;
  const user = { id: 'personal-ui-actor', username: 'personal-ui', email: 'personal-ui@example.invalid',
    firstName: 'آزمون', lastName: 'بارگیری', role: 'ADMIN', isActive: true };
  const session = { id: 'personal-ui-session' };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') {
      loggedIn = true;
      return route.fulfill({ json: { success: true, data: { user }, session } });
    }
    if (path === '/api/auth/me') return route.fulfill({ status: loggedIn ? 200 : 401,
      json: loggedIn ? { success: true, data: user, session } : { success: false } });
    if (path === '/api/workspace-permissions/user-workspaces') return route.fulfill({ json: { success: true,
      data: ['logistics', 'security', 'accounting', 'sales', 'hr', 'crm', 'inventory', 'purchasing', 'bi']
        .map(workspace => ({ workspace, permission: 'admin' })) } });
    return route.fulfill({ json: { success: true, data: [], badge: null } });
  });
}

const pickupContext = { contracts: [{ id: 'selected-contract', number: '100101' }], partners: [{ caseId: 'selected-case', name: 'همکار انتخاب‌شده' }] };

test('personal pickup selects a passenger car without manual identity and clears quantity on switching', async ({ page }, testInfo) => {
  await mockUiIdentity(page);
  await loginAsAdmin(page);
  let personal = false;
  const ordinaryDriver = { id: 'ordinary-turn', source: 'EXTERNAL', firstName: 'راننده عادی', lastName: 'آزمون', vehicleType: 'کامیون', queueStatus: 'ENTERED_LOADING_AREA' };
  const draft: any = { id: 'personal-ui-loading', loadingNumber: '9001', status: 'DRAFT', customerId: 'customer', projectId: 'project',
    customer: { firstName: 'مشتری', lastName: 'انتخاب‌شده' }, project: { projectName: 'پروژه آزمون', address: 'نشانی آزمون' },
    guardQueueTurns: [], canonicalAllocationDrafts: [], driverAssignments: [],
    lines: [{ id: 'line', sourceContractId: 'selected-contract', sourceContractItemId: 'item', productId: 'product', quantity: 2,
      unit: 'count', productSnapshot: { name: 'سنگ آزمون' }, sourceSnapshot: { contractNumber: '100101', remainingQuantity: 5 } }] };
  await page.route('**/api/logistics/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/transport')) {
      expect(route.request().postDataJSON()).toEqual({ mode: personal ? 'DRIVERS' : 'PERSONAL' });
      personal = !personal;
      draft.guardQueueTurns = personal ? [{ id: 'personal-turn', driverSource: 'PERSONAL_PICKUP', status: 'RESERVED_FOR_LOADING', loadingId: draft.id }] : [];
      draft.lines[0].quantity = 0;
      return route.fulfill({ json: { success: true, data: { turn: personal ? { id: 'personal-turn' } : null } } });
    }
    if (path.endsWith(`/loadings/${draft.id}`)) return route.fulfill({ json: { success: true, data: draft } });
    if (path.endsWith('/drivers')) return route.fulfill({ json: { success: true, data: [ordinaryDriver, ...(personal ? [{ id: 'personal-turn', source: 'PERSONAL_PICKUP',
      firstName: 'راننده شخصی', vehicleType: 'سواری', queueStatus: 'RESERVED', reservedLoading: { id: draft.id } }] : [])] } });
    if (path.endsWith('/remaining')) return route.fulfill({ json: { success: true, data: { groups: [] } } });
    if (path.endsWith('/customers')) return route.fulfill({ json: { success: true, data: [] } });
    return route.continue();
  });
  await page.goto(`/dashboard/logistics/loadings/new?draftId=${draft.id}`);
  const personalButton = page.getByRole('button', { name: 'راننده شخصی', exact: true });
  await expect(personalButton).toHaveAttribute('aria-pressed', 'false');
  await personalButton.click();
  await expect(personalButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main').last()).toContainText('سواری');
  await expect(page.getByRole('button', { name: 'رانندگان دیگر', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /پلاک|کد ملی|شماره همراه/ })).toHaveCount(0);
  await setTheme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("personal-pickup-mobile.png"), fullPage: true });
  await page.getByRole('button', { name: /راننده عادی آزمون/ }).click();
  await expect(page.locator('main').last()).not.toContainText('سواری');
  await expect(personalButton).toBeEnabled();
  await expect(personalButton).toHaveAttribute('aria-pressed', 'false');
});

test('Partner loading reports finalization after losing the successful response', async ({ page }) => {
  await mockUiIdentity(page);
  await loginAsAdmin(page);
  const id = 'partner-pickup-finalize';
  const turnId = 'partner-pickup-turn';
  const draft = {
    loadingId: id, loadingNumber: '9002', contractNumber: 'fixture-contract', status: 'DRAFT', personalTurnId: turnId,
    source: {
      sourceKind: 'PARTNER_CASE',
      owner: { caseId: 'fixture-case', revision: 1, integrityHash: 'fixture-hash' },
      recipient: { displayName: 'مشتری نمونه', destination: 'نشانی نمونه' },
      rows: [{ productRowId: 'fixture-row', description: 'سنگ نمونه', unit: 'count', plannedQuantity: '2' }],
    },
    allocations: [{ queueTurnId: turnId, reservationActive: true, lines: [{ productRowId: 'fixture-row', quantity: '1' }] }],
  };
  let finalized = false;
  await page.route('**/api/logistics/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/loadings/${id}`)) return route.fulfill({ json: { success: true,
      data: { ...draft, status: finalized ? 'FINALIZED' : 'DRAFT' } } });
    if (path.endsWith('/drivers')) return route.fulfill({ json: { success: true, data: [] } });
    if (path.endsWith(`/canonical-allocations/${turnId}`)) return route.fulfill({ status: finalized ? 409 : 200,
      json: { success: !finalized } });
    if (path.endsWith(`/loadings/${id}/finalize`)) {
      finalized = true;
      return route.abort('connectionreset');
    }
    return route.fallback();
  });
  await page.goto(`/dashboard/logistics/loadings/new?draftId=${id}`);
  await page.getByRole('button', { name: 'نهایی‌سازی بارگیری', exact: true }).click();
  await expect(page.getByText('بارگیری نهایی شد.', { exact: true })).toBeVisible();
});

test('personal pickup Guard exit shows selected customer, Partner and contract without a plate or admission', async ({ page }, testInfo) => {
  await mockUiIdentity(page);
  await loginAsAdmin(page);
  let exited = false;
  await page.route('**/api/security/exit-desk/authorizations**', route => {
    if (route.request().method() === 'POST') {
      exited = true;
      return route.fulfill({ json: { success: true, data: { id: 'exit', smsIntent: { status: 'PENDING' } } } });
    }
    return route.fulfill({ json: { success: true, data: exited ? [] : [{ id: 'authorization', dispatchNumber: '100001',
      validUntil: '2027-01-01T00:00:00Z', admissionSnapshot: { driver: { firstName: 'راننده شخصی' }, vehicle: { vehicleType: 'سواری' } },
      summary: { driverSource: 'PERSONAL_PICKUP', customerName: 'مشتری نهایی انتخاب‌شده', personalPickup: pickupContext } }] } });
  });
  await page.route('**/api/security/canonical-driver-queue**', route => route.fulfill({ json: { success: true,
    data: route.request().url().includes('/admission-options') ? { internalAssignments: [], externalDrivers: [], externalVehicles: [] } : [] } }));
  await page.goto('/dashboard/security/vehicles?operation=sales-exit');
  const exits = page.locator('main').last();
  await expect(exits.getByRole('heading', { name: 'خروج مجاز گیت', exact: true })).toBeVisible();
  await expect(exits).toContainText('مشتری نهایی انتخاب‌شده');
  await expect(exits).toContainText('همکار انتخاب‌شده');
  await expect(exits).toContainText('100101');
  await expect(exits).not.toContainText('بدون پلاک');
  await expect(exits).not.toContainText('نسخه چاپی به‌تنهایی');
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("personal-pickup-mobile.png"), fullPage: true });
  await exits.getByRole('button', { name: 'ثبت خروج', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ثبت خروج فیزیکی', exact: true }).click();
  await expect(page.getByText('مجوز معتبر برای خروج وجود ندارد', { exact: true })).toBeVisible();
  expect(exited).toBe(true);
});
