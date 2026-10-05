import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, setTheme, assertNoHorizontalOverflow } from './support/design-system';
import { partnerInputHash, type PartnerTechnicalDraft } from '../../packages/partner-sales-contracts/dist';

const actorId = 'partner-entry-regression';
const oldRecoveryId = 'partner-old-entry';
const inquiryId = 'partner-old-inquiry';
const oldCustomer = { id: 'old-customer', displayName: 'مشتری قبلی', address: 'تهران' };
const newCustomer = { id: 'new-customer', displayName: 'مشتری جدید', address: 'تهران' };
const projects = [
  { id: 'old-project', customerId: oldCustomer.id, title: 'پروژه قبلی' },
  { id: 'new-project', customerId: newCustomer.id, title: 'پروژه جدید' },
];
const saved = { schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, inputRevision: 1,
  graphHash: `sha256-v1:${'a'.repeat(64)}`, updatedAt: new Date().toISOString(), rows: [{
    configurationRef: { recoveryId: oldRecoveryId, recoveryRevision: 1, productRowId: 'old-product' },
    quantity: '2', unit: 'meter', configurationChange: 'NEW',
  }], replayed: true };
const staleRuntime = { actorId, inquiryId,
  access: { schemaVersion: 1, recoveryId: oldRecoveryId, browserSessionId: 'partner-browser-old',
    leaseToken: 'old-lease', baseRevision: 0 },
  saved, configuredRows: [], customerId: oldCustomer.id, projectId: 'old-project', contractDate: '2026-01-01' };
const runtimeKey = `partner-creation-runtime:${actorId}:${inquiryId}`;
const workflow = (page: Page) => page.locator('main.sds-workspace.sds-neumorphic-workflow-scope');
const next = (page: Page) => workflow(page).getByRole('button', { name: 'بعدی', exact: true });
const previous = (page: Page) => workflow(page).getByRole('button', { name: 'قبلی', exact: true });

async function mockPartner(page: Page, recoverable = false) {
  const state = { recoverable, actorId, deletes: [] as string[], acquisitions: [] as string[],
    services: false, checkpoint: undefined as PartnerTechnicalDraft | undefined,
    delayDelete: undefined as Promise<void> | undefined };
  // Never send a Partner request to a real account, including unexpected mutations.
  await page.route('**/api/partner/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const input = route.request().postData() ? route.request().postDataJSON() : undefined;
    let data: unknown;
    if (path.endsWith('/creation-context')) data = {
      schemaVersion: 1, kind: 'PARTNER', actorId: state.actorId, actorDisplayName: 'همکار آزمون',
      profileId: 'partner-entry-profile', writable: true, inquiryIds: [inquiryId], latestInquiryId: inquiryId,
      customers: [oldCustomer, newCustomer], projects,
      recoverableDrafts: state.recoverable ? [{ recoveryId: oldRecoveryId, baseRevision: 0,
        updatedAt: new Date().toISOString() }] : [],
      ...(state.recoverable ? { recoverableDraft: { recoveryId: oldRecoveryId, baseRevision: 0,
        updatedAt: new Date().toISOString() } } : {}),
    };
    else if (path.endsWith('/catalog/query')) data = {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: input.kind, items: state.services && input.kind === 'SERVICE' ? [{
        catalogItemId: `service-${input.sourceType}`, catalogSnapshotVersion: '2026-10-03T00:00:00.000Z',
        sourceType: input.sourceType, name: `خدمت ${input.sourceType}`, unit: input.sourceType === 'finishing' ? 'squareMeter' : 'meter',
        suggestedRetailUnitPrice: { amount: '100', currency: 'IRT' },
      }] : [],
    };
    else if (path.endsWith('/recoveries/acquire')) {
      state.acquisitions.push(input.recoveryId);
      data = { schemaVersion: 1, recoveryId: input.recoveryId, browserSessionId: input.browserSessionId,
        leaseToken: 'test-lease', baseRevision: 0, updatedAt: new Date().toISOString(), takenOver: false };
    } else if (path.endsWith('/recoveries/read')) data = {
      schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: input.recoveryId === oldRecoveryId ? 1 : 0,
      updatedAt: new Date().toISOString(), draft: null,
    };
    else if (path.endsWith('/recoveries/read-saved')) {
      const { replayed, ...view } = saved;
      data = view;
    }
    else if (path.endsWith('/recoveries/checkpoint')) {
      state.checkpoint = input.draft;
      data = { schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: input.expectedRecoveryRevision + 1,
        inputRevision: input.draft.inputRevision, updatedAt: new Date().toISOString(), replayed: false };
    } else if (path.endsWith('/customer-total-preview')) data = { inputRevision: input.draft.inputRevision,
      draftHash: await partnerInputHash(input.draft), total: { amount: '29', currency: 'IRT' } };
    else if (route.request().method() === 'DELETE') {
      state.deletes.push(path.split('/').at(-1)!);
      await state.delayDelete;
      state.recoverable = false;
      data = { recoveryId: oldRecoveryId };
    } else return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
    return route.fulfill({ json: { success: true, data } });
  });
  return state;
}

