import { expect, test, type Page, type Route } from '@playwright/test';
import { createFixtureDispatchDocumentsClient } from '../../frontend/src/features/accounting/dispatch-documents/dispatchDocumentsFixture';
import type { DispatchDocumentCase, DispatchDocumentPermission } from '../../frontend/src/features/accounting/dispatch-documents/dispatchDocumentsViewModel';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
};

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const selectCase = (page: Page, number: string) =>
  page.getByLabel('صف پرونده‌های اسناد ارسال').getByRole('button', { name: new RegExp(number) }).click();

const backendReadModel = (item: DispatchDocumentCase) => {
  const lines = item.contracts.flatMap((contract) => contract.rows.map((row) => ({
    id: `line-${row.id}`, sourceContractId: contract.id, sourceContractItemId: row.id,
    productRowId: row.id, quantity: row.quantity, unit: row.unit,
    snapshot: { contractNumber: contract.number, productName: row.label },
  })));
  const pricedAllocationEvents = item.contracts.flatMap((contract) => contract.rows.map((row) => ({
    allocationRevisionLineId: `line-${row.id}`, grossAmount: row.gross.amount,
    discountAmount: row.discount.amount, netAmount: row.net.amount,
  })));
  const waybill = item.bundle ? {
    id: item.bundle.id, number: item.bundle.number, status: item.bundle.status, issuedAt: item.bundle.issuedAt,
    documentArtifacts: item.bundle.artifacts.map((artifact) => ({
      id: artifact.id, kind: artifact.kind === 'ADJUSTMENT' ? 'STATEMENT_ADJUSTMENT' : artifact.kind,
      byteLength: artifact.byteSize, sha256: artifact.checksum, publishedAt: artifact.createdAt,
      statementAdjustmentId: artifact.kind === 'ADJUSTMENT' ? item.bundle?.adjustments[0]?.id : undefined,
    })),
    printHandoffs: item.bundle.printHistory.map((handoff) => ({ id: handoff.id,
      requestedKinds: handoff.action === 'BOTH' ? ['WAYBILL', 'STATEMENT'] : [handoff.action],
      requestedBy: handoff.actorName, requestedAt: handoff.occurredAt,
      completedAt: handoff.outcome === 'SUCCEEDED' ? handoff.occurredAt : null, status: handoff.outcome })),
    statementAdjustments: item.bundle.adjustments.map((adjustment) => ({ id: adjustment.id,
      sequence: adjustment.sequence, issuedAt: adjustment.issuedAt,
      snapshot: { payload: { reason: adjustment.summary, netAmountDelta: adjustment.netDelta.amount } } })),
    voidedAt: null, voidReason: null,
  } : null;
  return {
    id: item.id,
    status: item.state === 'READY' ? 'PENDING' : item.state === 'BLOCKED' ? 'STALE_REQUIRES_SUCCESSOR' : 'ACCEPTED',
    dispositionReason: item.readiness.reasons[0]?.label,
    allocationRevision: {
      finalizedAt: item.finalizedAt,
      snapshot: { loading: { number: item.loadingNumber, customer: { companyName: item.customerName },
        project: { address: item.destination } }, queueTurn: { admissionSnapshot: {
        vehiclePlate: item.vehiclePlate, driverName: item.driverName } } },
      lines,
      pricingReferences: item.contracts.map((contract) => ({ contractId: contract.id,
        pricingVersion: { currency: contract.rows[0]?.net.currency || 'IRR' } })),
      pricedAllocationEvents,
    },
    waybills: waybill ? [waybill] : [],
  };
};

