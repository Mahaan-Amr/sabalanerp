import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';

test('Partner contract header exposes Sales toolbar actions with the preserved SMS label', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerFixtures();
  const view = { ...fixture.partner, state: 'COMMITTED' as const };
  let status = 'DRAFT';
  const decisions: string[] = [];
  for (const action of ['approve', 'reject', 'sign']) await page.route(`**/api/sales/contracts/partner-toolbar-e2e/${action}`, route => {
    decisions.push(action);
    status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'CANCELLED' : 'SIGNED';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/sales/contracts/partner-toolbar-e2e', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      id: 'partner-toolbar-e2e', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: view.owner.caseId,
      partnerRevision: view.owner.revision, partnerIntegrityHash: view.owner.integrityHash,
      partnerCaseView: view, products: [], status,
    } }),
  }));
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { cases: [{
      view, snapshotId: null, customerOutput: fixture.customer, history: [],
      actions: { canContinue: false, canPreview: false, canIssue: false, canFinalize: false,
        canSendConfirmation: true, canRequestCorrection: true, canCancel: false, canRequestVoid: true },
    }] } }),
  }));
  await page.goto('/dashboard/sales/contracts/partner-toolbar-e2e');
  for (const name of ['ویرایش', 'دانلود PDF', 'پرینت', 'ارسال پیامک تأیید']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'ارسال دوباره کد تایید', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تایید', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'رد', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'امضا', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'تایید', exact: true }).click();
  await expect(page.getByRole('button', { name: 'امضا', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'رد', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'امضا', exact: true }).click();
  await expect(page.getByRole('button', { name: 'امضا', exact: true })).toHaveCount(0);
  expect(decisions).toEqual(['approve', 'sign']);
  status = 'DRAFT';
  await page.reload();
  await page.getByRole('button', { name: 'رد', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تایید', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'امضا', exact: true })).toHaveCount(0);
  expect(decisions).toEqual(['approve', 'sign', 'reject']);
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'ارسال پیامک تأیید', exact: true })).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

test('Partner creation consumes the shared eight-step date, customer, and project presentation', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      schemaVersion: 1,
      kind: 'PARTNER',
      actorId: 'partner-e2e',
      actorDisplayName: 'فروشنده همکار آزمایشی',
      profileId: 'partner-profile-e2e',
      writable: true,
      inquiryIds: [],
      recoverableDrafts: [],
      customers: [{ id: 'partner-customer-e2e', displayName: 'مشتری همکار آزمایشی', address: 'تهران', phone: '09120000000' }],
      projects: [{ id: 'partner-project-e2e', customerId: 'partner-customer-e2e', title: 'پروژه همکار آزمایشی' }],
    } }),
  }));
  await page.route('**/api/partner/technical/catalog/query', async route => {
    const kind = (route.request().postDataJSON() as { kind: 'PRODUCT' | 'TOOL' | 'FINISHING' | 'LAYER' }).kind;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [],
    } }) });
  });

  await page.goto('/dashboard/sales/contracts/create?newInquiry=1');
  const workflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(workflow.getByRole('heading', { name: 'ایجاد فروش همکار', exact: true })).toBeVisible();
  const progress = workflow.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' });
  await expect(progress.getByRole('button')).toHaveCount(8);
  await expect(workflow.getByText('فروشنده همکار آزمایشی', { exact: true })).toBeVisible();
  await expect(workflow.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last()).toBeVisible();
  await expect(workflow.getByText('شماره پس از ثبت موفق قرارداد تخصیص داده می‌شود.', { exact: true })).toBeVisible();

  // Partner persists Gregorian dates but opens the same Jalali picker as ordinary Sales.
  const dateTrigger = workflow.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last();
  await dateTrigger.click();
  const calendar = page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' });
  await expect(calendar).toBeVisible();
  await expect(calendar).not.toContainText('نامعتبر');
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  await expect(calendar.locator('[aria-selected="true"][data-date]'))
    .toHaveAttribute('data-date', `${part('year')}/${part('month')}/${part('day')}`);
  await calendar.getByRole('button', { name: 'ماه بعد', exact: true }).click();
  const firstDay = calendar.locator('[data-date$="/01"]').first();
  const selectedDate = await firstDay.getAttribute('data-date');
  await firstDay.click();
  await expect(calendar).toBeHidden();
  await dateTrigger.click();
  await expect(calendar.locator('[aria-selected="true"][data-date]')).toHaveAttribute('data-date', selectedDate!);
  await page.keyboard.press('Escape');

  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(workflow.getByRole('searchbox', { name: 'جستجوی مشتری' })).toHaveAttribute('placeholder', 'جستجو با نام یا شماره تلفن');
  const customer = workflow.getByRole('button', { name: /مشتری همکار آزمایشی/ });
  await expect(customer).toHaveAttribute('aria-pressed', 'true');

  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  const project = workflow.getByRole('button', { name: /پروژه همکار آزمایشی/ });
  await project.focus();
  await page.keyboard.press('Enter');
  await expect(project).toHaveAttribute('aria-pressed', 'true');

  await setTheme(page, 'dark');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  expect(await workflow.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);
  await assertNoSeriousAxeViolations(page);
});

