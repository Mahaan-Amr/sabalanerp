import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

test('contract creation keeps date, customer selection and return navigation intact with readable RTL', async ({ page }, info) => {
  await loginAsAdmin(page);
  // Complete cold Next dev compilation before leaving the current document.
  expect((await page.request.get('/dashboard/sales/contracts/create')).ok()).toBe(true);
  await page.waitForLoadState('networkidle');
  await page.goto('/dashboard/sales/contracts/create');
  const workflow = page.locator('main.sds-workspace');
  await expect(workflow.getByRole('heading', { name: 'اطلاعات ثبت', exact: true })).toBeVisible();
  await setViewportAndZoom(page, { width: 1600, height: 1050 });
  const dateBounds = await workflow.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last().boundingBox();
  const contentBounds = await workflow.locator('.step-content-card').boundingBox();
  const registrationBounds = await workflow.getByRole('heading', { name: 'اطلاعات ثبت', exact: true }).boundingBox();
  const creatorBounds = await workflow.getByText('ثبت‌کننده', { exact: true }).boundingBox();
  const numberBounds = await workflow.getByText('شماره احتمالی قرارداد', { exact: true }).boundingBox();
  expect(Math.abs(dateBounds!.x + dateBounds!.width / 2 - contentBounds!.x - contentBounds!.width / 2)).toBeLessThan(2);
  expect(registrationBounds!.y).toBeGreaterThan(dateBounds!.y + dateBounds!.height);
  expect(numberBounds!.y).toBeGreaterThan(creatorBounds!.y + creatorBounds!.height);

  await expect(workflow.getByText('ثبت‌کننده', { exact: true })).toBeVisible();
  await expect(workflow.getByRole('textbox', { name: /شماره احتمالی/ })).toHaveCount(0);
  await expect(workflow.getByText('شماره نهایی هنگام ثبت قرارداد در سرور قطعی می‌شود.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const next = workflow.getByRole('button', { name: 'ادامه: انتخاب مشتری', exact: true });
  await expect(next).toBeVisible();
  await workflow.getByRole('button', { name: 'تاریخ قرارداد', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'انتخاب تاریخ شمسی' })).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [400, 600, 700].every(weight => document.fonts.check(`${weight} 14px "Yekan Bakh"`, 'قرارداد فروش')))).toBe(true);
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`create-date-${theme}.png`) });
  }
  await next.click();
  const search = workflow.getByRole('searchbox', { name: 'جستجوی مشتری' });
  await expect(search).toBeVisible();
  const customerRows = workflow.getByRole('group', { name: 'انتخاب مشتری', exact: true }).getByRole('button');
  await expect(customerRows.first()).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: info.outputPath(`create-customer-${theme}.png`) });
  }
  await search.fill('نام‌ناموجود-پیش‌نمایش-قرارداد-qa');
  await expect(workflow.getByText('مشتری‌ای با این عبارت پیدا نشد', { exact: true })).toBeVisible();
  await search.clear();
  await expect(customerRows.first()).toBeVisible();
  const customerName = await customerRows.first().getByRole('heading').innerText();
  await customerRows.first().click();
  await expect(customerRows.first()).toHaveAttribute('aria-pressed', 'true');
  await workflow.getByRole('button', { name: 'ادامه: مدیریت پروژه', exact: true }).click();
  await expect(workflow.getByText(`پروژه‌های ${customerName}`, { exact: true })).toBeVisible();
  await workflow.getByRole('button', { name: 'قبلی', exact: true }).click();
  await expect(workflow.getByText('مشتری انتخاب شده', { exact: true })).toBeVisible();
  await expect(customerRows.first()).toHaveAttribute('aria-pressed', 'true');
  await setViewportAndZoom(page, { width: 390, height: 1000 });
  await setTheme(page, 'dark');
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.screenshot({ path: info.outputPath('create-customer-mobile.png'), fullPage: true });
  await workflow.getByRole('button', { name: 'قبلی', exact: true }).click();
  await expect(next).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('create-date-mobile.png'), fullPage: true });
  await setViewportAndZoom(page, { width: 1280, height: 1000 }, 2);
  await assertNoHorizontalOverflow(page);
});
