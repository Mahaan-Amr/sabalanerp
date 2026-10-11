import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';

const id = 'qa-ordinary-reactivation';
const reply = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fixture = () => ({ id, contractNumber: 'QA-REACTIVATE', titlePersian: 'قرارداد فروش سنگ', status: 'CANCELLED',
  commercialFlowVersion: 1, commercialRevision: 7, totalAmount: 100000, currency: 'ریال',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  customer: { id: 'qa-customer', firstName: 'مشتری', lastName: 'آزمون', customerType: 'INDIVIDUAL' },
  department: { id: 'sales', namePersian: 'فروش' },
  createdByUser: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
  responsibleSeller: { id: 'admin', firstName: 'مدیر', lastName: 'آزمون', username: 'admin' },
  responsibleSellerSource: 'CREATOR',
  items: [], deliveries: [], payments: [],
  commercialActions: { canRenew: false, canEdit: false, canApproveSales: false, canSendConfirmation: false },
  reactivationActions: { canReactivate: true, canCreateReplacement: false, requiresAccountingAuthorization: false, expectedRevision: 7, reason: '' },
});

for (const width of [1280, 390]) test(`ordinary reactivation reason, retry and pending protection at ${width}px`, async ({ page }, info) => {
  await loginAsAdmin(page);
  await setViewportAndZoom(page, { width, height: 900 });
  await page.route(`**/api/sales/contracts/${id}`, route => reply(route, fixture()));
  await page.route('**/api/sales/reports/sellers*', route => reply(route, []));
  let attempts = 0;
  let release: (() => void) | undefined;
  await page.route(`**/api/sales/contracts/${id}/reactivate`, async route => {
    expect(route.request().postDataJSON()).toEqual({ reason: 'مشتری برای ادامه قرارداد برگشته است', expectedRevision: 7 });
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'مجوز قرارداد تغییر کرده است؛ دوباره بررسی کنید.' }) });
    await new Promise<void>(resolve => { release = resolve; });
    await reply(route, { contractId: id, status: 'DRAFT', commercialRevision: 8 });
  });
  await page.goto(`/dashboard/sales/contracts/${id}`);
  const activate = page.getByRole('button', { name: 'فعال‌سازی قرارداد', exact: true });
  await expect(activate).toBeVisible();
  await activate.click();
  const submit = page.getByRole('button', { name: 'فعال‌سازی و ویرایش قرارداد', exact: true });
  await expect(submit).toBeDisabled();
  const reason = page.getByRole('textbox', { name: 'دلیل فعال‌سازی' });
  await reason.fill('مشتری برای ادامه قرارداد برگشته است');
  await submit.click();
  await expect(page.getByText(/مجوز قرارداد تغییر کرده است/)).toBeVisible();
  await expect(reason).toHaveValue('مشتری برای ادامه قرارداد برگشته است');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`reactivation-${width}-${theme}.png`), fullPage: true });
  }
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(submit).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(reason).toBeVisible();
  release!();
  await expect(page).toHaveURL(new RegExp(`/sales/contracts/${id}/edit$`), { timeout: 60_000 });
});

test('expired cancellation offers a new Contract and financial cancellation explains the fresh Accounting authority', async ({ page }) => {
  await loginAsAdmin(page);
  const contract = fixture();
  contract.reactivationActions = { ...contract.reactivationActions, canReactivate: false, canCreateReplacement: true,
    reason: 'مهلت قرارداد لغوشده گذشته است؛ از این اطلاعات قرارداد جدید بسازید.' };
  await page.route(`**/api/sales/contracts/${id}`, route => reply(route, contract));
  await page.route('**/api/sales/reports/sellers*', route => reply(route, []));
  await page.goto(`/dashboard/sales/contracts/${id}`);
  await expect(page.getByRole('button', { name: 'فعال‌سازی قرارداد', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تمدید مهلت', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ایجاد قرارداد جدید از این اطلاعات', exact: true })).toHaveAttribute('href', `/dashboard/sales/contracts/create?fresh=1&copyFrom=${id}`);
  contract.reactivationActions = { ...contract.reactivationActions, canCreateReplacement: false, requiresAccountingAuthorization: true,
    reason: 'برای فعال‌سازی، مجوز تازه اصلاح را از پرونده حسابداری دریافت کنید.' };
  await page.reload();
  await expect(page.getByText(/مجوز تازه اصلاح را از پرونده حسابداری/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'فعال‌سازی قرارداد', exact: true })).toHaveCount(0);
});