async function seedStale(page: Page) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: runtimeKey, value: staleRuntime });
}

async function confirmStartNew(page: Page) {
  await page.getByRole('button', { name: 'شروع قرارداد جدید', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'شروع قرارداد جدید', exact: true });
  await dialog.getByRole('button', { name: 'شروع قرارداد جدید', exact: true }).click();
  await expect(workflow(page).getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last()).toBeVisible();
}

test('Partner independent services use catalog defaults, editable rates and distinct duplicate recovery identities', async ({ page }) => {
  await loginAsAdmin(page);
  const state = await mockPartner(page);
  state.services = true;
  await page.goto('/dashboard/sales/contracts/create?entry=new-contract');
  await next(page).click();
  await workflow(page).getByRole('button', { name: /مشتری جدید/ }).click();
  await next(page).click();
  await workflow(page).getByRole('button', { name: /پروژه جدید/ }).click();
  await next(page).click();
  const services = workflow(page).getByRole('region', { name: 'خدمات مستقل' });
  await services.getByRole('button', { name: 'افزودن خدمت', exact: true }).click();
  await services.getByRole('button', { name: /خدمت tool/ }).click();
  await services.getByRole('textbox', { name: 'مقدار', exact: true }).fill('0.29');
  await services.getByRole('textbox', { name: 'نرخ (تومان)', exact: true }).fill('200');
  await expect.poll(() => state.checkpoint?.serviceRows?.[0]?.quantity).toBe('0.29');
  await expect.poll(() => state.checkpoint?.serviceRows?.[0]?.retailUnitPrice?.amount).toBe('200');
  await services.getByRole('button', { name: 'تکثیر', exact: true }).click();
  await expect.poll(() => state.checkpoint?.serviceRows?.length).toBe(2);
  expect(new Set(state.checkpoint!.serviceRows!.map(row => row.serviceRowId)).size).toBe(2);
  expect(state.checkpoint!.rows).toEqual([]);
  await services.getByRole('button', { name: 'حذف', exact: true }).last().click();
  await services.getByRole('button', { name: 'تأیید حذف', exact: true }).click();
  await expect.poll(() => state.checkpoint?.serviceRows?.length).toBe(1);
  await expect(workflow(page).getByRole('button', { name: 'ادامه تکمیل قرارداد', exact: true })).toBeEnabled();
});

