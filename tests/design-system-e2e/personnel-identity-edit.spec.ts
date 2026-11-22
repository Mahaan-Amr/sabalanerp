import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, assertNoHorizontalOverflow, setTheme } from './support/design-system';

async function fixture(page: Page, permission = 'edit', archived = false) {
  await loginAsAdmin(page);
  let identity = { id: 'identity-qa', firstName: 'شهرام', lastName: 'قاسمی', nationalCode: '', employeeNumber: 'EMP-42', hasUser: false, archivedAt: archived ? '2026-10-01' : null, identityVersion: 'version-1', history: [] as any[] };
  let conflict = false;
  let duplicate = false;
  const writes: any[] = [];
  await page.route('**/api/hr/authorization/me', route => route.fulfill({ json: { data: { actionPermissionCodes: [], effectiveAccess: { features: [{ feature: 'PERSONNEL', permission }] } } } }));
  await page.route('**/api/hr/operational-reference/personnel', route => route.fulfill({ json: { data: { positions: [] } } }));
  await page.route(/\/api\/hr\/personnel(?:\?|$)/, route => route.fulfill({ json: { data: [{ ...identity, hrEmploymentRelationships: [] }, { id: 'other-identity', firstName: 'شهرام', lastName: 'قاسمی', user: { id: 'other-user', username: 'other' }, hrEmploymentRelationships: [] }], meta: { page: 1, total: 2, totalPages: 1 } } }));
  await page.route('**/api/hr/personnel/identity-qa/identity', route => route.fulfill({ json: { success: true, data: identity } }));
  await page.route('**/api/hr/personnel/identity-qa', route => {
    const body = route.request().postDataJSON(); writes.push(body);
    if (duplicate) return route.fulfill({ status: 409, json: { error: 'شمارهٔ پرسنلی تکراری است.' } });
    if (conflict) return route.fulfill({ status: 409, json: { error: 'اطلاعات هم‌زمان تغییر کرده است.' } });
    const before = { ...identity };
    identity = { ...identity, ...body, identityVersion: 'version-2', history: [{ id: 'audit-1', createdAt: '2026-10-18T10:00:00Z', actorName: 'ویرایش‌کننده', changes: { before, after: body } }] };
    return route.fulfill({ json: { success: true, data: identity } });
  });
  await page.goto('/dashboard/hr/personnel?focus=identity-qa');
  await expect(page.getByRole('dialog', { name: 'پروندهٔ پرسنل', exact: true })).toBeVisible();
  return { writes, setDuplicate: (value: boolean) => { duplicate = value; }, setConflict: (value: boolean) => { conflict = value; }, setLatest: () => { identity = { ...identity, lastName: 'تغییر دیگر', identityVersion: 'version-latest' }; } };
}

