import { expect, test, type Page } from '@playwright/test';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.getByRole('textbox', { name: 'رمز عبور خود را وارد کنید' }).fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/security)?$/, { timeout: 15_000 });
};

test('Guard admits a canonical visit and advances it while legacy history remains read-only', async ({ page }) => {
  let canonicalTurns: any[] = [];
  let admissions = 0;
  let voids = 0;
  let exits = 0;
  let failedExits = 0;
  let authorizedExits: any[] = [{ id: 'authorization-1', waybillId: 'waybill-1', dispatchNumber: '1000000001',
    validUntil: '2026-08-08T08:00:00.000Z', admissionSnapshot: { driver: { firstName: 'راننده', lastName: 'مجاز' }, plate: { plate: '44ه444ایران44' } } }];
  await page.route('**/api/security/exit-desk/authorizations**', async (route) => {
    if (route.request().method() === 'POST') {
      if (route.request().url().includes('authorization-expired')) {
        failedExits += 1;
        authorizedExits = [];
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Expired authorization' }) });
        return;
      }
      exits += 1;
      authorizedExits = [];
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true,
        data: { id: 'physical-exit-1', smsIntent: { status: 'NEEDS_ATTENTION' } } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: authorizedExits }) });
  });
  await page.route('**/api/security/canonical-driver-queue**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/admission-options')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
        internalAssignments: [{ driverId: 'internal-1', vehicleId: 'company-1', assignmentId: 'assignment-1', driverName: 'راننده داخلی', vehicleType: 'کامیون', fleetCode: 'F-101', plate: '11ب111ایران11' }],
        externalDrivers: [{ id: 'external-driver-1', firstName: 'راننده', lastName: 'متفرقه', nationalCode: '0012345678', phone: '09120000000' }],
        externalVehicles: [{ id: 'external-vehicle-1', vehicleType: 'کامیون', plate: '22ج222ایران22' }],
      } }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/available')) {
      canonicalTurns = canonicalTurns.map((turn) => turn.id === 'turn-1' ? { ...turn, status: 'AVAILABLE_FOR_LOADING' } : turn);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: canonicalTurns[0] }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/close-without-loading')) {
      canonicalTurns = [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'turn-1', status: 'CLOSED_WITHOUT_LOADING' } }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/void')) {
      voids += 1;
      canonicalTurns = [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'turn-2', status: 'VOIDED' } }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/canonical-driver-queue')) {
      admissions += 1;
      const external = request.postDataJSON().source === 'EXTERNAL';
      canonicalTurns = [{
        id: external ? 'turn-2' : 'turn-1', status: 'WAITING_AT_GATE', driverSource: external ? 'EXTERNAL' : 'INTERNAL', admittedAt: '2026-08-07T08:00:00.000Z',
        admissionSnapshot: { driver: { firstName: 'راننده', lastName: external ? 'متفرقه' : 'داخلی' }, vehicle: { vehicleType: 'کامیون' }, plate: { plate: external ? '22ج222ایران22' : '11ب111ایران11' } },
      }];
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: canonicalTurns[0] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: canonicalTurns }) });
  });
  await page.route('**/api/security/driver-queue**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{
    id: 'legacy-turn-1', status: 'OUT_OF_QUEUE', enteredAt: '2025-01-01T08:00:00.000Z', historicalOnly: true,
    vehiclePair: { firstName: 'راننده', lastName: 'قدیمی', vehiclePlate: '33د333ایران33' },
  }] }) }));
  await page.route('**/api/security/vehicle-pairs**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/security/vehicle-movements**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));

  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/security/vehicles');

  const workspace = page.locator('main.sds-workspace');
  await expect(workspace.getByRole('heading', { name: 'پذیرش صف جاری', exact: true })).toBeVisible();
  await workspace.getByRole('combobox', { name: 'راننده و خودروی داخلی' }).selectOption('internal-1');
  await workspace.getByRole('button', { name: 'ثبت پذیرش', exact: true }).click();
  await expect.poll(() => admissions).toBe(1);
  await expect(workspace.getByText('راننده داخلی', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'آماده بارگیری', exact: true }).click();
  await expect(workspace.getByText('آماده بارگیری', { exact: true })).toBeVisible();
  const reason = workspace.getByRole('textbox', { name: 'دلیل بازگشت، خروج بدون بارگیری یا ابطال' });
  await reason.fill('پایان مراجعه آزمایشی');
  await workspace.getByRole('button', { name: 'خروج بدون بارگیری', exact: true }).click();
  await workspace.getByRole('button', { name: 'راننده متفرقه', exact: true }).click();
  await workspace.getByRole('combobox', { name: 'راننده متفرقه' }).selectOption('external-driver-1');
  await workspace.getByRole('combobox', { name: 'خودروی متفرقه' }).selectOption('external-vehicle-1');
  await workspace.getByRole('button', { name: 'ثبت پذیرش', exact: true }).click();
  await expect.poll(() => admissions).toBe(2);
  await reason.fill('ثبت اشتباه برای آزمون');
  await workspace.getByRole('button', { name: 'ابطال پذیرش', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'تأیید ابطال پذیرش' });
  await expect(confirmation).toBeVisible();
  expect(voids).toBe(0);
  await confirmation.getByRole('button', { name: 'تأیید ابطال', exact: true }).click();
  await expect.poll(() => voids).toBe(1);
  await workspace.getByRole('button', { name: 'آماده خروج', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'خروج مجاز گیت', exact: true })).toBeVisible();
  await expect(workspace.getByText('بارنامه 1000000001', { exact: true })).toBeVisible();
  await expect(workspace.getByText('نسخه چاپی به‌تنهایی اجازه خروج نمی‌دهد', { exact: false })).toBeVisible();
  await workspace.getByRole('button', { name: 'ثبت خروج', exact: true }).click();
  const exitConfirmation = page.getByRole('dialog', { name: 'تأیید خروج فیزیکی' });
  await expect(exitConfirmation).toBeVisible();
  expect(exits).toBe(0);
  await exitConfirmation.getByRole('button', { name: 'ثبت خروج فیزیکی', exact: true }).click();
  await expect.poll(() => exits).toBe(1);
  await expect(workspace.getByText(/نیاز به پیگیری/)).toBeVisible();
  await expect(workspace.getByText('مجوز معتبر برای خروج وجود ندارد', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'صف رانندگان', exact: true }).click();
  authorizedExits = [{ id: 'authorization-expired', waybillId: 'waybill-expired', dispatchNumber: '1000000002',
    validUntil: '2026-08-07T07:00:00.000Z', admissionSnapshot: { driver: { firstName: 'Expired', lastName: 'Driver' }, plate: { plate: '55E555IR55' } } }];
  await page.reload();
  await workspace.getByRole('button', { name: 'آماده خروج', exact: true }).click();
  await workspace.getByRole('button', { name: 'ثبت خروج', exact: true }).click();
  await page.getByRole('dialog', { name: 'تأیید خروج فیزیکی' }).getByRole('button', { name: 'ثبت خروج فیزیکی', exact: true }).click();
  await expect.poll(() => failedExits).toBe(1);
  await expect(workspace.getByText('Expired authorization', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'صف رانندگان', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'سوابق صف قدیمی', exact: true })).toBeVisible();
  await expect(workspace.getByText('فقط سابقه', { exact: true })).toBeVisible();
  expect(await workspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);
});

