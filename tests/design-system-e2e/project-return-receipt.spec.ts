import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Logistics records multiple project products with direct and line-based quantities at 390px', async ({ page }) => {
  const visit = {
    id: 'return-506', driverSource: 'PERSONAL_PICKUP', status: 'WAITING_AT_GATE', projectReturnStatus: 'AWAITING_RECEIPT',
    driverName: 'راننده آزمون', vehicleType: 'سواری', plate: '12 ب 345 ایران 67', admittedAt: '2026-11-25T08:00:00.000Z',
  };
  const linearCalculation = { khatRas: '1.2', pieceCount: '3', plus: '0.3', minus: '0.1' };
  const projects = [{ projectId: 'project-506', projectName: 'پروژه سپید' }, { projectId: 'project-507', projectName: 'پروژه دوم' }];
  const direct = { productId: 'product-506', unit: 'squareMeter', healthyQuantity: '35', damagedQuantity: '5' };
  const linear = { productId: 'product-507', unit: 'meter', healthyQuantity: '0', damagedCalculation: linearCalculation };
  const receipt = {
    operationStatus: 'ACTIVE', canManage: true, operational: null, versions: [], operations: [],
    id: 'case-506', customerId: 'customer-506', customerName: 'مشتری آزمون', createdAt: visit.admittedAt,
    visit: { ...visit, projectReturnStatus: 'RECEIVED' },
    version: {
      id: 'version-506', number: 1, submittedAt: visit.admittedAt,
      projects,
      items: [
        { ...direct, id: 'item-506', productName: 'سنگ گرانیت سپید', productCode: 'RETURN-506' },
        { ...linear, id: 'item-507', productName: 'سنگ طولی', productCode: 'LINEAR-507', damagedQuantity: '3.8' },
      ],
    },
  };
  let persisted = false;
  await page.route(/\/api\/logistics\/project-return-visits(?:[/?]|$)/, route => route.fulfill({
    json: { success: true, data: persisted ? [] : [visit], capabilities: { canCancel: true } },
  }));
  await page.route(/\/api\/logistics\/stone-returns(?:[/?]|$)/, route => route.fulfill({
    json: { success: true, data: { items: [], nextCursor: null, canRecord: true } },
  }));
  await page.route(/\/api\/logistics\/project-returns(?:[/?]|$)/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') {
      expect(req.postDataJSON()).toEqual({
        visitId: visit.id, customerId: receipt.customerId, projectIds: ['project-506', 'project-507'],
        items: [direct, linear],
      });
      persisted = true;
      return route.fulfill({ status: 201, json: { success: true, data: receipt } });
    }
    if (url.pathname.endsWith('/customers')) return route.fulfill({
      json: { success: true, data: [{ id: receipt.customerId, label: receipt.customerName }] },
    });
    if (url.pathname.endsWith('/projects')) return route.fulfill({
      json: { success: true, data: projects.map(({ projectId, projectName }) => ({ id: projectId, label: projectName })) },
    });
    if (url.pathname.endsWith('/products')) {
      expect(url.searchParams.get('customerId')).toBe(receipt.customerId);
      expect(url.searchParams.getAll('projectId')).toEqual(['project-506', 'project-507']);
      const entries = receipt.version.items.map(({ productId, productName, productCode, unit }) => ({ productId, productName, productCode, unit }));
      return route.fulfill({ json: { success: true,
        data: entries.filter(item => item.productName.includes(url.searchParams.get('search') || '')),
      } });
    }
    if (url.pathname.endsWith('/case-506')) {
      expect(persisted).toBe(true);
      return route.fulfill({ json: { success: true, data: receipt } });
    }
    return route.fulfill({ json: { success: true, data: { items: persisted ? [receipt] : [], nextCursor: null } } });
  });

  await loginAsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/logistics/returns');
  await page.getByRole('link', { name: 'ثبت دریافت', exact: true }).click();
  await expect(page.getByText('مرحله ۱ از ۳', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /راننده و خودرو/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'مرحله قبل', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'انتخاب مشتری', exact: true }).click();
  await page.getByRole('option', { name: 'مشتری آزمون', exact: true }).click();
  await page.getByRole('combobox', { name: 'انتخاب پروژه', exact: true }).click();
  await page.getByRole('option', { name: 'پروژه سپید', exact: true }).click();
  await page.getByRole('combobox', { name: 'انتخاب پروژه', exact: true }).click();
  await page.getByRole('option', { name: 'پروژه دوم', exact: true }).click();
  await page.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await page.getByRole('combobox', { name: 'جست‌وجوی محصول پروژه', exact: true }).click();
  await page.getByRole('textbox', { name: 'جستجوی گزینه‌ها', exact: true }).fill('سپید');
  await page.getByRole('option', { name: /سنگ گرانیت سپید/ }).click();
  await page.getByRole('textbox', { name: /مقدار سالم/ }).fill('۳۵');
  await page.getByRole('textbox', { name: /مقدار آسیب‌دیده/ }).fill('۵');
  await page.getByRole('combobox', { name: 'جست‌وجوی محصول پروژه', exact: true }).click();
  await page.getByRole('textbox', { name: 'جستجوی گزینه‌ها', exact: true }).fill('طولی');
  await page.getByRole('option', { name: /سنگ طولی/ }).click();
  const length = page.getByRole('group', { name: 'مقدار آسیب‌دیده سنگ طولی' });
  await length.getByRole('button', { name: 'خط راس', exact: true }).click();
  await length.getByRole('textbox', { name: 'خط راس', exact: true }).fill('۱٫۲');
  await length.getByRole('textbox', { name: 'تعداد', exact: true }).fill('۳');
  await length.getByRole('textbox', { name: 'اضافه', exact: true }).fill('۰٫۳');
  await length.getByRole('textbox', { name: 'کسر', exact: true }).fill('۰٫۱');
  await page.getByRole('button', { name: 'مرحله بعد', exact: true }).click();
  await expect(page.getByText('پروژه سپید، پروژه دوم', { exact: true })).toBeVisible();
  await expect(page.getByText(/^۳٫۸.*متر طول/)).toBeVisible();
  await page.getByRole('button', { name: 'ثبت نهایی دریافت', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/logistics\/returns\/project\/case-506$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'رسید مرجوعی پروژه' })).toBeVisible();
  await expect(page.getByText('سنگ گرانیت سپید', { exact: true })).toBeVisible();
  await expect(page.getByText(/۳۵.*مترمربع/)).toBeVisible();
  await expect(page.getByText(/^۵.*مترمربع/)).toBeVisible();
  await expect(page.getByText(/^۳٫۸.*متر طول/)).toBeVisible();
  expect(await page.locator('main.sds-workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
