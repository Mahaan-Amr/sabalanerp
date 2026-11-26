import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Guard completes and records exit for a personal-car return cancelled without delivery', async ({ page }) => {
  let status: 'AWAITING_RECEIPT' | 'CANCELLED_WITHOUT_DELIVERY' | null = null;
  let exited = false;
  let completedAt: string | null = null;
  const turn = () => ({
    id: 'return-1', driverSource: 'PERSONAL_PICKUP', status: exited ? 'EXIT_RECORDED' : 'WAITING_AT_GATE',
    projectReturnStatus: status, driverName: 'راننده شخصی', vehicleType: 'سواری', plate: '12 ب 345 ایران 67', admittedAt: '2026-11-25T08:00:00.000Z',
    projectReturnReleasedAt: completedAt,
    admissionSnapshot: { driver: { firstName: 'راننده شخصی' }, vehicle: { vehicleType: 'سواری' }, plate: { plate: '12 ب 345 ایران 67' } },
  });
  await page.route(/\/api\/security\/canonical-driver-queue(?:[/?]|$)/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/admission-options')) {
      return route.fulfill({ json: { success: true, data: { internalAssignments: [], externalDrivers: [], externalVehicles: [] } } });
    }
    if (request.method() === 'POST') {
      if (url.pathname.endsWith('/project-return-exit')) {
        expect(status).toBe('CANCELLED_WITHOUT_DELIVERY');
        exited = true;
      } else if (url.pathname.endsWith('/project-return-complete')) {
        expect(status).toBe('CANCELLED_WITHOUT_DELIVERY');
        completedAt = '2026-11-25T08:20:00.000Z';
      } else {
        expect(request.postDataJSON()).toEqual({ source: 'PERSONAL_PICKUP', purpose: 'PROJECT_RETURN', plate: '12 ب 345 ایران 67' });
        status = 'AWAITING_RECEIPT';
      }
      return route.fulfill({ status: 201, json: { success: true, data: turn() } });
    }
    const data = status && (!exited || url.searchParams.get('history') === 'true') ? [turn()] : [];
    const pagination = { page: Number(url.searchParams.get('page') || 1),
      pageSize: Number(url.searchParams.get('pageSize') || 20), total: data.length };
    return route.fulfill({ json: { success: true, data, pagination } });
  });
  await page.route(/\/api\/logistics\/project-return-visits(?:[/?]|$)/, async route => {
    if (route.request().method() === 'POST') {
      expect(status).toBe('AWAITING_RECEIPT');
      status = 'CANCELLED_WITHOUT_DELIVERY';
      return route.fulfill({ json: { success: true, data: turn() } });
    }
    return route.fulfill({ json: { success: true, data: status && !exited ? [turn()] : [], capabilities: { canCancel: true } } });
  });
  await page.route(/\/api\/logistics\/stone-returns(?:[/?]|$)/, route =>
    route.fulfill({ json: { success: true, data: { items: [], nextCursor: null, canRecord: true } } }));

  await page.route(/\/api\/security\/(?:vehicle-pairs|vehicle-movements|driver-queue|exit-desk\/authorizations)(?:[/?]|$)/,
    route => route.fulfill({ json: { success: true, data: [] } }));
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/security/vehicles');
  const guard = page.locator('main.sds-workspace');
  await guard.getByRole('button', { name: 'پذیرش راننده', exact: true }).last().click();
  const admission = page.getByRole('dialog', { name: 'پذیرش راننده و خودرو' });
  await admission.getByRole('combobox', { name: 'هدف ورود', exact: true }).click();
  await page.getByRole('option', { name: 'مرجوعی پروژه', exact: true }).click();
  await admission.getByRole('button', { name: 'خودروی شخصی', exact: true }).click();
  const plate = admission.getByRole('group', { name: 'شماره پلاک', exact: true });
  await plate.getByRole('textbox', { name: 'شماره پلاک: دو رقم سمت چپ' }).fill('۱۲');
  await plate.getByRole('combobox', { name: 'شماره پلاک: حرف' }).click();
  await page.getByRole('option', { name: 'ب', exact: true }).click();
  await plate.getByRole('textbox', { name: 'شماره پلاک: سه رقم' }).fill('۳۴۵');
  await plate.getByRole('textbox', { name: 'شماره پلاک: کد ایران' }).fill('۶۷');
  await admission.getByRole('button', { name: 'ثبت پذیرش', exact: true }).click();
  await expect(guard.getByText('در انتظار تحویل مرجوعی', { exact: true })).toBeVisible();
  await expect(guard.getByRole('button', { name: 'ورود برای بارگیری', exact: true })).toHaveCount(0);

  await page.goto('/dashboard/logistics/returns');
  await page.getByRole('button', { name: 'لغو بدون تحویل', exact: true }).click();
  await page.getByRole('dialog', { name: 'لغو مرجوعی بدون تحویل' })
    .getByRole('button', { name: 'تأیید لغو', exact: true }).click();
  await expect(page.getByText('لغو بدون تحویل · در انتظار خروج', { exact: true })).toBeVisible();

  await page.goto('/dashboard/security/vehicles');
  await expect(guard.getByRole('button', { name: 'انتقال به صف بارگیری', exact: true })).toHaveCount(0);
  await guard.getByRole('button', { name: 'ثبت اتمام مرجوعی', exact: true }).click();
  await expect(guard.getByText('اتمام مرجوعی ثبت شد', { exact: true })).toBeVisible();
  await page.reload();
  await expect(guard.getByText('اتمام مرجوعی ثبت شد', { exact: true })).toBeVisible();
  await expect(guard.getByRole('button', { name: 'ثبت اتمام مرجوعی', exact: true })).toHaveCount(0);
  await guard.getByRole('button', { name: 'خروج مرجوعی', exact: true }).click();
  await page.getByRole('dialog', { name: 'تأیید خروج مرجوعی' })
    .getByRole('button', { name: 'ثبت خروج فیزیکی', exact: true }).click();
  await expect.poll(() => exited).toBe(true);
  await expect(guard.getByText('مراجعه جاری در صف وجود ندارد')).toBeVisible();
  await guard.getByRole('button', { name: 'سوابق تردد', exact: true }).click();
  await expect(guard.getByText('مرجوعی لغو شد', { exact: true })).toBeVisible();
  await expect(guard.getByText('خروج ثبت‌شده', { exact: true })).toBeVisible();
});