test('view-only Guard sees redacted queue state without mutation controls', async ({ page }) => {
  let mutations = 0;
  let admissionOptionRequests = 0;
  await page.route('**/api/workspace-permissions/user-workspaces', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{ workspace: 'security', permission: 'view' }] }) }));
  await page.route('**/api/security/exit-desk/authorizations**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/security/canonical-driver-queue**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') mutations += 1;
    if (url.pathname.endsWith('/admission-options')) {
      admissionOptionRequests += 1;
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'edit required' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, capabilities: { canEdit: false }, data: [{
      id: 'redacted-turn', status: 'WAITING_AT_GATE', driverSource: 'INTERNAL', admittedAt: '2026-08-07T08:00:00.000Z', redacted: true,
      admissionSnapshot: { driver: { firstName: '', lastName: 'راننده' }, vehicle: { vehicleType: 'کامیون' }, plate: { plate: '********11' }, readiness: { status: 'READY' } }, events: [],
    }] }) });
  });
  await page.route('**/api/security/driver-queue**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/security/vehicle-pairs**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/security/vehicle-movements**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));

  await login(page);
  await page.goto('/dashboard/security/vehicles');
  const workspace = page.locator('main.sds-workspace');
  await expect(workspace.getByText('راننده · ********11', { exact: true })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'ثبت پذیرش', exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'آماده بارگیری', exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'ابطال پذیرش', exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('textbox', { name: 'دلیل بازگشت، خروج بدون بارگیری یا ابطال' })).toHaveCount(0);
  expect(mutations).toBe(0);
  expect(admissionOptionRequests).toBe(0);
  await expect(workspace.getByText('بخشی از اطلاعات خودرویی دریافت نشد')).toHaveCount(0);
});