test('replacement opens a fresh draft with copied Customer and Items without prior payment or signature', async ({ page }) => {
  await loginAsAdmin(page);
  const customer = { id: 'qa-copy-customer', firstName: 'مشتری', lastName: 'قرارداد جایگزین',
    customerType: 'Individual', status: 'Active', projectAddresses: [], phoneNumbers: [], isBlacklisted: false, isLocked: false };
  const product = { rowId: 'old-row', productId: 'qa-piece', productType: 'prepared', preparedKind: 'readyPiece',
    preparedUnit: 'count', preparedQuantity: 1, quantity: 1, squareMeters: 0, unitPrice: 100,
    pricePerSquareMeter: 100, totalPrice: 100, originalTotalPrice: 100, stoneName: 'سنگ قرارداد جایگزین',
    stoneCode: 'QA', currency: 'تومان', appliedSubServices: [], finishings: [], remainingStones: [],
    usedRemainingStones: [], cutDetails: [], length: 0, width: 0, lengthUnit: 'm', widthUnit: 'cm',
    isMandatory: false, mandatoryPercentage: 0, isCut: false, cutType: null, cuttingCost: 0,
    physicalCuttingCost: 0, totalSubServiceCost: 0, meta: { isLayer: false } };
  await page.route(`**/api/sales/contracts/${id}`, route => reply(route, { ...fixture(), customer,
    reactivationActions: { ...fixture().reactivationActions, canReactivate: false, canCreateReplacement: true },
    contractData: { contractKind: 'standard', contractNumber: 'OLD-NUMBER', customerId: customer.id, customer,
      products: [product], serviceRows: [], deliveries: [{ id: 'old-delivery' }],
      payment: { payments: [{ amount: 100 }], currency: 'تومان', totalContractAmount: 100 },
      signature: { contractId: id, confirmationStatus: 'VERIFIED' } } }));
  await page.route('**/api/sales/contracts/next-number', route => reply(route, { contractNumber: 'NEW-PREVIEW', creatorSequenceNumber: 1 }));
  await page.route('**/api/crm/customers**', route => reply(route, [customer]));
  let creations = 0;
  await page.route('**/api/sales/contracts', route => {
    if (route.request().method() === 'POST') creations++;
    return reply(route, []);
  });
  await page.goto(`/dashboard/sales/contracts/create?fresh=1&copyFrom=${id}`);
  await expect(page.getByText('شماره نهایی هنگام ثبت قرارداد در سرور قطعی می‌شود.', { exact: true })).toBeVisible({ timeout: 60_000 });
  const readCopy = () => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('contract-recovery:v2:'))
    .map(key => JSON.parse(localStorage.getItem(key) || '{}').payload?.wizardData)
    .find(data => data?.customerId === 'qa-copy-customer'));
  await expect.poll(async () => (await readCopy())?.products?.length).toBe(1);
  const draft = await readCopy();
  expect(draft.products[0].rowId).not.toBe('old-row');
  expect(draft.products[0].productId).toBe('qa-piece');
  expect(draft.contractNumber).not.toBe('OLD-NUMBER');
  expect(draft.payment.payments).toEqual([]);
  expect(draft.deliveries).toEqual([]);
  expect(draft.signature?.contractId || null).toBeNull();
  expect(creations).toBe(0);
});
