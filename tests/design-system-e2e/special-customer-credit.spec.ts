import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';

for (const width of [1280, 390]) {
  test(`CRM customer credit persists category and finite/unlimited settings at ${width}px`, async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    const lastName = `اعتبار-${randomUUID()}`;
    let customerId: string | undefined;
    const request = async (path: string, method = 'GET', body?: unknown) => page.evaluate(async ({ path, method, body }) => {
      const response = await fetch(`/api${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }, { path, method, body });
    try {
      const created = await request('/crm/customers', 'POST', { firstName: 'آزمون', lastName, customerType: 'Individual', status: 'Active', phoneNumbers: [], projectAddresses: [] });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      customerId = created.body.data.id;
      await page.goto(`/dashboard/crm/customers/${customerId}`);
      await setViewportAndZoom(page, { width, height: 900 });
      await expect(page.getByText('مشتری عادی', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'تنظیم اعتبار', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'تنظیم اعتبار مشتری', exact: true });
      await dialog.getByLabel('دسته مشتری').selectOption('SPECIAL');
      await dialog.getByLabel('نوع سقف').selectOption('LIMITED');
      await dialog.getByLabel('سقف اعتبار (ریال)').fill('100000000');
      await dialog.getByLabel('دلیل تغییر').fill('آزمون خودکار مشتری مورد اعتماد');
      await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText('مشتری خاص', { exact: true })).toBeVisible();
      const saved = await request(`/crm/customers/${customerId}/credit`);
      expect(saved.body.data).toMatchObject({ trustCategory: 'SPECIAL', limitRials: '100000000', policyVersion: 1, usedRials: '0' });
      await page.reload();
      await expect(page.getByText('مشتری خاص', { exact: true })).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`customer-credit-${width}-${theme}.png`), fullPage: true });
      }
      await page.getByRole('button', { name: 'تنظیم اعتبار', exact: true }).click();
      await dialog.getByLabel('نوع سقف').selectOption('UNLIMITED');
      await dialog.getByLabel('دلیل تغییر').fill('آزمون بازگشت سقف به نامحدود');
      await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect((await request(`/crm/customers/${customerId}/credit`)).body.data.limitRials).toBeNull();
      const stale = await request(`/crm/customers/${customerId}/credit`, 'PUT', { trustCategory: 'NORMAL', limitRials: null, policyVersion: 0, reason: 'آزمون نسخه قدیمی' });
      expect(stale.status).toBe(409);
      // Recovered selections may contain an old NORMAL category. The payment modal must use live CRM eligibility.
      await page.evaluate(({ customerId, lastName }) => {
        localStorage.setItem('contractWizardState', JSON.stringify({ currentStep: 7, wizardData: {
          contractKind: 'standard', contractDate: '1405/07/12', contractNumber: '', creatorSequenceNumber: null,
          customerId, customer: { id: customerId, firstName: 'آزمون', lastName, trustCategory: 'NORMAL',
            customerType: 'Individual', status: 'Active', phoneNumbers: [], projectAddresses: [] }, projectId: '', project: null,
          selectedProductTypeForAddition: null, products: [{ rowId: 'credit-preview', productId: 'credit-preview', product: {},
            productType: 'slab', stoneCode: 'QA', stoneName: 'آزمون پرداخت', quantity: 1, squareMeters: 1,
            pricePerSquareMeter: 1000, originalTotalPrice: 1000, totalPrice: 1000, currency: 'تومان',
            lengthUnit: 'm', widthUnit: 'cm', isMandatory: false, mandatoryPercentage: 0, meta: { isLayer: false },
            remainingStones: [], cutDetails: [], appliedSubServices: [] }], serviceRows: [], deliveries: [],
          payment: { payments: [], currency: 'تومان', totalContractAmount: 1000 }, discount: null, signature: null,
        } }));
      }, { customerId, lastName });
      await page.goto('/dashboard/sales/contracts/create?returnTo=contract&step=7');
      await page.locator('main.sds-workspace').getByRole('button', { name: /^افزودن پرداخت/ }).click();
      const paymentDialog = page.getByRole('dialog', { name: 'افزودن پرداخت', exact: true });
      const method = paymentDialog.getByRole('combobox', { name: 'نوع پرداخت' });
      await expect(method.locator('option[value="SPECIAL_CUSTOMER_CREDIT"]')).toHaveCount(1);
      await method.selectOption('SPECIAL_CUSTOMER_CREDIT');
      await expect(paymentDialog.getByText(/اعتبار آزاد مشتری: نامحدود/)).toBeVisible();
      await expect(paymentDialog.getByText('تاریخ وعده پرداخت مشتری', { exact: true })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`special-credit-payment-${width}.png`), fullPage: true });
    } finally {
      await page.evaluate(() => localStorage.removeItem('contractWizardState'));
      if (customerId) {
        const preview = await request(`/crm/customers/${customerId}/deletion-preview`);
        const removed = await request(`/crm/customers/${customerId}`, 'DELETE', { reason: 'پاکسازی مشتری آزمون خودکار', confirmed: true, previewToken: preview.body.data.previewToken });
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      }
    }
  });
}
