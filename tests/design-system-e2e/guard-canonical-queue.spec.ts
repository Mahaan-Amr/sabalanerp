import { expect, test, type Page } from '@playwright/test';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
  await page.getByRole('textbox', { name: 'رمز عبور خود را وارد کنید' }).fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
};

test('Guard admits a canonical visit and advances it while legacy history remains read-only', async ({ page }) => {
  let canonicalTurns: any[] = [];
  let admissions = 0;
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
    if (request.method() === 'POST' && url.pathname.endsWith('/canonical-driver-queue')) {
      admissions += 1;
      canonicalTurns = [{
        id: 'turn-1', status: 'WAITING_AT_GATE', driverSource: 'INTERNAL', admittedAt: '2026-08-07T08:00:00.000Z',
        admissionSnapshot: { driver: { firstName: 'راننده', lastName: 'داخلی' }, vehicle: { vehicleType: 'کامیون' }, plate: { plate: '11ب111ایران11' } },
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
  await expect(workspace.getByRole('heading', { name: 'سوابق صف قدیمی', exact: true })).toBeVisible();
  await expect(workspace.getByText('فقط سابقه', { exact: true })).toBeVisible();
  expect(await workspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);
});
