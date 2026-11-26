import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, loginAsAdmin } from './support/design-system';

test.use({ hasTouch: true });

test('buyer-items counts stay in one row and the advanced price thumbs can be dragged on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  const contract = { id: 'contract', number: '100892', date: '2026-11-01', status: 'SIGNED', isInactive: false };
  const rows = [100, 500, 900].map((price, index) => ({
    id: String(index), name: `سنگ ${index + 1}`, productKey: String(index), contract,
    squareMeters: '1', linearMeters: null, pieceCount: null, mandatory: false,
    totalToman: String(price), beforeToman: String(price), afterToman: null, mandatoryPercentage: null,
  }));
  await page.route('**/api/crm/customers/buyer-items-test/buyer-items', route =>
    route.fulfill({ json: { success: true, data: { customerName: 'مشتری آزمایشی', rows } } }));
  await page.goto('/dashboard/crm/customers/buyer-items-test/buyer-items');

  const search = page.getByRole('searchbox', { name: 'جستجو' });
  await expect(search).toBeVisible();
  const stats = page.locator('dl[aria-label="شاخص‌های کلیدی"]');
  const metricTops = await stats.locator(':scope > div').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().top));
  expect(metricTops).toHaveLength(3);
  expect(new Set(metricTops).size).toBe(1);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await search.fill('۱۰۰۸۹۲');
  await expect(page.getByText('سنگ 3', { exact: true }).filter({ visible: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'فیلترهای پیشرفته', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'فیلترهای پیشرفته' });
  const lower = dialog.getByRole('slider', { name: 'از مبلغ' });
  const upper = dialog.getByRole('slider', { name: 'تا مبلغ' });
  await expect(lower).toHaveValue('100');
  await expect(upper).toHaveValue('900');
  const box = (await lower.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 22, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, y, { steps: 8 });
  await page.mouse.up();
  await expect(lower).not.toHaveValue('100');
  await expect(upper).toHaveValue('900');

  const touch = await page.context().newCDPSession(page);
  const touchX = box.x + 22;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y }] });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: touchX + step * 7, y }],
    });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await expect(upper).not.toHaveValue('900');
  await dialog.getByRole('button', { name: 'نمایش نتایج' }).click();
  await expect(page.getByText('سنگ 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('سنگ 2', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: /فیلترهای پیشرفته/ }).click();
  await dialog.getByRole('button', { name: 'بازنشانی فیلترها' }).click();
  await expect(lower).toHaveValue('100');
  await expect(upper).toHaveValue('900');
  await dialog.getByRole('button', { name: 'نمایش نتایج' }).click();
  await expect(search).toHaveValue('۱۰۰۸۹۲');
  await expect(page.getByText('سنگ 1', { exact: true }).filter({ visible: true })).toBeVisible();
});
