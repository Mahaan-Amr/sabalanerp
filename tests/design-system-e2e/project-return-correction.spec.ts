import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Accounting assigns a finalized correction and Logistics revises the same customer’s quantities at 390px', async ({ page }) => {
  const accounting = '/dashboard/accounting/returns';
  const logistics = '/dashboard/logistics/returns/project';
  const date = '2026-11-25T08:00:00.000Z';
  const customerId = 'customer-511';
  const customerName = 'مشتری آزمون اصلاح';
  const project = { projectId: 'project-511', projectName: 'پروژه سپید' };
  const product = { productId: 'product-511', productName: 'سنگ آزمون اصلاح', productCode: 'RETURN-511', unit: 'squareMeter' };
  const legacyId = 'legacy-511';
  const caseId = 'case-511';
  const oldReceipt = {
    ...product, id: legacyId, customerId, customerName, createdAt: date,
    receivedQuantity: '40', acceptedQuantity: '35', rejectedQuantity: '5', rejectionReason: 'لب‌پریدگی',
  };
  const finalization = {
    id: 'final-511', draftVersion: 1, documentDate: date,
    summary: { agreedUnitRateRials: '2500000', originalNetRials: '60000000', originalTaxRials: '6000000',
      customerCreditRials: '87500000', credits: [] },
  };
  const prior = {
    receipt: oldReceipt, finalizationId: finalization.id, finalizedAt: date,
    agreedUnitRateRials: '2500000', creditRials: '87500000', sourceChanged: false, projectAttributionKnown: false,
    rows: [{ id: 'share-511', originalInvoiceNumber: 'SALE-511', contractNumber: 'CONTRACT-511', quantity: '35', projectName: null }],
    credits: [{ creditInvoiceId: 'credit-511', creditNumber: 'RETURN-511', voucherId: 'voucher-511', voucherNumber: 51,
      availableRials: '87500000', customerCreditRials: '87500000', usedRials: '0', reducedRials: '0', voucherStatus: 'POSTED',
      taxDocument: { id: 'tax-511', serial: 'TAX-RETURN-511', status: 'QUEUED' } }],
  };
  let opened = false;
  let assigned = true;
  let number = 1;
  let healthyQuantity = '35';
  let projects: (typeof project)[] = [];
  const versionId = () => `proposal-${number}`;
  const receipt = () => ({
    id: caseId, customerId, customerName, createdAt: date, visit: null, legacyFinalizationId: finalization.id,
    operationStatus: 'ACTIVE', canManage: false, canSubmitCorrection: assigned, operations: [], versions: [], operational: null,
    version: { id: versionId(), number, submittedAt: assigned ? null : date, assignedAt: assigned ? date : null, projects,
      items: [{ ...product, id: 'item-511', healthyQuantity, damagedQuantity: '5' }] },
  });
  const blocks = [{ code: 'HISTORICAL_PROJECT_UNKNOWN', message: 'پروژهٔ ثبت قطعی تاریخی قابل احراز نیست.' }];
  await page.route(/\/api\/accounting\/stone-returns\/legacy-511$/, route => route.fulfill({
    json: { success: true, data: {
      receipt: oldReceipt, allocationStatus: 'FINALIZED', canAllocate: true, canFinalize: true,
      candidates: [], finalization, draft: null, allocatedQuantity: '35', unallocatedQuantity: '0',
    } },
  }));
  await page.route(/\/api\/accounting\/project-returns\//, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/legacy/legacy-511/correction')) {
      expect(route.request().method()).toBe('POST');
      opened = true;
      return route.fulfill({ json: { success: true, data: { id: caseId } } });
    }
    expect(opened).toBe(true);
    if (url.pathname.endsWith('/correction/return')) {
      expect(route.request().postDataJSON()).toEqual({ expectedVersionId: versionId(), expectedDraftNumber: 0 });
      assigned = true;
      number++;
      return route.fulfill({ json: { success: true, data: { id: caseId } } });
    }
    const data = receipt();
    return route.fulfill({ json: { success: true, data: {
      receipt: data, prior, draft: null, canAllocate: true, allocationStatus: assigned ? 'CORRECTION_WITH_LOGISTICS' : 'RECEIVED',
      correctionBlocks: blocks, postingBlock: blocks[0],
      items: data.version.items.map(item => ({ ...item, candidates: [], rows: [], agreedUnitRateRials: null,
        allocatedQuantity: '0', unallocatedQuantity: healthyQuantity })),
    } } });
  });
  await page.route(/\/api\/logistics\/project-returns(?:[/?]|$)/, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/projects')) {
      expect(url.pathname).toContain(customerId);
      return route.fulfill({ json: { success: true, data: [{ id: project.projectId, label: project.projectName }] } });
    }
    if (url.pathname.endsWith('/correction/submit')) {
      const quantity = number === 1 ? '36' : '34';
      expect(route.request().postDataJSON()).toEqual({
        expectedVersionId: versionId(), projectIds: [project.projectId],
        items: [{ productId: product.productId, unit: product.unit, healthyQuantity: quantity, damagedQuantity: '5' }],
      });
      assigned = false;
      healthyQuantity = quantity;
      projects = [project];
      number++;
      return route.fulfill({ json: { success: true, data: receipt() } });
    }
    return route.fulfill({ json: { success: true, data: url.pathname.endsWith(caseId) ? receipt() : { items: [receipt()], nextCursor: null } } });
  });

  await loginAsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${accounting}/${legacyId}`);
  await page.getByRole('button', { name: 'بازکردن نسخهٔ اصلاحی', exact: true }).click();
  await expect(page).toHaveURL(`${accounting}/project/${caseId}`);
  await expect(page.getByRole('heading', { name: 'مرجوعی قطعی قبلی' })).toBeVisible();
  await expect(page.getByText('اصلاح نزد لجستیک', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ذخیره پیش‌نویس' })).toHaveCount(0);

  await page.goto(logistics);
  await page.getByRole('link', { name: 'مشاهده اصلاح', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'اصلاح مرجوعی قطعی', exact: true })).toBeVisible();
  await expect(page.getByText(customerName, { exact: true })).toBeVisible();
  const quantityInput = page.getByRole('textbox', { name: /مقدار سالم/ });
  await expect(quantityInput).toHaveValue('35');
  await page.getByRole('combobox', { name: 'انتخاب پروژهٔ مشتری' }).click();
  await page.getByRole('option', { name: project.projectName, exact: true }).click();
  await quantityInput.fill('۳۶');
  await page.getByRole('button', { name: 'ارسال اصلاح به حسابداری' }).click();
  await expect(page.getByText('اصلاح ارسال شد', { exact: true })).toBeVisible();

  await page.goto(`${accounting}/project/${caseId}`);
  await expect(page.getByText('نسخهٔ پیشنهادی', { exact: true })).toBeVisible();
  await expect(page.getByText('بستانکاری ثبت‌شده', { exact: true })).toBeVisible();
  await expect(page.getByText('تسویه یا مصرف‌شده', { exact: true })).toBeVisible();
  await expect(page.getByText(blocks[0].message, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ارجاع دوباره به لجستیک' }).click();
  await expect(page.getByText('اصلاح نزد لجستیک', { exact: true })).toBeVisible();
  await page.goto(`${logistics}/${caseId}`);
  await expect(quantityInput).toHaveValue('36');
  await quantityInput.fill('۳۴');
  await page.getByRole('button', { name: 'ارسال اصلاح به حسابداری' }).click();
  await expect(page.getByText('اصلاح ارسال شد', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^۳۴ مترمربع$/)).toBeVisible();
  expect(await page.locator('main.sds-workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
