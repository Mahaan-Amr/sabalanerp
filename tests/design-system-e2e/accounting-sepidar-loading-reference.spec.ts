import { expect, test } from '@playwright/test';

test('accountant registers a loading reference and finds every driver row by it', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  let reference: string | null = null;
  let canManage = true;
  let canView = true;
  let partnerWritable = false;
  let failNextSave = true;
  let history: Array<{ id: string; actorId: string; createdAt: string }> = [];
  const rows = ['driver-a', 'driver-b', 'driver-c'].map(id => ({ id, loadingId: id === 'driver-c' ? 'loading-2' : 'loading-1',
    status: 'PENDING', loadingStatus: 'FINALIZED', canManage: true, sepidarLoadingReference: reference,
    summary: { loadingNumber: '42', driverName: id, plate: '۱۲۳', customerName: 'مشتری' },
    waybills: id === 'driver-a' ? [{ id: 'waybill-a', status: 'ISSUED', number: '1' }] : [] }));
  await page.route('**/api/dispatch-confirmation/capabilities', route => route.fulfill({ json: { success: true,
    data: { canManageAccountingCandidates: true, canManageAccountingConfirmation: true } } }));
  await page.route('**/api/dispatch-confirmation/waybills/waybill-a/sessions', route => route.fulfill({ json: {
    success: true, data: { id: 'session-a', waybillId: 'waybill-a' },
  } }));
  await page.route('**/api/accounting/dispatch-candidates', route => route.fulfill(canView ? { json: {
    success: true, data: rows.map(row => ({ ...row, canManage: canManage && (row.id !== 'driver-b' || partnerWritable),
      canManageSepidarLoadingReference: canManage && (row.loadingId !== 'loading-1' || partnerWritable),
      sepidarLoadingReferenceHistory: row.loadingId === 'loading-1' ? history : [],
      sepidarLoadingReference: row.loadingId === 'loading-1' ? reference : null })),
  } } : { status: 403, json: { success: false } }));
  await page.route(url => url.pathname === '/api/dispatch-cases', route => route.fulfill({ json: {
    success: true, access: { permission: 'edit' }, data: [...rows.map(row => ({
      id: `case-${row.id}`, loadingId: row.loadingId, loadingNumber: '42', driverName: row.id, status: 'LOADING_FINALIZED',
    })), { id: 'unmatched-case', loadingId: 'another-loading', loadingNumber: '42', driverName: 'unmatched', status: 'LOADING_FINALIZED' }],
  } }));
  await page.route('**/api/accounting/loadings/loading-1/sepidar-reference', async route => {
    if (failNextSave) {
      failNextSave = false;
      await route.fulfill({ status: 409, json: { success: false, error: 'این شماره برای بارگیری دیگری ثبت شده است.' } });
      return;
    }
    reference = '00123';
    const auditEntry = { id: 'reference-1', actorId: 'accountant', createdAt: '2026-11-18T10:00:00Z' };
    history = [auditEntry];
    await route.fulfill({ json: { success: true, data: { value: reference, auditEntry } } });
  });
  await page.goto('/dashboard/accounting/dispatch');
  await expect(page.getByRole('columnheader', { name: 'شماره بارگیری سپیدار' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('cell').nth(1)).toHaveText('—');
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' })).toHaveCount(0);
  await page.getByRole('button', { name: 'پرونده‌های ارسال', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'unmatched' }).getByRole('cell').nth(1)).toHaveText('—');
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' })).toHaveCount(0);
  partnerWritable = true;
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' }).click();
  await page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' }).fill(' ۰۰۱۲۳ ');
  await page.getByRole('button', { name: 'ثبت شماره', exact: true }).click();
  await expect(page.getByText('این شماره برای بارگیری دیگری ثبت شده است.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' })).toHaveValue(' 00123 ');
  await page.getByRole('button', { name: 'ثبت شماره', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('00123');
  await expect(page.getByRole('row').filter({ hasText: 'driver-b' })).toContainText('00123');
  await expect(page.getByRole('row').filter({ hasText: 'unmatched' }).getByRole('cell').nth(1)).toHaveText('—');
  await expect(page.getByRole('row').filter({ hasText: 'unmatched' }).getByRole('button', { name: /شماره بارگیری سپیدار/ })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'جست‌وجو' }).fill('۰۰۱۲۳');
  await expect(page.getByRole('row').filter({ hasText: /driver-/ })).toHaveCount(2);
  await expect(page.getByRole('row').filter({ hasText: 'unmatched' })).toHaveCount(0);
  await page.getByRole('button', { name: 'صدور بارنامه', exact: true }).click();
  await page.getByRole('searchbox', { name: 'جست‌وجو' }).fill('00123');
  await expect(page.getByRole('row').filter({ hasText: /driver-/ })).toHaveCount(2);
  await page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await expect(page.getByText('شماره بارگیری سپیدار: 00123')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'تأیید هویت راننده' }).click();
  await expect(page.getByText('شماره بارگیری سپیدار: 00123')).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'بازگشت', exact: true }).click();
  canManage = false;
  await page.getByRole('searchbox', { name: 'جست‌وجو' }).fill('');
  await page.getByRole('button', { name: 'به‌روزرسانی' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('00123');
  await expect(page.getByRole('row').filter({ hasText: 'driver-c' }).getByRole('cell').nth(1)).toHaveText('—');
  await expect(page.getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' })).toHaveCount(0);
  await page.getByRole('button', { name: 'پرونده‌های ارسال', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('00123');
  await expect(page.getByRole('button', { name: /(?:ثبت|اصلاح) شماره بارگیری سپیدار/ })).toHaveCount(0);
  canView = false;
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('cell').nth(1)).toHaveText('—');
});

test('accountant corrects and clears a saved reference with a reason and can review its history', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  let reference: string | null = '00123';
  let loadingStatus = 'FINALIZED';
  let history = [{ id: 'reference-1', actorId: 'accountant', createdAt: '2026-11-18T10:00:00Z',
    beforeState: { sepidarLoadingReference: null as string | null }, afterState: { sepidarLoadingReference: '00123' }, note: 'شماره بارگیری سپیدار: 00123' }];
  let fail = true;
  await page.route('**/api/dispatch-confirmation/capabilities', route => route.fulfill({ json: { success: true,
    data: { canManageAccountingCandidates: true, canManageAccountingConfirmation: false } } }));
  await page.route('**/api/accounting/dispatch-candidates', route => route.fulfill({ json: { success: true, data: [
    { id: 'driver-a', loadingId: 'loading-1', status: 'RETURNED', loadingStatus, canManage: true,
      canManageSepidarLoadingReference: loadingStatus === 'FINALIZED',
      sepidarLoadingReference: reference, sepidarLoadingReferenceHistory: history,
      summary: { loadingNumber: '42', driverName: 'driver-a' }, waybills: [] },
  ] } }));
  await page.route('**/api/accounting/loadings/loading-1/sepidar-reference', async route => {
    const body = route.request().postDataJSON();
    expect(body.expectedVersion).toBe(history[0].id);
    if (fail) {
      fail = false;
      history = [{ ...history[0], id: 'reference-2' }, ...history];
      await route.fulfill({ status: 409, json: { success: false, code: 'SEPIDAR_REFERENCE_STALE',
        error: 'شماره این بارگیری تغییر کرده است. صفحه را به‌روز کنید.' } });
      return;
    }
    const auditEntry = { id: `reference-${history.length + 1}`, actorId: 'accountant', createdAt: '2026-11-18T11:00:00Z',
      beforeState: { sepidarLoadingReference: reference }, afterState: { sepidarLoadingReference: body.value },
      note: body.reason };
    history = [auditEntry, ...history];
    reference = body.value;
    await route.fulfill({ json: { success: true, data: { value: reference, auditEntry } } });
  });
  await page.goto('/dashboard/accounting/dispatch');
  await page.getByRole('button', { name: 'اصلاح شماره بارگیری سپیدار' }).click();
  await expect(page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' })).toHaveValue('00123');
  await page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' }).fill('00456');
  await expect(page.getByRole('button', { name: 'ذخیره شماره' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'دلیل اصلاح' }).fill('اشتباه تایپی');
  await page.getByRole('button', { name: 'ذخیره شماره' }).click();
  await expect(page.getByText('شماره این بارگیری تغییر کرده است. صفحه را به‌روز کنید.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' })).toHaveValue('00456');
  await expect(page.getByRole('textbox', { name: 'دلیل اصلاح' })).toHaveValue('اشتباه تایپی');
  await expect(page.getByRole('button', { name: 'ذخیره شماره' })).toBeDisabled();
  await page.getByRole('button', { name: 'به‌روزرسانی شماره فعلی' }).click();
  await page.getByRole('button', { name: 'ذخیره شماره' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('00456');
  await page.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await page.getByRole('button', { name: 'سابقه شماره بارگیری سپیدار' }).click();
  await expect(page.getByText('اشتباه تایپی')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'اصلاح شماره بارگیری سپیدار' }).click();
  await page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' }).fill('');
  await page.getByRole('textbox', { name: 'دلیل اصلاح' }).fill('مرجع نادرست بود');
  await page.getByRole('button', { name: 'پاک‌کردن شماره' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('cell').nth(1)).toHaveText('—');
  await page.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await page.getByRole('button', { name: 'سابقه شماره بارگیری سپیدار' }).click();
  await expect(page.getByText('مرجع نادرست بود')).toBeVisible();
  await page.keyboard.press('Escape');
  reference = '321';
  loadingStatus = 'CANCELLED';
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('321');
  await expect(page.getByRole('button', { name: 'اصلاح شماره بارگیری سپیدار' })).toHaveCount(0);
  await page.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await expect(page.getByText('بارگیری لغوشده')).toBeVisible();
  await expect(page.getByText('شماره بارگیری سپیدار: 321')).toBeVisible();
});