for (const returnMode of ['logout/login', 'browser reopen'] as const) {
  test(`stale runtime is ignored after ${returnMode} and a different customer starts clean`, async ({ page, context, browser }) => {
    await loginAsAdmin(page);
    await seedStale(page);
    let target = page;
    let reopened: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    if (returnMode === 'browser reopen') {
      reopened = await browser.newContext({ baseURL: 'http://localhost:3000', storageState: await context.storageState() });
      target = await reopened.newPage();
      await loginAsAdmin(target);
    } else {
      // The old per-user runtime survives a new login, with a new editor location.
      await page.getByRole('button', { name: 'خروج', exact: true }).click();
      await loginAsAdmin(page);
    }
    try {
      const state = await mockPartner(target);
      await target.goto('http://localhost:3000/dashboard/sales/contracts/create');
      await expect(workflow(target).getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last()).toBeVisible();
      expect(state.acquisitions).not.toContain(oldRecoveryId);
      await next(target).click();
      await workflow(target).getByRole('button', { name: /مشتری جدید/ }).click();
      await next(target).click();
      await expect(workflow(target).getByRole('button', { name: /پروژه قبلی/ })).toHaveCount(0);
      await workflow(target).getByRole('button', { name: /پروژه جدید/ }).click();
      await next(target).click();
      await expect(workflow(target).getByText('محصولی اضافه نشده است', { exact: false })).toBeVisible();
      await previous(target).click();
      await expect(workflow(target).getByRole('button', { name: /پروژه جدید/ })).toHaveAttribute('aria-pressed', 'true');
      await previous(target).click();
      await expect(workflow(target).getByRole('button', { name: /مشتری جدید/ })).toHaveAttribute('aria-pressed', 'true');
    } finally { await reopened?.close(); }
  });
}

test('refresh after Start New resumes the same recovery and customer/project progress', async ({ page }) => {
  await loginAsAdmin(page);
  const state = await mockPartner(page, true);
  await page.goto('/dashboard/sales/contracts/create');
  await confirmStartNew(page);
  await next(page).click();
  await workflow(page).getByRole('button', { name: /مشتری جدید/ }).click();
  await next(page).click();
  await workflow(page).getByRole('button', { name: /پروژه جدید/ }).click();
  await next(page).click();
  const firstId = state.acquisitions.at(-1)!;
  await page.reload();
  await expect(workflow(page).getByText('محصولی اضافه نشده است', { exact: false })).toBeVisible();
  expect(new Set(state.acquisitions)).toEqual(new Set([firstId]));
  expect(new URL(page.url()).searchParams.get('newInquiry')).toBeNull();
  await previous(page).click();
  await expect(workflow(page).getByRole('button', { name: /پروژه جدید/ })).toHaveAttribute('aria-pressed', 'true');
  await previous(page).click();
  await expect(workflow(page).getByRole('button', { name: /مشتری جدید/ })).toHaveAttribute('aria-pressed', 'true');
});

test('rapid Start New confirmation sends one DELETE throughout the transition', async ({ page }) => {
  await loginAsAdmin(page);
  const state = await mockPartner(page, true);
  let release!: () => void;
  state.delayDelete = new Promise<void>(resolve => { release = resolve; });
  await page.goto('/dashboard/sales/contracts/create');
  await page.getByRole('button', { name: 'شروع قرارداد جدید', exact: true }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'شروع قرارداد جدید', exact: true });
  await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => state.deletes.length).toBeGreaterThan(0);
  try {
    expect(state.deletes).toEqual([oldRecoveryId]);
    await expect(page.getByRole('button', { name: 'شروع قرارداد جدید', exact: true }).first()).toBeDisabled();
  } finally { release(); }
  await expect(workflow(page).getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last()).toBeVisible();
  expect(state.deletes).toEqual([oldRecoveryId]);
  expect(new Set(state.acquisitions).size).toBe(1);
});

test('valid explicit resume restores its live runtime and preserves actor isolation', async ({ page }) => {
  await loginAsAdmin(page);
  const state = await mockPartner(page, true);
  await seedStale(page);
  await page.goto(`/dashboard/sales/contracts/create?inquiryId=${inquiryId}&draftId=${oldRecoveryId}`);
  await expect(previous(page)).toBeEnabled();
  await previous(page).click();
  await expect(workflow(page).getByRole('button', { name: /پروژه قبلی/ })).toHaveAttribute('aria-pressed', 'true');
  state.actorId = 'another-partner';
  state.recoverable = false;
  await page.goto('/dashboard/sales/contracts/create?entry=new-contract');
  await expect(workflow(page).getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last()).toBeVisible();
  await next(page).click();
  await next(page).click();
  await expect(workflow(page).getByRole('button', { name: /پروژه قبلی/ })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(key => localStorage.getItem(key), runtimeKey)).not.toBeNull();
});