const projectAuthenticatedReadModel = async (page: Page, permission: DispatchDocumentPermission) => {
  const fixture = createFixtureDispatchDocumentsClient(permission === 'UNAUTHORIZED' ? 'MANAGE' : permission);
  const failures = { load: false, command: false, forbidden: false, detail: '', group: false, lostReceipt: false };
  const observed = { lists: 0, details: [] as string[], groups: 0, decisions: [] as string[] };
  await page.route('**/api/accounting/dispatch-**', async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (request.method() === 'GET' && pathname.endsWith('/api/accounting/dispatch-candidates')) {
      if (failures.forbidden) return json(route, 403, { success: false, error: 'مجاز نیست' });
      const group = searchParams.get('loadingId');
      if (group) observed.groups++;
      else observed.lists++;
      if (group ? failures.group : failures.load) return json(route, 503, { success: false, error: 'بازیابی آزمایشی ناموفق بود.' });
      const snapshot = group ? await fixture.loadGroup(group)
        : await fixture.load(searchParams.get('documentQueue') as DispatchDocumentCase['state']);
      const headers = { 'X-Dispatch-Documents-Permission': permission === 'MANAGE' ? 'MANAGE' : 'VIEW' };
      return route.fulfill({ status: 200, contentType: 'application/json', headers,
        body: JSON.stringify({ success: true, data: { rows: snapshot.cases.map(item => ({
          id: item.id, loadingId: item.loadingId, waybillId: item.bundle?.id, canManage: item.canManage, state: item.state,
          customerName: item.customerName, destination: item.destination, loadingNumber: item.loadingNumber, total: item.total,
        })), counts: snapshot.counts } }) });
    }
    if (request.method() === 'GET' && pathname.endsWith('/document-read-model')) {
      const candidateId = decodeURIComponent(pathname.split('/').at(-2) || '');
      observed.details.push(candidateId);
      if (failures.detail === candidateId) return json(route, 503, { success: false });
      const item = (await fixture.load()).cases.find(candidate => candidate.id === candidateId);
      return item ? json(route, 200, { success: true, data: backendReadModel(item) })
        : json(route, 404, { success: false });
    }
    if (failures.command) return json(route, 409, { success: false, error: 'فرمان آزمایشی ناموفق بود.' });
    if (pathname.endsWith('/decision')) {
      const candidateId = decodeURIComponent(pathname.split('/').at(-2) || '');
      const input = request.postDataJSON();
      observed.decisions.push(request.headers()['idempotency-key']);
      const receipt = await fixture.decide(candidateId, input);
      if (failures.lostReceipt) {
        failures.lostReceipt = false;
        return route.abort('connectionreset');
      }
      return json(route, 200, { success: true, data: {
        candidateId, status: receipt.status === 'ISSUED' ? 'ACCEPTED' : 'REJECTED',
        waybill: receipt.status === 'ISSUED' ? { id: 'bundle-1260', number: receipt.number } : null,
      } });
    }
    return route.fallback();
  });
  return Object.assign(failures, { observed });
};

test('MANAGE projection keeps rejection work in a focused dialog', async ({ page }) => {
  await login(page); await projectAuthenticatedReadModel(page, 'MANAGE');
  await page.goto('/dashboard/accounting/dispatch-documents');
  await expect(page.getByRole('heading', { name: 'پرونده‌های اسناد ارسال' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'آماده · ۱' })).toBeVisible();
  await selectCase(page, '۱۲۶۰');
  await page.getByRole('button', { name: 'بازگرداندن برای اصلاح' }).click();
  const rejection = page.getByRole('textbox', { name: 'دلیل بازگرداندن پرونده' });
  await rejection.fill('نیازمند اصلاح ردیف منبع');
  await expect(rejection).toHaveValue('نیازمند اصلاح ردیف منبع');
});