test('a resumed Partner inquiry stays inside the same seven-step contract wizard', async ({ page }) => {
  await loginAsAdmin(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('partner-creation-runtime:partner-e2e:partner-inquiry-e2e', JSON.stringify({
      actorId: 'partner-e2e',
      inquiryId: 'partner-inquiry-e2e',
      access: { schemaVersion: 1, recoveryId: 'partner-recovery-e2e', browserSessionId: 'partner-browser-e2e',
        leaseToken: 'partner-lease-e2e', baseRevision: 1 },
      saved: { schemaVersion: 1, recoveryId: 'partner-recovery-e2e', recoveryRevision: 1, inputRevision: 1,
        graphHash: 'a'.repeat(64), updatedAt: '2026-09-16T08:00:00.000Z', rows: [], replayed: true },
      configuredRows: [],
      customerId: 'partner-customer-e2e',
      contractDate: '2026-09-16',
      projectId: 'partner-project-e2e',
    }));
  });
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      schemaVersion: 1,
      kind: 'PARTNER',
      actorId: 'partner-e2e',
      actorDisplayName: 'فروشنده همکار آزمایشی',
      profileId: 'partner-profile-e2e',
      writable: true,
      inquiryIds: ['partner-inquiry-e2e'],
      latestInquiryId: 'partner-inquiry-e2e',
      recoverableDrafts: [],
      customers: [{ id: 'partner-customer-e2e', displayName: 'مشتری همکار آزمایشی', address: 'تهران', phone: '09120000000' }],
      projects: [{ id: 'partner-project-e2e', customerId: 'partner-customer-e2e', title: 'پروژه همکار آزمایشی' }],
    } }),
  }));
  await page.route('**/api/partner/inquiries/query-v2', route => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'STATE_CONFLICT', status: 409, message: 'fixture inquiry remains pending' }),
  }));
  await page.route('**/api/crm/partner/customers', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      customer: { customerId: 'partner-customer-created', displayName: 'مشتری تازه همکار' },
    } }),
  }));

  await page.goto('/dashboard/sales/contracts/create');
  await setTheme(page, 'light');
  const workflow = page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
  await expect(workflow.getByRole('heading', { name: 'ایجاد فروش همکار', exact: true })).toBeVisible();
  await expect(workflow.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' }).getByRole('button')).toHaveCount(7);
  await expect(workflow).toHaveCSS('direction', 'rtl');
  const previous = workflow.getByRole('button', { name: 'قبلی', exact: true });
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(workflow.getByRole('button', { name: /پروژه همکار آزمایشی/ })).toHaveAttribute('aria-pressed', 'true');
  await previous.click();
  await workflow.getByRole('button', { name: 'ایجاد مشتری', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('مشتری');
  await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('تازه');
  await page.getByRole('textbox', { name: 'شماره تماس', exact: true }).fill('09121111111');
  await page.getByRole('textbox', { name: 'نشانی تحویل', exact: true }).fill('تهران');
  await page.getByRole('button', { name: 'ثبت مشتری و ادامه', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage
    .getItem('partner-creation-runtime:partner-e2e:partner-inquiry-e2e') || '{}')))
    .toMatchObject({ customerId: 'partner-customer-created' });
  await workflow.getByRole('button', { name: /مشتری همکار آزمایشی/ }).click();
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await workflow.getByRole('button', { name: /پروژه همکار آزمایشی/ }).click();
  await workflow.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(workflow.getByText('مشخصات فنی ذخیره‌شده برای ۰ ردیف', { exact: true })).toBeVisible();
  await setTheme(page, 'dark');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  expect(await workflow.evaluate(element => element.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('the independent price inquiry remains outside customer and project selection', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      schemaVersion: 1,
      kind: 'PARTNER',
      actorId: 'partner-e2e',
      actorDisplayName: 'فروشنده همکار آزمایشی',
      profileId: 'partner-profile-e2e',
      writable: true,
      inquiryIds: [],
      recoverableDrafts: [],
      customers: [],
      projects: [],
    } }),
  }));
  await page.route('**/api/partner/technical/catalog/query', async route => {
    const kind = (route.request().postDataJSON() as { kind: 'PRODUCT' | 'TOOL' | 'FINISHING' | 'LAYER' }).kind;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, items: [],
    } }) });
  });

  await page.goto('/dashboard/sales/partner-inquiries?newInquiry=1');
  await expect(page.getByRole('heading', { name: 'استعلام قیمت جدید', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'مراحل ایجاد قرارداد' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'جستجوی مشتری' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /پروژه/ })).toHaveCount(0);
});