test('sidebar new-contract entry preserves the live draft choice without silently resuming it', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/dashboard/profile', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: { ...body.data, role: 'USER' } } });
  });
  await page.route('**/api/dashboard/route-availability?*', route => route.fulfill({
    json: { success: true, data: { allowed: true } },
  }));
  const state = await mockPartner(page, true);
  await seedStale(page);
  await page.goto(`/dashboard/sales/contracts/create?draftId=${oldRecoveryId}`);
  await expect(previous(page)).toBeEnabled();
  await page.getByRole('navigation', { name: 'ناوبری فضای کاری' })
    .getByRole('link', { name: 'ایجاد قرارداد جدید', exact: true }).click();
  await expect(page).toHaveURL(/entry=new-contract/);
  await expect(page.getByRole('button', { name: 'ادامه پیش‌نویس قبلی', exact: true })).toBeVisible();
  expect(state.acquisitions.every(id => id === oldRecoveryId)).toBe(true);
  expect(state.deletes).toEqual([]);
  await page.getByRole('button', { name: 'ادامه پیش‌نویس قبلی', exact: true }).click();
  await expect(previous(page)).toBeEnabled();
  expect(state.acquisitions.every(id => id === oldRecoveryId)).toBe(true);
});

test('a newly initialized Partner wizard persists no automatic payment', async ({ page }) => {
  await loginAsAdmin(page);
  await mockPartner(page, true);
  await seedStale(page);
  await page.goto(`/dashboard/sales/contracts/create?draftId=${oldRecoveryId}`);
  await expect.poll(() => page.evaluate(({ actorId, oldRecoveryId }) => {
    const value = localStorage.getItem(`partner-wizard-draft:${actorId}:${oldRecoveryId}`);
    return value ? JSON.parse(value).draft.intent.customerPaymentPlan.installments : null;
  }, { actorId, oldRecoveryId })).toEqual([]);
});

