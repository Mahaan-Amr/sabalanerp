import { expect, test } from '@playwright/test';
import { loginAsAdmin, seedContractNavigation } from './support/design-system';

const draftCustomer = {
  id: 'qa-customer-outside-first-page',
  firstName: 'مشتری',
  lastName: 'قدیمی',
  customerType: 'Individual',
  status: 'Active',
  isBlacklisted: false,
  isLocked: false,
  phoneNumbers: [],
  projectAddresses: [{ id: 'qa-existing-project', projectName: 'پروژه قبلی', address: 'تهران', isActive: true }]
};

test('contract customer is actionable and a draft customer is restored before product catalogs are requested', async ({ page }, info) => {
  await loginAsAdmin(page);
  const catalogRoutes = ['/api/products', '/api/cutting-types', '/api/sub-services', '/api/stone-finishings'];
  const catalogRequests: string[] = [];
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (catalogRoutes.includes(pathname)) catalogRequests.push(pathname);
  });
  const customerRequests: Array<{ byId: boolean; limit: string | null }> = [];
  let customerResponseBytes = 0;
  const { projectAddresses: _projects, phoneNumbers: _phones, ...option } = draftCustomer;
  await page.route('**/api/crm/customer-options?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const byId = params.has('id');
    customerRequests.push({ byId, limit: params.get('limit') });
    const data = byId
      ? params.get('id') === option.id ? [{ ...option, phone: null }] : []
      : [{ ...option, id: 'qa-recent-customer', lastName: 'اخیر', phone: null }];
    const body = JSON.stringify({ success: true, data });
    customerResponseBytes += Buffer.byteLength(body);
    return route.fulfill({ contentType: 'application/json', body });
  });
  await page.route(`**/api/crm/customers/${draftCustomer.id}`, route =>
    route.fulfill({ json: { success: true, data: draftCustomer } }));
  await page.goto('/dashboard/sales/contracts/create?fresh=1', { waitUntil: 'commit' });
  const workflow = page.locator('main.sds-workspace');
  const date = workflow.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last();
  await date.click();
  await expect(page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' })).toBeVisible();
  const firstFieldMs = await page.evaluate(() => performance.now());
  await page.keyboard.press('Escape');
  await workflow.getByRole('button', { name: 'ادامه: انتخاب مشتری', exact: true }).click();
  const search = workflow.getByRole('searchbox', { name: 'جستجوی مشتری' });
  await expect(search).toBeEditable();
  await expect(workflow.getByRole('button', { name: /مشتری اخیر/ })).toBeVisible();
  const firstCustomerOptionMs = await page.evaluate(() => performance.now());
  expect(catalogRequests).toEqual([]);
  expect(customerRequests).toEqual([{ byId: false, limit: '3' }]);
  await info.attach('contract-first-interaction.json', {
    body: JSON.stringify({ firstFieldMs, firstCustomerOptionMs, customerResponseBytes, catalogRequests: catalogRequests.length }),
    contentType: 'application/json'
  });
  await seedContractNavigation(page, {
    currentStep: 2,
    wizardData: {
      contractKind: 'standard', contractDate: '1405/08/20', contractNumber: '',
      customerId: draftCustomer.id, customer: draftCustomer,
      projectId: draftCustomer.projectAddresses[0].id, project: draftCustomer.projectAddresses[0],
      selectedProductTypeForAddition: null, products: [], serviceRows: [], deliveries: [],
      payment: { currency: 'تومان', payments: [], totalContractAmount: 0 }, discount: null, signature: null,
    }
  });
  await page.goto('/dashboard/sales/contracts/create?fresh=1&returnTo=contract&step=2');
  await expect.poll(() => customerRequests.filter(request => request.byId).length).toBe(1);
  await expect(workflow.getByText('مشتری قدیمی', { exact: true })).toBeVisible();
  expect(catalogRequests).toEqual([]);
  await workflow.getByRole('button', { name: 'ادامه: مدیریت پروژه', exact: true }).click();
  await expect(workflow.getByText('پروژه انتخاب شده', { exact: true })).toBeVisible();
  expect(catalogRequests).toEqual([]);
  await workflow.getByRole('button', { name: 'ادامه: انتخاب محصولات', exact: true }).click();
  await expect.poll(() => [...catalogRequests].sort()).toEqual([...catalogRoutes].sort());
});
