import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';
import { remainingRecoveryGuidance } from '../../backend/src/services/remainingRecoveryGuidance';

const products = JSON.parse(readFileSync('packages/contract-product-graph/src/__tests__/fixtures/remaining-child-chain.json', 'utf8'));

test('remaining recovery error keeps every row and shows exact chain guidance on mobile', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  let submitted: any;
  const guidance = remainingRecoveryGuidance(products, products[1].rowId, 'cutting-price-drift');
  const message = `${guidance.message} کد پیگیری: remaining-recovery-e2e`;
  await page.route('**/sales/contract-edit-sessions/**', async route => {
    const acquire = route.request().url().endsWith('/acquire');
    const discover = route.request().url().endsWith('/discover');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true,
      data: discover ? null : acquire ? { session: { leaseToken: 'remaining-recovery-e2e' }, recovery: null } : {} }) });
  });
  await page.route('**/sales/contracts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false,
      code: 'contract-product-graph-validation-failed', trackingId: 'remaining-recovery-e2e',
      details: [{ code: 'legacy-remaining-recovery-required', path: `productRow:${products[1].rowId}`,
        productRowId: products[1].rowId, ...guidance, message }] }) });
  });
  await loginAsAdmin(page);
  await page.evaluate(products => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sabalan-contract-active-draft:') || key.startsWith('contract-recovery:')) localStorage.removeItem(key);
    }
    const project = { id: 'e2e-project', customerId: 'e2e-customer', address: 'آدرس آزمون', city: 'شیراز', isActive: true };
    localStorage.setItem('contractWizardState', JSON.stringify({ currentStep: 8, wizardData: {
      contractKind: 'standard', contractDate: '1405/06/04', contractNumber: 'E2E-REMAINING', creatorSequenceNumber: null,
      customerId: 'e2e-customer', customer: { id: 'e2e-customer', firstName: 'مشتری', lastName: 'آزمون', customerType: 'Individual',
        status: 'Active', projectAddresses: [project], phoneNumbers: [], isBlacklisted: false, isLocked: false },
      projectId: project.id, project, selectedProductTypeForAddition: null, products, serviceRows: [], deliveries: [],
      payment: { payments: [], currency: 'تومان', totalContractAmount: 23071875 }, discount: null, signature: null
    } }));
  }, products);
  await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=8', { waitUntil: 'domcontentloaded' });
  const submit = page.getByRole('button', { name: 'ثبت قرارداد', exact: true });
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
  await expect.poll(() => submitted).toBeTruthy();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  // The legacy return-navigation key is intentionally consumed on hydration; recovery lives in the scoped journal.
  const recoveredProducts = () => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('contract-recovery:v2:'))
    .map(key => JSON.parse(localStorage.getItem(key) || '{}'))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.payload?.wizardData?.products);
  await expect.poll(async () => (await recoveredProducts())?.length).toBe(5);
  const retained = await recoveredProducts();
  expect(retained.map((p: any) => p.rowId)).toEqual(products.map((p: any) => p.rowId));
  expect(retained.map((p: any) => p.totalPrice)).toEqual(submitted.contractData.products.map((p: any) => p.totalPrice));
  expect(retained.slice(1, 4).map((p: any) => p.meta.remainingSource.consumedSourceStoneIds))
    .toEqual(products.slice(1, 4).map((p: any) => p.meta.remainingSource.consumedSourceStoneIds));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText(message, { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('remaining-recovery-mobile.png'), fullPage: true });
});
