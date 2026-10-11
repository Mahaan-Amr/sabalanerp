import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, setTheme, assertNoHorizontalOverflow } from './support/design-system';
import { partnerInputHash, type PartnerTechnicalDraft } from '../../packages/partner-sales-contracts/dist';

import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';

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

for (const saveMode of ['normal', 'delayed', 'failure', 'missing checkpoint'] as const) test(`initial Partner inquiry persists its pricing step before numbering and survives immediate reload: ${saveMode}`, async ({ page }) => {
  await loginAsAdmin(page);
  const state = await mockPartner(page, true);
  state.recoveryDraft = { schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'old-product', catalogItemId: 'retained-stone', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z',
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' },
    contractualTitle: 'سنگ محفوظ', retailUnitPrice: { amount: '3000000', currency: 'IRT' },
  }] };
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  const { sabalanTotals: _wholesaleTotal, sabalanPaymentPlan: _wholesalePlan,
    resaleDifference: _difference, ...unpriced } = fixture.partner;
  const view = { ...unpriced, products: unpriced.products.map(({ wholesaleUnitPrice: _rate, wholesalePricing: _pricing, ...row }) => row),
    state: 'DRAFT', pricingState: 'AWAITING_INQUIRY', preparationCompleted: false };
  let creates = 0;
  let numberedWithoutRecovery = false;
  let rejectSave = saveMode === 'failure';
  await page.route(`**/api/partner/cases/drafts/${oldRecoveryId}/wizard`, async route => {
    if (route.request().method() === 'PUT') {
      if (rejectSave) return route.fulfill({ status: 503, json: { success: false, code: 'TEMPORARY_FAILURE' } });
      if (saveMode === 'delayed') await new Promise(resolve => setTimeout(resolve, 1_000));
      const input = route.request().postDataJSON();
      state.wizard = { schemaVersion: 1, wizardRevision: Number(state.wizard?.wizardRevision ?? 0) + 1,
        step: input.step, intent: input.intent, updatedAt: new Date().toISOString() };
    }
    if (!state.wizard) return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
    return route.fulfill({ json: { success: true, data: state.wizard } });
  });
  await page.route('**/api/partner/cases/creation-context*', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId, actorDisplayName: 'همکار آزمون', profileId: 'partner-entry-profile',
    writable: true, inquiryIds: creates ? [] : [inquiryId], customers: [oldCustomer], projects,
    recoverableDrafts: [{ recoveryId: oldRecoveryId, ...(creates ? { caseId } : {}),
      baseRevision: 0, updatedAt: new Date().toISOString() }],
  } } }));
  await page.route('**/api/partner/cases/quote', route => {
    const { intent } = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: { schemaVersion: 1,
      recoveryId: intent.recoveryId, recoveryRevision: intent.recoveryRevision, graphHash: intent.graphHash,
      rows: [{ productRowId: 'old-product', retailEffectiveUnitPrice: { amount: '3000000', currency: 'IRT' },
        retailLineTotal: { amount: '6000000', currency: 'IRT' } }] } } });
  });
  await page.route('**/api/partner/cases/commands', route => {
    creates++;
    numberedWithoutRecovery ||= !state.wizard || state.wizard.step !== 'pricing';
    if (saveMode === 'missing checkpoint') state.wizard = undefined;
    const command = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: { commandId: command.commandId,
      replayed: false, case: view, eventIds: [] } } });
  });
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true,
    data: { cases: [{ view, snapshotId: null, actions: { canContinue: true, canPreview: false,
      canIssue: false, canFinalize: false, canSendConfirmation: false, canRequestCorrection: false,
      canCancel: true, canRequestVoid: false } }] } } }));
  await page.route('**/api/partner/cases/approval-matches', route => route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1,
      rows: [], missingPricingSubjectIds: ['old-product'] } } }));
  await seedStale(page);
  await page.goto(`/dashboard/sales/contracts/create?draftId=${oldRecoveryId}`);
  if (saveMode === 'failure') {
    await expect(workflow(page).getByText('ارسال استعلام انجام نشد؛ دوباره تلاش کنید. اطلاعات محصولات حفظ شده است.', { exact: true })).toBeVisible();
    expect(creates, 'a failed recovery save must prevent initial creation').toBe(0);
    rejectSave = false;
    await workflow(page).getByRole('button', { name: 'تلاش مجدد برای ارسال استعلام', exact: true }).click();
  }
  await expect.poll(() => creates).toBe(1);
  expect(numberedWithoutRecovery, 'the successful inquiry must already have a durable pricing step').toBe(false);
  await expect(page).toHaveURL(new RegExp(`caseId=${caseId}`));
  await page.reload();
  await expect(workflow(page).getByText('بازیابی پرونده ذخیره‌شده انجام نشد؛ هیچ تغییری ثبت نشده است.', { exact: true })).toHaveCount(0);
  await expect(workflow(page).getByRole('heading', { name: 'استعلام قیمت', exact: true })).toBeVisible();
  expect(creates).toBe(1);
});