test('Partner payments require user entry and preserve remaining balance through add edit delete and discount', async ({ page }) => {
  const { createPartnerFixtures } = await import('../../packages/partner-sales-contracts/dist/testing');
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  const intent = { ...fixture.draftSubmissionReference, recoveryId: oldRecoveryId, customerId: oldCustomer.id,
    projectId: 'old-project', contractDate: '2026-09-30', preparationCompleted: false,
    rows: [{ productRowId: 'old-product', retailUnitPrice: { amount: '1000', currency: 'IRT' } }],
    customerPaymentPlan: { planId: 'manual-payments-plan', version: 1, effectiveDate: '2026-09-30', installments: [] },
    deliveries: [{ deliveryId: 'payment-test-delivery', date: '2026-10-03', destination: 'تهران',
      projectManagerName: 'مدیر آزمون', receiverName: 'تحویل‌گیرنده آزمون',
      items: [{ productRowId: 'old-product', quantity: '2' }] }],
    retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false };
  await loginAsAdmin(page);
  await mockPartner(page, true);
  await page.route('**/api/partner/cases/quote', route => {
    const { intent: quotedIntent } = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: { schemaVersion: 1,
      recoveryId: quotedIntent.recoveryId, recoveryRevision: quotedIntent.recoveryRevision,
      graphHash: quotedIntent.graphHash, rows: [{ productRowId: 'old-product',
        retailEffectiveUnitPrice: { amount: '1000', currency: 'IRT' },
        retailLineTotal: { amount: '2000', currency: 'IRT' } }] } } });
  });
  await page.route('**/api/partner/cases/creation-context*', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId, actorDisplayName: 'همکار آزمون', profileId: 'partner-entry-profile',
    writable: true, inquiryIds: [], customers: [oldCustomer, newCustomer], projects,
    recoverableDrafts: [{ recoveryId: oldRecoveryId, caseId, baseRevision: 0, updatedAt: new Date().toISOString() }],
  } } }));
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true,
    data: { cases: [{ view: { ...fixture.partner, state: 'DRAFT', preparationCompleted: false }, snapshotId: null,
      actions: { canContinue: true, canPreview: false, canIssue: false, canFinalize: false, canSendConfirmation: false,
        canRequestCorrection: false, canCancel: true, canRequestVoid: false } }] } } }));
  await page.route('**/api/partner/cases/approval-matches', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, rows: [], missingPricingSubjectIds: ['old-product'],
  } } }));
  await page.route(`**/api/partner/cases/drafts/${oldRecoveryId}/wizard`, route => route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, wizardRevision: 1, step: 'payment',
      intent: route.request().method() === 'PUT' ? route.request().postDataJSON().intent : intent,
      updatedAt: new Date().toISOString() },
  } }));
  await page.goto(`/dashboard/sales/contracts/create?caseId=${caseId}`);
  await workflow(page).getByRole('button', { name: 'مرحله بعدی', exact: true }).click();
  await next(page).click();
  const remaining = workflow(page).getByText('مانده قابل تخصیص').locator('..');
  await expect(workflow(page).getByText('پرداخت ۱', { exact: true })).toHaveCount(0);
  await expect(remaining).toContainText('۲,۰۰۰');
  await workflow(page).getByRole('button', { name: 'افزودن پرداخت', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن پرداخت', exact: true });
  await expect(dialog.getByLabel('نوع پرداخت')).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true })).toHaveValue('2,000');
  await expect(dialog.getByText(/مانده قابل پرداخت:/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByText(/مانده قابل پرداخت:/)).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true })).toHaveValue('2,000');
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(dialog.getByText('روش پرداخت را انتخاب کنید.', { exact: true })).toBeVisible();
  await dialog.getByLabel('نوع پرداخت').selectOption('CASH_SHIBA');
  await dialog.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(remaining).toContainText('۱,۵۰۰');
  await workflow(page).getByRole('button', { name: 'افزودن پرداخت', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true })).toHaveValue('1,500');
  await expect(dialog.getByLabel('نوع پرداخت')).toHaveValue('');
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(remaining).toContainText('۱,۵۰۰');
  await workflow(page).getByRole('button', { name: 'ویرایش پرداخت 1', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'ویرایش پرداخت', exact: true });
  await edit.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true }).fill('700');
  await edit.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(remaining).toContainText('۱,۳۰۰');
  await workflow(page).getByRole('textbox', { name: 'مبلغ تخفیف (تومان)', exact: true }).fill('100');
  await expect(remaining).toContainText('۱,۲۰۰');
  await workflow(page).getByRole('button', { name: 'ویرایش پرداخت 1', exact: true }).click();
  await expect(edit.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true })).toHaveValue('700');
  await edit.getByRole('button', { name: 'بستن', exact: true }).click();
  await workflow(page).getByRole('button', { name: 'حذف پرداخت 1', exact: true }).click();
  await expect(remaining).toContainText('۱,۹۰۰');
  await expect(workflow(page).getByText('پرداخت ۱', { exact: true })).toHaveCount(0);
});