test('identity form saves only the intended homonym, protects existing identifiers and exposes automatic history', async ({ page }) => {
  const { writes } = await fixture(page);
  const profile = page.getByRole('dialog', { name: 'پروندهٔ پرسنل', exact: true });
  await profile.getByRole('button', { name: 'ویرایش مشخصات', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'ویرایش مشخصات پرسنل', exact: true });
  await expect(editor.getByRole('textbox', { name: 'نام خانوادگی', exact: true })).toHaveValue('قاسمی');
  await editor.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('قاسمی راننده');
  await editor.getByRole('textbox', { name: 'شمارهٔ پرسنلی', exact: true }).fill('');
  await expect(editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' })).toBeDisabled();
  await editor.getByRole('textbox', { name: 'شمارهٔ پرسنلی', exact: true }).fill('EMP-42');
  await editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' }).click();
  await expect(editor).toBeHidden();
  expect(writes).toEqual([{ firstName: 'شهرام', lastName: 'قاسمی راننده', nationalCode: '', employeeNumber: 'EMP-42', expectedIdentityVersion: 'version-1' }]);
  await expect(profile.getByRole('heading', { name: 'شهرام قاسمی راننده', exact: true })).toBeVisible();
  await expect(page.locator('[data-personnel-id="other-identity"]')).toContainText('شهرام قاسمی');
  await profile.getByRole('button', { name: 'تاریخچهٔ مشخصات' }).click();
  const history = page.getByRole('dialog', { name: 'تاریخچهٔ مشخصات پرسنل', exact: true });
  await expect(history).toContainText('ویرایش‌کننده');
  await expect(history).toContainText('قاسمی راننده');
});

test('stale editor requires explicit latest-data review and dirty close preserves the draft', async ({ page }, testInfo) => {
  const state = await fixture(page);
  const profile = page.getByRole('dialog', { name: 'پروندهٔ پرسنل', exact: true });
  const opener = profile.getByRole('button', { name: 'ویرایش مشخصات', exact: true });
  await opener.click();
  const editor = page.getByRole('dialog', { name: 'ویرایش مشخصات پرسنل', exact: true });
  await editor.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('پیش‌نویس');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'کنارگذاشتن تغییرات مشخصات؟', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'ادامهٔ ویرایش', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'نام خانوادگی', exact: true })).toHaveValue('پیش‌نویس');
  state.setConflict(true); state.setLatest();
  await editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' })).toBeDisabled();
  await editor.getByRole('button', { name: 'دریافت آخرین اطلاعات' }).click();
  await expect(editor.getByRole('textbox', { name: 'نام خانوادگی', exact: true })).toHaveValue('تغییر دیگر');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const [width, zoom] of [[1440, 1], [390, 1], [1440, 2]] as const) {
      await setViewportAndZoom(page, { width, height: 1000 }, zoom);
      await assertNoHorizontalOverflow(page);
      await expect(editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' })).toBeVisible();
    }
  }
  await page.screenshot({ path: testInfo.outputPath('personnel-identity-editor.png') });
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const [permission, archived] of [['view', false], ['edit', true]] as const) test(`identity edit unavailable for ${permission}, archived=${archived}`, async ({ page }) => {
  await fixture(page, permission, archived);
  const profile = page.getByRole('dialog', { name: 'پروندهٔ پرسنل', exact: true });
  await expect(profile.getByRole('button', { name: 'ویرایش مشخصات', exact: true })).toHaveCount(0);
  await expect(profile.getByRole('button', { name: 'تاریخچهٔ مشخصات', exact: true })).toBeVisible();
});

test('User name editor sends its version, shows current names on conflict and omits unchanged names from unrelated saves', async ({ page }) => {
  await loginAsAdmin(page);
  let latest = false;
  const writes: any[] = [];
  await page.route('**/api/departments', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/users/user-identity-qa', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: { id: 'user-identity-qa', firstName: 'نام', lastName: latest ? 'نام تازه' : 'نام قبلی', identityVersion: latest ? 'new-version' : 'old-version', username: 'identity-qa', email: 'identity@example.com', role: 'USER', isActive: true, personnel: { id: 'identity-qa' } } } });
    writes.push(route.request().postDataJSON()); latest = true;
    return route.fulfill({ status: 409, json: { code: 'PERSONNEL_IDENTITY_CONFLICT', error: 'اطلاعات هم‌زمان تغییر کرده است.' } });
  });
  await page.goto('/dashboard/hr/users/user-identity-qa/edit');
  const lastName = page.locator('input[name="lastName"]');
  await expect(lastName).toHaveValue('نام قبلی');
  await lastName.fill('نام پیشنهادی');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(lastName).toHaveValue('نام تازه');
  expect(writes[0].expectedIdentityVersion).toBe('old-version');
  expect(writes[0].lastName).toBe('نام پیشنهادی');
  await page.locator('input[name="email"]').fill('other@example.com');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).not.toHaveProperty('firstName');
  expect(writes[1]).not.toHaveProperty('lastName');
});


test('duplicate identifier rejection preserves the draft and permits direct correction', async ({ page }) => {
  const state = await fixture(page); state.setDuplicate(true);
  await page.getByRole('dialog', { name: 'پروندهٔ پرسنل', exact: true }).getByRole('button', { name: 'ویرایش مشخصات', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'ویرایش مشخصات پرسنل', exact: true });
  await editor.getByRole('textbox', { name: 'شمارهٔ پرسنلی', exact: true }).fill('DUPLICATE');
  await editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' }).click();
  await expect(editor.getByRole('alert')).toContainText('تکراری');
  await expect(editor.getByRole('textbox', { name: 'شمارهٔ پرسنلی', exact: true })).toBeEnabled();
  await expect(editor.getByRole('textbox', { name: 'شمارهٔ پرسنلی', exact: true })).toHaveValue('DUPLICATE');
  state.setDuplicate(false);
  await editor.getByRole('textbox', { name: 'شمارهٔ پرسنلی', exact: true }).fill('UNIQUE-42');
  await editor.getByRole('button', { name: 'ذخیرهٔ مشخصات' }).click();
  await expect(editor).toBeHidden();
});