async function mockPartner(page: Page, recoverable = false) {
  const state = { recoverable, actorId, deletes: [] as string[], acquisitions: [] as string[],
    services: false, recoveryDraft: undefined as PartnerTechnicalDraft | undefined, wizard: undefined as Record<string, unknown> | undefined, checkpoint: undefined as PartnerTechnicalDraft | undefined,
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
    else if (path.endsWith('/wizard')) {
      if (route.request().method() === 'PUT') state.wizard = { schemaVersion: 1, wizardRevision: 1,
        step: input.step, intent: input.intent, updatedAt: new Date().toISOString() };
      if (!state.wizard) return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
      data = state.wizard;
    }
    else if (path.endsWith('/recoveries/acquire')) {
      state.acquisitions.push(input.recoveryId);
      data = { schemaVersion: 1, recoveryId: input.recoveryId, browserSessionId: input.browserSessionId,
        leaseToken: 'test-lease', baseRevision: 0, updatedAt: new Date().toISOString(), takenOver: false };
    } else if (path.endsWith('/recoveries/read')) data = {
      schemaVersion: 1, recoveryId: input.recoveryId, recoveryRevision: input.recoveryId === oldRecoveryId ? 1 : 0,
      updatedAt: new Date().toISOString(), draft: state.recoveryDraft ?? null,
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
  await expect(workflow(page).getByRole('button', { name: 'ادامه و استعلام محصولات', exact: true })).toBeEnabled();
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
  state.recoveryDraft = { schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'old-product', catalogItemId: 'retained-stone', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z',
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' },
    contractualTitle: 'سنگ محفوظ', retailUnitPrice: { amount: '1000', currency: 'IRT' },
  }] };
  await seedStale(page);
  await page.goto(`/dashboard/sales/contracts/create?inquiryId=${inquiryId}&draftId=${oldRecoveryId}`);
  await expect(workflow(page).getByRole('heading', { name: 'استعلام قیمت', exact: true })).toBeVisible();
  await expect(previous(page)).toBeEnabled();
  await previous(page).click();
  await expect(page).toHaveURL(/configure=1/);
  await expect.poll(() => state.wizard?.intent).toBeTruthy();
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

test('a newly initialized Partner wizard persists no automatic payment or discount', async ({ page }) => {
  await loginAsAdmin(page);
  await mockPartner(page, true);
  await seedStale(page);
  await page.goto(`/dashboard/sales/contracts/create?draftId=${oldRecoveryId}`);
  await expect.poll(() => page.evaluate(({ actorId, oldRecoveryId }) => {
    const value = localStorage.getItem(`partner-wizard-draft:${actorId}:${oldRecoveryId}`);
    return value ? JSON.parse(value).draft.intent.customerPaymentPlan.installments : null;
  }, { actorId, oldRecoveryId })).toEqual([]);
  await expect.poll(() => page.evaluate(({ actorId, oldRecoveryId }) => {
    const value = localStorage.getItem(`partner-wizard-draft:${actorId}:${oldRecoveryId}`);
    return value ? JSON.parse(value).draft.intent.retailDiscount.amount : null;
  }, { actorId, oldRecoveryId })).toBe('0');
});

test('Partner payments have no discount editor and preserve the full balance through add edit delete', async ({ page }) => {
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
  const remaining = workflow(page).getByText('باقیمانده:', { exact: true }).locator('..');
  await expect(workflow(page).getByRole('textbox', { name: /تخفیف/ })).toHaveCount(0);
  await expect(workflow(page).getByRole('radio', { name: 'درصد', exact: true })).toHaveCount(0);
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
  await expect(workflow(page).getByRole('textbox', { name: /تخفیف/ })).toHaveCount(0);
  await expect(remaining).toContainText('۱,۳۰۰');
  await workflow(page).getByRole('button', { name: 'ویرایش پرداخت 1', exact: true }).click();
  await expect(edit.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true })).toHaveValue('700');
  await edit.getByRole('button', { name: 'بستن', exact: true }).click();
  await workflow(page).getByRole('button', { name: 'حذف پرداخت 1', exact: true }).click();
  await expect(remaining).toContainText('۲,۰۰۰');
  await expect(workflow(page).getByText('پرداخت ۱', { exact: true })).toHaveCount(0);
  await expect(workflow(page).getByText('هنوز پرداختی ثبت نشده است', { exact: true })).toBeVisible();
  await workflow(page).getByRole('button', { name: 'ایجاد پرداخت جدید', exact: true }).click();
  await dialog.getByLabel('نوع پرداخت').selectOption('CASH_SHIBA');
  await dialog.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true }).fill('2100');
  await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(workflow(page).getByText(/جمع پرداخت‌ها ۱۰۰ تومان بیشتر از مبلغ قرارداد/)).toBeVisible();
  await next(page).click();
  await expect(workflow(page).getByText('جمع اقساط باید با مبلغ فروش برابر باشد.', { exact: true })).toBeVisible();
  await workflow(page).getByRole('button', { name: 'ویرایش پرداخت 1', exact: true }).click();
  await edit.getByRole('textbox', { name: 'مبلغ (تومان)', exact: true }).fill('2000');
  await edit.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(workflow(page).getByText('مجموع پرداخت‌ها با مبلغ قرارداد برابر است', { exact: true })).toBeVisible();
  await expect(workflow(page).getByText('جمع اقساط باید با مبلغ فروش برابر باشد.', { exact: true })).toHaveCount(0);
  for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 });
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `reports/qa/partner-payment/payment-${width}-${theme}.png`, fullPage: true });
  }
});


