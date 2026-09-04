import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client';
import { parseCanonicalProductGraph, projectCanonicalProductGraph } from '../../packages/contract-product-graph/src';
import { loginAsAdmin, setTheme, assertNoHorizontalOverflow } from './support/design-system';

const fixture = JSON.parse(readFileSync('packages/contract-product-graph/src/__tests__/fixtures/remaining-child-chain.json', 'utf8'));

test('real remaining-chain draft saves, reloads, edits and reaches accounting without money or inventory drift', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const databaseUrl = process.env.REMAINING_RECOVERY_QA_DATABASE_URL ||
    'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
  expect(new URL(databaseUrl).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  expect(new URL(databaseUrl).port).toBe('55432');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const key = `qa-remaining-ui-${randomUUID()}`;
  const productIds: string[] = [];
  const draftIds = new Set<string>();
  const errors: string[] = [];
  const failures: string[] = [];
  let customerId: string | undefined;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 500) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    if (response.request().method() === 'POST' && response.url().includes('/contract-edit-sessions/')) {
      const draft = response.request().postDataJSON()?.draftId;
      if (typeof draft === 'string') draftIds.add(draft);
    }
  });
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { username: process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin' } });
    const customer = await db.crmCustomer.create({ data: { firstName: 'آزمون', lastName: key,
      ownerUserId: admin.id, createdBy: admin.id } });
    customerId = customer.id;
    const project = await db.projectAddress.create({ data: { customerId, address: 'قصرالدشت — آزمون محلی', city: 'شیراز', projectName: 'آزمون باقی‌مانده', projectType: 'مسکونی' } });
    let serialized = JSON.stringify(fixture);
    for (const [index, catalogId] of [...new Set<string>(fixture.map((p: any) => p.productId))].entries()) {
      const p = await db.product.create({ data: { code: `${key}-${index}`, name: key, namePersian: fixture[index === 0 ? 0 : 4].stoneName,
        cuttingDimensionCode: 'qa', cuttingDimensionName: 'qa', cuttingDimensionNamePersian: 'آزمون',
        stoneTypeCode: 'qa', stoneTypeName: 'qa', stoneTypeNamePersian: 'آزمون', widthCode: 'qa', widthValue: 40, widthName: 'qa',
        thicknessCode: 'qa', thicknessValue: 2, thicknessName: 'qa', mineCode: 'qa', mineName: 'qa', mineNamePersian: 'آزمون',
        finishCode: 'qa', finishName: 'qa', finishNamePersian: 'آزمون', colorCode: 'qa', colorName: 'qa', colorNamePersian: 'آزمون',
        qualityCode: 'qa', qualityName: 'qa', qualityNamePersian: 'آزمون', images: [] } });
      productIds.push(p.id);
      serialized = serialized.split(catalogId).join(p.id);
    }
    const products = JSON.parse(serialized);
    await loginAsAdmin(page);
    const wizardData = { contractKind: 'standard', contractDate: '1405/06/04', contractNumber: '', creatorSequenceNumber: null,
      customerId, customer: { ...customer, projectAddresses: [project], phoneNumbers: [] }, projectId: project.id, project,
      selectedProductTypeForAddition: null, products, serviceRows: [], discount: null, signature: null,
      deliveries: [{ deliveryDate: '1405/06/07', deliveryAddress: project.address, projectManagerName: 'آزمون', receiverName: 'آزمون',
        products: products.map((p: any, index: number) => ({ productRowId: p.rowId, productIndex: index, productId: p.productId,
          quantity: p.quantity, unit: p.productType === 'longitudinal' ? 'meter' : 'count',
          amount: p.productType === 'longitudinal' ? p.length * p.quantity : p.quantity })) }],
      payment: { payments: [{ id: key, method: 'CASH_CARD', amount: 23071875, paymentDate: '1405/06/05', status: 'WILL_BE_PAID' }],
        currency: 'تومان', totalContractAmount: 23071875 } };
    // Exercise the real recovered-draft entry point, without intercepting any application endpoint.
    await page.evaluate(data => localStorage.setItem('contractWizardState', JSON.stringify({ currentStep: 8, wizardData: data })), wizardData);
    await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=8', { waitUntil: 'domcontentloaded' });
    const submit = page.getByRole('button', { name: 'ثبت قرارداد', exact: true });
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/sales/contracts') && r.request().method() === 'POST');
    await submit.click();
    const response = await responsePromise;
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    const id = body.data.id;
    const load = () => db.salesContract.findUniqueOrThrow({ where: { id }, include: { productGraphState: true, items: true, deliveries: true, payments: true } });
    const saved = await load();
    expect(saved.totalAmount!.toString()).toBe('23071875');
    expect(saved.items).toHaveLength(5);
    expect(saved.deliveries).toHaveLength(1);
    expect(saved.payments).toHaveLength(1);
    const graph = parseCanonicalProductGraph(saved.productGraphState!.graph);
    expect(graph.allocations.map(a => a.consumedSourcePieces)).toEqual([5, 5, 1]);
    expect(graph.remainingStones.map(s => [s.widthMeters, s.quantity]).sort()).toEqual([['0.001', 5], ['0.02', 1], ['0.03', 11]].sort());
    for (const audience of ['pdf', 'accounting', 'workshop', 'delivery', 'logistics'] as const) {
      expect(projectCanonicalProductGraph(graph, audience).products.slice(1, 4).map(p => p.baseAmountToman)).toEqual(['0', '0', '0']);
    }
    await expect(page).toHaveURL(new RegExp(`/dashboard/sales/contracts/${id}`), { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'اطلاعات قرارداد', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'اطلاعات قرارداد', exact: true })).toBeVisible({ timeout: 60_000 });
    for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await setTheme(page, theme);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`saved-${width}-${theme}.png`), fullPage: true });
      await page.screenshot({ path: testInfo.outputPath(`saved-${width}-${theme}-viewport.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const variant of ['original', 'summary']) {
      await page.getByRole('combobox', { name: 'نسخه چاپ' }).selectOption(variant);
      // A cold PDF render can take close to one minute in the constrained local
      // Compose runtime; keep the record alive until that real render completes.
      const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
      await page.getByRole('button', { name: 'دانلود PDF', exact: true }).click();
      const download = await downloadPromise;
      const pdfPath = testInfo.outputPath(`contract-${variant}.pdf`);
      await download.saveAs(pdfPath);
      expect(readFileSync(pdfPath).subarray(0, 4).toString()).toBe('%PDF');
    }
    await page.getByRole('link', { name: 'ویرایش', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ویرایش قرارداد', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('navigation', { name: 'مراحل ویرایش قرارداد' }).getByRole('button', { name: 'انتخاب محصولات' }).click();
    await page.screenshot({ path: testInfo.outputPath('edit-products.png'), fullPage: true });
    const updatePromise = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/sales/contracts/${id}`) && r.request().method() === 'PUT', { timeout: 30_000 });
    await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
    const updatedResponse = await updatePromise;
    expect(updatedResponse.status(), JSON.stringify(await updatedResponse.json())).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/dashboard/sales/contracts/${id}(?:\\?|$)`), { timeout: 60_000 });
    const edited = await load();
    expect(edited.totalAmount!.toString()).toBe('23071875');
    expect(edited.items.map(i => i.id).sort()).toEqual(saved.items.map(i => i.id).sort());
    expect(parseCanonicalProductGraph(edited.productGraphState!.graph).allocations).toEqual(graph.allocations);
    await page.goto(`/dashboard/accounting/contracts/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'خلاصه قرارداد', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath('accounting.png'), fullPage: true });
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
    await testInfo.attach('persisted-evidence', { body: JSON.stringify({ contractNumber: saved.contractNumber,
      rows: saved.items.length, amount: saved.totalAmount!.toString(), graphRevision: edited.productGraphState!.revision,
      allocations: graph.allocations.map(a => a.consumedSourcePieces), consoleErrors: errors, serverFailures: failures }), contentType: 'application/json' });
  } finally {
    await testInfo.attach('browser-diagnostics', { body: JSON.stringify({ errors, failures }), contentType: 'application/json' });
    try {
      if (customerId) {
        const contracts = await db.salesContract.findMany({ where: { customerId }, select: { id: true } });
        const ids = contracts.map(c => c.id);
        const events = await db.notificationEvent.findMany({ where: { resourceId: { in: ids } }, select: { id: true } });
        await db.notification.deleteMany({ where: { eventId: { in: events.map(e => e.id) } } });
        await db.notificationEvent.deleteMany({ where: { id: { in: events.map(e => e.id) } } });
        await db.salesContractEditSession.deleteMany({ where: { OR: [{ contractId: { in: ids } }, { draftId: { in: [...draftIds] } }] } });
        await db.salesContractDraftAudit.deleteMany({ where: { draftId: { in: [...draftIds] } } });
        await db.crmCustomer.delete({ where: { id: customerId } });
      }
      await db.product.deleteMany({ where: { id: { in: productIds } } });
    } finally { await db.$disconnect(); }
  }
});