test('VIEW projection exposes retained documents without mutation controls', async ({ page }) => {
  await login(page); await projectAuthenticatedReadModel(page, 'VIEW');
  await page.goto('/dashboard/accounting/dispatch-documents');
  await expect(page.getByText(/فقط برای مشاهده و دریافت اسناد/)).toBeVisible();
  await page.getByRole('button', { name: 'صادرشده · ۱' }).click();
  await selectCase(page, '۱۲۵۸');
  await expect(page.getByRole('button', { name: 'چاپ هر دو' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'پذیرش و صدور اسناد', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'اقدامات بیشتر' }).click();
  await expect(page.getByText('جایگزینی بسته اسناد')).toHaveCount(0);
});

test('the customer document queue opens only the selected details and isolates a failed case', async ({ page }) => {
  await login(page);
  const fixture = await projectAuthenticatedReadModel(page, 'MANAGE');
  fixture.detail = 'dispatch-ready';
  await page.goto('/dashboard/accounting/dispatch-documents');
  await expect(page.getByRole('button', { name: 'آماده · ۱' })).toBeVisible();
  expect(fixture.observed.lists).toBe(1);
  expect(fixture.observed.details).toEqual([]);
  await selectCase(page, '۱۲۶۰');
  await expect(page.getByText('جزئیات این پرونده دریافت نشد.')).toBeVisible();
  expect(fixture.observed.details).toEqual(['dispatch-ready']);
  await page.getByRole('button', { name: 'صادرشده · ۱' }).click();
  await selectCase(page, '۱۲۵۸');
  await expect(page.getByRole('button', { name: 'چاپ هر دو' })).toBeVisible();
  expect(fixture.observed.details).toEqual(['dispatch-ready', 'dispatch-issued']);
});

test('a recovered issuance remains confirmed when group refresh fails and retry sends only a read', async ({ page }) => {
  await login(page);
  const fixture = await projectAuthenticatedReadModel(page, 'MANAGE');
  fixture.lostReceipt = true;
  fixture.group = true;
  await page.goto('/dashboard/accounting/dispatch-documents');
  await selectCase(page, '۱۲۶۰');
  await page.getByRole('button', { name: 'پذیرش و صدور اسناد' }).click();
  await expect(page.getByRole('button', { name: 'بازیابی همان فرمان' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'بازیابی همان فرمان' }).click();
  await expect(page.getByText('بارنامه ۱۲۶۰ صادر شد.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تازه‌سازی همین بارگیری' })).toBeVisible();
  expect(fixture.observed.decisions).toHaveLength(2);
  expect(fixture.observed.decisions[0]).toBe(fixture.observed.decisions[1]);
  expect(fixture.observed.groups).toBe(1);
  fixture.group = false;
  await page.getByRole('button', { name: 'تازه‌سازی همین بارگیری' }).click();
  await expect(page.getByRole('button', { name: 'تازه‌سازی همین بارگیری' })).toHaveCount(0);
  expect(fixture.observed.groups).toBe(2);
  expect(fixture.observed.decisions).toHaveLength(2);
  expect(fixture.observed.lists).toBe(2);
});

test('UNAUTHORIZED projection discloses no case existence', async ({ page }) => {
  await login(page); const failures = await projectAuthenticatedReadModel(page, 'MANAGE');
  const cached = await createFixtureDispatchDocumentsClient('MANAGE').load();
  await page.evaluate((workspace) => sessionStorage.setItem('accounting:dispatch-documents:last-success:v1', JSON.stringify({ filter: 'READY', selectedId: 'dispatch-ready', rejectionReason: '', scrollTop: 0, workspace })), cached);
  failures.forbidden = true;
  await page.goto('/dashboard/accounting/dispatch-documents');
  await expect(page.getByText('دسترسی به اسناد ارسال حسابداری برای این نقش مجاز نیست.')).toBeVisible();
  await expect(page.getByText('ارسال ۱۲۶۰')).toHaveCount(0);
  await expect(page.getByLabel('صف پرونده‌های اسناد ارسال')).toHaveCount(0);
});

test('command and refresh failures preserve Last Successful View and unsaved reason', async ({ page }) => {
  await login(page); const failures = await projectAuthenticatedReadModel(page, 'MANAGE');
  await page.goto('/dashboard/accounting/dispatch-documents');
  await selectCase(page, '۱۲۶۰');
  await page.getByRole('button', { name: 'بازگرداندن برای اصلاح' }).click();
  const rejection = page.getByRole('textbox', { name: 'دلیل بازگرداندن پرونده' });
  await rejection.fill('این دلیل نباید از بین برود');
  failures.command = true;
  await page.getByRole('button', { name: 'بازگرداندن برای اصلاح' }).last().click();
  await expect(page.getByText('فرمان آزمایشی ناموفق بود.').first()).toBeVisible();
  await expect(rejection).toHaveValue('این دلیل نباید از بین برود');
  await page.keyboard.press('Escape');
  failures.command = false; failures.load = true;
  await page.getByRole('button', { name: 'تازه‌سازی' }).click();
  await expect(page.getByText(/آخرین نمایش موفق حفظ شده است/).first()).toBeVisible();
  failures.load = false;
  await page.getByRole('button', { name: 'تازه‌سازی' }).click();
  await page.getByRole('button', { name: 'بازگرداندن برای اصلاح' }).click();
  await expect(page.getByRole('textbox', { name: 'دلیل بازگرداندن پرونده' })).toHaveValue('این دلیل نباید از بین برود');
  await page.keyboard.press('Escape');
  await page.reload();
  await selectCase(page, '۱۲۶۰');
  await page.getByRole('button', { name: 'بازگرداندن برای اصلاح' }).click();
  await expect(page.getByRole('textbox', { name: 'دلیل بازگرداندن پرونده' })).toHaveValue('این دلیل نباید از بین برود');
});

test('selected review stays before the queue at 390px and remains keyboard usable at 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page); await projectAuthenticatedReadModel(page, 'MANAGE');
  await page.goto('/dashboard/accounting/dispatch-documents');
  await selectCase(page, '۱۲۶۰');
  const selectedHeading = page.getByRole('heading', { name: /۱۲۶۰/ });
  await expect(selectedHeading).toBeVisible();
  const queue = page.getByLabel('صف پرونده‌های اسناد ارسال');
  const selectedBox = await selectedHeading.boundingBox(); const queueBox = await queue.boundingBox();
  expect(selectedBox).not.toBeNull(); expect(queueBox).not.toBeNull(); expect(selectedBox!.y).toBeLessThan(queueBox!.y);
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await expect(page.getByRole('button', { name: 'پذیرش و صدور اسناد' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const primaryAction = page.getByRole('button', { name: 'پذیرش و صدور اسناد' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reachedPrimaryAction = false;
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press('Tab');
    if (await primaryAction.evaluate((element) => document.activeElement === element)) {
      reachedPrimaryAction = true;
      break;
    }
  }
  expect(reachedPrimaryAction).toBe(true);
});