test('cancelling Partner customer creation returns to customer selection without restoring another inquiry', async ({ page }) => {
  await loginAsAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('contractWizardState', JSON.stringify({ currentStep: 4 }));
    localStorage.setItem('partner-creation-runtime:partner-return-e2e:old-inquiry', JSON.stringify({
      actorId: 'partner-return-e2e', inquiryId: 'old-inquiry',
      access: { schemaVersion: 1, recoveryId: 'old-draft', browserSessionId: 'old-session', leaseToken: 'old-token', baseRevision: 1 },
      saved: { recoveryId: 'old-draft', recoveryRevision: 1, rows: [] }, configuredRows: [], customerId: 'return-customer',
    }));
  });
  const inquiryRequests: string[] = [];
  await page.route('**/api/partner/inquiries/query-v2', route => {
    inquiryRequests.push(route.request().postData() || '');
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'STATE_CONFLICT' }) });
  });
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, kind: 'PARTNER', actorId: 'partner-return-e2e', actorDisplayName: 'همکار آزمایشی',
      profileId: 'return-profile', writable: true, latestInquiryId: 'old-inquiry', inquiryIds: ['old-inquiry'],
      recoverableDrafts: [{ recoveryId: 'return-draft', baseRevision: 0, updatedAt: new Date().toISOString() }],
      customers: [{ id: 'return-customer', displayName: 'مشتری بازگشت', address: 'تهران' }],
      projects: [{ id: 'return-project', customerId: 'return-customer', title: 'پروژه بازگشت' }],
    } }) }));
  await page.route('**/api/partner/technical/catalog/query', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: route.request().postDataJSON().kind, items: route.request().postDataJSON().kind === 'PRODUCT' ? [{
        catalogItemId: 'stair-return', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', code: '1010610930100', name: 'سنگ پله آزمایشی',
        families: ['stair'], salesUnits: { prepared: 'count', volumetric: 'count' }, dimensions: { motherLengthMeters: '2', motherWidthCentimeters: '35', thicknessCentimeters: '2' },
        attributes: { stoneType: 'مرمریت', mine: 'آباد', finish: 'صیقل', color: 'سفید', quality: '1', cuttingDimension: '30' }, isAvailable: true,
      }] : [
        { catalogItemId: 'return-layer', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', name: 'لایه آزمایشی', kind: 'LAYER', unit: 'physicalPiece' },
        { catalogItemId: 'return-tool', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', name: 'ابزار آزمایشی', kind: 'TOOL', unit: 'meter' },
        { catalogItemId: 'return-finishing', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', name: 'پرداخت آزمایشی', kind: 'FINISHING', unit: 'squareMeter', incompatibleCatalogItemIds: [] },
      ].filter(item => item.kind === route.request().postDataJSON().kind),
    } }) }));
  await page.route('**/api/partner/technical/recoveries/acquire', route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, recoveryId: request.recoveryId, browserSessionId: request.browserSessionId,
      leaseToken: 'return-lease', baseRevision: 0, updatedAt: new Date().toISOString(), takenOver: false,
    } }) });
  });
  await page.route('**/api/partner/technical/recoveries/read', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      schemaVersion: 1, recoveryId: 'return-draft', recoveryRevision: 0, updatedAt: new Date().toISOString(), draft: null,
    } }) }));
  await page.goto('/dashboard/crm/customers/create?returnTo=contract&step=2&partnerContract=1&draftId=return-draft');
  await page.getByRole('button', { name: 'لغو و بازگشت به قرارداد', exact: true }).click();
  await expect(page).toHaveURL(/step=2.*draftId=return-draft/);
  await expect(page.getByRole('searchbox', { name: 'جستجوی مشتری' })).toBeVisible();
  await page.getByRole('button', { name: /مشتری بازگشت/ }).last().click();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('button', { name: /پروژه بازگشت/ }).last().click();
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(page.getByText('جستجوی محصول', { exact: true })).toBeVisible();
  await expect(page.getByText(/وضعیت فعلی اجازه این اقدام را نمی‌دهد/)).toHaveCount(0);
  expect(inquiryRequests).toEqual([]);
  await page.getByRole('option', { name: /سنگ پله آزمایشی/ }).click();
  await page.locator('label').filter({ has: page.getByRole('radiogroup', { name: 'واحد طول', exact: true }) }).getByRole('textbox').fill('2');
  const mother = page.getByRole('textbox', { name: 'طول سنگ مادر', exact: true });
  await mother.fill('');
  await mother.pressSequentially('2.35');
  await expect(mother).toHaveValue('2.35');
  await page.getByRole('radiogroup', { name: 'واحد طول سنگ مادر', exact: true }).getByRole('radio', { name: 'cm', exact: true }).click();
  await expect(mother).toHaveValue('235');
  await mother.fill('');
  await expect(mother).toHaveValue('');
  await expect(mother).toHaveAttribute('placeholder', '200');
  await page.locator('label').filter({ has: page.getByRole('radiogroup', { name: 'واحد عمق', exact: true }) }).getByRole('textbox').fill('30');
  await page.getByRole('button', { name: 'افزودن لایه', exact: true }).click();
  await page.getByRole('textbox', { name: 'تعداد لایه برای هر پله', exact: true }).fill('1');
  await page.locator('label').filter({ has: page.getByRole('radiogroup', { name: 'واحد عرض لایه', exact: true }) }).getByRole('textbox').fill('5');
  await page.getByRole('button', { name: 'جلو', exact: true }).click();
  await expect(page.getByRole('button', { name: 'افزودن ابزار', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'افزودن پرداخت', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'افزودن ابزار', exact: true }).last().click();
  await page.getByRole('button', { name: /ابزار آزمایشی/ }).click();
  await page.getByRole('button', { name: 'افزودن پرداخت', exact: true }).last().click();
  await page.getByRole('button', { name: /پرداخت آزمایشی/ }).click();
  await expect(page.getByText('ابزار آزمایشی', { exact: true })).toBeVisible();
  await expect(page.getByText('پرداخت آزمایشی', { exact: true })).toBeVisible();

});