for (const width of [1280, 390]) test(`Reviewed Partner correction starts at date and preserves prior payment at ${width}px`, async ({ page }) => {
  const { createPartnerFixtures } = await import('../../packages/partner-sales-contracts/dist/testing');
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  let wizardWrites = 0;
  let pricingReads = 0;
  let pricingUnavailable = false;
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
  const recoveryState = await mockPartner(page, true);
  // This correction resumes a validated revision, without a newer unfinished checkpoint.
  recoveryState.recoveryDraft = { schemaVersion: 1, inputRevision: saved.inputRevision, rows: [] };
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
  await page.route('**/api/partner/cases/approval-matches', route => { pricingReads++;
    if (pricingUnavailable) return route.fulfill({ status: 503, json: { success: false, code: 'TEMPORARY_FAILURE' } });
    return route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, rows: [], missingPricingSubjectIds: ['old-product'],
  } } }); });
  await page.route(`**/api/partner/cases/drafts/${oldRecoveryId}/wizard`, route => {
    if (route.request().method() === 'PUT') wizardWrites++;
    return route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, wizardRevision: 1, step: 'payment',
      intent: route.request().method() === 'PUT' ? route.request().postDataJSON().intent : intent,
      updatedAt: new Date().toISOString() },
  } }); });

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
  await expect(workflow(page).getByRole('heading', { name: 'اطلاعات قرارداد', exact: true })).toBeVisible();
  await expect(workflow(page).getByRole('heading', { name: 'اطلاعات مشتری', exact: true })).toBeVisible();
  await expect(workflow(page).getByRole('heading', { name: 'جمع‌بندی مالی', exact: true })).toBeVisible();
  await expect(workflow(page).getByRole('table', { name: 'محصولات قرارداد', exact: true })).toBeVisible();
  await expect(workflow(page).getByText('تخفیف ثبت‌شدهٔ قبلی', { exact: true })).toHaveCount(0);
  await workflow(page).locator('summary').filter({ hasText: 'برنامه پرداخت (1)' }).click();
  const payments = workflow(page).getByRole('table', { name: 'برنامه پرداخت', exact: true });
  await expect(payments.getByText('نقدی (کارت‌خوان)', { exact: true })).toBeVisible();
  await expect(payments.getByText('1405/07/11', { exact: true })).toBeVisible();
  await expect(workflow(page).getByRole('heading', { name: 'عملیات تأیید قرارداد', exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme); await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `reports/qa/partner-confirmation/confirmation-${width}-${theme}.png`, fullPage: true });
  }
  if (width === 1280) {
    // Allow the actual step edit and initial approval binding to persist first.
    await page.waitForTimeout(1_500);
    const writesBeforePolling = wizardWrites;
    await expect(workflow(page).getByText(/^آخرین دریافت:/)).toBeVisible();
    const readsBeforeManual = pricingReads;
    await workflow(page).getByRole('button', { name: 'بررسی تازه استعلام', exact: true }).click();
    await expect.poll(() => pricingReads).toBeGreaterThan(readsBeforeManual);
    const readsBeforePolling = pricingReads;
    await expect.poll(() => pricingReads, { timeout: 30_000 }).toBeGreaterThanOrEqual(readsBeforePolling + 2);
    await page.waitForTimeout(1_000);
    expect(wizardWrites, 'unchanged pricing refreshes must not acquire leases and autosave').toBe(writesBeforePolling);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const readsBeforeHidden = pricingReads;
    await page.waitForTimeout(11_000);
    expect(pricingReads, 'hidden pages must not poll Partner inquiries').toBe(readsBeforeHidden);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => pricingReads).toBeGreaterThan(readsBeforeHidden);
    await page.waitForTimeout(500);
    const lastSuccessfulRead = await workflow(page).getByText(/^آخرین دریافت:/).textContent();
    pricingUnavailable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(workflow(page).getByText('دریافت پاسخ جدید استعلام انجام نشد؛ اطلاعات قبلی حفظ شده است.', { exact: true })).toBeVisible();
    await expect(workflow(page).getByText(/^آخرین دریافت:/)).toHaveText(lastSuccessfulRead!);
    await expect(workflow(page).getByRole('table', { name: 'محصولات قرارداد', exact: true })).toBeVisible();
    await expect(workflow(page).getByRole('button', { name: 'ثبت یادداشت قرارداد', exact: true })).toBeDisabled();
    pricingUnavailable = false;
    await workflow(page).getByRole('button', { name: 'تلاش مجدد', exact: true }).click();
    await expect(workflow(page).getByText('دریافت پاسخ جدید استعلام انجام نشد؛ اطلاعات قبلی حفظ شده است.', { exact: true })).toHaveCount(0);
    expect(wizardWrites).toBe(writesBeforePolling);

  }
  await workflow(page).getByRole('button', { name: 'لغو قرارداد', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'لغو قرارداد', exact: true });
  await expect(cancel).toBeVisible();
  await expect(cancel.getByRole('button', { name: 'تأیید لغو قرارداد', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(cancel).toBeHidden();
});

for (const width of [1280, 390]) test(`Partner unified contracts retain a damaged case and private recovery at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await loginAsAdmin(page);
  await mockPartner(page, true);
  const fixture = createPartnerFixtures();
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true, data: {
    cases: [{ view: { ...fixture.partner, trackingNumber: 11 }, snapshotId: null, actions: {
      canContinue: false, canPreview: false, canIssue: false, canFinalize: false, canSendConfirmation: false,
      canRequestCorrection: false, canCancel: false, canRequestVoid: false } }],
    issues: [{ caseId: 'damaged-case', caseNumber: 'PC-damaged', trackingNumber: 10,
      code: 'INTEGRITY_CONFLICT', supportReference: '96fcc17e-9816-4254-bd97-5588344ed1e6' }],
  } } }));
  await page.goto('/dashboard/sales/contracts');
  await expect(page.getByRole('heading', { name: 'قراردادهای فروش', exact: true })).toBeVisible();
  await expect(page.getByText('نیازمند بررسی', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('کد پیگیری ۰۰۰۱۰', { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'ادامه تکمیل', exact: true }).filter({ visible: true }).first()).toHaveAttribute('href',
    `/dashboard/sales/contracts/create?draftId=${oldRecoveryId}`);
  await assertNoHorizontalOverflow(page);
  await page.goto('/dashboard/sales/partner-cases');
  await expect(page).toHaveURL(/\/dashboard\/sales\/contracts$/);
});

for (const scenario of [
  { inactive: true, newer: false, label: 'inactive customer', step: 'delivery' as const },
  { inactive: false, newer: true, label: 'newer checkpoint', step: 'delivery' as const },
  { inactive: false, newer: false, label: 'active matching recovery', step: 'delivery' as const },
  { inactive: true, newer: false, label: 'inactive customer', step: 'pricing' as const },
  { inactive: false, newer: true, label: 'newer checkpoint', step: 'pricing' as const },
]) test(`numbered resume preserves ${scenario.step} with ${scenario.label}`, async ({ page }) => {
  const { inactive, newer } = scenario;
  const resumedHeading = scenario.step === 'delivery' ? 'برنامه تحویل' : 'استعلام قیمت';
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  const intent = { ...fixture.draftSubmissionReference, recoveryId: oldRecoveryId, customerId: oldCustomer.id,
    recoveryRevision: 1, graphHash: saved.graphHash, projectId: 'old-project', contractDate: '2026-09-30',
    preparationCompleted: false, rows: [{ productRowId: 'old-product', retailUnitPrice: { amount: '1000', currency: 'IRT' },
      approvedRowBinding: { inquiryId: 'historical-inquiry', rowId: 'historical-row', revision: 2 } }],
    customerPaymentPlan: { planId: 'retained-plan', version: 1, effectiveDate: '2026-09-30', installments: [] },
    deliveries: [{ deliveryId: 'retained-delivery', date: '2026-10-03', destination: 'نشانی ذخیره‌شده',
      items: [{ productRowId: 'old-product', quantity: '2' }] }],
    retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false };
  const requestedVersions: number[] = [];
  const savedIntents: unknown[] = [];
  let blockedQuoteRequests = 0;
  await loginAsAdmin(page);
  await mockPartner(page, true);
  await page.route('**/api/partner/cases/quote', route => {
    blockedQuoteRequests++;
    return route.fulfill({ status: 409, json: { success: false, code: 'INTEGRITY_CONFLICT' } });
  });
  await page.setViewportSize({ width: inactive ? 390 : 1280, height: 900 });
  await page.route('**/api/partner/cases/creation-context*', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId, profileId: 'partner-entry-profile', writable: true, inquiryIds: [],
    customers: inactive ? [newCustomer] : [oldCustomer, newCustomer], projects,
    ...(inactive ? { retainedCustomer: oldCustomer } : {}),
    recoverableDrafts: [{ recoveryId: oldRecoveryId, caseId, baseRevision: 0, updatedAt: new Date().toISOString() }],
  } } }));
  await page.route('**/api/partner/technical/recoveries/read', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: newer ? 9 : 1,
    updatedAt: new Date().toISOString(), draft: { schemaVersion: 1, inputRevision: newer ? 8 : 1, rows: [] },
  } } }));
  await page.route('**/api/partner/technical/recoveries/read-saved', route => {
    const revision = route.request().postDataJSON().recoveryRevision; requestedVersions.push(revision);
    const { replayed, ...view } = saved;
    return route.fulfill({ json: revision === 1 ? { success: true, data: view }
      : { success: false, code: 'NOT_FOUND' } });
  });
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true, data: {
    cases: [{ view: { ...fixture.partner, state: 'DRAFT', preparationCompleted: false }, snapshotId: null,
      actions: { canContinue: true, canPreview: false, canIssue: false, canFinalize: false, canSendConfirmation: false,
        canRequestCorrection: false, canCancel: true, canRequestVoid: false } }],
  } } }));
  await page.route('**/api/partner/cases/approval-matches', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, rows: [], missingPricingSubjectIds: ['old-product'],
  } } }));
  await page.route(`**/api/partner/cases/drafts/${oldRecoveryId}/wizard`, route => {
    if (route.request().method() === 'PUT') savedIntents.push(route.request().postDataJSON().intent);
    return route.fulfill({ json: { success: true, data: {
      schemaVersion: 1, wizardRevision: 1, step: scenario.step, intent, updatedAt: new Date().toISOString(),
    } } });
  });
  await page.goto(`/dashboard/sales/contracts/create?caseId=${caseId}`);
  await expect(page.getByLabel('ایجاد پرونده فروش همکار').getByRole('heading', { name: resumedHeading, exact: true })).toBeVisible();
  if (scenario.step === 'delivery') await expect(workflow(page).getByRole('textbox', { name: 'آدرس تحویل', exact: true })).toHaveValue('نشانی ذخیره‌شده');
  if (inactive || newer) await expect(workflow(page).getByText(inactive ? /مشتری این پرونده غیرفعال است/ : /تغییرات ذخیره‌شده محصولات هنوز اعتبارسنجی نشده‌اند/)).toBeVisible();
  else await expect(next(page)).toBeEnabled();
  expect(requestedVersions.every(revision => revision === 1)).toBe(true);
  await page.reload();
  await expect(page.getByLabel('ایجاد پرونده فروش همکار').getByRole('heading', { name: resumedHeading, exact: true })).toBeVisible();
  if (scenario.step === 'delivery') await expect(workflow(page).getByRole('textbox', { name: 'آدرس تحویل', exact: true })).toHaveValue('نشانی ذخیره‌شده');
  await expect(workflow(page).getByText('محاسبه مبلغ محصولات انجام نشد؛ دوباره تلاش کنید.', { exact: true })).toHaveCount(0);
  expect(blockedQuoteRequests).toBe(0);
  await expect.poll(() => savedIntents.length).toBeGreaterThan(0);
  for (const savedIntent of savedIntents) expect(savedIntent).toEqual(intent);
  await assertNoHorizontalOverflow(page);
});

for (const action of ['note', 'arrival', 'accept', 'review'] as const) test(`offered Sabalan price requires deliberate acceptance: ${action}`, async ({ page }) => {
  await loginAsAdmin(page);
  const state = await mockPartner(page, true);
  const saveNote = action === 'note' || action === 'arrival';
  let offersAvailable = action !== 'arrival';
  let quoteReads = 0;
  state.recoveryDraft = { schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'old-product', catalogItemId: 'retained-stone', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z',
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' },
    contractualTitle: 'سنگ محفوظ', retailUnitPrice: { amount: '1000', currency: 'IRT' },
  }] };
  const fixture = createPartnerFixtures();
  const caseId = fixture.partner.owner.caseId;
  const offer = { ...fixture.inquiry.rows[0], configurationRef: saved.rows[0].configurationRef,
    approvedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    approvedPrice: { amount: '500', currency: 'IRT' } };
  const intent = { ...fixture.draftSubmissionReference, recoveryId: oldRecoveryId, recoveryRevision: 1, graphHash: saved.graphHash,
    customerId: oldCustomer.id, projectId: 'old-project', contractDate: '2026-09-30', preparationCompleted: false,
    rows: [{ productRowId: 'old-product', retailUnitPrice: { amount: '1000', currency: 'IRT' } }],
    customerPaymentPlan: { planId: 'test-offer-plan', version: 1, effectiveDate: '2026-09-30', installments: [{
      installmentId: 'test-cash', method: 'CASH', subtype: 'CARD', dueDate: '2026-10-03', amount: { amount: '2000', currency: 'IRT' } }] },
    deliveries: [{ deliveryId: 'test-offer-delivery', date: '2026-10-03', destination: 'تهران', projectManagerName: 'مدیر', receiverName: 'گیرنده',
      items: [{ productRowId: 'old-product', quantity: '2' }] }], retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false };
  state.wizard = { schemaVersion: 1, wizardRevision: 1, step: 'confirmation', intent, updatedAt: new Date().toISOString() };
  const unpriced = { ...fixture.partner, customerPaymentPlan: intent.customerPaymentPlan, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY', preparationCompleted: false,
    products: fixture.partner.products.map(({ wholesaleUnitPrice, approvalEvidenceId, ...row }) => row),
    sabalanTotals: undefined, resaleDifference: undefined, sabalanPaymentPlan: undefined };
  await page.route('**/api/partner/inquiries/query-v2', route => route.fulfill({ json: { success: true,
    data: { ...fixture.inquiry, schemaVersion: 2, rows: [offer] } } }));
  let approvalCommands = 0;
  await page.route('**/api/partner/cases/*/commercial', route => { if (route.request().method() === 'POST') approvalCommands++; return route.fulfill({ status: 409, json: { success: false } }); });
  const commands: Array<{ type: string; intent: typeof intent & { rows: Array<{ productRowId: string; approvedRowBinding?: typeof offer.approvedRowBinding }> } }> = [];
  await page.route('**/api/partner/cases/creation-context*', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId, profileId: 'partner-entry-profile', writable: true, inquiryIds: [],
    customers: [oldCustomer], projects, recoverableDrafts: [{ recoveryId: oldRecoveryId, caseId, baseRevision: 0, updatedAt: new Date().toISOString() }],
  } } }));
  await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true, data: { cases: [{
    view: unpriced, snapshotId: null, pricingResponseState: 'READY',
    editRecovery: { recoveryId: oldRecoveryId, baseRevision: 0 },
    commercial: { version: 1, revision: 1, status: 'NOTE', salesApproved: false, customerAccepted: false, inquiry: 'WAITING',
      expiresAt: null, firstFinancialRecordAt: null },
    actions: { canContinue: true, canPreview: false, canIssue: false, canFinalize: false, canSendConfirmation: false,
      canRequestCorrection: false, canCancel: true, canRequestVoid: false },
  }] } } }));
  await page.route('**/api/partner/cases/approval-matches', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, rows: offersAvailable ? [offer] : [], missingPricingSubjectIds: offersAvailable ? [] : ['old-product'],
  } } }));
  await page.route('**/api/partner/cases/quote', route => { quoteReads++; return route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, recoveryId: oldRecoveryId, recoveryRevision: 1, graphHash: saved.graphHash,
    rows: [{ productRowId: 'old-product', retailEffectiveUnitPrice: { amount: '1000', currency: 'IRT' },
      retailLineTotal: { amount: '2000', currency: 'IRT' }, wholesaleUnitPrice: offersAvailable ? { amount: '500', currency: 'IRT' } : undefined,
      wholesaleLineTotal: offersAvailable ? { amount: '1000', currency: 'IRT' } : undefined }],
  } } }); });
  await page.route('**/api/partner/cases/commands', route => {
    const command = route.request().postDataJSON(); commands.push(command);
    return route.fulfill({ json: { success: true, data: { commandId: command.commandId, replayed: false,
      case: action === 'accept' ? fixture.partner : unpriced, eventIds: [] } } });
  });
  if (action === 'review') {
    await page.goto(`/dashboard/sales/contracts?caseId=${caseId}`);
    await expect(page.getByRole('button', { name: 'رد استعلام', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'بررسی استعلام سبلان', exact: true })).toBeVisible();
    await page.screenshot({ path: 'tmp/qa/partner-sales-2026-10-11/offer-review-header.png', fullPage: true });
    await page.getByRole('button', { name: 'بررسی استعلام سبلان', exact: true }).click();
  } else await page.goto(`/dashboard/sales/contracts/create?caseId=${caseId}${action === 'accept' ? '&returnTo=contract&step=5' : ''}`);
  if (saveNote) await expect(workflow(page).getByRole('button', { name: 'ثبت یادداشت قرارداد', exact: true })).toBeVisible();
  else await expect(workflow(page).getByRole('heading', { name: 'استعلام قیمت', exact: true })).toBeVisible();
  await expect(workflow(page).getByRole('button', { name: 'بررسی پاسخ جدید استعلام', exact: true })).toHaveCount(0);
  if (action === 'review') { await page.reload(); await expect(workflow(page).getByRole('heading', { name: 'استعلام قیمت', exact: true })).toBeVisible(); return; }
  if (action === 'arrival') {
    const before = quoteReads;
    offersAvailable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => quoteReads).toBeGreaterThan(before);
    expect((state.wizard?.intent as typeof intent).rows[0]).not.toHaveProperty('approvedRowBinding');
  }
  const button = workflow(page).getByRole('button', { name: saveNote ? 'ثبت یادداشت قرارداد' : 'پذیرش قیمت‌ها', exact: true });
  await expect(button).toBeEnabled(); await button.click();
  await expect.poll(() => commands.length).toBe(1);
  expect(approvalCommands).toBe(0);
  expect(commands[0].type).toBe('CASE_DRAFT_REVISE');
  expect(commands[0].intent.rows[0].approvedRowBinding).toEqual(action === 'accept' ? offer.approvedRowBinding : undefined);
  expect(commands[0].intent.preparationCompleted).toBe(saveNote);
  if (action === 'accept') {
    await expect(workflow(page).getByRole('button', { name: 'پذیرش قیمت‌ها', exact: true })).toHaveCount(0);
    await expect(workflow(page).getByRole('button', { name: 'رد قیمت و درخواست پیشنهاد مجدد', exact: true })).toBeVisible();
    await page.screenshot({ path: 'tmp/qa/partner-sales-2026-10-11/accepted-offer-actions.png', fullPage: true });
  }
});