test('Guard transfers a received return in the same visit and can reopen loading availability', async ({ page }) => {
  let status = 'WAITING_AT_GATE';
  let transferredAt: string | null = null;
  const turn = () => ({
    id: 'return-508', driverSource: 'EXTERNAL', status, projectReturnStatus: 'RECEIVED',
    admittedAt: '2026-11-25T08:00:00.000Z', projectReturnReleasedAt: transferredAt,
    admissionSnapshot: {
      driver: { firstName: 'راننده', lastName: 'بیرونی' },
      vehicle: { vehicleType: 'کامیون' }, plate: { plate: '22 ب 345 ایران 67' },
    },
  });
  await page.route(/\/api\/security\/canonical-driver-queue(?:[/?]|$)/, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/admission-options')) {
      return route.fulfill({ json: { success: true, data: { internalAssignments: [], externalDrivers: [], externalVehicles: [] } } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { success: true, data: [turn()] } });
    if (path.endsWith('/return-508/project-return-transfer')) {
      expect(transferredAt).toBeNull();
      transferredAt = '2026-11-25T08:20:00.000Z';
      status = 'AVAILABLE_FOR_LOADING';
    } else if (path.endsWith('/return-508/return-to-waiting')) {
      status = 'WAITING_AT_GATE';
    } else {
      expect(path).toMatch(/\/return-508\/available$/);
      status = 'AVAILABLE_FOR_LOADING';
    }
    return route.fulfill({ json: { success: true, data: turn() } });
  });
  await page.route(/\/api\/security\/(?:vehicle-pairs|vehicle-movements|driver-queue|exit-desk\/authorizations)(?:[/?]|$)/,
    route => route.fulfill({ json: { success: true, data: [] } }));

  await loginAsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/security/vehicles');
  const guard = page.locator('main.sds-workspace');
  await expect(guard.getByText('تحویل مرجوعی ثبت شد', { exact: true })).toBeVisible();
  await expect(guard.getByRole('button', { name: 'خروج مرجوعی', exact: true })).toBeVisible();
  await guard.getByRole('button', { name: 'انتقال به صف بارگیری', exact: true }).click();
  await expect(guard.getByRole('button', { name: 'بازگشت به انتظار', exact: true })).toBeVisible();
  await page.reload();
  await expect(guard.getByRole('button', { name: 'خروج مرجوعی', exact: true })).toHaveCount(0);
  await guard.getByRole('button', { name: 'بازگشت به انتظار', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'بازگشت راننده به انتظار' });
  await dialog.getByRole('textbox', { name: 'دلیل', exact: true }).fill('توقف موقت برای آزمون');
  await dialog.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
  await expect(guard.getByRole('button', { name: 'انتقال به صف بارگیری', exact: true })).toHaveCount(0);
  await guard.getByRole('button', { name: 'ورود برای بارگیری', exact: true }).click();
  await expect(guard.getByRole('button', { name: 'بازگشت به انتظار', exact: true })).toBeVisible();
});
