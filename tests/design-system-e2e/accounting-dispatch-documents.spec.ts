import { expect, test, type Page, type Route } from '@playwright/test';
import { createFixtureDispatchDocumentsClient } from '../../frontend/src/features/accounting/dispatch-documents/dispatchDocumentsFixture';
import type { DispatchDocumentCase, DispatchDocumentPermission, DispatchDocumentWorkspace } from '../../frontend/src/features/accounting/dispatch-documents/dispatchDocumentsViewModel';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
};

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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
  const source = await fixture.load();
  const workspace: DispatchDocumentWorkspace = { ...source, permission };
  const failures = { load: false, command: false, forbidden: false };
  const readModels = new Map(workspace.cases.map((item) => [item.id, backendReadModel(item)]));
  await page.route('**/api/accounting/dispatch-**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname.endsWith('/api/accounting/dispatch-candidates')) {
      if (failures.forbidden) return json(route, 403, { success: false, error: 'مجاز نیست' });
      if (failures.load) return json(route, 503, { success: false, error: 'بازیابی آزمایشی ناموفق بود.' });
      const headers = { 'X-Dispatch-Documents-Permission': permission === 'MANAGE' ? 'MANAGE' : 'VIEW' };
      return route.fulfill({ status: 200, contentType: 'application/json', headers,
        body: JSON.stringify({ success: true, data: [...readModels.values()].map((item) => ({
          id: item.id, status: item.status, waybills: item.waybills.map((waybill) => ({ id: waybill.id })) })) }) });
    }
    if (request.method() === 'GET' && pathname.endsWith('/document-read-model')) {
      const candidateId = decodeURIComponent(pathname.split('/').at(-2) || '');
      return json(route, 200, { success: true, data: readModels.get(candidateId) });
    }
    if (failures.command) return json(route, 503, { success: false, error: 'فرمان آزمایشی ناموفق بود.' });
    if (pathname.endsWith('/decision')) return json(route, 200, { success: true, data: { waybill: { id: 'bundle-1260' } } });
    if (pathname.endsWith('/replace')) return json(route, 200, { success: true, data: { replacement: { id: 'bundle-1266' } } });
    const body = request.postDataJSON() as { kind: string };
    const issued = workspace.cases.find((item) => item.state === 'ISSUED')!;
    const requested = body.kind === 'PRINT_BOTH' ? ['WAYBILL', 'STATEMENT'] : [body.kind.endsWith('WAYBILL') ? 'WAYBILL' : 'STATEMENT'];
    return json(route, 200, { success: true, data: { artifacts: requested.map((kind) => ({ kind, url: 'data:application/pdf;base64,JVBERi0xLjQK', fileName: `${kind.toLowerCase()}-${issued.bundle?.number}.pdf` })) } });
  });
  return failures;
};

test('MANAGE projection keeps the split queue and rejection work', async ({ page }) => {
  await login(page); await projectAuthenticatedReadModel(page, 'MANAGE');
  await page.goto('/dashboard/accounting/dispatch-documents');
  await expect(page.getByRole('heading', { name: 'اسناد ارسال مشتری' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'آماده · ۱' })).toBeVisible();
  const rejection = page.getByRole('textbox', { name: 'دلیل رد پرونده اسناد ارسال' });
  await rejection.fill('نیازمند اصلاح ردیف منبع');
  await page.getByRole('button', { name: 'مسدود · ۱' }).click();
  await page.getByRole('button', { name: 'آماده · ۱' }).click();
  await expect(rejection).toHaveValue('نیازمند اصلاح ردیف منبع');
});

test('VIEW projection exposes retained documents without mutation controls', async ({ page }) => {
  await login(page); await projectAuthenticatedReadModel(page, 'VIEW');
  await page.goto('/dashboard/accounting/dispatch-documents');
  await expect(page.getByText(/فقط برای مشاهده و دریافت اسناد/)).toBeVisible();
  await page.getByRole('button', { name: 'صادرشده · ۱' }).click();
  await expect(page.getByRole('button', { name: 'چاپ هر دو' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'پذیرش و صدور هر دو سند' })).toHaveCount(0);
  await page.getByRole('button', { name: 'اقدامات بیشتر' }).click();
  await expect(page.getByText('جایگزینی بسته اسناد')).toHaveCount(0);
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
  const rejection = page.getByRole('textbox', { name: 'دلیل رد پرونده اسناد ارسال' });
  await rejection.fill('این دلیل نباید از بین برود');
  failures.command = true;
  await page.getByRole('button', { name: 'رد برای اصلاح در منبع' }).click();
  await expect(page.getByText('فرمان آزمایشی ناموفق بود.').first()).toBeVisible();
  await expect(rejection).toHaveValue('این دلیل نباید از بین برود');
  failures.command = false; failures.load = true;
  await page.getByRole('button', { name: 'تازه‌سازی' }).click();
  await expect(page.getByText(/آخرین نمایش موفق حفظ شده است/).first()).toBeVisible();
  await expect(rejection).toHaveValue('این دلیل نباید از بین برود');
  failures.load = false;
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'دلیل رد پرونده اسناد ارسال' })).toHaveValue('این دلیل نباید از بین برود');
});

test('selected review stays before the queue at 390px and remains keyboard usable at 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page); await projectAuthenticatedReadModel(page, 'MANAGE');
  await page.goto('/dashboard/accounting/dispatch-documents');
  const selectedHeading = page.getByRole('heading', { name: /ارسال ۱۲۶۰/ });
  const queue = page.getByLabel('صف پرونده‌های اسناد ارسال');
  const selectedBox = await selectedHeading.boundingBox(); const queueBox = await queue.boundingBox();
  expect(selectedBox).not.toBeNull(); expect(queueBox).not.toBeNull(); expect(selectedBox!.y).toBeLessThan(queueBox!.y);
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await expect(page.getByRole('button', { name: 'پذیرش و صدور هر دو سند' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Tab'); await expect(page.locator(':focus')).toBeVisible();
});