for (const width of [1280, 390]) test(`Reviewed Partner correction starts at date and preserves prior payment at ${width}px`, async ({ page }) => {
  const { createPartnerFixtures } = await import('../../packages/partner-sales-contracts/dist/testing');
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  const intent = { ...fixture.draftSubmissionReference, recoveryId: oldRecoveryId, customerId: oldCustomer.id,
    projectId: 'old-project', contractDate: '2026-09-30', preparationCompleted: false,
    rows: [{ productRowId: 'old-product', retailUnitPrice: { amount: '1000', currency: 'IRT' } }],
    customerPaymentPlan: { planId: 'manual-payments-plan', version: 1, effectiveDate: '2026-09-30', installments: [{ installmentId: 'retained-cash', method: 'CASH', subtype: 'CARD', dueDate: '2026-10-03', amount: { amount: '2000', currency: 'IRT' } }] },
    deliveries: [{ deliveryId: 'payment-test-delivery', date: '2026-10-03', destination: 'تهران',
      projectManagerName: 'مدیر آزمون', receiverName: 'تحویل‌گیرنده آزمون',
      items: [{ productRowId: 'old-product', quantity: '2' }] }],
    retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false };
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  await mockPartner(page, true);
  await page.route('**/api/partner/cases/quote', route => {
    const { intent: quotedIntent } = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: { schemaVersion: 1,
      recoveryId: quotedIntent.recoveryId, recoveryRevision: quotedIntent.recoveryRevision,
      graphHash: quotedIntent.graphHash, rows: [{ productRowId: 'old-product',
        retailEffectiveUnitPrice: { amount: '1000', currency: 'IRT' },
        retailLineTotal: { amount: '2000', currency: 'IRT' } }] } } });
  });
  await page.route('**/api/partner/cases/creation-context*', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId, actorDisplayName: 'همکار آزمون', profileId: 'partner-entry-profile',
    writable: true, inquiryIds: [], customers: [oldCustomer, newCustomer], projects,
    recoverableDrafts: [{ recoveryId: oldRecoveryId, caseId, baseRevision: 0, updatedAt: new Date().toISOString() }],
  } } }));
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true,
    data: { cases: [{ view: { ...fixture.partner, state: 'COMMITTED', preparationCompleted: true, customerPaymentPlan: intent.customerPaymentPlan }, snapshotId: null,
      reviewedCorrection: { requestId: 'reviewed-correction', reason: 'بررسی نشانی تحویل توسط حسابداری' },
      actions: { canContinue: true, canPreview: false, canIssue: false, canFinalize: false, canSendConfirmation: false,
        canRequestCorrection: false, canCancel: true, canRequestVoid: false } }] } } }));
  await page.route('**/api/partner/cases/approval-matches', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, rows: [], missingPricingSubjectIds: ['old-product'],
  } } }));
  await page.route(`**/api/partner/cases/drafts/${oldRecoveryId}/wizard`, route => route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, wizardRevision: 1, step: 'payment',
      intent: route.request().method() === 'PUT' ? route.request().postDataJSON().intent : intent,
      updatedAt: new Date().toISOString() },
  } }));

  await page.goto(`/dashboard/sales/contracts/create?caseId=${caseId}`);
  await expect(workflow(page).getByText('اصلاح قرارداد با تأیید حسابداری — بررسی نشانی تحویل توسط حسابداری', { exact: true })).toBeVisible();
  const progress = workflow(page).getByRole('navigation', { name: 'مراحل ویرایش قرارداد' });
  if (width >= 640) await expect(progress.getByRole('button', { name: 'تاریخ قرارداد', exact: true })).toHaveAttribute('aria-current', 'step');
  if (width < 640) {
    await progress.getByRole('button', { name: /انتخاب مرحله ویرایش؛ مرحله فعلی تاریخ قرارداد/ }).click();
    await page.getByRole('dialog', { name: 'انتخاب مرحله ویرایش', exact: true })
      .getByRole('button', { name: /روش پرداخت/ }).click();
  } else await progress.getByRole('button', { name: 'روش پرداخت', exact: true }).click();
  await expect(workflow(page).getByText('پرداخت ۱', { exact: true })).toBeVisible();
  await workflow(page).getByRole('button', { name: 'ویرایش پرداخت 1', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'ویرایش پرداخت', exact: true });
  await expect(edit.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true })).toHaveValue('2,000');
  await edit.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(edit).toBeHidden();
  await next(page).click();
  if (width < 640) await expect(progress.getByRole('button', { name: /انتخاب مرحله ویرایش؛ مرحله فعلی تایید دیجیتال/ })).toBeVisible();
  else await expect(progress.getByRole('button', { name: 'تایید دیجیتال', exact: true })).toHaveAttribute('aria-current', 'step');
  await expect(workflow(page).getByText('کد ملی برای پرداخت با تاریخ غیر از امروز الزامی است.', { exact: true })).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) { await setTheme(page, theme); await assertNoHorizontalOverflow(page); }
});
