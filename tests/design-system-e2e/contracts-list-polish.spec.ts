import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

test('contracts list keeps search, action menus and Persian RTL usable across themes and widths', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/sales/contracts');
  const search = page.getByRole('searchbox', { name: 'جستجو', exact: true });
  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();
  const number = (await rows.first().locator('td').first().locator('bdi').first().innerText()).trim();
  expect(number).not.toBe('');

  await setViewportAndZoom(page, { width: 1600, height: 1100 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('جستجو', { exact: true })).toBeVisible();
  await expect(search).toBeVisible();
  const searchBox = await search.boundingBox();
  const statusBox = await page.getByRole('combobox', { name: 'وضعیت', exact: true }).boundingBox();
  expect(searchBox!.width).toBeGreaterThan(statusBox!.width * 1.5);
  const firstRow = rows.first();
  await expect(firstRow.getByRole('link', { name: 'مشاهده', exact: true })).toHaveAttribute('href', /\/dashboard\/sales\/contracts\//);
  const more = firstRow.getByRole('button', { name: 'سایر عملیات', exact: true });
  await more.click();
  await expect(page.getByRole('dialog', { name: 'سایر عملیات', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'دانلود PDF', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'سایر عملیات', exact: true })).toBeHidden();
  await expect(more).toBeFocused();

  await search.fill(number);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').first()).toContainText(number);
  await search.clear();
  await expect(rows).toHaveCount(10);
  await search.blur();

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`contracts-${theme}-desktop.png`) });
  }
  await setTheme(page, 'dark');
  await setViewportAndZoom(page, { width: 390, height: 1000 });
  await assertNoHorizontalOverflow(page);
  await expect(search).toBeVisible();
  const mobileMore = page.getByRole('button', { name: 'سایر عملیات', exact: true }).filter({ visible: true }).first();
  await mobileMore.scrollIntoViewIfNeeded();
  await mobileMore.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('contracts-dark-mobile.png') });
  await setViewportAndZoom(page, { width: 1280, height: 1000 }, 2);
  await assertNoHorizontalOverflow(page);
});
